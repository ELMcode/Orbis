# ─────────────────────────────────────────────────────────────
# Orbis — Image Docker multi-stage
# ─────────────────────────────────────────────────────────────

# Stage 1: build the frontend
FROM node:20-bookworm-slim AS frontend-build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/backend/package.json ./packages/backend/
COPY packages/collector/package.json ./packages/collector/
RUN pnpm install --frozen-lockfile --prod=false
COPY packages/frontend/ ./packages/frontend/
RUN pnpm --filter @orbis/frontend run build

# Stage 2: build the backend and install production dependencies
FROM node:20-bookworm-slim AS backend-build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/collector/package.json ./packages/collector/
RUN pnpm install --frozen-lockfile --prod=false
COPY packages/backend/ ./packages/backend/
RUN pnpm --filter @orbis/backend exec prisma generate
RUN pnpm --filter @orbis/backend run build

# Stage 3: final runtime image
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Copy package.json files and install backend production dependencies only.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/backend/package.json ./packages/backend/
RUN pnpm install --filter @orbis/backend --frozen-lockfile
COPY packages/backend/prisma ./packages/backend/prisma

# Copier le build backend
COPY --from=backend-build /app/packages/backend/dist ./packages/backend/dist
# Regenerate Prisma Client with engines matching the runtime image.
RUN cd packages/backend && pnpm exec prisma generate

# Copier le build frontend
COPY --from=frontend-build /app/packages/frontend/dist ./packages/backend/public

# Collector artifacts downloadable from the application.
COPY deploy/releases ./packages/backend/collector-downloads/releases

# Create the upload directory.
RUN mkdir -p /app/packages/backend/uploads

# Startup script (migrations, conditional seed, and server).
COPY docker/entrypoint.sh /app/packages/backend/entrypoint.sh
RUN chmod +x /app/packages/backend/entrypoint.sh

WORKDIR /app/packages/backend

EXPOSE 4000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["./entrypoint.sh"]
