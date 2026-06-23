-- Factory System v2 · 顾客扫码下单（虚拟门店账号方案）
-- 在 Supabase SQL Editor 执行，可重复执行。
-- 依赖：schema-saas.sql（必须）
-- 说明：本脚本第 0 节会自动补齐结账相关字段，无需先执行 schema-payment.sql
--
-- 设计要点：
--   · 不修改 orders.shop_id NOT NULL
--   · 每商家虚拟门店账号 public_{merchant_id}（users.active=FALSE，不可登录）
--   · 顾客单 shop_id = COALESCE(channel.shop_id, public_{merchant_id})
--   · order_source ∈ { shop_account, public_order, wechat_group }

-- ============================================================
-- 0. 结账字段（兼容未执行 schema-payment.sql 的生产库）
--     与 schema-payment.sql 中 settlement_type 相关片段等价，可重复执行
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS settlement_type TEXT NOT NULL DEFAULT 'monthly';

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_settlement_type_check
    CHECK (settlement_type IN ('monthly', 'cash'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_type TEXT;

DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_settlement_type_check
    CHECK (settlement_type IS NULL OR settlement_type IN ('monthly', 'cash'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 商品排序字段（与 schema.sql 一致；未执行时自动补齐，不影响现有数据）
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- ============================================================
-- 1. 下单渠道表
-- ============================================================
CREATE TABLE IF NOT EXISTS order_channels (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  shop_id         TEXT,
  name            TEXT NOT NULL,
  channel_type    TEXT NOT NULL DEFAULT 'wechat_group'
                  CHECK (channel_type IN ('wechat_group', 'public_qr', 'store_poster')),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_channels_merchant
  ON order_channels(merchant_id, active, sort_order);

-- ============================================================
-- 2. 虚拟门店账号（每商家一个，不可登录）
-- ============================================================
CREATE OR REPLACE FUNCTION fos_public_shop_id(p_merchant_id TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'public_' || trim(p_merchant_id);
$$;

INSERT INTO users (id, name, password_hash, role, active, merchant_id, settlement_type)
SELECT
  fos_public_shop_id(m.id),
  coalesce(nullif(trim(m.name), ''), m.id) || ' · 顧客注文',
  '!VIRTUAL_PUBLIC_NO_LOGIN',
  'order',
  FALSE,
  m.id,
  'cash'
FROM merchants m
  ON CONFLICT (id) DO UPDATE SET
    merchant_id = EXCLUDED.merchant_id,
    name = EXCLUDED.name,
    active = FALSE,
    password_hash = EXCLUDED.password_hash,
    settlement_type = 'cash';

-- ============================================================
-- 3. orders 扩展字段
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_source TEXT NOT NULL DEFAULT 'shop_account';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_address TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_preferred_date DATE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_preferred_slot TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_time_note TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_payment_method TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'n/a';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'n/a';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS public_order_code TEXT;

-- 迁移旧值 public_qr → public_order
UPDATE orders SET order_source = 'public_order' WHERE order_source = 'public_qr';

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_source_check
  CHECK (order_source IN ('shop_account', 'public_order', 'wechat_group'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_preferred_slot_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_preferred_slot_check
  CHECK (delivery_preferred_slot IS NULL OR delivery_preferred_slot IN (
    'unspecified', 'morning', 'afternoon', 'evening'
  ));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_customer_payment_method_check;
ALTER TABLE orders ADD CONSTRAINT orders_customer_payment_method_check
  CHECK (customer_payment_method IS NULL OR customer_payment_method IN (
    'cash', 'paypay', 'wechat', 'alipay', 'bank_transfer'
  ));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('n/a', 'unpaid', 'pending', 'paid', 'refunded'));

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_delivery_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_delivery_status_check
  CHECK (delivery_status IN (
    'n/a', 'new', 'accepted', 'delivering', 'delivered', 'cancelled'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_order_code
  ON orders(public_order_code) WHERE public_order_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_order_source
  ON orders(order_source, merchant_id);

CREATE INDEX IF NOT EXISTS idx_orders_channel
  ON orders(channel_id);

CREATE INDEX IF NOT EXISTS idx_orders_public_lookup
  ON orders(customer_phone, public_order_code);

CREATE INDEX IF NOT EXISTS idx_orders_delivery_status
  ON orders(delivery_status);

-- 存量门店订单默认值
UPDATE orders SET order_source = 'shop_account'
  WHERE order_source IS NULL OR order_source = '';
UPDATE orders SET payment_status = 'n/a', delivery_status = 'n/a'
  WHERE order_source = 'shop_account'
    AND (payment_status IS NULL OR payment_status = '' OR delivery_status IS NULL OR delivery_status = '');

-- ============================================================
-- 4. 统计视图：门店销售额排除顾客单（可选，覆盖 schema-saas-stats）
-- ============================================================
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
  order_source,
  created_at
FROM orders
WHERE status IS DISTINCT FROM 'cancelled'
  AND (order_source = 'shop_account' OR order_source IS NULL);

CREATE OR REPLACE VIEW merchant_public_sales_orders AS
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
  order_source,
  channel_id,
  customer_name,
  public_order_code,
  created_at
FROM orders
WHERE status IS DISTINCT FROM 'cancelled'
  AND order_source IN ('public_order', 'wechat_group');

-- ============================================================
-- 5. 辅助函数
-- ============================================================
CREATE OR REPLACE FUNCTION fos_ensure_public_shop(p_merchant_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_mid TEXT := trim(p_merchant_id);
  v_sid TEXT;
  v_mname TEXT;
BEGIN
  IF v_mid = '' THEN
    RAISE EXCEPTION 'merchant_required';
  END IF;
  v_sid := fos_public_shop_id(v_mid);
  SELECT name INTO v_mname FROM merchants WHERE id = v_mid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merchant_not_found';
  END IF;
  INSERT INTO users (id, name, password_hash, role, active, merchant_id, settlement_type)
  VALUES (
    v_sid,
    coalesce(nullif(trim(v_mname), ''), v_mid) || ' · 顧客注文',
    '!VIRTUAL_PUBLIC_NO_LOGIN',
    'order',
    FALSE,
    v_mid,
    'cash'
  )
  ON CONFLICT (id) DO UPDATE SET
    merchant_id = EXCLUDED.merchant_id,
    active = FALSE,
    name = EXCLUDED.name,
    settlement_type = 'cash';
  RETURN v_sid;
END;
$$;

CREATE OR REPLACE FUNCTION fos_gen_public_order_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_code TEXT;
  v_try  INTEGER := 0;
BEGIN
  LOOP
    v_try := v_try + 1;
    IF v_try > 20 THEN
      RAISE EXCEPTION 'cannot generate public_order_code';
    END IF;
    v_code := 'P' || to_char(NOW() AT TIME ZONE 'UTC', 'YYMMDD') || '-' ||
              upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM orders o WHERE o.public_order_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION fos_map_channel_order_source(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_type = 'wechat_group' THEN 'wechat_group'
    ELSE 'public_order'
  END;
$$;

-- ============================================================
-- 6. 顾客端只读：渠道 + 商品目录
-- ============================================================
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

-- ============================================================
-- 7. 顾客端：创建订单（唯一写入口）
-- ============================================================
CREATE OR REPLACE FUNCTION create_public_order(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel_id   TEXT;
  v_ch           order_channels%ROWTYPE;
  v_shop_id      TEXT;
  v_name         TEXT;
  v_phone        TEXT;
  v_address      TEXT;
  v_note         TEXT;
  v_del_date     DATE;
  v_del_slot     TEXT;
  v_del_note     TEXT;
  v_pay_method   TEXT;
  v_items        JSONB;
  v_item         JSONB;
  v_product      products%ROWTYPE;
  v_order_id     UUID;
  v_order_no     INTEGER;
  v_public_code  TEXT;
  v_sub          NUMERIC := 0;
  v_tax          NUMERIC := 0;
  v_lp           NUMERIC;
  v_qty          INTEGER;
  v_now          TIMESTAMPTZ := NOW();
  v_order_date   DATE := (v_now AT TIME ZONE 'UTC')::date;
  v_source       TEXT;
  v_pid          TEXT;
BEGIN
  v_channel_id := trim(coalesce(p_payload->>'channel_id', ''));
  IF v_channel_id = '' THEN RAISE EXCEPTION 'channel_required'; END IF;

  SELECT * INTO v_ch FROM order_channels WHERE id = v_channel_id AND active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'channel_not_found'; END IF;

  v_shop_id := coalesce(nullif(trim(v_ch.shop_id), ''), fos_ensure_public_shop(v_ch.merchant_id));
  IF v_shop_id IS NULL OR v_shop_id = '' THEN
    RAISE EXCEPTION 'shop_id_required';
  END IF;

  v_name := trim(coalesce(p_payload->>'customer_name', ''));
  v_phone := trim(coalesce(p_payload->>'customer_phone', ''));
  v_address := trim(coalesce(p_payload->>'customer_address', ''));
  IF v_name = '' OR v_phone = '' OR v_address = '' THEN
    RAISE EXCEPTION 'customer_info_required';
  END IF;

  v_note := nullif(trim(coalesce(p_payload->>'note', '')), '');
  v_del_note := nullif(trim(coalesce(p_payload->>'delivery_time_note', '')), '');

  IF p_payload ? 'delivery_preferred_date' AND coalesce(p_payload->>'delivery_preferred_date', '') <> '' THEN
    v_del_date := (p_payload->>'delivery_preferred_date')::date;
  END IF;

  v_del_slot := coalesce(nullif(trim(p_payload->>'delivery_preferred_slot'), ''), 'unspecified');
  IF v_del_slot NOT IN ('unspecified', 'morning', 'afternoon', 'evening') THEN
    RAISE EXCEPTION 'invalid_delivery_slot';
  END IF;

  v_pay_method := trim(coalesce(p_payload->>'customer_payment_method', ''));
  IF v_pay_method NOT IN ('cash', 'paypay', 'wechat', 'alipay', 'bank_transfer') THEN
    RAISE EXCEPTION 'invalid_payment_method';
  END IF;

  v_items := coalesce(p_payload->'items', '[]'::jsonb);
  IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'items_required'; END IF;

  v_source := fos_map_channel_order_source(v_ch.channel_type);
  v_public_code := fos_gen_public_order_code();

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'invalid_qty'; END IF;

    v_pid := trim(coalesce(v_item->>'product_id', ''));
    IF v_pid = '' THEN RAISE EXCEPTION 'product_not_found'; END IF;

    SELECT * INTO v_product FROM products
    WHERE id::text = v_pid
      AND merchant_id = v_ch.merchant_id
      AND active = TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found'; END IF;
    IF v_product.stock < v_qty THEN RAISE EXCEPTION 'insufficient_stock'; END IF;

    v_lp := v_product.price * v_qty;
    v_sub := v_sub + v_lp;
    v_tax := v_tax + round((v_lp * coalesce(v_product.tax_rate, 0)) / 100);
  END LOOP;

  INSERT INTO orders (
    shop_id,
    shop_name,
    order_date,
    note,
    status,
    subtotal,
    tax_total,
    total,
    merchant_id,
    shop_submitted_at,
    order_source,
    channel_id,
    customer_name,
    customer_phone,
    customer_address,
    delivery_preferred_date,
    delivery_preferred_slot,
    delivery_time_note,
    customer_payment_method,
    payment_status,
    delivery_status,
    public_order_code,
    settlement_type,
    created_at,
    updated_at
  ) VALUES (
    v_shop_id,
    v_ch.name,
    v_order_date,
    v_note,
    'pending',
    v_sub,
    v_tax,
    v_sub + v_tax,
    v_ch.merchant_id,
    v_now,
    v_source,
    v_ch.id,
    v_name,
    v_phone,
    v_address,
    v_del_date,
    v_del_slot,
    v_del_note,
    v_pay_method,
    'unpaid',
    'new',
    v_public_code,
    'cash',
    v_now,
    v_now
  )
  RETURNING id, order_no INTO v_order_id, v_order_no;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;
    v_pid := trim(coalesce(v_item->>'product_id', ''));

    SELECT * INTO v_product FROM products
    WHERE id::text = v_pid
      AND merchant_id = v_ch.merchant_id;

    INSERT INTO order_items (
      order_id, product_id, product_name, product_spec, product_emoji,
      unit_price, tax_rate, qty
    ) VALUES (
      v_order_id,
      v_product.id,
      v_product.name,
      coalesce(v_product.spec, ''),
      coalesce(v_product.emoji, '📦'),
      v_product.price,
      coalesce(v_product.tax_rate, 0),
      v_qty
    );

    UPDATE products
    SET stock = greatest(0, stock - v_qty), updated_at = v_now
    WHERE id = v_product.id;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_no', v_order_no,
    'public_order_code', v_public_code,
    'total', v_sub + v_tax
  );
END;
$$;

-- ============================================================
-- 8. 顾客端：订单查询（手机号 + 订单号双匹配）
-- ============================================================
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
    SELECT product_name, product_spec, product_emoji, qty, unit_price
    FROM order_items WHERE order_id = v_order.id
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

-- ============================================================
-- 9. 权限：仅开放顾客端 RPC 给 anon
-- ============================================================
GRANT EXECUTE ON FUNCTION fos_public_shop_id(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION fos_ensure_public_shop(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_order_context(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_public_order(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION query_public_order(TEXT, TEXT) TO anon, authenticated;
