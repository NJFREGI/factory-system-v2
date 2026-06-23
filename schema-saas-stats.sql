-- Factory System v2 · SaaS 销售统计视图（Phase 4，可选）
-- 在 Supabase SQL Editor 执行。不执行也不影响前端统计（merchant-stats.js 客户端聚合）。

-- 可计入销售额的订单（排除 cancelled）
CREATE OR REPLACE VIEW merchant_sales_orders AS
SELECT
  id,
  merchant_id,
  order_date,
  status,
  total,
  subtotal,
  tax_total,
  shop_id,
  shop_name,
  created_at
FROM orders
WHERE status IS DISTINCT FROM 'cancelled'
  AND (order_source = 'shop_account' OR order_source IS NULL);

-- 按商家 + 日期汇总
CREATE OR REPLACE VIEW merchant_daily_sales AS
SELECT
  COALESCE(merchant_id, 'default') AS merchant_id,
  order_date,
  COUNT(*)::INTEGER AS order_count,
  COALESCE(SUM(total), 0)::NUMERIC AS sales_total,
  CASE
    WHEN COUNT(*) > 0 THEN ROUND(COALESCE(SUM(total), 0) / COUNT(*))
    ELSE 0
  END AS avg_order_value
FROM merchant_sales_orders
GROUP BY COALESCE(merchant_id, 'default'), order_date;

-- 商品销量（关联有效订单）
CREATE OR REPLACE VIEW merchant_product_sales AS
SELECT
  COALESCE(o.merchant_id, 'default') AS merchant_id,
  o.order_date,
  oi.product_id,
  oi.product_name,
  SUM(oi.qty)::INTEGER AS total_qty,
  SUM(oi.qty * oi.unit_price)::NUMERIC AS sales_amount
FROM order_items oi
JOIN merchant_sales_orders o ON o.id = oi.order_id
GROUP BY
  COALESCE(o.merchant_id, 'default'),
  o.order_date,
  oi.product_id,
  oi.product_name;

-- 验证（可选）
-- SELECT * FROM merchant_daily_sales WHERE merchant_id = 'default' ORDER BY order_date DESC LIMIT 7;
