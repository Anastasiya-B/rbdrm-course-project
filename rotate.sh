#!/usr/bin/env bash

set -e

DB_CONTAINER="marketplace-postgres"
DB_USER="marketplace"
DB_NAME="marketplace"
SECRET_FILE="secrets/db_password"

NEW_PASSWORD="marketplace_$(date +%s)"

echo "Rotating database password..."

docker exec "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" \
  -c "ALTER ROLE $DB_USER WITH PASSWORD '$NEW_PASSWORD';"

printf '%s' "$NEW_PASSWORD" > "$SECRET_FILE"

docker exec "$DB_CONTAINER" \
  psql -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE usename = '$DB_USER'
        AND pid <> pg_backend_pid();"

echo "Database password rotated successfully."