# ---- builder ---------------------------------------------------------------
# Build context is the REPO ROOT (the full workspace is needed).
# Invoke as:
#   docker build -f crates/video-worker/Dockerfile -t video-worker .
FROM rust:1.100.0-slim-trixie AS builder
WORKDIR /app

# Build-time system deps:
# - clang + libclang-dev: required by aws-lc-sys (used transitively by
#   aws-sdk-s3) which runs bindgen at build time.
# - cmake: aws-lc-sys drives its CMake-based build of aws-lc.
# - pkg-config: queried by some build scripts even when no native lib is linked.
# The workspace uses rustls everywhere so libssl-dev is NOT needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang libclang-dev lld cmake pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Copy the full workspace and build only the video-worker binary.
COPY . .

RUN cargo build --release -p video-worker

FROM mwader/static-ffmpeg:7.1.1 AS ffmpeg

# ---- runtime ---------------------------------------------------------------
# Ships glibc, CA certificates (rustls-native-certs reads /etc/ssl/certs) and a
# nonroot user, and nothing else.
FROM gcr.io/distroless/cc-debian13:nonroot AS runtime

COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe

COPY --from=builder /app/target/release/video-worker      /usr/local/bin/video-worker
COPY --from=builder /app/target/release/transcode-server  /usr/local/bin/transcode-server

# The container's job is to be the HTTP server: transcode-server handles
# requests from the Cloudflare queue consumer (sync mode by default).
# The video-worker one-shot binary stays in the image as the subprocess.
ENTRYPOINT ["transcode-server"]
