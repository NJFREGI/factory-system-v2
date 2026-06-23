-- 订单号 order_no：按「商家 + 东京时区自然日」每日从 1 重新递增
-- 过了 0 点首单为 #1（与截单 order_date 无关，店铺仍可传自己的 order_date）
-- 在 Supabase SQL Editor 执行（可重复执行）

CREATE TABLE IF NOT EXISTS order_daily_counters (
  merchant_id TEXT NOT NULL DEFAULT 'default',
  order_date DATE NOT NULL,
  last_no INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (merchant_id, order_date)
);

CREATE OR REPLACE FUNCTION fos_normalize_merchant_id(p_merchant_id TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(nullif(trim(p_merchant_id), ''), 'default');
$$;

CREATE OR REPLACE FUNCTION fos_order_business_date(p_ts TIMESTAMPTZ DEFAULT NOW())
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (coalesce(p_ts, NOW()) AT TIME ZONE 'Asia/Tokyo')::date;
$$;

CREATE OR REPLACE FUNCTION fos_assign_order_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_merchant TEXT;
  v_date DATE;
  v_next INTEGER;
BEGIN
  IF NEW.order_no IS NOT NULL AND NEW.order_no > 0 THEN
    RETURN NEW;
  END IF;

  v_merchant := fos_normalize_merchant_id(NEW.merchant_id);
  v_date := fos_order_business_date(NOW());

  IF NEW.order_date IS NULL THEN
    NEW.order_date := v_date;
  END IF;

  INSERT INTO order_daily_counters (merchant_id, order_date, last_no)
  VALUES (v_merchant, v_date, 1)
  ON CONFLICT (merchant_id, order_date)
  DO UPDATE SET last_no = order_daily_counters.last_no + 1
  RETURNING last_no INTO v_next;

  NEW.order_no := v_next;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fos_assign_order_no ON orders;
DROP TRIGGER IF EXISTS trg_assign_order_no ON orders;
DROP TRIGGER IF EXISTS set_order_no ON orders;
DROP TRIGGER IF EXISTS orders_order_no_trigger ON orders;

CREATE TRIGGER trg_fos_assign_order_no
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION fos_assign_order_no();

CREATE INDEX IF NOT EXISTS idx_orders_merchant_date_no
  ON orders (fos_normalize_merchant_id(merchant_id), order_date, order_no);

-- 顾客/店铺 RPC 的 order_date 与本地 0 点对齐（东京时区）
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
  v_unit_price   NUMERIC;
  v_qty          INTEGER;
  v_now          TIMESTAMPTZ := NOW();
  v_order_date   DATE := fos_order_business_date(v_now);
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

    v_unit_price := fos_product_public_unit_price(v_product);
    v_lp := v_unit_price * v_qty;
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

    v_unit_price := fos_product_public_unit_price(v_product);

    INSERT INTO order_items (
      order_id, product_id, product_name, product_spec, product_emoji,
      unit_price, tax_rate, qty
    ) VALUES (
      v_order_id, v_product.id, v_product.name, coalesce(v_product.spec, ''),
      coalesce(v_product.emoji, '📦'), v_unit_price, coalesce(v_product.tax_rate, 0), v_qty
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
  v_order_date   DATE := fos_order_business_date(v_now);
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
  WHERE id = v_shop_login
    AND password_hash = v_shop_pass
    AND role = 'order'
    AND active = TRUE
    AND merchant_id = v_ch.merchant_id;
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

GRANT EXECUTE ON FUNCTION fos_order_business_date(TIMESTAMPTZ) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
