#!/usr/bin/env python3
"""Generate the Python -> Rust parity inventory without contacting production systems."""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PY_MAIN = ROOT / "backend" / "main.py"
FRONTEND = ROOT / "frontend" / "src"
OUT = Path(__file__).resolve().parent.parent / "PARITY_MANIFEST.json"

# Exact route registrations currently present in the Rust router.  This is kept
# explicit so a deleted/renamed Rust route cannot silently look migrated.
RUST_ROUTES = {
    ("GET", "/healthz"),
    ("GET", "/api/v1/public/config"),
    ("GET", "/api/v1/public/videos"),
    ("POST", "/api/v1/login"),
    ("GET", "/api/v1/user/profile"),
    ("PUT", "/api/v1/user/profile"),
    ("POST", "/api/v1/user/avatar"),
    ("GET", "/api/v1/user/experience/history"),
    ("GET", "/api/v1/users"),
    ("POST", "/api/v1/users"),
    ("PUT", "/api/v1/users/{user_id}"),
    ("DELETE", "/api/v1/users/{user_id}"),
    ("GET", "/api/v1/stats"),
    ("GET", "/api/v1/config"),
    ("POST", "/api/v1/config"),
    ("POST", "/api/v1/models"),
    ("GET", "/api/v1/gallery/images"),
    ("DELETE", "/api/v1/gallery/images/{image_id}"),
    ("POST", "/api/v1/gallery/images/batch-delete"),
    ("POST", "/api/v1/gallery/images/{image_id}/share"),
    ("POST", "/api/v1/gallery/images/batch-share"),
    ("POST", "/api/v1/gallery/images/share-all"),
    ("GET", "/api/v1/gallery/videos"),
    ("POST", "/api/v1/gallery/videos/batch-delete"),
    ("POST", "/api/v1/gallery/videos/batch-share"),
    ("POST", "/api/v1/gallery/videos/share-all"),
    ("GET", "/api/v1/gallery/videos/{video_id}/review"),
    ("POST", "/api/v1/gallery/videos/{video_id}/review"),
    ("GET", "/api/v1/queue"),
    ("POST", "/api/v1/queue"),
    ("DELETE", "/api/v1/queue"),
    ("DELETE", "/api/v1/queue/{item_id}"),
    ("POST", "/api/v1/queue/{item_id}/retry"),
    ("GET", "/api/v1/admin/live-status"),
    ("GET", "/api/v1/admin/activities"),
    ("DELETE", "/api/v1/admin/activities"),
    ("GET", "/api/v1/admin/user/{user_id}/tasks"),
    ("POST", "/api/v1/analyze"),
    ("POST", "/api/v1/batch-generate"),
    ("POST", "/api/v1/batch-generate-async"),
    ("GET", "/api/v1/batch-generate-async/{task_id}"),
    ("POST", "/api/v1/simple-batch-generate"),
    ("POST", "/api/v1/story-analyze"),
    ("POST", "/api/v1/generate-video-prompt"),
    ("POST", "/api/v1/story-generate"),
    ("POST", "/api/v1/merge-videos"),
    ("POST", "/api/v1/story-chain"),
    ("GET", "/api/v1/story-chain/{chain_id}"),
    ("POST", "/api/v1/story-fission"),
    ("GET", "/api/v1/story-fission/{fission_id}"),
    ("POST", "/api/v1/story-fission/{fission_id}/branch/{branch_id}/retry"),
    ("POST", "/api/v1/story-fission/{fission_id}/remerge"),
    ("POST", "/api/v1/gallery/images/batch-download"),
    ("POST", "/api/v1/gallery/videos/batch-download"),
    ("POST", "/api/v1/gallery/videos/{video_id}/share"),
    ("PUT", "/api/v1/queue/{item_id}"),
    ("POST", "/api/v1/queue/{item_id}/generate"),
    ("POST", "/api/v1/character/generate"),
    ("POST", "/api/v1/keywords/analyze-single"),
    ("POST", "/api/v1/keywords/history"),
    ("GET", "/api/v1/keywords/history"),
    ("DELETE", "/api/v1/keywords/history/{index}"),
    ("DELETE", "/api/v1/keywords/history"),
    ("POST", "/api/v1/keywords/export-excel"),
    ("POST", "/api/v1/keywords/sync-feishu"),
    ("POST", "/api/v1/mexico-beauty/keyword-analysis-single"),
    ("POST", "/api/v1/mexico-beauty/title-optimization-single"),
    ("POST", "/api/v1/mexico-beauty/image-prompt-single"),
    ("POST", "/api/v1/mexico-beauty/description-single"),
    ("POST", "/api/v1/mexico-beauty/image-prompts-batch"),
    ("POST", "/api/v1/mexico-beauty/refine-prompt"),
    ("POST", "/api/v1/mexico-beauty/generate-image"),
    ("POST", "/api/v1/mexico-beauty/sync-feishu"),
    ("POST", "/api/v1/mexico-beauty/sync-description-feishu"),
    ("POST", "/api/v1/voice-clone/analyze-video"),
    ("POST", "/api/v1/voice-clone/synthesize-speech"),
    ("WEBSOCKET", "/ws/{token}"),
}

SMOKE_VERIFIED = {
    ("GET", "/api/v1/public/config"),
    ("GET", "/api/v1/public/videos"),
    ("GET", "/api/v1/user/profile"),
    ("GET", "/api/v1/user/experience/history"),
    ("GET", "/api/v1/gallery/images"),
    ("GET", "/api/v1/gallery/videos"),
    ("GET", "/api/v1/queue"),
    ("GET", "/api/v1/stats"),
    ("GET", "/api/v1/users"),
    ("GET", "/api/v1/config"),
    ("GET", "/api/v1/admin/live-status"),
    ("GET", "/api/v1/admin/user/{user_id}/tasks"),
    ("GET", "/api/v1/admin/activities"),
    ("GET", "/api/v1/keywords/history"),
}

WRITE_SMOKE_VERIFIED = {
    ("POST", "/api/v1/login"),
    ("PUT", "/api/v1/user/profile"),
    ("POST", "/api/v1/user/avatar"),
    ("POST", "/api/v1/config"),
    ("POST", "/api/v1/models"),
    ("POST", "/api/v1/users"),
    ("PUT", "/api/v1/users/{user_id}"),
    ("DELETE", "/api/v1/users/{user_id}"),
    ("POST", "/api/v1/queue"),
    ("PUT", "/api/v1/queue/{item_id}"),
    ("DELETE", "/api/v1/queue/{item_id}"),
    ("POST", "/api/v1/gallery/videos/{video_id}/share"),
    ("POST", "/api/v1/gallery/videos/batch-share"),
    ("POST", "/api/v1/gallery/videos/share-all"),
    ("POST", "/api/v1/gallery/videos/batch-delete"),
    ("POST", "/api/v1/gallery/images/{image_id}/share"),
    ("POST", "/api/v1/gallery/images/batch-share"),
    ("POST", "/api/v1/gallery/images/share-all"),
    ("POST", "/api/v1/gallery/images/batch-download"),
    ("POST", "/api/v1/gallery/images/batch-delete"),
    ("DELETE", "/api/v1/gallery/images/{image_id}"),
    ("POST", "/api/v1/gallery/videos/batch-download"),
    ("DELETE", "/api/v1/queue"),
    ("GET", "/api/v1/gallery/videos/{video_id}/review"),
    ("DELETE", "/api/v1/admin/activities"),
    ("POST", "/api/v1/keywords/history"),
    ("POST", "/api/v1/keywords/export-excel"),
    ("POST", "/api/v1/keywords/analyze-single"),
    ("POST", "/api/v1/mexico-beauty/keyword-analysis-single"),
    ("POST", "/api/v1/mexico-beauty/title-optimization-single"),
    ("POST", "/api/v1/mexico-beauty/image-prompt-single"),
    ("POST", "/api/v1/mexico-beauty/description-single"),
    ("POST", "/api/v1/mexico-beauty/image-prompts-batch"),
    ("POST", "/api/v1/mexico-beauty/refine-prompt"),
    ("POST", "/api/v1/generate-video-prompt"),
    ("POST", "/api/v1/story-analyze"),
    ("POST", "/api/v1/analyze"),
    ("POST", "/api/v1/simple-batch-generate"),
    ("POST", "/api/v1/batch-generate-async"),
    ("GET", "/api/v1/batch-generate-async/{task_id}"),
    ("POST", "/api/v1/batch-generate"),
    ("POST", "/api/v1/story-generate"),
    ("POST", "/api/v1/mexico-beauty/generate-image"),
    ("POST", "/api/v1/queue/{item_id}/generate"),
    ("POST", "/api/v1/queue/{item_id}/retry"),
    ("WEBSOCKET", "/ws/{token}"),
    ("DELETE", "/api/v1/keywords/history/{index}"),
    ("DELETE", "/api/v1/keywords/history"),
    ("POST", "/api/v1/character/generate"),
    ("POST", "/api/v1/merge-videos"),
    ("POST", "/api/v1/story-chain"),
    ("GET", "/api/v1/story-chain/{chain_id}"),
    ("POST", "/api/v1/story-fission"),
    ("GET", "/api/v1/story-fission/{fission_id}"),
    ("POST", "/api/v1/story-fission/{fission_id}/branch/{branch_id}/retry"),
    ("POST", "/api/v1/story-fission/{fission_id}/remerge"),
    ("POST", "/api/v1/gallery/videos/{video_id}/review"),
    ("POST", "/api/v1/keywords/sync-feishu"),
    ("POST", "/api/v1/mexico-beauty/sync-feishu"),
    ("POST", "/api/v1/mexico-beauty/sync-description-feishu"),
    ("POST", "/api/v1/voice-clone/analyze-video"),
    ("POST", "/api/v1/voice-clone/synthesize-speech"),
}

PARITY_VERIFIED = SMOKE_VERIFIED | WRITE_SMOKE_VERIFIED

SLICE_RULES = (
    ("public", ("/public/",)),
    ("auth-users", ("/login", "/user/", "/users", "/stats", "/config", "/models")),
    ("gallery", ("/gallery/",)),
    ("queue-media", ("/queue", "/merge-videos")),
    ("generation", ("/analyze", "/batch-generate", "/simple-batch", "/generate-video-prompt")),
    ("story", ("/story-", "/story/")),
    ("admin", ("/admin/",)),
    ("character", ("/character/",)),
    ("keywords", ("/keywords/",)),
    ("mexico-beauty", ("/mexico-beauty/",)),
    ("voice-clone", ("/voice-clone/",)),
)


def slice_for(path: str) -> str:
    for name, prefixes in SLICE_RULES:
        if any(prefix in path for prefix in prefixes):
            return name
    return "other"


def auth_for(function: ast.FunctionDef | ast.AsyncFunctionDef, path: str) -> str:
    names = {arg.arg for arg in (*function.args.posonlyargs, *function.args.args, *function.args.kwonlyargs)}
    if path.startswith("/api/v1/public/") or path == "/api/v1/login":
        return "public"
    if "admin" in names:
        return "admin"
    if "user" in names:
        return "bearer-user"
    if "token" in names:
        return "bearer-token"
    if path.startswith("/ws/"):
        return "websocket-token"
    return "inspect"


def frontend_refs(path: str) -> list[str]:
    # Search the stable route prefix, because JSX commonly interpolates IDs/query strings.
    prefix = path.split("{")[0].rstrip("/")
    if prefix.endswith("/batch"):
        prefix = prefix[:-6]
    refs: set[str] = set()
    for file in FRONTEND.rglob("*"):
        if file.suffix not in {".js", ".jsx", ".ts", ".tsx"}:
            continue
        try:
            text = file.read_text()
        except UnicodeDecodeError:
            continue
        if prefix in text:
            refs.add(str(file.relative_to(ROOT)))
    return sorted(refs)


def request_shape(function: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    result: list[str] = []
    for arg in (*function.args.posonlyargs, *function.args.args, *function.args.kwonlyargs):
        if arg.arg in {"db", "user", "admin", "token", "request", "background_tasks", "websocket"}:
            continue
        annotation = ast.unparse(arg.annotation) if arg.annotation else None
        result.append(f"{arg.arg}: {annotation or 'inferred'}")
    return result


def response_model(decorator: ast.Call) -> str | None:
    for keyword in decorator.keywords:
        if keyword.arg == "response_model":
            return ast.unparse(keyword.value)
    return None


def side_effects(slice_name: str) -> list[str]:
    common = {
        "auth-users": ["PostgreSQL users/system_config/experience_logs", "uploads/avatars for avatar upload"],
        "gallery": ["PostgreSQL saved_images/video_queue", "filesystem deletion or ZIP generation"],
        "queue-media": ["PostgreSQL video_queue", "uploads/queue and generated media", "Redis queue/events"],
        "generation": ["external image provider", "PostgreSQL image_logs/saved_images", "uploads/gallery", "Redis/WebSocket progress"],
        "story": ["external image/video provider", "uploads/story artifacts", "persistent task status", "Redis/WebSocket progress"],
        "character": ["external video/voice provider", "uploads or remote media"],
        "keywords": ["system_config/user history storage", "Excel file generation", "Feishu API when requested"],
        "mexico-beauty": ["external chat/image provider", "prompt files and uploads", "Feishu API when requested"],
        "voice-clone": ["external voice/video provider", "temporary uploads and generated audio/video"],
        "admin": ["PostgreSQL user_activities/video_queue", "WebSocket online state"],
        "public": ["PostgreSQL read-only"],
        "other": [],
    }
    return common[slice_name]


def extract_routes() -> list[dict]:
    tree = ast.parse(PY_MAIN.read_text())
    routes: list[dict] = []
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not (
                isinstance(decorator, ast.Call)
                and isinstance(decorator.func, ast.Attribute)
                and isinstance(decorator.func.value, ast.Name)
                and decorator.func.value.id == "app"
                and decorator.func.attr in {"get", "post", "put", "delete", "patch", "websocket"}
            ):
                continue
            path = ast.literal_eval(decorator.args[0])
            method = decorator.func.attr.upper()
            key = (method, path)
            rust_present = key in RUST_ROUTES
            routes.append(
                {
                    "id": f"R-{len(routes) + 1:03d}",
                    "method": method,
                    "path": path,
                    "python_function": node.name,
                    "python_line": node.lineno,
                    "async": isinstance(node, ast.AsyncFunctionDef),
                    "auth": auth_for(node, path),
                    "request_parameters": request_shape(node),
                    "response_model": response_model(decorator),
                    "rust_status": "parity-tested" if key in PARITY_VERIFIED else ("partial" if rust_present else "missing"),
                    "smoke_verified": key in SMOKE_VERIFIED,
                    "write_smoke_verified": key in WRITE_SMOKE_VERIFIED,
                    "rust_route_present": rust_present,
                    "migration_slice": slice_for(path),
                    "frontend_files": frontend_refs(path),
                    "expected_side_effects": side_effects(slice_for(path)),
                    "parity_note": (
                        "Isolated differential write smoke passed; provider/error matrices may still apply."
                        if key in WRITE_SMOKE_VERIFIED
                        else "Read-only differential smoke passed; provider-backed/write contract tests still required."
                        if key in SMOKE_VERIFIED
                        else "Rust route exists; differential contract test still required."
                        if rust_present
                        else "No matching Rust route registration yet."
                    ),
                }
            )
    return routes


def workers() -> list[dict]:
    return [
        {"id": "W-001", "source": "backend/queue_manager.py", "responsibility": "Redis-backed queue scheduling, progress events, user notifications", "rust_status": "partial", "slice": "queue-media"},
        {"id": "W-002", "source": "backend/review_queue.py", "responsibility": "review queue persistence/dispatch", "rust_status": "partial", "slice": "queue-media"},
        {"id": "W-003", "source": "backend/video_reviewer.py", "responsibility": "video review provider call, score persistence and experience grant", "rust_status": "parity-tested", "slice": "queue-media"},
        {"id": "W-004", "source": "backend/websocket_manager.py", "responsibility": "connection registry, user/broadcast events", "rust_status": "partial", "slice": "admin"},
        {"id": "W-005", "source": "backend/prompt_optimizer.py", "responsibility": "prompt parsing/optimization and provider request construction", "rust_status": "partial", "slice": "generation"},
        {"id": "W-006", "source": "main.py:process_video_background/process_video_with_auto_retry", "responsibility": "video generation, retry, watermark-free conversion, queue lifecycle", "rust_status": "parity-tested", "slice": "queue-media"},
        {"id": "W-007", "source": "main.py:process_batch_generate_async_task", "responsibility": "persisted async batch generation and progress", "rust_status": "parity-tested", "slice": "generation"},
        {"id": "W-008", "source": "main.py:process_story_chain/process_story_fission", "responsibility": "story chain/fission orchestration and artifact persistence", "rust_status": "parity-tested", "slice": "story"},
        {"id": "W-009", "source": "main.py:zombie_task_recovery/cleanup_task", "responsibility": "restart recovery and stale task cleanup", "rust_status": "parity-tested", "slice": "queue-media"},
        {"id": "W-010", "source": "scripts/cron/backup/sync", "responsibility": "operational backups and OneDrive synchronization", "rust_status": "not-applicable", "slice": "operations"},
        {"id": "W-011", "source": "backend/cleanup_gallery.py", "responsibility": "remove gallery rows whose files no longer exist", "rust_status": "partial", "slice": "operations"},
    ]


def tables() -> list[str]:
    text = PY_MAIN.read_text()
    found = re.findall(r"__tablename__\s*=\s*['\"]([^'\"]+)", text)
    return sorted(set(found))


def main() -> None:
    routes = extract_routes()
    data = {
        "generated_by": str(Path(__file__).relative_to(ROOT)),
        "source_commit_scope": "working tree",
        "python_route_count": len(routes),
        "rust_registered_route_count": len(RUST_ROUTES),
        "routes": routes,
        "workers": workers(),
        "python_sqlalchemy_tables": tables(),
        "required_external_boundaries": [
            "OpenAI-compatible chat/image APIs",
            "Gemini-compatible image/text APIs",
            "Sora/video API",
            "voice clone/TTS API",
            "Cloudflare Turnstile",
            "Feishu tenant token and spreadsheet API",
            "Redis Pub/Sub",
            "PostgreSQL",
        ],
        "status_legend": {
            "missing": "No Rust route/worker counterpart exists.",
            "partial": "Rust route or a related primitive exists, but exact contract and side effects are not differential-tested.",
            "parity-tested": "Differential test suite proves compatibility. None are promoted by this generator automatically.",
        },
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {OUT} ({len(routes)} routes, {len(RUST_ROUTES)} Rust registrations)")


if __name__ == "__main__":
    main()
