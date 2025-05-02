FROM rust:latest AS builder

WORKDIR /usr/src/app

FROM builder AS development

RUN cargo install cargo-watch

COPY Cargo.toml Cargo.lock ./

ENV ROCKET_ADDRESS=0.0.0.0
ENV ROCKET_PORT=8000

EXPOSE 8000

CMD ["cargo", "watch", "-x", "run"]

FROM builder AS production

COPY . .

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /usr/src/app/target/release/syllabus-tracker /app/
COPY --from=builder /usr/src/app/static /app/static
COPY --from=builder /usr/src/app/templates /app/templates
COPY --from=builder /usr/src/app/config /app/config

RUN mkdir -p /app/data

EXPOSE 8000

ENV ROCKET_ADDRESS=0.0.0.0
ENV ROCKET_PORT=8000

CMD ["/app/syllabus-tracker"]
