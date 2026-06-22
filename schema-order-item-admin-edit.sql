-- 订单明细：后台标识 + 部分缺货
-- 在 Supabase SQL Editor 中执行（执行后若仍报错，可在 Settings → API 点 Reload schema）

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS admin_edit TEXT;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS shortage_qty INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN order_items.admin_edit IS 'null=顾客原单; added=后台添加; modified=后台修改数量';
COMMENT ON COLUMN order_items.shortage_qty IS '缺货数量，0=无缺货；可小于 qty 表示部分缺货';

-- 旧数据：勾选整行缺货的，迁移为 shortage_qty = qty
UPDATE order_items
SET shortage_qty = qty
WHERE shortage = true AND shortage_qty = 0;

-- 顾客端订单查询 RPC
CREATE OR REPLACE FUNCTION query_public_order(p_phone TEXT, p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone TEXT := trim(coalesce(p_phone, ''));
  v_code  TEXT := trim(coalesce(p_code, ''));
  v_order orders%ROWTYPE;
  v_items JSONB;
BEGIN
  IF v_phone = '' OR v_code = '' THEN
    RAISE EXCEPTION 'phone_and_code_required';
  END IF;

  SELECT * INTO v_order FROM orders
  WHERE customer_phone = v_phone
    AND public_order_code = v_code
    AND order_source IN ('public_order', 'wechat_group')
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(i) ORDER BY i.product_name), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      oi.product_name,
      oi.product_spec,
      oi.product_emoji,
      oi.qty,
      oi.unit_price,
      oi.product_id,
      coalesce(p.image_url, '') AS image_url
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = v_order.id
  ) i;

  RETURN jsonb_build_object(
    'public_order_code', v_order.public_order_code,
    'order_no', v_order.order_no,
    'order_source', v_order.order_source,
    'status', v_order.status,
    'delivery_status', v_order.delivery_status,
    'payment_status', v_order.payment_status,
    'customer_payment_method', v_order.customer_payment_method,
    'total', v_order.total,
    'created_at', v_order.created_at,
    'delivery_preferred_date', v_order.delivery_preferred_date,
    'delivery_preferred_slot', v_order.delivery_preferred_slot,
    'delivery_time_note', v_order.delivery_time_note,
    'note', v_order.note,
    'items', v_items
  );
END;
$$;
