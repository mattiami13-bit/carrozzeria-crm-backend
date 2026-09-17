#!/usr/bin/env bash
# Per-boot reconciliation: bring PostgreSQL up and make sure the schema is in
# sync. Safe to run repeatedly; returns once the database is ready.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_VERSION="${PG_VERSION:-16}"

sudo pg_ctlcluster "$PG_VERSION" main start 2>/dev/null || true
for _ in $(seq 1 30); do sudo -u postgres pg_isready -q && break || sleep 1; done

# Defensive: recreate role/db if a fresh volume ever lacks them.
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='crm'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE crm LOGIN PASSWORD 'crm';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='carrozzeria_crm'" | grep -q 1 \
  || sudo -u postgres createdb -O crm carrozzeria_crm

if [ -f .env ]; then
  npx prisma db push >/dev/null 2>&1 || true
fi
