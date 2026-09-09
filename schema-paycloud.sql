-- PayCloud 支付设置（每个商家 / 租户一套）
-- 在 Supabase SQL Editor 中执行。可重复执行。

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE settings IS '系统 KV 设置。PayCloud 每商家配置保存为 paycloud_settings_{merchant_id}。';

-- 保存示例：
-- key: paycloud_settings_default
-- value:
-- {
--   "enabled": true,
--   "wechatEnabled": true,
--   "alipayEnabled": true,
--   "merchantNo": "...",
--   "storeNo": "...",
--   "appId": "...",
--   "gatewayRsaPublicKey": "...",
--   "appRsaPublicKey": "...",
--   "privateKeyRef": "aws/secrets/paycloud/default/app_rsa_private_key",
--   "hasPrivateKey": true
-- }
