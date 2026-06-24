-- 统一扫码入口 · 店铺月结下单 RPC + payment_type 字段
-- 在 Supabase SQL Editor 执行（可重复执行）

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS merchant_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS settlement_type TEXT NOT NULL DEFAULT 'monthly';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_type TEXT;

-- 散客单回填 payment_type
UPDATE orders
SET payment_type = customer_payment_method
WHERE order_source IN ('public_order', 'wechat_group')
  AND payment_type IS NULL
  AND customer_payment_method IS NOT NULL;

UPDATE orders
SET payment_type = 'monthly'
WHERE (order_source = 'shop_account' OR order_source IS NULL)
  AND payment_type IS NULL;

-- 更新散客下单：写入 payment_type
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
  IF v_shop_id IS NULL OR v_shop_id = '' THEN RAISE EXCEPTION 'shop_id_required'; END IF;

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
    shop_id, shop_name, order_date, note, status, subtotal, tax_total, total,
    merchant_id, shop_submitted_at, order_source, channel_id,
    customer_name, customer_phone, customer_address,
    delivery_preferred_date, delivery_preferred_slot, delivery_time_note,
    customer_payment_method, payment_status, delivery_status, public_order_code,
    settlement_type, payment_type, created_at, updated_at
  ) VALUES (
    v_shop_id, v_ch.name, v_order_date, v_note, 'pending', v_sub, v_tax, v_sub + v_tax,
    v_ch.merchant_id, v_now, v_source, v_ch.id,
    v_name, v_phone, v_address,
    v_del_date, v_del_slot, v_del_note,
    v_pay_method, 'unpaid', 'new', v_public_code,
    'cash', v_pay_method, v_now, v_now
  )
  RETURNING id, order_no INTO v_order_id, v_order_no;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;
    v_pid := trim(coalesce(v_item->>'product_id', ''));

    SELECT * INTO v_product FROM products
    WHERE id::text = v_pid AND merchant_id = v_ch.merchant_id;

    INSERT INTO order_items (
      order_id, product_id, product_name, product_spec, product_emoji,
      unit_price, tax_rate, qty
    ) VALUES (
      v_order_id, v_product.id, v_product.name, coalesce(v_product.spec, ''),
      coalesce(v_product.emoji, '📦'), v_product.price, coalesce(v_product.tax_rate, 0), v_qty
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

-- 店铺扫码月结下单（同一渠道二维码）
CREATE OR REPLACE FUNCTION create_shop_channel_order(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel_id   TEXT;
  v_shop_login   TEXT;
  v_shop_pass    TEXT;
  v_ch           order_channels%ROWTYPE;
  v_shop         users%ROWTYPE;
  v_note         TEXT;
  v_items        JSONB;
  v_item         JSONB;
  v_product      products%ROWTYPE;
  v_order_id     UUID;
  v_order_no     INTEGER;
  v_sub          NUMERIC := 0;
  v_tax          NUMERIC := 0;
  v_lp           NUMERIC;
  v_qty          INTEGER;
  v_now          TIMESTAMPTZ := NOW();
  v_order_date   DATE := (v_now AT TIME ZONE 'UTC')::date;
  v_pid          TEXT;
BEGIN
  v_channel_id := trim(coalesce(p_payload->>'channel_id', ''));
  v_shop_login := trim(coalesce(p_payload->>'shop_login_id', ''));
  v_shop_pass := trim(coalesce(p_payload->>'shop_password', ''));
  IF v_channel_id = '' THEN RAISE EXCEPTION 'channel_required'; END IF;
  IF v_shop_login = '' OR v_shop_pass = '' THEN RAISE EXCEPTION 'shop_login_required'; END IF;

  SELECT * INTO v_ch FROM order_channels WHERE id = v_channel_id AND active = TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'channel_not_found'; END IF;

  SELECT * INTO v_shop FROM users
  WHERE password_hash = v_shop_pass
    AND role = 'order'
    AND active = TRUE
    AND merchant_id = v_ch.merchant_id
    AND (
      id = v_shop_login
      OR phone = regexp_replace(v_shop_login, '\s', '', 'g')
      OR trim(name) = v_shop_login
    )
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'shop_login_invalid'; END IF;

  v_items := coalesce(p_payload->'items', '[]'::jsonb);
  IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION 'items_required'; END IF;

  v_note := nullif(trim(coalesce(p_payload->>'note', '')), '');

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
    shop_id, shop_name, order_date, note, status, subtotal, tax_total, total,
    merchant_id, shop_submitted_at, order_source, channel_id,
    settlement_type, payment_type, payment_status, delivery_status,
    created_at, updated_at
  ) VALUES (
    v_shop.id, v_shop.name, v_order_date, v_note, 'pending', v_sub, v_tax, v_sub + v_tax,
    v_ch.merchant_id, v_now, 'shop_account', v_ch.id,
    'monthly', 'monthly', 'n/a', 'n/a',
    v_now, v_now
  )
  RETURNING id, order_no INTO v_order_id, v_order_no;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_qty := (v_item->>'qty')::integer;
    v_pid := trim(coalesce(v_item->>'product_id', ''));

    SELECT * INTO v_product FROM products
    WHERE id::text = v_pid AND merchant_id = v_ch.merchant_id;

    INSERT INTO order_items (
      order_id, product_id, product_name, product_spec, product_emoji,
      unit_price, tax_rate, qty
    ) VALUES (
      v_order_id, v_product.id, v_product.name, coalesce(v_product.spec, ''),
      coalesce(v_product.emoji, '📦'), v_product.price, coalesce(v_product.tax_rate, 0), v_qty
    );

    UPDATE products
    SET stock = greatest(0, stock - v_qty), updated_at = v_now
    WHERE id = v_product.id;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_no', v_order_no,
    'shop_name', v_shop.name,
    'total', v_sub + v_tax
  );
END;
$$;

GRANT EXECUTE ON FUNCTION create_public_order(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_shop_channel_order(JSONB) TO anon, authenticated;

-- 店铺渠道扫码登录（H5 匿名端无法直接查 users 表时使用）
CREATE OR REPLACE FUNCTION fos_shop_session_json(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_id          TEXT;
  v_name        TEXT;
  v_address     TEXT;
  v_merchant_id TEXT;
  v_phone       TEXT := '';
  v_contact     TEXT := '';
  v_settlement  TEXT := 'monthly';
BEGIN
  SELECT u.id, u.name, coalesce(u.address, ''), u.merchant_id
  INTO v_id, v_name, v_address, v_merchant_id
  FROM users u
  WHERE u.id = p_user_id;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'phone'
  ) THEN
    SELECT coalesce(u.phone, '') INTO v_phone FROM users u WHERE u.id = p_user_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'contact_name'
  ) THEN
    SELECT coalesce(u.contact_name, '') INTO v_contact FROM users u WHERE u.id = p_user_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'settlement_type'
  ) THEN
    SELECT coalesce(u.settlement_type, 'monthly') INTO v_settlement FROM users u WHERE u.id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'name', v_name,
    'phone', v_phone,
    'address', v_address,
    'contact_name', v_contact,
    'settlement_type', v_settlement,
    'merchant_id', v_merchant_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION shop_channel_login(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant TEXT := trim(coalesce(p_payload->>'merchant_id', ''));
  v_shop_id  TEXT := trim(coalesce(p_payload->>'shop_id', ''));
  v_login    TEXT := trim(coalesce(p_payload->>'login_id', ''));
  v_phone    TEXT := regexp_replace(v_login, '\s', '', 'g');
  v_pass     TEXT := trim(coalesce(p_payload->>'password', ''));
  v_user_id  TEXT;
  v_result   JSONB;
BEGIN
  IF v_merchant = '' OR v_pass = '' THEN
    RAISE EXCEPTION 'shop_login_required';
  END IF;

  IF v_shop_id <> '' THEN
    SELECT u.id INTO v_user_id
    FROM users u
    WHERE u.id = v_shop_id
      AND u.merchant_id = v_merchant
      AND u.role = 'order'
      AND u.active = TRUE
      AND u.password_hash = v_pass
    LIMIT 1;

    IF v_user_id IS NOT NULL THEN
      v_result := fos_shop_session_json(v_user_id);
      IF v_result IS NOT NULL THEN RETURN v_result; END IF;
    END IF;
  END IF;

  IF v_login = '' THEN
    RAISE EXCEPTION 'shop_login_invalid';
  END IF;

  SELECT u.id INTO v_user_id
  FROM users u
  WHERE u.merchant_id = v_merchant
    AND u.role = 'order'
    AND u.active = TRUE
    AND u.password_hash = v_pass
    AND (
      u.id = v_login
      OR trim(u.name) = v_login
      OR (
        v_phone <> ''
        AND EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'phone'
        )
        AND u.phone = v_phone
      )
    )
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'shop_login_invalid';
  END IF;

  v_result := fos_shop_session_json(v_user_id);
  IF v_result IS NULL THEN
    RAISE EXCEPTION 'shop_login_invalid';
  END IF;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION fos_shop_session_json(TEXT) TO anon, authenticated;

GRANT EXECUTE ON FUNCTION shop_channel_login(JSONB) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
