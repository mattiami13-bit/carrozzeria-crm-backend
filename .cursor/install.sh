#!/usr/bin/env bash
# Idempotent bootstrap for the Carrozzeria CRM Cloud Agent environment.
# Runs after checkout. With environment builds it runs once to create the
# baseline snapshot, so it must converge cleanly on repeated runs.
set -euo pipefail
cd "$(dirname "$0")/.."

PG_VERSION="${PG_VERSION:-16}"

# 1. PostgreSQL server (stable system dependency).
if ! command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
fi

# 2. Bring the cluster up so we can provision the role/database.
sudo pg_ctlcluster "$PG_VERSION" main start 2>/dev/null || true
for _ in $(seq 1 30); do sudo -u postgres pg_isready -q && break || sleep 1; done

# 3. Application role + database (idempotent).
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='crm'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE crm LOGIN PASSWORD 'crm';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='carrozzeria_crm'" | grep -q 1 \
  || sudo -u postgres createdb -O crm carrozzeria_crm
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE carrozzeria_crm TO crm;" >/dev/null

# 4. Local .env (git-ignored). Placeholder Supabase values let the storage
#    client load; real photo upload needs genuine credentials.
if [ ! -f .env ]; then
  cat > .env <<'EOF'
DATABASE_URL="postgresql://crm:crm@localhost:5432/carrozzeria_crm"
DIRECT_URL="postgresql://crm:crm@localhost:5432/carrozzeria_crm"

JWT_SECRET="dev-local-secret-change-me"
JWT_EXPIRES_IN="8h"

PORT=4310

SUPABASE_URL="https://placeholder.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="placeholder-service-role-key"
EOF
fi

# 5. Node dependencies. postinstall runs `prisma generate`, which reads
#    DIRECT_URL from .env via prisma.config.ts.
npm install

# 6. Sync the Prisma schema to the database. `db push` is used instead of
#    `migrate deploy` because the committed migration history is incomplete
#    (it omits supplier_orders/supplier_order_items and other tables that the
#    schema and later migrations rely on).
npx prisma db push
