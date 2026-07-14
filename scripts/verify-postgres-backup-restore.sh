#!/usr/bin/env bash
set -euo pipefail

# Restores a fresh dump in an isolated PostgreSQL container. This is deliberately
# separate from the application database so it can be run in CI and production-like environments.
SOURCE_CONTAINER="${POSTGRES_CONTAINER:-orbis-db}"
POSTGRES_USER="${POSTGRES_USER:-orbis}"
POSTGRES_DB="${POSTGRES_DB:-orbis}"
VERIFY_IMAGE="${POSTGRES_VERIFY_IMAGE:-postgres:16-alpine}"
VERIFY_DB="${POSTGRES_VERIFY_DB:-orbis_restore_verify}"
VERIFY_USER="${POSTGRES_VERIFY_USER:-restore_verifier}"
VERIFY_PASSWORD="${POSTGRES_VERIFY_PASSWORD:-restore-verification-only}"
VERIFY_CONTAINER="orbis-restore-verify-$$"
DUMP_FILE="$(mktemp -t orbis-restore-verify.XXXXXX.dump)"

cleanup() {
  rm -f "$DUMP_FILE"
  docker rm --force "$VERIFY_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker inspect "$SOURCE_CONTAINER" >/dev/null 2>&1; then
  echo "PostgreSQL source container not found: $SOURCE_CONTAINER" >&2
  exit 1
fi

docker exec "$SOURCE_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null
source_migration_count="$(docker exec "$SOURCE_CONTAINER" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT count(*) FROM public.\"_prisma_migrations\" WHERE finished_at IS NOT NULL;")"

if [[ ! "$source_migration_count" =~ ^[1-9][0-9]*$ ]]; then
  echo "Source database does not contain applied Prisma migrations." >&2
  exit 1
fi

docker exec "$SOURCE_CONTAINER" pg_dump \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --format=custom \
  --no-owner \
  --no-acl > "$DUMP_FILE"

test -s "$DUMP_FILE"

docker run -d --name "$VERIFY_CONTAINER" \
  -e "POSTGRES_USER=$VERIFY_USER" \
  -e "POSTGRES_PASSWORD=$VERIFY_PASSWORD" \
  -e "POSTGRES_DB=$VERIFY_DB" \
  "$VERIFY_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$VERIFY_CONTAINER" pg_isready -U "$VERIFY_USER" -d "$VERIFY_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

docker exec "$VERIFY_CONTAINER" pg_isready -U "$VERIFY_USER" -d "$VERIFY_DB" >/dev/null
docker cp "$DUMP_FILE" "$VERIFY_CONTAINER:/tmp/backup.dump"
docker exec "$VERIFY_CONTAINER" pg_restore \
  -U "$VERIFY_USER" \
  -d "$VERIFY_DB" \
  --no-owner \
  --no-acl \
  --exit-on-error \
  /tmp/backup.dump

table_count="$(docker exec "$VERIFY_CONTAINER" psql -U "$VERIFY_USER" -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
migration_count="$(docker exec "$VERIFY_CONTAINER" psql -U "$VERIFY_USER" -d "$VERIFY_DB" -tAc \
  "SELECT count(*) FROM public.\"_prisma_migrations\" WHERE finished_at IS NOT NULL;")"

if [[ ! "$table_count" =~ ^[1-9][0-9]*$ ]] || [[ "$migration_count" != "$source_migration_count" ]]; then
  echo "Restore validation failed (tables=$table_count, source_migrations=$source_migration_count, restored_migrations=$migration_count)." >&2
  exit 1
fi

echo "PostgreSQL restore verified: $table_count tables, $migration_count applied migrations."
