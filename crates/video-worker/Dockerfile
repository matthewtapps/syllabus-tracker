# ---- builder ---------------------------------------------------------------
# Build context is the REPO ROOT (the full workspace is needed).
# Invoke as:
#   docker build -f crates/video-worker/Dockerfile -t video-worker .
FROM rust:1.86-slim-bookworm AS builder
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

# ---- runtime ---------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

# ffmpeg ships ffprobe in the same package.
# ca-certificates is needed for reqwest (rustls uses the system trust store
# via rustls-native-certs, which reads /etc/ssl/certs).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/video-worker      /usr/local/bin/video-worker
COPY --from=builder /app/target/release/transcode-server  /usr/local/bin/transcode-server

RUN useradd -r -s /usr/sbin/nologin -u 10001 worker
USER worker

# The container's job is to be the HTTP server: transcode-server handles
# requests from the Cloudflare queue consumer (sync mode by default).
# The video-worker one-shot binary stays in the image as the subprocess.
ENTRYPOINT ["transcode-server"]
