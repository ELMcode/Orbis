#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${POSTGRES_CONTAINER:-orbis-db}"
POSTGRES_USER="${POSTGRES_USER:-orbis}"
POSTGRES_DB="${POSTGRES_DB:-orbis}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
mkdir -p "$BACKUP_DIR"

backup_file="$BACKUP_DIR/orbis-${POSTGRES_DB}-${timestamp}.dump"

docker exec "$CONTAINER_NAME" pg_dump \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --format=custom \
  --no-owner \
  --no-acl > "$backup_file"

find "$BACKUP_DIR" -type f -name 'orbis-*.dump' -mtime +"$RETENTION_DAYS" -delete

echo "$backup_file"
