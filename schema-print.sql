-- 出库打印：打印日志表 + 打印机设置（settings 表 KV 存储）
-- 在 Supabase SQL Editor 执行

CREATE TABLE IF NOT EXISTS print_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  print_type TEXT NOT NULL DEFAULT 'outbound',
  device_info TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  operator_id TEXT,
  operator_name TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_logs_merchant_created
  ON print_logs (merchant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_print_logs_order
  ON print_logs (order_id, created_at DESC);

COMMENT ON TABLE print_logs IS '出库配送单打印日志';
COMMENT ON COLUMN print_logs.print_type IS 'outbound | reprint';
COMMENT ON COLUMN print_logs.device_info IS '例如 LAN 192.168.1.100:9100';
