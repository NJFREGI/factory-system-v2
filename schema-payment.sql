-- Factory System v2 · 结账方式（月结 / 现结 + 现结方式）
-- 在 Supabase SQL Editor 执行，可重复执行。

-- 店铺结账类型：monthly=月结, cash=现结
ALTER TABLE users ADD COLUMN IF NOT EXISTS settlement_type TEXT NOT NULL DEFAULT 'monthly'
  CHECK (settlement_type IN ('monthly', 'cash'));

-- 订单配送结账记录
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_type TEXT
  CHECK (settlement_type IS NULL OR settlement_type IN ('monthly', 'cash'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_recorded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_payment_recorded ON orders(payment_recorded_at);
CREATE INDEX IF NOT EXISTS idx_orders_settlement_type ON orders(settlement_type);

-- 商家自定义现结方式
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_merchant ON payment_methods(merchant_id, active, sort_order);

-- 默认商家现结方式（可按需修改名称）
INSERT INTO payment_methods (merchant_id, name, sort_order)
SELECT v.merchant_id, v.name, v.sort_order
FROM (VALUES
  ('default', '現金', 1),
  ('default', '振込', 2),
  ('default', 'クレジット', 3),
  ('default', 'PayPay', 4)
) AS v(merchant_id, name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM payment_methods pm WHERE pm.merchant_id = v.merchant_id
);
