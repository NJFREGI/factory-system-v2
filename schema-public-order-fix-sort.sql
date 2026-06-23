-- 热修复：get_public_order_context · p.sort_order 根因修复
-- 根因：jsonb_agg(ORDER BY p.sort_order) 引用的是子查询别名 p 的列，
--       子查询 SELECT 未包含 sort_order 时，即使 products 表有该列也会报错。
-- 在 Supabase SQL Editor 执行（可重复执行）

ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION get_public_order_context(p_channel_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ch   order_channels%ROWTYPE;
  v_merch merchants%ROWTYPE;
  v_products JSONB;
  v_has_sort_order BOOLEAN;
BEGIN
  SELECT * INTO v_ch FROM order_channels
  WHERE id = trim(p_channel_id) AND active = TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'channel_not_found';
  END IF;

  SELECT * INTO v_merch FROM merchants WHERE id = v_ch.merchant_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merchant_inactive';
  END IF;

  PERFORM fos_ensure_public_shop(v_ch.merchant_id);

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'sort_order'
  ) INTO v_has_sort_order;

  IF v_has_sort_order THEN
    -- sort_order 必须出现在子查询 SELECT 中，外层 ORDER BY p.sort_order 才合法
    SELECT coalesce(
      jsonb_agg(row_to_json(p) ORDER BY p.sort_order NULLS LAST, p.category NULLS LAST, p.name, p.id),
      '[]'::jsonb
    )
    INTO v_products
    FROM (
      SELECT
        id, name, name_zh, spec, price, tax_rate, category, emoji, image_url, stock, active,
        sort_order
      FROM products
      WHERE merchant_id = v_ch.merchant_id AND active = TRUE
      ORDER BY sort_order NULLS LAST, category NULLS LAST, name, id
    ) p;
  ELSE
    -- 无 sort_order 列：全程不引用 p.sort_order
    SELECT coalesce(
      jsonb_agg(row_to_json(p) ORDER BY p.category NULLS LAST, p.name, p.id),
      '[]'::jsonb
    )
    INTO v_products
    FROM (
      SELECT
        id, name, name_zh, spec, price, tax_rate, category, emoji, image_url, stock, active
      FROM products
      WHERE merchant_id = v_ch.merchant_id AND active = TRUE
      ORDER BY category NULLS LAST, name, id
    ) p;
  END IF;

  RETURN jsonb_build_object(
    'channel', jsonb_build_object(
      'id', v_ch.id,
      'name', v_ch.name,
      'channel_type', v_ch.channel_type,
      'merchant_id', v_ch.merchant_id,
      'shop_id', v_ch.shop_id
    ),
    'merchant', jsonb_build_object(
      'id', v_merch.id,
      'name', v_merch.name
    ),
    'products', v_products
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_public_order_context(TEXT) TO anon, authenticated;

-- 刷新 PostgREST schema 缓存（Supabase API 立即生效）
NOTIFY pgrst, 'reload schema';
