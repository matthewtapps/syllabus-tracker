default:
    @just --list

build:
    docker build --target production -t syllabus-tracker:latest .
    docker build --target production -t syllabus-tracker-frontend:latest ./frontend

up:
    docker compose up -d

dev:
    docker compose up

stop:
    docker compose stop

down:
    docker compose down
