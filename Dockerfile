FROM lukemathwalker/cargo-chef:latest-rust-1.86-alpine AS chef
WORKDIR /app

FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
COPY .sqlx ./.sqlx
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder-deps
WORKDIR /app
COPY --from=planner /app/recipe.json recipe.json
ENV SQLX_OFFLINE=true
RUN rustup target add x86_64-unknown-linux-musl
RUN cargo chef cook --release --target x86_64-unknown-linux-musl

FROM chef AS dev-builder
WORKDIR /app
COPY --from=builder-deps /app/target target
COPY --from=builder-deps /usr/local/cargo /usr/local/cargo
RUN cargo install cargo-watch

FROM chef AS dev
WORKDIR /app
COPY --from=dev-builder /usr/local/cargo/bin/cargo-watch /usr/local/cargo/bin/cargo-watch
ENV ROCKET_ADDRESS=0.0.0.0
ENV ROCKET_PORT=8000
EXPOSE 8000
CMD ["cargo", "watch", "-x", "run"]

FROM chef AS builder
WORKDIR /app
COPY --from=builder-deps /app/target target
COPY --from=builder-deps /usr/local/cargo /usr/local/cargo
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
COPY .sqlx ./.sqlx
COPY config ./config
ENV SQLX_OFFLINE=true
RUN cargo build --release --target x86_64-unknown-linux-musl
RUN cp target/x86_64-unknown-linux-musl/release/syllabus-tracker /app/syllabus-tracker

FROM scratch AS production
WORKDIR /app
COPY --from=builder /app/syllabus-tracker /app/syllabus-tracker
COPY --from=builder /app/config /app/config
VOLUME /app/data
EXPOSE 8000
ENV ROCKET_ADDRESS=0.0.0.0
ENV ROCKET_PORT=8000
CMD ["/app/syllabus-tracker"]
