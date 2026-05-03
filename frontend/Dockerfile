FROM node:22.22.2-alpine AS base
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
