#!/usr/bin/env python3
"""Isolated Python-vs-Rust write-contract smoke test.

This script MUST only target disposable databases/uploads/Redis instances. It
creates and removes one user and one queue item on each backend.
"""
from __future__ import annotations

import argparse
import base64
import json
import sys
import io
import zipfile
import os
import socket
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)
DYNAMIC_KEYS = {"access_token", "created_at", "updated_at", "last_retry_at"}


def decode_body(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw.decode(errors="replace")}


def request(
    base: str,
    method: str,
    path: str,
    token: str | None = None,
    body: Any = None,
    content_type: str = "application/json",
) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        headers["Content-Type"] = content_type
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(base.rstrip("/") + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            return response.status, decode_body(raw)
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, decode_body(raw)


def zip_request(base: str, path: str, token: str, body: Any) -> tuple[int, Any]:
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/zip",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = response.read()
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                entries = sorted(archive.namelist())
            return response.status, {
                "content_type": response.headers.get_content_type(),
                "entries": entries,
            }
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else None


def xlsx_request(base: str, path: str, token: str, body: Any) -> tuple[int, Any]:
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = response.read()
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                entries = set(archive.namelist())
            return response.status, {
                "is_xlsx": "xl/workbook.xml" in entries
                and any(name.startswith("xl/worksheets/") for name in entries),
                "nonempty": bool(payload),
            }
    except urllib.error.HTTPError as error:
        return error.code, decode_body(error.read())


def websocket_ping(base: str, token: str) -> tuple[int, Any]:
    parsed = urllib.parse.urlparse(base)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 80
    key = base64.b64encode(os.urandom(16)).decode()
    sock = socket.create_connection((host, port), timeout=10)
    sock.settimeout(10)
    request_headers = (
        f"GET /ws/{token} HTTP/1.1\r\nHost: {host}:{port}\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(request_headers.encode())
    response = b""
    while b"\r\n\r\n" not in response:
        response += sock.recv(4096)
    status = int(response.split(b" ", 2)[1])
    if status != 101:
        sock.close()
        return status, {"reply": None}

    payload = b"ping"
    mask = os.urandom(4)
    masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
    sock.sendall(bytes([0x81, 0x80 | len(payload)]) + mask + masked)

    reply = None
    for _ in range(5):
        header = sock.recv(2)
        if len(header) < 2:
            break
        opcode = header[0] & 0x0F
        length = header[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", sock.recv(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", sock.recv(8))[0]
        frame = b""
        while len(frame) < length:
            frame += sock.recv(length - len(frame))
        if opcode == 1:
            text = frame.decode(errors="replace")
            if text == "pong":
                reply = text
                break
    sock.close()
    return status, {"reply": reply}


def poll_batch_task(base: str, token: str, task_id: str) -> tuple[int, Any]:
    last = (0, None)
    for _ in range(60):
        last = request(base, "GET", f"/api/v1/batch-generate-async/{task_id}", token)
        if last[0] == 200 and isinstance(last[1], dict):
            if last[1].get("status") in {"completed", "completed_with_errors", "failed"}:
                return last
        time.sleep(0.5)
    return last


def poll_queue_item(base: str, token: str, item_id: str) -> tuple[int, Any]:
    last = (0, None)
    for _ in range(120):
        status, body = request(base, "GET", "/api/v1/queue", token)
        last = (status, body)
        if status == 200 and isinstance(body, list):
            item = next((entry for entry in body if entry.get("id") == item_id), None)
            if item and item.get("status") in {"done", "error", "archived"}:
                return status, item


def poll_story_terminal(base: str, token: str, path: str, terminal: set) -> tuple[int, Any]:
    last = (0, None)
    last = (0, None)
    for _ in range(180):
        last = request(base, "GET", path, token)
        body = last[1]
        if last[0] == 200 and isinstance(body, dict) and body.get("status") in terminal:
            return last
        time.sleep(1)
    return last

def poll_review(base: str, token: str, video_id: str) -> tuple[int, Any]:
    last = (0, None)
    for _ in range(120):
        last = request(base, "GET", f"/api/v1/gallery/videos/{video_id}/review", token)
        body = last[1]
        if last[0] == 200 and isinstance(body, dict) and body.get("review_status") in {"done", "error"}:
            return last
        time.sleep(0.5)
    return last

def poll_fission_success(base: str, token: str, fission_id: str) -> tuple[int, Any]:
    last = (0, None)
    for _ in range(180):
        last = request(base, "GET", f"/api/v1/story-fission/{fission_id}", token)
        body = last[1]
        branches = body.get("branches") if isinstance(body, dict) else None
        if (
            last[0] == 200
            and isinstance(body, dict)
            and body.get("status") == "completed"
            and body.get("phase") == "done"
            and isinstance(branches, list)
            and branches
            and all(isinstance(branch, dict) and branch.get("status") == "done" for branch in branches)
        ):
            return last
        time.sleep(1)
    return last


def fission_terminal_shape(body: Any) -> Any:
    if not isinstance(body, dict):
        return body
    return {
        "status": body.get("status"),
        "phase": body.get("phase"),
        "total_branches": body.get("total_branches"),
        "completed_branches": body.get("completed_branches"),
        "branches_len": len(body.get("branches", [])) if isinstance(body.get("branches"), list) else None,
        "merged_video_url_string": isinstance(body.get("merged_video_url"), str),
        "error_nullable": body.get("error") is None or isinstance(body.get("error"), str),
    }

def workflow_completed(label: str, left: Any, right: Any, kind: str) -> bool:
    def valid(body: Any) -> bool:
        if not isinstance(body, dict) or body.get("status") != "completed":
            return False
        if not isinstance(body.get("merged_video_url"), str):
            return False
        if kind == "chain":
            return (
                body.get("current_shot") == body.get("total_shots") == 2
                and isinstance(body.get("video_ids"), list)
                and len(body["video_ids"]) == 2
            )
        branches = body.get("branches")
        return (
            body.get("phase") == "done"
            and body.get("total_branches") == 2
            and body.get("completed_branches") == 2
            and isinstance(branches, list)
            and len(branches) == 2
            and all(isinstance(branch, dict) and branch.get("status") == "done" for branch in branches)
        )

    ok = valid(left) and valid(right)
    print(f"{'PASS' if ok else 'FAIL'} {label} completed-success")
    if not ok:
        print("  python success body:", json.dumps(left, ensure_ascii=False)[:1600])
        print("  rust success body:  ", json.dumps(right, ensure_ascii=False)[:1600])
    return ok


def sse_request(base: str, path: str, token: str, body: Any) -> tuple[int, Any]:
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            payload = response.read().decode(errors="replace")
            content_type = response.headers.get_content_type()
        lines = [line for line in payload.splitlines() if line.strip()]
        return response.status, {"content_type": content_type, "lines": lines}
    except urllib.error.HTTPError as error:
        return error.code, decode_body(error.read())
        time.sleep(0.5)
    return last

def login(base: str, username: str, password: str) -> tuple[int, Any]:
    body = urllib.parse.urlencode({"username": username, "password": password}).encode()
    return request(
        base,
        "POST",
        "/api/v1/login",
        body=body,
        content_type="application/x-www-form-urlencoded",
    )


def multipart_queue(prompt: str = "parity prompt") -> tuple[bytes, str]:
    boundary = "----abp-parity-" + uuid.uuid4().hex
    chunks = []
    for name, value in (("prompt", prompt), ("category", "parity")):
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    chunks.extend(
        [
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="tiny.png"\r\nContent-Type: image/png\r\n\r\n'.encode(),
            PNG,
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def shape(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: shape(item)
            for key, item in sorted(value.items())
            if key not in DYNAMIC_KEYS
        }
    if isinstance(value, list):
        return {"type": "list", "length": len(value), "item": shape(value[0]) if value else None}
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    return "string"


def multipart_files(
    files: list[tuple[str, str, str, bytes]],
    fields: dict[str, str] | None = None,
) -> tuple[bytes, str]:
    boundary = "----abp-parity-" + uuid.uuid4().hex
    chunks = []
    for name, value in (fields or {}).items():
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    for field_name, filename, content_type, payload in files:
        chunks.extend([
            f'--{boundary}\r\nContent-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\nContent-Type: {content_type}\r\n\r\n'.encode(),
            payload,
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def multipart_file(
    field_name: str,
    filename: str,
    content_type: str,
    payload: bytes,
    fields: dict[str, str] | None = None,
) -> tuple[bytes, str]:
    return multipart_files([(field_name, filename, content_type, payload)], fields)


def compare(label: str, left: tuple[int, Any], right: tuple[int, Any]) -> bool:
    ok = left[0] == right[0] and shape(left[1]) == shape(right[1])
    print(f"{'PASS' if ok else 'FAIL'} {label} status={left[0]}/{right[0]}")
    if not ok:
        print("  python:", json.dumps(shape(left[1]), ensure_ascii=False)[:1600])
        print("  rust:  ", json.dumps(shape(right[1]), ensure_ascii=False)[:1600])
        print("  python value:", json.dumps(left[1], ensure_ascii=False)[:1600])
        print("  rust value:  ", json.dumps(right[1], ensure_ascii=False)[:1600])
    return ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", required=True)
    parser.add_argument("--rust", required=True)
    parser.add_argument("--admin-user", default="admin")
    parser.add_argument("--admin-password", required=True)
    parser.add_argument("--python-provider", required=True)
    parser.add_argument("--rust-provider", required=True)
    args = parser.parse_args()
    bases = [args.python, args.rust]
    failures = 0

    logins = [login(base, args.admin_user, args.admin_password) for base in bases]
    failures += not compare("POST /api/v1/login", logins[0], logins[1])
    tokens = [result[1]["access_token"] for result in logins]

    websocket_results = [websocket_ping(base, token) for base, token in zip(bases, tokens)]
    failures += not compare("WEBSOCKET /ws/{token} ping/pong", websocket_results[0], websocket_results[1])

    configs = [request(base, "GET", "/api/v1/config", token) for base, token in zip(bases, tokens)]
    failures += not compare("GET /api/v1/config isolated", configs[0], configs[1])
    config_updates = []
    for base, token, provider in zip(bases, tokens, [args.python_provider, args.rust_provider]):
        config_body = dict(configs[0][1])
        config_body.update({
            "site_title": "Parity Studio",
            "api_url": provider,
            "api_key": "parity-key",
            "analysis_model_name": "stub-model",
        })
        config_updates.append(request(base, "POST", "/api/v1/config", token, config_body))
    failures += not compare("POST /api/v1/config", config_updates[0], config_updates[1])

    model_results = [
        request(base, "POST", "/api/v1/models", token, {"api_url": provider, "api_key": "parity-key"})
        for base, token, provider in zip(bases, tokens, [args.python_provider, args.rust_provider])
    ]
    failures += not compare("POST /api/v1/models", model_results[0], model_results[1])

    keyword_analyses = [
        request(base, "POST", "/api/v1/keywords/analyze-single", token, {"title": "Labial rojo mate"})
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/keywords/analyze-single", keyword_analyses[0], keyword_analyses[1])

    mexico_keyword_analyses = [
        request(base, "POST", "/api/v1/mexico-beauty/keyword-analysis-single", token, {"title": "Labial rojo mate"})
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/mexico-beauty/keyword-analysis-single",
        mexico_keyword_analyses[0],
        mexico_keyword_analyses[1],
    )

    mexico_title_results = []
    mexico_image_prompt_results = []
    mexico_description_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_file(
            "image", "product.png", "image/png", PNG, {"title": "Labial rojo mate"}
        )
        mexico_title_results.append(
            request(base, "POST", "/api/v1/mexico-beauty/title-optimization-single", token, body, content_type)
        )
        body, content_type = multipart_file("image", "product.png", "image/png", PNG)
        mexico_image_prompt_results.append(
            request(base, "POST", "/api/v1/mexico-beauty/image-prompt-single", token, body, content_type)
        )
        body, content_type = multipart_file(
            "image", "product.png", "image/png", PNG, {"title": "Labial rojo mate"}
        )
        mexico_description_results.append(
            request(base, "POST", "/api/v1/mexico-beauty/description-single", token, body, content_type)
        )
    failures += not compare(
        "POST /api/v1/mexico-beauty/title-optimization-single",
        mexico_title_results[0], mexico_title_results[1],
    )
    failures += not compare(
        "POST /api/v1/mexico-beauty/image-prompt-single",
        mexico_image_prompt_results[0], mexico_image_prompt_results[1],
    )
    failures += not compare(
        "POST /api/v1/mexico-beauty/description-single",
        mexico_description_results[0], mexico_description_results[1],
    )

    mexico_batch_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_file(
            "image",
            "product.png",
            "image/png",
            PNG,
            {
                "title": "Labial rojo mate",
                "keywords": "labial, rojo, mate",
                "description": "Producto de belleza",
                "aspect_ratio": "1:1",
                "target_language": "es-MX",
            },
        )
        mexico_batch_results.append(
            request(base, "POST", "/api/v1/mexico-beauty/image-prompts-batch", token, body, content_type)
        )
    failures += not compare(
        "POST /api/v1/mexico-beauty/image-prompts-batch",
        mexico_batch_results[0], mexico_batch_results[1],
    )

    refine_body = {
        "original_prompt": {
            "id": 1,
            "type": "Main Image",
            "title": "Original",
            "promptText": "Commercial product scene",
            "rationale": "Original rationale",
            "review_status": None,
        },
        "feedback": "Use a lighter background",
        "product_title": "Labial rojo mate",
        "product_description": "Producto de belleza",
        "feedback_images": [],
    }
    mexico_refine_results = [
        request(base, "POST", "/api/v1/mexico-beauty/refine-prompt", token, refine_body)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/mexico-beauty/refine-prompt",
        mexico_refine_results[0], mexico_refine_results[1],
    )

    video_prompt_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_file("image", "product.png", "image/png", PNG)
        video_prompt_results.append(
            request(base, "POST", "/api/v1/generate-video-prompt", token, body, content_type)
        )
    failures += not compare(
        "POST /api/v1/generate-video-prompt",
        video_prompt_results[0], video_prompt_results[1],
    )

    story_analysis_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_file(
            "image", "product.png", "image/png", PNG, {"topic": "产品故事", "shot_count": "5"}
        )
        story_analysis_results.append(
            request(base, "POST", "/api/v1/story-analyze", token, body, content_type)
        )
    failures += not compare(
        "POST /api/v1/story-analyze",
        story_analysis_results[0], story_analysis_results[1],
    )

    analyze_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_files(
            [
                ("product_img", "product.png", "image/png", PNG),
                ("ref_img", "reference.png", "image/png", PNG),
            ],
            {"category": "beauty", "gen_count": "3", "custom_product_name": "Red lipstick"},
        )
        analyze_results.append(request(base, "POST", "/api/v1/analyze", token, body, content_type))
    failures += not compare("POST /api/v1/analyze", analyze_results[0], analyze_results[1])

    story_shots = json.dumps([
        {"shot": 1, "prompt": "Opening product shot", "duration": 5, "description": "Opening", "shotStory": "开场", "heroSubject": "Red lipstick"},
        {"shot": 2, "prompt": "Detail product shot", "duration": 5, "description": "Detail", "shotStory": "细节", "heroSubject": "Red lipstick"},
    ])
    story_generate_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_file(
            "image", "product.png", "image/png", PNG, {"shots_json": story_shots}
        )
        story_generate_results.append(
            request(base, "POST", "/api/v1/story-generate", token, body, content_type)
        )
    failures += not compare(
        "POST /api/v1/story-generate",
        story_generate_results[0], story_generate_results[1],
    )

    simple_batch_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_files(
            [("product_imgs", "product.png", "image/png", PNG)],
            {
                "prompt": "Premium lipstick product scene",
                "category": "beauty",
                "aspect_ratio": "1:1",
                "scene_style_prompt": "soft studio lighting",
                "gen_count": "2",
            },
        )
        simple_batch_results.append(
            request(base, "POST", "/api/v1/simple-batch-generate", token, body, content_type)
        )
    failures += not compare(
        "POST /api/v1/simple-batch-generate",
        simple_batch_results[0], simple_batch_results[1],
    )

    scripts = json.dumps([
        {"angle_name": "Front", "script": "Premium front lipstick composition"},
        {"angle_name": "Detail", "script": "Macro lipstick texture detail"},
    ])
    async_starts = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_files(
            [
                ("product_img", "product.png", "image/png", PNG),
                ("ref_img", "reference.png", "image/png", PNG),
            ],
            {"scripts": scripts, "aspect_ratio": "1:1", "category": "beauty"},
        )
        async_starts.append(
            request(base, "POST", "/api/v1/batch-generate-async", token, body, content_type)
        )
    failures += not compare(
        "POST /api/v1/batch-generate-async", async_starts[0], async_starts[1]
    )
    async_task_ids = [result[1]["task_id"] for result in async_starts]
    async_statuses = [
        poll_batch_task(base, token, task_id)
        for base, token, task_id in zip(bases, tokens, async_task_ids)
    ]
    failures += not compare(
        "GET /api/v1/batch-generate-async/{task_id}",
        async_statuses[0], async_statuses[1],
    )

    sync_batch_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_files(
            [
                ("product_img", "product.png", "image/png", PNG),
                ("ref_img", "reference.png", "image/png", PNG),
            ],
            {"scripts": scripts, "aspect_ratio": "1:1", "category": "beauty"},
        )
        sync_batch_results.append(
            request(base, "POST", "/api/v1/batch-generate", token, body, content_type)
        )
    failures += not compare(
        "POST /api/v1/batch-generate", sync_batch_results[0], sync_batch_results[1]
    )

    mexico_generate_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_file(
            "reference_image",
            "product.png",
            "image/png",
            PNG,
            {"prompt_text": "Premium lipstick campaign image", "aspect_ratio": "1:1"},
        )
        mexico_generate_results.append(
            request(base, "POST", "/api/v1/mexico-beauty/generate-image", token, body, content_type)
        )
    failures += not compare(
        "POST /api/v1/mexico-beauty/generate-image",
        mexico_generate_results[0], mexico_generate_results[1],
    )

    username = "writer_" + uuid.uuid4().hex[:10]
    creates = [
        request(
            base,
            "POST",
            "/api/v1/users",
            token,
            {"username": username, "password": "writer-pass", "role": "user"},
        )
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/users", creates[0], creates[1])
    user_ids = [result[1]["id"] for result in creates]

    updates = [
        request(
            base,
            "PUT",
            f"/api/v1/users/{user_id}",
            token,
            {"username": username + "_updated", "role": "user"},
        )
        for base, token, user_id in zip(bases, tokens, user_ids)
    ]
    failures += not compare("PUT /api/v1/users/{id}", updates[0], updates[1])

    writer_logins = [login(base, username + "_updated", "writer-pass") for base in bases]
    failures += not compare("POST /api/v1/login as created user", writer_logins[0], writer_logins[1])
    writer_tokens = [result[1]["access_token"] for result in writer_logins]
    profile_updates = [
        request(
            base,
            "PUT",
            "/api/v1/user/profile",
            token,
            {"nickname": "Parity Writer", "default_share": False},
        )
        for base, token in zip(bases, writer_tokens)
    ]
    failures += not compare("PUT /api/v1/user/profile", profile_updates[0], profile_updates[1])

    avatar_uploads = []
    for base, token in zip(bases, writer_tokens):
        body, content_type = multipart_file("file", "avatar.png", "image/png", PNG)
        avatar_uploads.append(request(base, "POST", "/api/v1/user/avatar", token, body, content_type))
    failures += not compare("POST /api/v1/user/avatar", avatar_uploads[0], avatar_uploads[1])

    queue_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_queue()
        queue_results.append(request(base, "POST", "/api/v1/queue", token, body, content_type))
    failures += not compare("POST /api/v1/queue", queue_results[0], queue_results[1])
    queue_ids = [result[1]["id"] for result in queue_results]

    queue_updates = [
        request(
            base,
            "PUT",
            f"/api/v1/queue/{queue_id}",
            token,
            {"status": "error", "error_msg": "parity failure"},
        )
        for base, token, queue_id in zip(bases, tokens, queue_ids)
    ]
    failures += not compare("PUT /api/v1/queue/{id}", queue_updates[0], queue_updates[1])

    retry_successes = [
        request(base, "POST", f"/api/v1/queue/{queue_id}/retry", token)
        for base, token, queue_id in zip(bases, tokens, queue_ids)
    ]
    failures += not compare("POST /api/v1/queue/{id}/retry", retry_successes[0], retry_successes[1])

    retries = [
        request(base, "POST", f"/api/v1/queue/{queue_id}/retry", token)
        for base, token, queue_id in zip(bases, tokens, queue_ids)
    ]
    failures += not compare("POST /api/v1/queue/{id}/retry pending rejection", retries[0], retries[1])

    queues = [request(base, "GET", "/api/v1/queue", token) for base, token in zip(bases, tokens)]
    failures += not compare("GET /api/v1/queue after insert", queues[0], queues[1])

    deletes = [
        request(base, "DELETE", f"/api/v1/queue/{queue_id}", token)
        for base, token, queue_id in zip(bases, tokens, queue_ids)
    ]
    failures += not compare("DELETE /api/v1/queue/{id}", deletes[0], deletes[1])

    for base, token, provider in zip(bases, tokens, [args.python_provider, args.rust_provider]):
        current_config = request(base, "GET", "/api/v1/config", token)[1]
        current_config.update({
            "video_api_url": provider,
            "video_api_key": "parity-video-key",
            "video_model_name": "stub-video-model",
        })
        request(base, "POST", "/api/v1/config", token, current_config)

    video_queue_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_queue("Generate a video based on this image")
        video_queue_results.append(request(base, "POST", "/api/v1/queue", token, body, content_type))
    failures += not compare(
        "POST /api/v1/queue for video generation",
        video_queue_results[0], video_queue_results[1],
    )
    video_queue_ids = [result[1]["id"] for result in video_queue_results]

    generation_starts = [
        request(base, "POST", f"/api/v1/queue/{item_id}/generate", token)
        for base, token, item_id in zip(bases, tokens, video_queue_ids)
    ]
    failures += not compare(
        "POST /api/v1/queue/{id}/generate", generation_starts[0], generation_starts[1]
    )
    generation_finals = [
        poll_queue_item(base, token, item_id)
        for base, token, item_id in zip(bases, tokens, video_queue_ids)
    ]
    failures += not compare("queue generation terminal item", generation_finals[0], generation_finals[1])

    for base, token, item_id in zip(bases, tokens, video_queue_ids):
        request(
            base,
            "PUT",
            f"/api/v1/queue/{item_id}",
            token,
            {"status": "error", "error_msg": "retry parity"},
        )
    successful_retries = [
        request(base, "POST", f"/api/v1/queue/{item_id}/retry", token)
        for base, token, item_id in zip(bases, tokens, video_queue_ids)
    ]
    failures += not compare(
        "POST /api/v1/queue/{id}/retry configured", successful_retries[0], successful_retries[1]
    )
    retry_finals = [
        poll_queue_item(base, token, item_id)
        for base, token, item_id in zip(bases, tokens, video_queue_ids)
    ]
    failures += not compare("queue retry terminal item", retry_finals[0], retry_finals[1])

    review_config_updates = []
    for base, token, provider in zip(
        bases, tokens, [args.python_provider, args.rust_provider]
    ):
        current_config = request(base, "GET", "/api/v1/config", token)[1]
        if not isinstance(current_config, dict):
            current_config = {}
        current_config.update({
            "review_enabled": True,
            "review_api_url": provider,
            "review_api_key": "parity-review-key",
            "review_model_name": "stub-review-model",
        })
        review_config_updates.append(
            request(base, "POST", "/api/v1/config", token, current_config)
        )
    failures += not compare(
        "POST /api/v1/config enable video review",
        review_config_updates[0], review_config_updates[1],
    )
    review_triggers = [
        request(base, "POST", f"/api/v1/gallery/videos/{item_id}/review", token)
        for base, token, item_id in zip(bases, tokens, video_queue_ids)
    ]
    failures += not compare(
        "POST /api/v1/gallery/videos/{id}/review", review_triggers[0], review_triggers[1]
    )
    review_finals = [
        poll_review(base, token, item_id)
        for base, token, item_id in zip(bases, tokens, video_queue_ids)
    ]
    failures += not compare(
        "GET /api/v1/gallery/videos/{id}/review after execution",
        review_finals[0], review_finals[1],
    )
    review_success = all(
        status == 200
        and isinstance(body, dict)
        and body.get("review_status") == "done"
        and body.get("review_score") == 8
        and isinstance(body.get("details"), dict)
        for status, body in review_finals
    )
    print(f"{'PASS' if review_success else 'FAIL'} video review execution completed-success")
    if not review_success:
        print("  review python:", json.dumps(review_finals[0][1], ensure_ascii=False)[:1600])
        print("  review rust:  ", json.dumps(review_finals[1][1], ensure_ascii=False)[:1600])
    failures += not review_success
    experience_histories = [
        request(base, "GET", "/api/v1/user/experience/history?limit=20", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "GET /api/v1/user/experience/history after review",
        experience_histories[0], experience_histories[1],
    )
    history_success = all(
        isinstance(history, list)
        and any(
            isinstance(entry, dict)
            and entry.get("video_id") == item_id
            and entry.get("score") == 8
            and entry.get("exp_change") == 20
            for entry in history
        )
        for (_, history), item_id in zip(experience_histories, video_queue_ids)
    )
    print(f"{'PASS' if history_success else 'FAIL'} review experience grant persisted")
    failures += not history_success

    character_streams = [
        sse_request(
            base,
            "/api/v1/character/generate",
            token,
            {
                "video_base64": "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEBA",
                "prompt": "raise right hand and smile",
            },
        )
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/character/generate", character_streams[0], character_streams[1]
    )

    feishu_syncs = [
        request(
            base,
            "POST",
            "/api/v1/keywords/sync-feishu",
            token,
            {"titles": [{"original": "lipstick", "translation": "口红", "keywords": "uno, dos", "status": "completed"}]},
        )
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/keywords/sync-feishu", feishu_syncs[0], feishu_syncs[1]
    )
    mexico_feishu_syncs = [
        request(
            base,
            "POST",
            "/api/v1/mexico-beauty/sync-feishu",
            token,
            {"module": "keyword", "results": [{"input": "lipstick", "output": "口红"}]},
        )
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/mexico-beauty/sync-feishu", mexico_feishu_syncs[0], mexico_feishu_syncs[1]
    )
    description_feishu_syncs = [
        request(
            base,
            "POST",
            "/api/v1/mexico-beauty/sync-description-feishu",
            token,
            {"product_title": "Labial Rojo", "prompts": [{"id": 1, "title": "t", "promptText": "p"}]},
        )
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/mexico-beauty/sync-description-feishu",
        description_feishu_syncs[0], description_feishu_syncs[1],
    )

    merge_source_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_queue("merge source one")
        merge_source_results.append(request(base, "POST", "/api/v1/queue", token, body, content_type))
        body, content_type = multipart_queue("merge source two")
        merge_source_results.append(request(base, "POST", "/api/v1/queue", token, body, content_type))
    failures += not compare(
        "POST /api/v1/queue for merge sources",
        merge_source_results[0], merge_source_results[1],
    )
    merge_source_ids = [result[1]["id"] for result in merge_source_results]
    for base, token, item_ids in zip(bases, tokens, [merge_source_ids[0:2], merge_source_ids[2:4]]):
        for item_id, video in zip(item_ids, ["/uploads/queue/seed.mp4", "/uploads/queue/seed2.mp4"]):
            request(
                base,
                "PUT",
                f"/api/v1/queue/{item_id}",
                token,
                {"status": "done", "result_url": video},
            )
    merged_results = [
        request(
            base,
            "POST",
            "/api/v1/merge-videos",
            token,
            {"video_ids": item_ids},
        )
        for base, token, item_ids in zip(
            bases, tokens, [merge_source_ids[0:2], merge_source_ids[2:4]]
        )
    ]
    failures += not compare(
        "POST /api/v1/merge-videos", merged_results[0], merged_results[1]
    )

    voice_analyzes = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_file(
            "video",
            "clip.mp4",
            "video/mp4",
            b"\x00\x00\x00\x18ftypmp42",
            {"target_lang": "th-TH", "video_duration": "3.5"},
        )
        voice_analyzes.append(request(base, "POST", "/api/v1/voice-clone/analyze-video", token, body, content_type))
    failures += not compare(
        "POST /api/v1/voice-clone/analyze-video", voice_analyzes[0], voice_analyzes[1]
    )
    voice_syntheses = [
        request(
            base,
            "POST",
            "/api/v1/voice-clone/synthesize-speech",
            token,
            {
                "segments": [
                    {"id": 1, "timeRange": "0:00-0:10", "targetContent": "สวัสดี", "chinese": "你好"},
                    {"id": 2, "timeRange": "0:10-0:20", "targetContent": "", "chinese": ""},
                ],
                "voice_name": "Kore",
                "target_lang": "th-TH",
            },
        )
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/voice-clone/synthesize-speech", voice_syntheses[0], voice_syntheses[1]
    )

    seed_image_data = "data:image/png;base64," + base64.b64encode(PNG).decode()
    config_api_clears = []
    for base, token in zip(bases, tokens):
        current_config = request(base, "GET", "/api/v1/config", token)[1]
        if not isinstance(current_config, dict):
            current_config = {}
        current_config.update({"api_url": "", "api_key": ""})
        config_api_clears.append(
            request(base, "POST", "/api/v1/config", token, current_config)
        )
    failures += not compare(
        "POST /api/v1/config clear image api", config_api_clears[0], config_api_clears[1]
    )
    story_chain_creates = [
        request(
            base,
            "POST",
            "/api/v1/story-chain",
            token,
            {
                "initial_image_url": seed_image_data,
                "shots": [
                    {"prompt": "Generate a video based on this image", "duration": 5, "shotStory": "镜头一", "description": "Scene one"},
                    {"prompt": "Generate a video based on this image", "duration": 5, "shotStory": "镜头二", "description": "Scene two"},
                ],
                "category": "other",
            },
        )
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/story-chain", story_chain_creates[0], story_chain_creates[1]
    )
    chain_ids = [
        result[1].get("chain_id") if isinstance(result[1], dict) else None
        for result in story_chain_creates
    ]
    chain_404s = [
        request(base, "GET", "/api/v1/story-chain/not-a-real-chain", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "GET /api/v1/story-chain/{chain_id} missing", chain_404s[0], chain_404s[1]
    )
    chain_terminals = []
    for base, token, chain_id in zip(bases, tokens, chain_ids):
        if chain_id:
            chain_terminals.append(
                poll_story_terminal(
                    base, token, f"/api/v1/story-chain/{chain_id}", {"completed", "failed"}
                )
            )
        else:
            chain_terminals.append((0, None))
    failures += not compare(
        "GET /api/v1/story-chain/{chain_id} terminal", chain_terminals[0], chain_terminals[1]
    )
    failures += not workflow_completed(
        "story-chain full success", chain_terminals[0][1], chain_terminals[1][1], "chain"
    )
    config_api_restores = []
    for base, token, provider in zip(
        bases, tokens, [args.python_provider, args.rust_provider]
    ):
        current_config = request(base, "GET", "/api/v1/config", token)[1]
        if not isinstance(current_config, dict):
            current_config = {}
        current_config.update({"api_url": provider, "api_key": "parity-key"})
        config_api_restores.append(
            request(base, "POST", "/api/v1/config", token, current_config)
        )
    failures += not compare(
        "POST /api/v1/config restore image api", config_api_restores[0], config_api_restores[1]
    )
    story_fission_creates = [
        request(
            base,
            "POST",
            "/api/v1/story-fission",
            token,
            {
                "initial_image_url": seed_image_data,
                "topic": "product showcase",
                "branch_count": 2,
                "category": "other",
            },
        )
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/story-fission", story_fission_creates[0], story_fission_creates[1]
    )
    fission_ids = [
        result[1].get("fission_id") if isinstance(result[1], dict) else None
        for result in story_fission_creates
    ]
    fission_404s = [
        request(base, "GET", "/api/v1/story-fission/not-a-real-fission", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "GET /api/v1/story-fission/{fission_id} missing", fission_404s[0], fission_404s[1]
    )
    fission_terminals = []
    for base, token, fission_id in zip(bases, tokens, fission_ids):
        if fission_id:
            fission_terminals.append(
                poll_story_terminal(
                    base, token, f"/api/v1/story-fission/{fission_id}", {"completed", "failed"}
                )
            )
        else:
            fission_terminals.append((0, None))
    failures += not compare(
        "GET /api/v1/story-fission/{fission_id} terminal",
        (fission_terminals[0][0], fission_terminal_shape(fission_terminals[0][1])),
        (fission_terminals[1][0], fission_terminal_shape(fission_terminals[1][1])),
    )
    failures += not workflow_completed(
        "story-fission full success", fission_terminals[0][1], fission_terminals[1][1], "fission"
    )
    successful_branch_retries = [
        request(
            base,
            "POST",
            f"/api/v1/story-fission/{fission_id}/branch/1/retry",
            token,
        )
        for base, token, fission_id in zip(bases, tokens, fission_ids)
    ]
    failures += not compare(
        "POST /api/v1/story-fission/{fission_id}/branch/{branch_id}/retry success",
        successful_branch_retries[0], successful_branch_retries[1],
    )
    fission_retry_terminals = [
        poll_fission_success(base, token, fission_id)
        for base, token, fission_id in zip(bases, tokens, fission_ids)
    ]
    failures += not compare(
        "GET /api/v1/story-fission/{fission_id} after branch retry",
        (fission_retry_terminals[0][0], fission_terminal_shape(fission_retry_terminals[0][1])),
        (fission_retry_terminals[1][0], fission_terminal_shape(fission_retry_terminals[1][1])),
    )
    failures += not workflow_completed(
        "story-fission branch retry success",
        fission_retry_terminals[0][1], fission_retry_terminals[1][1], "fission",
    )
    successful_remerges = [
        request(
            base,
            "POST",
            f"/api/v1/story-fission/{fission_id}/remerge",
            token,
        )
        for base, token, fission_id in zip(bases, tokens, fission_ids)
    ]
    failures += not compare(
        "POST /api/v1/story-fission/{fission_id}/remerge success",
        successful_remerges[0], successful_remerges[1],
    )
    branch_retries = [
        request(base, "POST", "/api/v1/story-fission/not-a-real-fission/branch/1/retry", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/story-fission/{fission_id}/branch/{branch_id}/retry missing",
        branch_retries[0], branch_retries[1],
    )
    remerges = [
        request(base, "POST", "/api/v1/story-fission/not-a-real-fission/remerge", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare(
        "POST /api/v1/story-fission/{fission_id}/remerge missing", remerges[0], remerges[1]
    )

    gallery_queue_results = []
    for base, token in zip(bases, tokens):
        body, content_type = multipart_queue("gallery parity")
        gallery_queue_results.append(request(base, "POST", "/api/v1/queue", token, body, content_type))
    failures += not compare("POST /api/v1/queue for gallery mutations", gallery_queue_results[0], gallery_queue_results[1])
    gallery_video_ids = [result[1]["id"] for result in gallery_queue_results]

    share_toggles = [
        request(base, "POST", f"/api/v1/gallery/videos/{video_id}/share", token)
        for base, token, video_id in zip(bases, tokens, gallery_video_ids)
    ]
    failures += not compare("POST /api/v1/gallery/videos/{id}/share", share_toggles[0], share_toggles[1])

    batch_shares = [
        request(base, "POST", "/api/v1/gallery/videos/batch-share", token, {"ids": [video_id], "is_shared": True})
        for base, token, video_id in zip(bases, tokens, gallery_video_ids)
    ]
    failures += not compare("POST /api/v1/gallery/videos/batch-share", batch_shares[0], batch_shares[1])

    share_alls = [
        request(base, "POST", "/api/v1/gallery/videos/share-all", token, {"is_shared": False, "skip_first_page": False, "skip_count": 0})
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/gallery/videos/share-all", share_alls[0], share_alls[1])

    gallery_deletes = [
        request(base, "POST", "/api/v1/gallery/videos/batch-delete", token, {"ids": [video_id]})
        for base, token, video_id in zip(bases, tokens, gallery_video_ids)
    ]
    failures += not compare("POST /api/v1/gallery/videos/batch-delete", gallery_deletes[0], gallery_deletes[1])

    video_downloads = [
        zip_request(base, "/api/v1/gallery/videos/batch-download", token, {"ids": ["seed-video"]})
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/gallery/videos/batch-download", video_downloads[0], video_downloads[1])

    queue_clears = [
        request(base, "DELETE", "/api/v1/queue", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("DELETE /api/v1/queue", queue_clears[0], queue_clears[1])

    review_reads = [
        request(base, "GET", "/api/v1/gallery/videos/seed-video/review", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("GET /api/v1/gallery/videos/{id}/review", review_reads[0], review_reads[1])

    image_share_toggles = [
        request(base, "POST", "/api/v1/gallery/images/1/share", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/gallery/images/{id}/share", image_share_toggles[0], image_share_toggles[1])

    image_batch_shares = [
        request(base, "POST", "/api/v1/gallery/images/batch-share", token, {"ids": [1], "is_shared": True})
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/gallery/images/batch-share", image_batch_shares[0], image_batch_shares[1])

    image_share_alls = [
        request(base, "POST", "/api/v1/gallery/images/share-all", token, {"is_shared": False, "skip_first_page": False, "skip_count": 0})
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/gallery/images/share-all", image_share_alls[0], image_share_alls[1])

    image_downloads = [
        zip_request(base, "/api/v1/gallery/images/batch-download", token, {"ids": [1]})
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/gallery/images/batch-download", image_downloads[0], image_downloads[1])

    image_deletes = [
        request(base, "POST", "/api/v1/gallery/images/batch-delete", token, {"ids": [1]})
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/gallery/images/batch-delete", image_deletes[0], image_deletes[1])

    single_image_deletes = [
        request(base, "DELETE", "/api/v1/gallery/images/2", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("DELETE /api/v1/gallery/images/{id}", single_image_deletes[0], single_image_deletes[1])
    user_deletes = [
        request(base, "DELETE", f"/api/v1/users/{user_id}", token)
        for base, token, user_id in zip(bases, tokens, user_ids)
    ]
    failures += not compare("DELETE /api/v1/users/{id}", user_deletes[0], user_deletes[1])

    history_body = {"titles": [{"original": "hola", "translation": "你好", "keywords": "belleza", "status": "completed"}]}
    keyword_exports = [
        xlsx_request(base, "/api/v1/keywords/export-excel", token, history_body)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/keywords/export-excel", keyword_exports[0], keyword_exports[1])
    history_saves = [
        request(base, "POST", "/api/v1/keywords/history", token, history_body)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("POST /api/v1/keywords/history", history_saves[0], history_saves[1])

    histories = [
        request(base, "GET", "/api/v1/keywords/history", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("GET /api/v1/keywords/history after save", histories[0], histories[1])

    history_deletes = [
        request(base, "DELETE", "/api/v1/keywords/history/0", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("DELETE /api/v1/keywords/history/{index}", history_deletes[0], history_deletes[1])

    history_clears = [
        request(base, "DELETE", "/api/v1/keywords/history", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("DELETE /api/v1/keywords/history", history_clears[0], history_clears[1])

    activity_clears = [
        request(base, "DELETE", "/api/v1/admin/activities", token)
        for base, token in zip(bases, tokens)
    ]
    failures += not compare("DELETE /api/v1/admin/activities", activity_clears[0], activity_clears[1])

    if failures:
        print(f"{failures} isolated write checks failed", file=sys.stderr)
        return 1
    print("all 88 isolated write checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
