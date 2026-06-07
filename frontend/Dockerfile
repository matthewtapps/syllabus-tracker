# check=skip=SecretsUsedInArgOrEnv
# The directive above must be the very first line — parser directives
# stop being recognised after any non-directive content. It silences
# the BuildKit check that flags `VITE_HONEYCOMB_API_KEY` as a secret
# in ARG/ENV. VITE_HONEYCOMB_API_KEY is a Honeycomb browser ingest key
# that is intentionally embedded in the public Vite bundle and ships
# to end users; not a secret in any meaningful sense. The per-service
# browser ingest key minted by platform tofu has create_datasets=false
# specifically because anyone loading the page can read it.

FROM node:22.22.2-alpine AS base
RUN npm install -g pnpm@10.8.0

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install
COPY . .
ARG VITE_HONEYCOMB_API_KEY
ARG VITE_API_URL
ARG VITE_ENVIRONMENT
ENV VITE_HONEYCOMB_API_KEY=$VITE_HONEYCOMB_API_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_ENVIRONMENT=$VITE_ENVIRONMENT
RUN pnpm build

FROM nginx:1.29.8-alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
