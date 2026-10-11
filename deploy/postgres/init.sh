#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v registry_password="$REGISTRY_DB_PASSWORD" -v evaluation_password="$EVALUATION_DB_PASSWORD" \
  -v governance_password="$GOVERNANCE_DB_PASSWORD" -f /bootstrap.sql
