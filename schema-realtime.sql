-- Factory System v2 · Supabase Realtime（订单提醒 / 商品同步）
-- 在 Supabase SQL Editor 中执行。若表已在 publication 中会报错，可忽略该条。

ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE order_items;

-- 合并订单时 UPDATE 需要旧值对比；建议对 orders 开启 FULL replica identity：
ALTER TABLE orders REPLICA IDENTITY FULL;
