# Build context is the REPO ROOT (the full workspace is needed).
# Invoke as:
#   docker build -f crates/video-worker/Dockerfile -t video-worker .
FROM lukemathwalker/cargo-chef:0.1.78-rust-1.100.0-alpine AS builder
WORKDIR /app
COPY . .
RUN rustup target add x86_64-unknown-linux-musl \
    && cargo build --release --target x86_64-unknown-linux-musl -p video-worker

FROM mwader/static-ffmpeg:9.0.2-1 AS ffmpeg

# Static binaries only: ships CA certificates (rustls-native-certs reads
# /etc/ssl/certs) and a nonroot user, and no libc.
FROM gcr.io/distroless/static-debian13:nonroot AS runtime

COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe

COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/video-worker      /usr/local/bin/video-worker
COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/transcode-server  /usr/local/bin/transcode-server

# The container's job is to be the HTTP server: transcode-server handles
# requests from the Cloudflare queue consumer (sync mode by default).
# The video-worker one-shot binary stays in the image as the subprocess.
ENTRYPOINT ["transcode-server"]
