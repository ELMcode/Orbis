# ─────────────────────────────────────────────────────────────
# Orbis — Image Docker multi-stage
# ─────────────────────────────────────────────────────────────

# Étape 1 : build du frontend
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

# Étape 2 : build du backend + installation prod
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

# Étape 3 : image finale runtime
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Copier les package.json et installer uniquement les dépendances prod du backend
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/backend/package.json ./packages/backend/
RUN pnpm install --filter @orbis/backend --frozen-lockfile
COPY packages/backend/prisma ./packages/backend/prisma

# Copier le build backend
COPY --from=backend-build /app/packages/backend/dist ./packages/backend/dist
# Régénérer le client Prisma (moteurs adaptés à l'image runtime)
RUN cd packages/backend && pnpm exec prisma generate

# Copier le build frontend
COPY --from=frontend-build /app/packages/frontend/dist ./packages/backend/public

# Artefacts collector téléchargeables depuis l'app
COPY deploy/releases ./packages/backend/collector-downloads/releases

# Créer le dossier d'uploads
RUN mkdir -p /app/packages/backend/uploads

# Script de démarrage (migrate + seed conditionnel + serveur)
COPY docker/entrypoint.sh /app/packages/backend/entrypoint.sh
RUN chmod +x /app/packages/backend/entrypoint.sh

WORKDIR /app/packages/backend

EXPOSE 4000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["./entrypoint.sh"]
