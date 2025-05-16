FROM rust:latest AS base
RUN cargo install sccache
RUN cargo install cargo-chef
ENV RUSTC_WRAPPER=sccache SCCACHE_DIR=/sccache

FROM base AS planner
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=$SCCACHE_DIR,sharing=locked \
    cargo chef prepare --recipe-path recipe.json

FROM base AS dev-builder
WORKDIR /app
COPY --from=planner /app/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=$SCCACHE_DIR,sharing=locked \
    cargo chef cook --release --recipe-path recipe.json
RUN cargo install cargo-watch

FROM base AS dev
WORKDIR /app
COPY --from=dev-builder /usr/local/cargo/bin/cargo-watch /usr/local/cargo/bin/cargo-watch
ENV ROCKET_ADDRESS=0.0.0.0
ENV ROCKET_PORT=8000
EXPOSE 8000
CMD ["cargo", "watch", "-x", "run"]

FROM base AS builder
WORKDIR /app
COPY --from=planner /app/recipe.json recipe.json
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=$SCCACHE_DIR,sharing=locked \
    cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=$SCCACHE_DIR,sharing=locked \
    cargo build --release

FROM base AS production

WORKDIR /app

COPY --from=builder /app/target/release/syllabus-tracker /app/
COPY --from=builder /app/static /app/static
COPY --from=builder /app/config /app/config
COPY frontend/dist /app/frontend/dist

RUN mkdir -p /app/data

EXPOSE 8000

ENV ROCKET_ADDRESS=0.0.0.0
ENV ROCKET_PORT=8000

CMD ["/app/syllabus-tracker"]
