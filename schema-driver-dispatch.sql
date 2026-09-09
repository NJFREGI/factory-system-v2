-- Factory System v2 · 配送员管理 + 手动派单
-- 在 Supabase SQL Editor 中执行。可重复执行（IF NOT EXISTS）。
-- 1) 商家可拥有多个配送员账号，数量由总后台 max_drivers 限制
-- 2) 订单可手动派给某个配送员，配送端只看到分配给自己（或未分配）的单

-- ============================================================
-- 1. merchants：配送员数量上限
-- ============================================================
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS max_drivers INTEGER NOT NULL DEFAULT 1;

-- 默认商家放开上限
UPDATE merchants SET max_drivers = 99 WHERE id = 'default';

-- ============================================================
-- 2. orders：派单字段（denormalized name 便于配送端直接显示）
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_driver_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_driver_name TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_assigned_driver
  ON orders(merchant_id, assigned_driver_id);

-- 可选：外键（配送员被删除时清空分配）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_assigned_driver_fkey'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_assigned_driver_fkey
      FOREIGN KEY (assigned_driver_id) REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ============================================================
-- 3. 验证（可选）
-- ============================================================
-- SELECT id, name, max_drivers FROM merchants;
-- SELECT id, role, merchant_id, name, active FROM users WHERE role = 'delivery';
-- SELECT id, order_no, assigned_driver_id, assigned_driver_name FROM orders WHERE assigned_driver_id IS NOT NULL;
