-- 顾客扫码账号（现结：手机号 + 密码登录/注册）
-- 在 Supabase SQL Editor 中执行

CREATE TABLE IF NOT EXISTS customer_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  settlement_type TEXT NOT NULL DEFAULT 'cash'
    CHECK (settlement_type IN ('cash', 'monthly')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_customer_accounts_merchant_phone
  ON customer_accounts(merchant_id, phone);

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;

-- 仅通过 RPC 访问，不开放表级 anon 读写

CREATE OR REPLACE FUNCTION customer_account_register(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant TEXT := trim(coalesce(p_payload->>'merchant_id', ''));
  v_phone    TEXT := regexp_replace(trim(coalesce(p_payload->>'phone', '')), '\s', '', 'g');
  v_pass     TEXT := trim(coalesce(p_payload->>'password', ''));
  v_name     TEXT := trim(coalesce(p_payload->>'name', ''));
  v_address  TEXT := trim(coalesce(p_payload->>'address', ''));
  v_row      customer_accounts%ROWTYPE;
BEGIN
  IF v_merchant = '' OR v_phone = '' OR v_pass = '' THEN
    RAISE EXCEPTION 'phone_password_required';
  END IF;
  IF v_address = '' THEN
    RAISE EXCEPTION 'address_required';
  END IF;
  IF length(v_pass) < 4 THEN
    RAISE EXCEPTION 'password_too_short';
  END IF;

  IF EXISTS (
    SELECT 1 FROM customer_accounts
    WHERE merchant_id = v_merchant AND phone = v_phone
  ) THEN
    RAISE EXCEPTION 'phone_already_registered';
  END IF;

  INSERT INTO customer_accounts (
    merchant_id, phone, password_hash, name, address, settlement_type, updated_at
  ) VALUES (
    v_merchant, v_phone, v_pass, v_name, v_address, 'cash', NOW()
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'merchant_id', v_row.merchant_id,
    'phone', v_row.phone,
    'name', v_row.name,
    'address', v_row.address,
    'settlement_type', v_row.settlement_type
  );
END;
$$;

CREATE OR REPLACE FUNCTION customer_account_login(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant TEXT := trim(coalesce(p_payload->>'merchant_id', ''));
  v_phone    TEXT := regexp_replace(trim(coalesce(p_payload->>'phone', '')), '\s', '', 'g');
  v_pass     TEXT := trim(coalesce(p_payload->>'password', ''));
  v_row      customer_accounts%ROWTYPE;
BEGIN
  IF v_merchant = '' OR v_phone = '' OR v_pass = '' THEN
    RAISE EXCEPTION 'phone_password_required';
  END IF;

  SELECT * INTO v_row FROM customer_accounts
  WHERE merchant_id = v_merchant
    AND phone = v_phone
    AND password_hash = v_pass
    AND active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_login_invalid';
  END IF;

  UPDATE customer_accounts SET updated_at = NOW() WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'merchant_id', v_row.merchant_id,
    'phone', v_row.phone,
    'name', v_row.name,
    'address', v_row.address,
    'settlement_type', v_row.settlement_type
  );
END;
$$;

GRANT EXECUTE ON FUNCTION customer_account_register(JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION customer_account_login(JSONB) TO anon, authenticated;

-- ============================================================
-- 散客登录后：按手机号查询历史订单（须已注册）
-- ============================================================
CREATE OR REPLACE FUNCTION list_customer_orders(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant TEXT := trim(coalesce(p_payload->>'merchant_id', ''));
  v_phone    TEXT := trim(coalesce(p_payload->>'phone', ''));
  v_channel  TEXT := trim(coalesce(p_payload->>'channel_id', ''));
  v_rows     JSONB;
BEGIN
  IF v_merchant = '' OR v_phone = '' THEN
    RAISE EXCEPTION 'phone_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM customer_accounts
    WHERE merchant_id = v_merchant
      AND phone = v_phone
      AND active = TRUE
  ) THEN
    RAISE EXCEPTION 'customer_login_invalid';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(o) ORDER BY o.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      o.public_order_code,
      o.order_no,
      o.total,
      o.created_at,
      o.delivery_status,
      o.customer_payment_method,
      o.delivery_preferred_date,
      o.delivery_preferred_slot,
      o.delivery_time_note,
      (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
      (
        SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.product_name), '[]'::jsonb)
        FROM (
          SELECT
            oi.product_name,
            oi.product_spec,
            oi.qty,
            oi.unit_price,
            oi.product_id,
            oi.product_emoji,
            coalesce(p.image_url, '') AS image_url
          FROM order_items oi
          LEFT JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = o.id
          ORDER BY oi.product_name
          LIMIT 3
        ) i
      ) AS items_preview
    FROM orders o
    WHERE o.merchant_id = v_merchant
      AND o.customer_phone = v_phone
      AND o.order_source IN ('public_order', 'wechat_group')
      AND (v_channel = '' OR o.channel_id = v_channel)
    ORDER BY o.created_at DESC
    LIMIT 50
  ) o;

  RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION list_customer_orders(JSONB) TO anon, authenticated;
