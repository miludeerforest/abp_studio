#!/usr/bin/env python3
"""Read-only Python-vs-Rust contract smoke test.

Usage:
  python3 tools/differential_smoke.py --python http://127.0.0.1:33013 \
      --rust http://127.0.0.1:33018 --token "$TOKEN"

It intentionally sends only read requests. Provider-backed writes require an
isolated stub environment and are covered by the Rust provider/unit seams.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any

ENDPOINTS = [
    ("GET", "/api/v1/public/config", False),
    ("GET", "/api/v1/public/videos?limit=2", False),
    ("GET", "/api/v1/user/profile", True),
    ("GET", "/api/v1/user/experience/history", True),
    ("GET", "/api/v1/stats", True),
    ("GET", "/api/v1/users", True),
    ("GET", "/api/v1/gallery/images?limit=2", True),
    ("GET", "/api/v1/gallery/videos?limit=2", True),
    ("GET", "/api/v1/queue", True),
    ("GET", "/api/v1/config", True),
    ("GET", "/api/v1/admin/live-status", True),
    ("GET", "/api/v1/admin/user/1/tasks", True),
    ("GET", "/api/v1/admin/activities?limit=2", True),
    ("GET", "/api/v1/keywords/history", True),
]
DYNAMIC_KEYS = {"created_at", "updated_at", "reviewed_at", "server_time"}


def request(base: str, method: str, path: str, token: str | None) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(base.rstrip("/") + path, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            body = response.read()
            return response.status, json.loads(body)
    except urllib.error.HTTPError as error:
        body = error.read()
        try:
            return error.code, json.loads(body)
        except json.JSONDecodeError:
            return error.code, body.decode("utf-8", errors="replace")


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


def normalize_for_path(path: str, value: Any) -> Any:
    """Remove values that cannot match across two independently running processes."""
    if path.startswith("/api/v1/admin/live-status") and isinstance(value, dict):
        value = dict(value)
        value["online_users"] = []
        value["online_count"] = 0
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", required=True)
    parser.add_argument("--rust", required=True)
    parser.add_argument("--token", default="")
    args = parser.parse_args()
    failures = 0
    for method, path, authenticated in ENDPOINTS:
        token = args.token if authenticated else None
        py_status, py_body = request(args.python, method, path, token)
        rs_status, rs_body = request(args.rust, method, path, token)
        py_body = normalize_for_path(path, py_body)
        rs_body = normalize_for_path(path, rs_body)
        ok = py_status == rs_status and shape(py_body) == shape(rs_body)
        print(f"{'PASS' if ok else 'FAIL'} {method} {path} status={py_status}/{rs_status}")
        if not ok:
            failures += 1
            print("  python:", json.dumps(shape(py_body), ensure_ascii=False)[:1200])
            print("  rust:  ", json.dumps(shape(rs_body), ensure_ascii=False)[:1200])
    if failures:
        print(f"{failures} differential checks failed", file=sys.stderr)
        return 1
    print(f"all {len(ENDPOINTS)} differential checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
