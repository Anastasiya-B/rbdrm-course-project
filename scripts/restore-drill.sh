#!/usr/bin/env bash

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$ROOT/backups"

RESTORE_CONTAINER="marketplace-restore-drill"
RESTORE_VOLUME="marketplace_restore_drill_data"

RESTORE_DB="marketplace_restore"
RESTORE_USER="restore_user"
RESTORE_PASSWORD="restore_password"

LATEST_BACKUP="$(
  ls -t "$BACKUP_DIR"/*.dump 2>/dev/null |
    head -n 1 || true
)"

if [ -z "$LATEST_BACKUP" ]; then
  echo "No backup found in $BACKUP_DIR" >&2
  exit 1
fi

cleanup() {
  docker rm -f "$RESTORE_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm -f "$RESTORE_VOLUME" >/dev/null 2>&1 || true
}

trap cleanup EXIT

cleanup

SOURCE_CHECKSUM="$(
  docker compose exec -T postgres \
    psql \
    -U marketplace \
    -d marketplace \
    -Atc "
      SELECT
        count(*) || '|' || COALESCE(sum(total_amount), 0)
      FROM orders;
    "
)"

echo "Backup: $LATEST_BACKUP"
echo "Source checksum: $SOURCE_CHECKSUM"

START_TIME="$(date +%s)"

docker volume create "$RESTORE_VOLUME" >/dev/null

docker run -d \
  --name "$RESTORE_CONTAINER" \
  -e POSTGRES_DB="$RESTORE_DB" \
  -e POSTGRES_USER="$RESTORE_USER" \
  -e POSTGRES_PASSWORD="$RESTORE_PASSWORD" \
  -v "$RESTORE_VOLUME:/var/lib/postgresql/data" \
  postgres:16 >/dev/null

until docker exec \
  "$RESTORE_CONTAINER" \
  pg_isready \
  -h 127.0.0.1 \
  -p 5432 \
  -U "$RESTORE_USER" \
  -d "$RESTORE_DB" >/dev/null 2>&1
do
  sleep 1
done

docker cp \
  "$LATEST_BACKUP" \
  "$RESTORE_CONTAINER:/tmp/restore.dump"

docker exec \
  -e PGPASSWORD="$RESTORE_PASSWORD" \
  "$RESTORE_CONTAINER" \
  pg_restore \
  --host=127.0.0.1 \
  --port=5432 \
  --no-owner \
  --no-privileges \
  --username="$RESTORE_USER" \
  --dbname="$RESTORE_DB" \
  /tmp/restore.dump

RESTORED_CHECKSUM="$(
  docker exec \
    -e PGPASSWORD="$RESTORE_PASSWORD" \
    "$RESTORE_CONTAINER" \
    psql \
    -h 127.0.0.1 \
    -p 5432 \
    -U "$RESTORE_USER" \
    -d "$RESTORE_DB" \
    -Atc "
      SELECT
        count(*) || '|' || COALESCE(sum(total_amount), 0)
      FROM orders;
    "
)"

END_TIME="$(date +%s)"
RTO_SECONDS="$((END_TIME - START_TIME))"

BACKUP_SIZE="$(
  du -h "$LATEST_BACKUP" |
    awk '{print $1}'
)"

echo "Restored checksum: $RESTORED_CHECKSUM"
echo "Backup size: $BACKUP_SIZE"
echo "RTO: ${RTO_SECONDS} seconds"

if [ "$SOURCE_CHECKSUM" != "$RESTORED_CHECKSUM" ]; then
  echo "MISMATCH"
  exit 1
fi

echo "MATCH"