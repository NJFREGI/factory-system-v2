#!/usr/bin/env bash
# Usage: build-db.sh <dbname>  — builds a DB resembling production from repo schema files
set -euo pipefail
DB=${1:-fos_test}; ROOT=$(cd "$(dirname "$0")/../.." && pwd)
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-54329} -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
$P -d postgres -c "DO \$\$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN NULL; END IF; END\$\$" >/dev/null
$P -d $DB -f "$ROOT/tests/security/supabase-mock.sql" >/dev/null 2>&1 || $P -d $DB -f <(sed '/^CREATE ROLE/d' "$ROOT/tests/security/supabase-mock.sql") >/dev/null
$P -d $DB -f "$ROOT/tests/security/legacy-base.sql" >/dev/null
for f in schema-saas.sql schema.sql schema-payment.sql schema-public-order.sql schema-product-public-price.sql \
  schema-public-order-fix-uuid.sql schema-public-order-fix-sort.sql schema-customer-account.sql \
  schema-channel-shop-order.sql schema-order-no-daily.sql schema-order-item-admin-edit.sql \
  schema-driver-dispatch.sql schema-invoice.sql schema-print.sql schema-paycloud.sql \
  schema-realtime.sql schema-shop-submitted.sql schema-order-reliability.sql; do
  $P -d $DB -f "$ROOT/$f" >/dev/null 2>"/tmp/build-$f.err" || { echo "FAILED: $f"; cat "/tmp/build-$f.err"; exit 1; }
done
echo "built $DB"
