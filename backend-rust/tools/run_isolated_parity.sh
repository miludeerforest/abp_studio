#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
RUST_ROOT="$ROOT/backend-rust"
WORKDIR=${ABP_PARITY_WORKDIR:-/tmp/abp-parity}
NETWORK=abp-parity
PY_PORT=${ABP_PARITY_PY_PORT:-33113}
RS_PORT=${ABP_PARITY_RS_PORT:-33114}
PG_PY_PORT=${ABP_PARITY_PG_PY_PORT:-25532}
PG_RS_PORT=${ABP_PARITY_PG_RS_PORT:-25533}
REDIS_RS_PORT=${ABP_PARITY_REDIS_RS_PORT:-6391}
ADMIN_PASSWORD=${ABP_PARITY_ADMIN_PASSWORD:-parity-pass}
RUST_PID=""
RECOVERY_PID=""
PROVIDER_PID="" # retained for cleanup compatibility; provider runs in Docker
PROVIDER_PORT=${ABP_PARITY_PROVIDER_PORT:-33115}

containers=(
  abp-parity-python
  abp-parity-pg-python
  abp-parity-pg-rust
  abp-parity-redis-python
  abp-parity-redis-rust
  abp-parity-provider
)

cleanup() {
  if [[ -n "$RUST_PID" ]]; then kill "$RUST_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$RECOVERY_PID" ]]; then kill "$RECOVERY_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$PROVIDER_PID" ]]; then kill "$PROVIDER_PID" >/dev/null 2>&1 || true; fi
  for container in "${containers[@]}"; do
    docker rm -f "$container" >/dev/null 2>&1 || true
  done
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
cleanup
finish() {
  local status=$?
  if [[ $status -ne 0 ]]; then
    echo "--- Python parity backend log ---" >&2
    docker logs --tail 120 abp-parity-python >&2 2>/dev/null || true
    echo "--- Rust parity backend log ---" >&2
    tail -120 "$WORKDIR/rust.log" >&2 2>/dev/null || true
  fi
  cleanup
  return "$status"
}
trap finish EXIT

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR/python-uploads" "$WORKDIR/rust-uploads"
ln -s "$RUST_ROOT/prompts" "$WORKDIR/prompts"
mkdir -p "$WORKDIR/python-uploads/gallery" "$WORKDIR/rust-uploads/gallery" \
  "$WORKDIR/python-uploads/queue" "$WORKDIR/rust-uploads/queue"
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC' | base64 -d > "$WORKDIR/python-uploads/gallery/seed.png"
cp "$WORKDIR/python-uploads/gallery/seed.png" "$WORKDIR/python-uploads/gallery/seed2.png"
cp "$WORKDIR/python-uploads/gallery/seed.png" "$WORKDIR/rust-uploads/gallery/seed.png"
cp "$WORKDIR/python-uploads/gallery/seed.png" "$WORKDIR/rust-uploads/gallery/seed2.png"
docker image inspect auto_banana_product-backend >/dev/null 2>&1 || \
  docker build -t auto_banana_product-backend "$ROOT/backend"
docker run --rm -v "$WORKDIR/python-uploads/queue:/out" auto_banana_product-backend \
  ffmpeg -loglevel error -f lavfi -i color=c=black:s=16x16:d=1 -c:v libx264 -pix_fmt yuv420p -y /out/seed.mp4
cp "$WORKDIR/python-uploads/queue/seed.mp4" "$WORKDIR/python-uploads/queue/seed2.mp4"
cp "$WORKDIR/python-uploads/queue/seed.mp4" "$WORKDIR/rust-uploads/queue/seed.mp4"
cp "$WORKDIR/python-uploads/queue/seed.mp4" "$WORKDIR/rust-uploads/queue/seed2.mp4"

docker image inspect auto_banana_product-backend >/dev/null 2>&1 || \
  docker build -t auto_banana_product-backend "$ROOT/backend"

cat > "$WORKDIR/provider_stub.py" <<'PY'
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.endswith("/video.mp4"):
            body = open("/seed.mp4", "rb").read()
            content_type = "video/mp4"
        else:
            body = json.dumps({"data": [{"id": "model-a"}, {"id": "model-b"}]}).encode()
            content_type = "application/json"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length) or b"{}")
        model = request.get("model", "stub-model")
        request_text = json.dumps(request, ensure_ascii=False)
        if "FAIL_VIDEO" in request_text:
            body = b"{\"error\":\"forced parity failure\"}"
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if "ai_score" in request_text or "视频质量审核专家" in request_text:
            content = json.dumps({
                "ai_score": 9,
                "consistency_score": 9,
                "physics_score": 8,
                "ecommerce_score": 9,
                "hook_score": 8,
                "platform_risk": 9,
                "overall_score": 8,
                "recommendation": "pass",
                "summary": "视频自然流畅，产品展示清晰。",
                "issues": [],
                "strengths": ["产品主体完整", "画面稳定"],
            })
        elif "故事分支" in request_text or "return ONLY JSON array" in request_text or "裂变成" in request_text:
            content = json.dumps([
                {"branch_id": i, "scene_name": f"场景 {i}", "theme": f"主题 {i}", "product_focus": "Red lipstick", "image_prompt": f"Preserve the EXACT product appearance. Commercial scene {i}", "video_prompt": "Generate a video based on this image", "camera_movement": "slow push-in"}
                for i in range(1, 4)
            ])
        elif "shotStory" in request_text:
            content = json.dumps([
                {"shot": i, "prompt": f"Cinematic shot {i}", "duration": 5, "description": f"Scene {i}", "shotStory": f"故事镜头 {i}", "heroSubject": "Red lipstick"}
                for i in range(1, 6)
            ])
        elif "product_description" in request_text and "environment_analysis" in request_text:
            content = json.dumps({
                "product_description": "Red lipstick product",
                "environment_analysis": "Premium beauty studio",
                "placement_mode": "Centered product placement",
                "scripts": [{"angle_name": f"Angle {i}", "script": f"Commercial lipstick scene {i}"} for i in range(1, 10)]
            })
        elif "exactly 10" in request_text or "10 image" in request_text or "10 consistent" in request_text:
            content = json.dumps([
                {"id": i, "type": "Main Image" if i <= 2 else "Detail/Scenario", "title": f"Prompt {i}", "promptText": f"Commercial scene {i}", "rationale": "Parity rationale"}
                for i in range(1, 11)
            ])
        else:
            content = json.dumps({"translation": "测试翻译", "keywords": "uno, dos, tres, cuatro"})
        if request.get("stream"):
            if "Generate a video based on this image" in request_text:
                content = f"http://{self.headers['Host']}/video.mp4"
            else:
                content = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
        if request.get("stream"):
            chunk = json.dumps({"choices": [{"delta": {"content": content}}]}).encode()
            body = b"data: " + chunk + b"\n\ndata: [DONE]\n\n"
            content_type = "text/event-stream"
        else:
            body = json.dumps({"model": model, "choices": [{"message": {"content": content}}]}).encode()
            content_type = "application/json"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_): pass
ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
PY

docker network create "$NETWORK" >/dev/null
docker run -d --rm --name abp-parity-provider --network "$NETWORK" \
  -p "127.0.0.1:${PROVIDER_PORT}:8000" \
  -v "$WORKDIR/provider_stub.py:/stub.py:ro" \
  -v "$WORKDIR/python-uploads/queue/seed.mp4:/seed.mp4:ro" \
  auto_banana_product-backend python /stub.py >/dev/null
docker run -d --rm --name abp-parity-pg-python --network "$NETWORK" \
  -e POSTGRES_USER=parity -e POSTGRES_PASSWORD=parity -e POSTGRES_DB=parity \
  -p "127.0.0.1:${PG_PY_PORT}:5432" postgres:15 >/dev/null
docker run -d --rm --name abp-parity-pg-rust --network "$NETWORK" \
  -e POSTGRES_USER=parity -e POSTGRES_PASSWORD=parity -e POSTGRES_DB=parity \
  -p "127.0.0.1:${PG_RS_PORT}:5432" postgres:15 >/dev/null
docker run -d --rm --name abp-parity-redis-python --network "$NETWORK" redis:latest >/dev/null
docker run -d --rm --name abp-parity-redis-rust --network "$NETWORK" \
  -p "127.0.0.1:${REDIS_RS_PORT}:6379" redis:latest >/dev/null

for container in abp-parity-pg-python abp-parity-pg-rust; do
  for _ in $(seq 1 40); do
    docker exec "$container" pg_isready -U parity >/dev/null 2>&1 && break
    sleep 0.5
  done
done

docker run -d --rm --name abp-parity-python --network "$NETWORK" \
  --add-host=host.docker.internal:host-gateway \
  -p "127.0.0.1:${PY_PORT}:8000" \
  -e PYTHONDONTWRITEBYTECODE=1 \
  -e DATABASE_URL=postgresql://parity:parity@abp-parity-pg-python:5432/parity \
  -e REDIS_HOST=abp-parity-redis-python -e REDIS_PORT=6379 -e REDIS_DB=0 \
  -e SECRET_KEY=parity-secret -e ADMIN_USER=admin -e ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  -e FORCE_RESET_ADMIN_PASSWORD=true -e TURNSTILE_SECRET_KEY= \
  -e HTTP_PROXY= -e HTTPS_PROXY= -e ALL_PROXY= -e NO_PROXY='*' \
  -v "$ROOT/backend:/app:ro" -v "$WORKDIR/python-uploads:/app/uploads" \
  auto_banana_product-backend >/dev/null

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:${PY_PORT}/api/v1/public/config" >/dev/null 2>&1 && break
  sleep 1
done

(cd "$RUST_ROOT" && cargo build -p abp-api --bin abp-server >/dev/null)
(
  cd "$WORKDIR"
  export DATABASE_URL="postgresql://parity:parity@127.0.0.1:${PG_RS_PORT}/parity"
  export REDIS_HOST=127.0.0.1 REDIS_PORT="$REDIS_RS_PORT" REDIS_DB=0 REDIS_PASSWORD=
  export SECRET_KEY=parity-secret ADMIN_USER=admin ADMIN_PASSWORD="$ADMIN_PASSWORD"
  export FORCE_RESET_ADMIN_PASSWORD=true HOST=127.0.0.1 PORT="$RS_PORT"
  export UPLOADS_DIR="$WORKDIR/rust-uploads" DISABLE_BACKGROUND_WORKER=true
  exec "$RUST_ROOT/target/debug/abp-server"
) >"$WORKDIR/rust.log" 2>&1 &
RUST_PID=$!
for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:${RS_PORT}/healthz" >/dev/null 2>&1 && break
  sleep 1
done

docker exec abp-parity-pg-python psql -U parity -d parity -v ON_ERROR_STOP=1 -c \
  "INSERT INTO saved_images (user_id,filename,file_path,url,prompt,width,height,category,is_shared) VALUES (1,'seed.png','/app/uploads/gallery/seed.png','/uploads/gallery/seed.png','parity seed',1,1,'parity',TRUE),(1,'seed2.png','/app/uploads/gallery/seed2.png','/uploads/gallery/seed2.png','parity seed 2',1,1,'parity',TRUE); INSERT INTO video_queue (id,filename,file_path,prompt,status,result_url,user_id,category,is_merged,is_shared,retry_count,created_at) VALUES ('seed-video','seed.mp4','/app/uploads/gallery/seed.png','parity video','done','/uploads/queue/seed.mp4',1,'parity',FALSE,TRUE,0,NOW()),('seed-video-2','seed2.mp4','/app/uploads/gallery/seed2.png','parity video 2','done','/uploads/queue/seed2.mp4',1,'parity',FALSE,TRUE,0,NOW());" >/dev/null
docker exec abp-parity-pg-rust psql -U parity -d parity -v ON_ERROR_STOP=1 -c \
  "INSERT INTO saved_images (user_id,filename,file_path,url,prompt,width,height,category,is_shared) VALUES (1,'seed.png','$WORKDIR/rust-uploads/gallery/seed.png','/uploads/gallery/seed.png','parity seed',1,1,'parity',TRUE),(1,'seed2.png','$WORKDIR/rust-uploads/gallery/seed2.png','/uploads/gallery/seed2.png','parity seed 2',1,1,'parity',TRUE); INSERT INTO video_queue (id,filename,file_path,prompt,status,result_url,user_id,category,is_merged,is_shared,retry_count,created_at) VALUES ('seed-video','seed.mp4','$WORKDIR/rust-uploads/gallery/seed.png','parity video','done','/uploads/queue/seed.mp4',1,'parity',FALSE,TRUE,0,NOW()),('seed-video-2','seed2.mp4','$WORKDIR/rust-uploads/gallery/seed2.png','parity video 2','done','/uploads/queue/seed2.mp4',1,'parity',FALSE,TRUE,0,NOW());" >/dev/null

python3 "$RUST_ROOT/tools/differential_write_smoke.py" \
  --python "http://127.0.0.1:${PY_PORT}" \
  --rust "http://127.0.0.1:${RS_PORT}" \
  --python-provider "http://abp-parity-provider:8000/v1" \
  --rust-provider "http://127.0.0.1:${PROVIDER_PORT}/v1" \
  --admin-password "$ADMIN_PASSWORD"

python3 "$RUST_ROOT/tools/redis_event_smoke.py" \
  --rust "http://127.0.0.1:${RS_PORT}" \
  --redis-port "$REDIS_RS_PORT" \
  --provider "http://127.0.0.1:${PROVIDER_PORT}/v1" \
  --admin-password "$ADMIN_PASSWORD"

RECOVERY_TASK_ID="recovery-chain-$(date +%s%N)"
RECOVERY_PAYLOAD='{"initial_image_url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC","shots":[{"prompt":"Generate a video based on this image","duration":5}],"category":"other"}'
docker exec -i abp-parity-pg-rust psql -U parity -d parity -v ON_ERROR_STOP=1 <<SQL
INSERT INTO task_runs (id, kind, user_id, status, progress, payload, heartbeat_at)
VALUES ('$RECOVERY_TASK_ID', 'story-chain', 1, 'processing', 0, '$RECOVERY_PAYLOAD'::jsonb, NOW() - INTERVAL '5 minutes');
SQL
(cd "$RUST_ROOT" && cargo build -p abp-worker --bin abp-worker >/dev/null)
(
  cd "$WORKDIR"
  export DATABASE_URL="postgresql://parity:parity@127.0.0.1:${PG_RS_PORT}/parity"
  export REDIS_HOST=127.0.0.1 REDIS_PORT="$REDIS_RS_PORT" REDIS_DB=0 REDIS_PASSWORD=
  export SECRET_KEY=parity-secret ADMIN_USER=admin ADMIN_PASSWORD="$ADMIN_PASSWORD"
  export UPLOADS_DIR="$WORKDIR/rust-uploads"
  exec "$RUST_ROOT/target/debug/abp-worker"
) >"$WORKDIR/recovery-worker.log" 2>&1 &
RECOVERY_PID=$!
RECOVERY_STATUS=""
for _ in $(seq 1 180); do
  RECOVERY_STATUS=$(docker exec abp-parity-pg-rust psql -U parity -d parity -At \
    -c "SELECT status FROM task_runs WHERE id = '$RECOVERY_TASK_ID';" 2>/dev/null | tr -d '[:space:]' || true)
  if [[ "$RECOVERY_STATUS" == "completed" || "$RECOVERY_STATUS" == "failed" ]]; then break; fi
  sleep 1
done
if [[ "$RECOVERY_STATUS" != "completed" || ! -s "$WORKDIR/rust-uploads/queue/story_chain_${RECOVERY_TASK_ID}.mp4" ]]; then
  echo "FAIL restart recovery: status=$RECOVERY_STATUS" >&2
  tail -120 "$WORKDIR/recovery-worker.log" >&2 || true
  exit 1
fi
kill "$RECOVERY_PID" >/dev/null 2>&1 || true
wait "$RECOVERY_PID" >/dev/null 2>&1 || true
RECOVERY_PID=""
echo "PASS restart recovery: stale story-chain task resumed by abp-worker"
