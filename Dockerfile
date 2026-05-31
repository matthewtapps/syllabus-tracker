FROM lukemathwalker/cargo-chef:0.1.71-rust-1.86-alpine AS chef
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY .sqlx ./.sqlx
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder-deps
WORKDIR /app
COPY --from=planner /app/recipe.json recipe.json
ENV SQLX_OFFLINE=true
RUN rustup target add x86_64-unknown-linux-musl
RUN cargo chef cook --release --target x86_64-unknown-linux-musl

FROM mwader/static-ffmpeg:7.1.1 AS ffmpeg

FROM chef AS builder
WORKDIR /app
COPY --from=builder-deps /app/target target
COPY --from=builder-deps /usr/local/cargo /usr/local/cargo
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY .sqlx ./.sqlx
ENV SQLX_OFFLINE=true
# `seed` is dev-only and not built here. The deploy pipeline invokes
# `--entrypoint /app/migrate --dry-run` against a copy of the prod DB as a
# pre-deploy gate; the main `syllabus-tracker` binary also runs the same
# migration on boot as a defensive no-op if migrate already ran.
RUN cargo build --release --target x86_64-unknown-linux-musl \
    --bin syllabus-tracker --bin migrate
RUN cp target/x86_64-unknown-linux-musl/release/syllabus-tracker /app/syllabus-tracker
RUN cp target/x86_64-unknown-linux-musl/release/migrate /app/migrate

FROM scratch AS production
WORKDIR /app
COPY --from=builder /app/syllabus-tracker /app/syllabus-tracker
COPY --from=builder /app/migrate /app/migrate
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
COPY config /app/config
VOLUME /app/data
EXPOSE 8000
ENV ROCKET_ADDRESS=0.0.0.0
ENV ROCKET_PORT=8000
ENV FFMPEG_BIN=/usr/local/bin/ffmpeg
ENV FFPROBE_BIN=/usr/local/bin/ffprobe
CMD ["/app/syllabus-tracker"]
