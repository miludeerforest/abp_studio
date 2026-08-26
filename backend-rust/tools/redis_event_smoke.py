#!/usr/bin/env python3
"""Exercise the Rust video event bridge against disposable Redis.

This test intentionally uses only the Rust backend.  Python's Redis contract
supplies the envelope/channel convention (events:global and events:user:{id});
Rust must publish the same envelope on both channels for processing, success,
and terminal failure transitions.
"""
from __future__ import annotations

import argparse
import base64
import json
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)


class RedisSubscriber(threading.Thread):
    def __init__(self, host: str, port: int, channels: list[str], timeout: float = 45.0):
        super().__init__(daemon=True)
        self.host = host
        self.port = port
        self.channels = channels
        self.timeout = timeout
        self.messages: list[tuple[str, dict[str, Any]]] = []
        self.ready = threading.Event()
        self.stop_requested = threading.Event()
        self.error: Exception | None = None

    def _readline(self, stream) -> bytes:
        line = stream.readline()
        if not line:
            raise EOFError("Redis connection closed")
        return line.rstrip(b"\r\n")

    def _read_response(self, stream) -> Any:
        prefix = stream.read(1)
        if not prefix:
            raise EOFError("Redis connection closed")
        if prefix == b"*":
            count = int(self._readline(stream))
            return [self._read_response(stream) for _ in range(count)]
        if prefix == b"$":
            length = int(self._readline(stream))
            if length < 0:
                return None
            data = stream.read(length)
            stream.read(2)
            return data.decode(errors="replace")
        if prefix in {b"+", b"-", b":"}:
            return self._readline(stream).decode(errors="replace")
        raise ValueError(f"unsupported Redis response prefix: {prefix!r}")

    def _command(self, sock: socket.socket, *parts: str) -> None:
        payload = [f"*{len(parts)}\r\n".encode()]
        for part in parts:
            encoded = part.encode()
            payload.append(f"${len(encoded)}\r\n".encode())
            payload.append(encoded + b"\r\n")
        sock.sendall(b"".join(payload))

    def run(self) -> None:
        try:
            with socket.create_connection((self.host, self.port), timeout=5) as sock:
                sock.settimeout(1)
                stream = sock.makefile("rwb", buffering=0)
                self._command(sock, "SUBSCRIBE", *self.channels)
                subscribed = 0
                while subscribed < len(self.channels):
                    response = self._read_response(stream)
                    if isinstance(response, list) and response and response[0] == "subscribe":
                        subscribed += 1
                self.ready.set()
                deadline = time.monotonic() + self.timeout
                while not self.stop_requested.is_set() and time.monotonic() < deadline:
                    try:
                        response = self._read_response(stream)
                    except socket.timeout:
                        continue
                    if not isinstance(response, list) or len(response) < 3 or response[0] != "message":
                        continue
                    channel = str(response[1])
                    raw = response[2]
                    try:
                        value = json.loads(raw)
                    except (TypeError, json.JSONDecodeError):
                        continue
                    if isinstance(value, dict):
                        self.messages.append((channel, value))
        except Exception as error:  # pragma: no cover - exercised by disposable environment
            self.error = error
            self.ready.set()

    def stop(self) -> None:
        self.stop_requested.set()


def decode_body(raw: bytes) -> Any:
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {"raw": raw.decode(errors="replace")}


def request(base: str, method: str, path: str, token: str, body: Any = None, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    data = None
    request_headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        data = json.dumps(body).encode()
        request_headers["Content-Type"] = "application/json"
    if headers:
        request_headers.update(headers)
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=data,
        headers=request_headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, decode_body(response.read())
    except urllib.error.HTTPError as error:
        return error.code, decode_body(error.read())


def login(base: str, username: str, password: str) -> str:
    data = urllib.parse.urlencode({"username": username, "password": password}).encode()
    req = urllib.request.Request(
        base.rstrip("/") + "/api/v1/login",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        value = json.loads(response.read())
    return value["access_token"]


def create_queue_item(base: str, token: str, prompt: str) -> str:
    boundary = "----abp-event-parity"
    chunks = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"event.png\"\r\nContent-Type: image/png\r\n\r\n".encode(),
        PNG,
        b"\r\n",
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\n{prompt}\r\n".encode(),
        f"--{boundary}--\r\n".encode(),
    ]
    req = urllib.request.Request(
        base.rstrip("/") + "/api/v1/queue",
        data=b"".join(chunks),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        value = json.loads(response.read())
    return str(value["id"])


def wait_for_event(messages: list[tuple[str, dict[str, Any]]], event_type: str, video_id: str) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if any(
            value.get("type") == event_type
            and isinstance(value.get("data"), dict)
            and value["data"].get("video_id") == video_id
            for _, value in messages
        ):
            return
        time.sleep(0.1)
    raise AssertionError(f"did not receive {event_type} for {video_id}")


def validate_event_matrix(messages: list[tuple[str, dict[str, Any]]], user_id: int, video_id: str, terminal_type: str) -> None:
    expected_types = ["video_processing", terminal_type]
    for event_type in expected_types:
        matching = [
            (channel, value)
            for channel, value in messages
            if value.get("type") == event_type
            and isinstance(value.get("data"), dict)
            and value["data"].get("video_id") == video_id
        ]
        channels = {channel for channel, _ in matching}
        expected_channels = {"events:global", f"events:user:{user_id}"}
        if channels != expected_channels:
            raise AssertionError(f"{event_type} channels {channels!r} != {expected_channels!r}")
        values = [value for _, value in matching]
        if len(values) < 2 or values[0] != values[1]:
            raise AssertionError(f"{event_type} global/user payloads differ: {values!r}")
        for value in values:
            if set(value) != {"type", "data", "timestamp"}:
                raise AssertionError(f"invalid envelope keys: {value!r}")
            if not isinstance(value["timestamp"], str):
                raise AssertionError(f"invalid timestamp: {value!r}")
            data = value["data"]
            if data.get("user_id") != user_id:
                raise AssertionError(f"invalid user id: {data!r}")
            if event_type == "video_processing" and set(data) != {"video_id", "user_id"}:
                raise AssertionError(f"invalid processing payload: {data!r}")
            if event_type == "video_completed" and set(data) != {"video_id", "user_id", "result_url"}:
                raise AssertionError(f"invalid completed payload: {data!r}")
            if event_type == "video_failed" and set(data) != {"video_id", "user_id", "error"}:
                raise AssertionError(f"invalid failed payload: {data!r}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rust", required=True)
    parser.add_argument("--redis-port", type=int, required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--admin-password", required=True)
    args = parser.parse_args()

    token = login(args.rust, "admin", args.admin_password)
    status, _ = request(
        args.rust,
        "POST",
        "/api/v1/config",
        token,
        {"video_api_url": args.provider, "video_api_key": "parity-event-key", "video_model_name": "stub-video-model"},
    )
    if status != 200:
        raise AssertionError(f"event test config failed: {status}")

    subscriber = RedisSubscriber("127.0.0.1", args.redis_port, ["events:global", "events:user:1"])
    subscriber.start()
    if not subscriber.ready.wait(5) or subscriber.error:
        raise AssertionError(f"Redis subscriber failed: {subscriber.error}")

    success_id = create_queue_item(args.rust, token, "Generate a video based on this image")
    status, _ = request(args.rust, "POST", f"/api/v1/queue/{success_id}/generate", token)
    if status != 200:
        raise AssertionError(f"success generation start failed: {status}")
    wait_for_event(subscriber.messages, "video_completed", success_id)
    validate_event_matrix(subscriber.messages, 1, success_id, "video_completed")

    failure_id = create_queue_item(args.rust, token, "FAIL_VIDEO")
    status, _ = request(args.rust, "POST", f"/api/v1/queue/{failure_id}/generate", token)
    if status != 200:
        raise AssertionError(f"failure generation start failed: {status}")
    wait_for_event(subscriber.messages, "video_failed", failure_id)
    validate_event_matrix(subscriber.messages, 1, failure_id, "video_failed")

    subscriber.stop()
    subscriber.join(timeout=2)
    print("PASS Redis event matrix: processing/completed/failed envelopes on global and user channels")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"FAIL Redis event matrix: {error}")
        raise SystemExit(1)
