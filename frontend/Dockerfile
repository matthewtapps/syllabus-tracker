FROM node:22-alpine AS base
RUN npm install -g pnpm

FROM base AS dev
WORKDIR /app
EXPOSE 5173
CMD ["sh", "-c", "pnpm install && pnpm dev --host"]

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install
COPY . .
RUN pnpm build

FROM nginx:alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
