# abp-rust — 多阶段构建；运行时包含 ffmpeg，最终镜像大小以实际构建为准
FROM rust:1.92-slim-bookworm AS builder
WORKDIR /build
COPY . .
RUN cargo build --release -p abp-api -p abp-worker

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/target/release/abp-server /usr/local/bin/abp-server
COPY --from=builder /build/target/release/abp-worker /usr/local/bin/abp-worker
ENV UPLOADS_DIR=/app/uploads \
    HOST=0.0.0.0 \
    PORT=8000
EXPOSE 8000
VOLUME ["/app/uploads"]
CMD ["abp-server"]
