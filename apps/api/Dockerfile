# syntax=docker/dockerfile:1
# ProcessHub API images. Build from the repository root:
#   docker build -f apps/api/Dockerfile .                     # runtime (the API server)
#   docker build -f apps/api/Dockerfile --target migrate .    # one-shot migrations + seed
# Alpine ships OpenSSL 3 (needed by the Prisma engines), so no extra system packages are required.
#
# Final session, part A: the runtime image holds only production dependencies (`pnpm deploy
# --prod`) and the compiled code; the Prisma CLI (migrations) lives in the separate `migrate` image,
# which docker-compose runs once before the API starts.
FROM node:22-alpine AS base
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
# Production dependencies only, with the workspace package (shared) copied in; then the Prisma
# client is generated into that tree and the query engine of the other CPU architecture removed.
# Peers pnpm installs for @prisma/client (the Prisma CLI with its engines and TypeScript) are build
# tools: the client needs only its generated code and the native query engine. The WebAssembly
# engines are for edge runtimes and driver adapters, which ProcessHub does not use.
RUN pnpm --filter @processhub/api deploy --prod --legacy /out \
  && rm -rf /out/dist /out/prisma \
  && cp -r apps/api/dist apps/api/prisma apps/api/docker-entrypoint.sh /out/ \
  && cd /out \
  && /app/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma \
  && case "$(uname -m)" in \
       x86_64) find node_modules -name 'libquery_engine-linux-musl-arm64-*' -delete ;; \
       aarch64) find node_modules -name 'libquery_engine-linux-musl-openssl-*' -delete ;; \
     esac \
  && rm -rf src test tsconfig*.json nest-cli.json jest.config.js Dockerfile \
  && rm -rf node_modules/prisma node_modules/typescript \
  && cd node_modules/.pnpm \
  && rm -rf prisma@* @prisma+engines@* @prisma+engines-version@* @prisma+fetch-engine@* \
       @prisma+config@* typescript@* effect@* fast-check@* \
       c12@* jiti@* giget@* nypm@* @types+* \
  && find . -path '*/@prisma/client/runtime/*.wasm*' -delete \
  && find . -path '*/.prisma/client/*' \( -name '*.wasm' -o -name 'wasm*' -o -name 'query_engine_bg.js' \) -delete
# The Prisma CLI in the version of the lockfile, for the migrate image only.
RUN PRISMA_VERSION="$(node -p "require('/app/apps/api/node_modules/prisma/package.json').version")" \
  && mkdir -p /prisma-cli && cd /prisma-cli && echo '{"private":true}' > package.json \
  && npm install --no-audit --no-fund --omit=dev "prisma@${PRISMA_VERSION}"

# ---- App: compiled code + production dependencies (shared by the two images below) ----
FROM node:22-alpine AS app
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=root:root /out /app
RUN mkdir -p /app/data && chown node:node /app/data && chmod +x docker-entrypoint.sh
USER node
ENTRYPOINT ["./docker-entrypoint.sh"]

# ---- Migrate: `prisma migrate deploy` and the seed, then exits (docker-compose service) ----
FROM app AS migrate
COPY --from=build --chown=root:root /prisma-cli /opt/prisma-cli
ENV PRISMA_CLI=/opt/prisma-cli/node_modules/.bin/prisma
CMD ["migrate"]

# ---- Runtime: the API server (no build tools, no dev dependencies, no Prisma CLI) ----
# Last stage, so a plain `docker build` (no --target) produces the API image.
FROM app AS runtime
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
