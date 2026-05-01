# Stage 1: build
FROM node:20-alpine AS build
RUN corepack enable
# Native build deps for better-sqlite3.
RUN apk add --no-cache python3 make g++ wget
WORKDIR /app

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
FROM node:20-alpine AS runtime
RUN corepack enable
# Runtime needs python/make/g++ too because the prod install rebuilds
# better-sqlite3's native binding for this image's Node version.
RUN apk add --no-cache python3 make g++
WORKDIR /app

# Copy package manifests
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/prototype/package.json ./prototype/
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/simulation/package.json ./packages/simulation/

# Install only production deps for the server's workspace tree
RUN pnpm install --frozen-lockfile --prod --filter "template-server..."

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
