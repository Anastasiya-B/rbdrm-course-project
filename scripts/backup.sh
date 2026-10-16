#!/usr/bin/env bash

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$ROOT/backups"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
BACKUP_FILE="$BACKUP_DIR/marketplace_$TIMESTAMP.dump"

docker compose exec -T postgres \
  pg_dump \
  --format=custom \
  --no-owner \
  --username=marketplace \
  --dbname=marketplace \
  > "$BACKUP_FILE"

echo "$BACKUP_FILE"