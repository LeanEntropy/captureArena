# Stage 1: build
FROM node:20-alpine AS build
RUN corepack enable
# Native build deps for better-sqlite3.
RUN apk add --no-cache python3 make g++ wget
WORKDIR /app

# Skip Playwright's ~300MB Chromium download. The `playwright` package
# is a root devDependency used only by tools/screenshot.mjs (dev-only) —
# `--filter "template-server..."` SHOULD exclude it, but pnpm has been
# inconsistent about this in v10. Setting this env var is belt-and-
# suspenders: even if the package gets installed, the browser binary
# download (which dominates install time) is skipped.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy package manifests for dependency install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json ./server/
COPY prototype/package.json ./prototype/
COPY packages/shared/package.json ./packages/shared/
COPY packages/simulation/package.json ./packages/simulation/

# Install all deps for the server's workspace tree
RUN pnpm install --frozen-lockfile --filter "template-server..."

# Copy source + the base tsconfig that server/tsconfig.json extends
COPY tsconfig.base.json ./
COPY prototype ./prototype
COPY server ./server
COPY packages ./packages

# Build server (prebuild script copies sim, then tsc)
RUN pnpm --filter template-server build

# Download db-ip free country-lite database (current month, fall back to last
# month on the 1st when the new mmdb may not be published yet). The file is
# placed alongside the built JS so geo.ts can find it relative to __dirname.
RUN mkdir -p /app/server/dist && \
    YM=$(date +%Y-%m); \
    YM_PREV=$(date -d "$(date +%Y-%m-15) -1 month" +%Y-%m 2>/dev/null || date +%Y-%m); \
    (wget -q -O /tmp/dbip.mmdb.gz "https://download.db-ip.com/free/dbip-country-lite-${YM}.mmdb.gz" \
      || wget -q -O /tmp/dbip.mmdb.gz "https://download.db-ip.com/free/dbip-country-lite-${YM_PREV}.mmdb.gz") && \
    gunzip -c /tmp/dbip.mmdb.gz > /app/server/dist/dbip-country-lite.mmdb && \
    rm /tmp/dbip.mmdb.gz

# Stage 2: runtime
# Reuse the build stage's compiled node_modules (already includes the
# better-sqlite3 native binding compiled against node:20-alpine). Skipping
# `pnpm install --prod` here saves ~3-5 minutes of build time per deploy:
# no second native compile, no second `apk add python3 make g++`. The
# tradeoff is the runtime image carries devDeps (~50MB more), which Railway
# doesn't bill us for; if image size becomes a concern we can `pnpm prune
# --prod` in this stage instead of reinstalling from scratch.
FROM node:20-alpine AS runtime
WORKDIR /app

# Copy node_modules + manifests from build stage (no reinstall, no recompile).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/prototype/package.json ./prototype/
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/simulation/package.json ./packages/simulation/

# Copy built server + the static prototype + the geoip database
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/prototype ./prototype

# Persistent SQLite location — mount a volume here in Railway/Docker.
RUN mkdir -p /app/data
ENV STATS_DB_PATH=/app/data/stats.db

ENV NODE_ENV=production
EXPOSE 2567
WORKDIR /app/server
CMD ["node", "dist/index.js"]
