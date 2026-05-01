# Stage 1: build
FROM node:20-alpine AS build
RUN corepack enable
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

# Stage 2: runtime
FROM node:20-alpine AS runtime
RUN corepack enable
WORKDIR /app

# Copy package manifests
COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/prototype/package.json ./prototype/
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/simulation/package.json ./packages/simulation/

# Install only production deps for the server's workspace tree
RUN pnpm install --frozen-lockfile --prod --filter "template-server..."

# Copy built server + the static prototype
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/prototype ./prototype

ENV NODE_ENV=production
EXPOSE 2567
WORKDIR /app/server
CMD ["node", "dist/index.js"]
