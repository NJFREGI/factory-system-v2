-- 接单端点「确定」后才通知工厂端（可单独执行）
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shop_submitted_at TIMESTAMPTZ;

UPDATE orders
SET shop_submitted_at = COALESCE(updated_at, created_at)
WHERE shop_submitted_at IS NULL;
