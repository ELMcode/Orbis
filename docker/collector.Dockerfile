FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/collector/package.json ./packages/collector/
RUN pnpm install --filter @orbis/collector --frozen-lockfile

COPY packages/collector ./packages/collector
RUN pnpm --filter @orbis/collector run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends net-tools ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/collector/package.json ./packages/collector/
RUN pnpm install --filter @orbis/collector --prod --frozen-lockfile

COPY --from=build /app/packages/collector/dist ./packages/collector/dist

WORKDIR /app/packages/collector
CMD ["node", "dist/index.js"]
