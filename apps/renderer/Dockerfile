# syntax=docker/dockerfile:1
# ProcessHub renderer (D-172): headless Chromium that draws diagrams and prints HTML to PDF for the
# API (exports, scheduled report e-mails). Internal only: no published port, no internet. Build
# from the repository root:
#   docker build -f apps/renderer/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/renderer/package.json apps/renderer/
RUN pnpm install --frozen-lockfile --filter "@processhub/web..." --filter "@processhub/renderer..."
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY apps/renderer apps/renderer
# The page code is the web app's own diagram renderer (render.html), so exports look like the app.
RUN pnpm --filter @processhub/web build:render \
  && pnpm --filter @processhub/renderer build \
  && pnpm --filter @processhub/renderer deploy --prod --legacy /out \
  && rm -rf /out/src /out/Dockerfile /out/tsconfig.json \
  && cp -r apps/renderer/dist /out/dist \
  && cp -r apps/web/dist-render /out/bundle

FROM node:22-alpine AS runtime
# Alpine's Chromium; the diagram fonts (Inter, IBM Plex Sans Arabic) come with the bundle.
# OS security fixes first; npm / corepack removed (not used at runtime, final session part B).
RUN apk upgrade --no-cache && apk add --no-cache chromium ttf-freefont \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production BUNDLE_DIR=/app/bundle PORT=3100 HOME=/tmp
WORKDIR /app
COPY --from=build --chown=root:root /out /app
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3100/health || exit 1
CMD ["node", "dist/server.js"]
