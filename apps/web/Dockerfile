# syntax=docker/dockerfile:1
# ProcessHub web image (static build served by nginx). Build from the repository root:
#   docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@processhub/web..."
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @processhub/web build && node apps/web/scripts/precompress.mjs

# Unprivileged nginx (NGINX's official image variant): runs as user nginx (uid 101) and listens on
# 8080, so the container needs no root and no extra capabilities (final session, part A).
# nginx 1.28 = the current stable branch (1.27 mainline is end-of-life); OS packages upgraded for security
# fixes, then back to the unprivileged user (final session part B, Trivy gate).
FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime
USER root
RUN apk upgrade --no-cache
USER 101
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
