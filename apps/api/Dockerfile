# syntax=docker/dockerfile:1
# ProcessHub API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile .
FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "@processhub/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @processhub/shared build \
  && pnpm --filter @processhub/api exec prisma generate \
  && pnpm --filter @processhub/api build

FROM base AS runtime
ENV NODE_ENV=production
# The Prisma CLI (needed for `migrate deploy` at start-up) is kept with the build output.
COPY --from=build /app /app
WORKDIR /app/apps/api
RUN mkdir -p /app/data && chown node:node /app/data && chmod +x docker-entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
