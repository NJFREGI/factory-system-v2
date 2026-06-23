-- Factory System v2 · SaaS 多商家基础结构（Phase 1）
-- 在 Supabase SQL Editor 中执行。可重复执行（IF NOT EXISTS / ON CONFLICT）。
-- 执行前建议备份 users / products / orders 表。

-- ============================================================
-- 1. merchants 表（商家 / SaaS 租户）
-- ============================================================
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  plan_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (plan_type IN ('trial', 'standard', 'pro', 'enterprise')),
  max_users INTEGER NOT NULL DEFAULT 10,
  max_products INTEGER NOT NULL DEFAULT 300,
  allow_order BOOLEAN NOT NULL DEFAULT TRUE,
  allow_order_app BOOLEAN NOT NULL DEFAULT TRUE,
  allow_admin_app BOOLEAN NOT NULL DEFAULT TRUE,
  allow_production_app BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchants_status ON merchants(status);
CREATE INDEX IF NOT EXISTS idx_merchants_plan ON merchants(plan_type);

-- ============================================================
-- 2. 扩展现有表
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS merchant_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_name TEXT;

ALTER TABLE products ADD COLUMN IF NOT EXISTS merchant_id TEXT;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shop_submitted_at TIMESTAMPTZ;

-- ============================================================
-- 3. 默认商家（外键依赖：须先于回填、superadmin 之后也可）
-- ============================================================
INSERT INTO merchants (
  id,
  name,
  contact_name,
  status,
  plan_type,
  max_users,
  max_products,
  allow_order,
  allow_order_app,
  allow_admin_app,
  allow_production_app,
  notes
)
VALUES (
  'default',
  'デフォルト商家',
  NULL,
  'active',
  'enterprise',
  999,
  9999,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  'Phase 1 migration: legacy single-factory data'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = 'active',
  plan_type = 'enterprise',
  max_users = 999,
  max_products = 9999,
  allow_order = TRUE,
  allow_order_app = TRUE,
  allow_admin_app = TRUE,
  allow_production_app = TRUE,
  updated_at = NOW();

-- ============================================================
-- 4. 外键约束
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_merchant_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_merchant_id_fkey'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_merchant_id_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_merchant_id_fkey
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 5. 索引
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_merchant_id ON users(merchant_id);
CREATE INDEX IF NOT EXISTS idx_users_merchant_role ON users(merchant_id, role);

CREATE INDEX IF NOT EXISTS idx_products_merchant_id ON products(merchant_id);

CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_date ON orders(merchant_id, order_date);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_status ON orders(merchant_id, status);

-- ============================================================
-- 6. 历史数据回填 merchant_id = default
-- ============================================================

-- users：除 super_admin 外全部归属 default
UPDATE users
SET merchant_id = 'default'
WHERE merchant_id IS NULL
  AND (role IS NULL OR role <> 'super_admin');

-- products
UPDATE products
SET merchant_id = 'default'
WHERE merchant_id IS NULL;

-- orders：优先从门店用户取 merchant_id，否则 default
UPDATE orders o
SET merchant_id = COALESCE(u.merchant_id, 'default')
FROM users u
WHERE o.shop_id = u.id
  AND o.merchant_id IS NULL;

UPDATE orders
SET merchant_id = 'default'
WHERE merchant_id IS NULL;

-- 历史订单视为已确认（工厂端提醒仅在接单端点「确定」后触发）
UPDATE orders
SET shop_submitted_at = COALESCE(updated_at, created_at)
WHERE shop_submitted_at IS NULL;

-- ============================================================
-- 7. 扩展 users.role 检查约束（加入 super_admin）
--    原约束通常仅允许 factory / order / delivery
-- ============================================================
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('factory', 'order', 'delivery', 'admin', 'super_admin'));

-- ============================================================
-- 8. 总后台 superadmin 账号
-- ============================================================
INSERT INTO users (id, name, password_hash, role, active, merchant_id)
VALUES ('superadmin', 'プラットフォーム管理者', 'pass', 'super_admin', TRUE, NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  role = 'super_admin',
  active = TRUE,
  merchant_id = NULL,
  password_hash = EXCLUDED.password_hash;

-- ============================================================
-- 9. 验证查询（可选，执行后查看结果）
-- ============================================================
-- SELECT id, name, status, plan_type, max_users, max_products FROM merchants;
-- SELECT id, role, merchant_id FROM users ORDER BY role, id;
-- SELECT COUNT(*) AS products_without_merchant FROM products WHERE merchant_id IS NULL;
-- SELECT COUNT(*) AS orders_without_merchant FROM orders WHERE merchant_id IS NULL;
