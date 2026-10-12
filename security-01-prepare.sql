-- =====================================================================
-- Factory System v2 · 安全改造 第 1 步（准备，不中断现有客户端）
-- security-01-prepare.sql
--
-- 作用：
--   1. 为所有员工账号（工厂/门店/配送/总后台）建立 Supabase Auth 账号，
--      旧明文密码转为 bcrypt 哈希，账号 ID 和密码保持不变。
--   2. 新增数据库端身份函数、账号管理 RPC、顾客/门店 H5 会话令牌、登录限流。
--   3. 预先创建按商家隔离的 RLS 策略（本步不启用，不影响现有客户端）。
--   4. 旧版网页/旧 APK 在本步之后仍可正常使用（legacy_auth = true）。
--
-- 执行方式：Supabase SQL Editor 整体执行（整个脚本为一个事务，失败自动回滚）。
-- 可重复执行。执行前请先备份数据库。
-- 执行后：发布新版网页 + 新版 APK，确认全部客户端已更新，再执行 security-02-enforce.sql。
--
-- 注意：本步之后不要再重新执行旧的 schema-order-reliability.sql /
--       schema-channel-shop-order.sql / schema-order-no-daily.sql /
--       schema-public-order*.sql / schema-order-item-admin-edit.sql，
--       否则会覆盖本脚本安装的安全包装函数。
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------
-- 0. 安全开关与内部表（全部禁止 anon/authenticated 直接访问）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fos_security_flags (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.fos_security_flags (key, enabled) VALUES ('legacy_auth', true)
ON CONFLICT (key) DO NOTHING;

-- 旧明文密码备份：仅用于第 2 步回滚。确认稳定运行后执行 security-03-cleanup.sql 删除。
CREATE TABLE IF NOT EXISTS public.fos_legacy_password_backup (
  user_id        text PRIMARY KEY,
  password_plain text NOT NULL,
  backed_up_at   timestamptz NOT NULL DEFAULT now()
);

-- 弱密码报告（不保存密码本身）
CREATE TABLE IF NOT EXISTS public.fos_weak_password_report (
  user_id     text PRIMARY KEY,
  role        text,
  merchant_id text,
  reason      text NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now()
);

-- 顾客 / 门店 H5 会话（只保存令牌的 SHA-256）
CREATE TABLE IF NOT EXISTS public.fos_public_sessions (
  token_hash   text PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('shop', 'customer')),
  subject_id   text NOT NULL,
  merchant_id  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_fos_public_sessions_expires ON public.fos_public_sessions (expires_at);
CREATE INDEX IF NOT EXISTS idx_fos_public_sessions_subject ON public.fos_public_sessions (kind, subject_id);

-- 登录失败限流
CREATE TABLE IF NOT EXISTS public.fos_login_throttle (
  k            text PRIMARY KEY,
  fails        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

-- 第 2 步启用 RLS 前，备份旧策略以便回滚
CREATE TABLE IF NOT EXISTS public.fos_policy_backup (
  id           bigserial PRIMARY KEY,
  schemaname   text NOT NULL,
  tablename    text NOT NULL,
  policyname   text NOT NULL,
  create_sql   text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fos_security_flags','fos_legacy_password_backup','fos_weak_password_report',
                           'fos_public_sessions','fos_login_throttle','fos_policy_backup'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.fos_policy_backup_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fos_legacy_auth_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT enabled FROM public.fos_security_flags WHERE key = 'legacy_auth'), false);
$$;

-- ---------------------------------------------------------------------
-- 1. 字段补齐
-- ---------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id uuid;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS merchant_id text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS zip_code text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS settlement_type text NOT NULL DEFAULT 'monthly';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users (auth_user_id) WHERE auth_user_id IS NOT NULL;

ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS max_drivers integer NOT NULL DEFAULT 1;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS invoice_company_name text;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS invoice_zip text;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS invoice_address text;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS invoice_tel text;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS invoice_fax text;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS invoice_registration_no text;
ALTER TABLE public.merchants ADD COLUMN IF NOT EXISTS invoice_bank_info text;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_driver_id text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_driver_name text;

-- RLS 按 merchant_id 精确匹配：补齐历史空值（与 schema-saas.sql 的回填规则一致）
UPDATE public.products SET merchant_id = 'default' WHERE merchant_id IS NULL;
UPDATE public.orders o SET merchant_id = coalesce(u.merchant_id, 'default')
  FROM public.users u WHERE o.shop_id = u.id AND o.merchant_id IS NULL;
UPDATE public.orders SET merchant_id = 'default' WHERE merchant_id IS NULL;
UPDATE public.users SET merchant_id = 'default' WHERE merchant_id IS NULL AND role <> 'super_admin';

DO $$
BEGIN
  IF to_regclass('public.stock_movements') IS NOT NULL THEN
    ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS merchant_id text;
    UPDATE public.stock_movements s SET merchant_id = coalesce(p.merchant_id, 'default')
      FROM public.products p
     WHERE s.merchant_id IS NULL AND p.id::text = s.product_id;
    UPDATE public.stock_movements SET merchant_id = 'default' WHERE merchant_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_stock_movements_merchant ON public.stock_movements (merchant_id, created_at);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. 登录邮箱映射：账号 ID → Supabase Auth 内部邮箱（不发送邮件）
--    与 shared/js/config.js 的 LOGIN_EMAIL_DOMAIN 保持一致
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fos_login_email(p_user_id text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'u' || substr(encode(sha256(convert_to(p_user_id, 'UTF8')), 'hex'), 1, 40) || '@login.njfregi.jp';
$$;
GRANT EXECUTE ON FUNCTION public.fos_login_email(text) TO anon, authenticated;

-- 使某账号所有已登录会话失效（Supabase Auth 刷新令牌 + H5 门店会话）
CREATE OR REPLACE FUNCTION public.fos_revoke_sessions(p_user_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_auth uuid;
BEGIN
  SELECT auth_user_id INTO v_auth FROM public.users WHERE id = p_user_id;
  IF v_auth IS NOT NULL THEN
    IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
      EXECUTE 'DELETE FROM auth.refresh_tokens WHERE user_id = $1' USING v_auth::text;
    END IF;
    IF to_regclass('auth.sessions') IS NOT NULL THEN
      EXECUTE 'DELETE FROM auth.sessions WHERE user_id = $1' USING v_auth;
    END IF;
  END IF;
  IF to_regclass('public.fos_public_sessions') IS NOT NULL THEN
    DELETE FROM public.fos_public_sessions WHERE kind = 'shop' AND subject_id = p_user_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fos_revoke_sessions(text) FROM PUBLIC, anon, authenticated;

-- 创建 / 更新 Auth 账号（bcrypt）。仅供其他 SECURITY DEFINER 函数和 SQL Editor 调用。
CREATE OR REPLACE FUNCTION public.fos_auth_upsert(p_user_id text, p_password text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_auth  uuid;
  v_email text := public.fos_login_email(p_user_id);
  v_hash  text;
  v_col   text;
BEGIN
  IF p_user_id IS NULL OR p_user_id = '' THEN RAISE EXCEPTION 'user_id_required'; END IF;
  IF p_password IS NULL OR p_password = '' THEN RAISE EXCEPTION 'password_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN RAISE EXCEPTION 'user_not_found'; END IF;

  v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 10));

  SELECT auth_user_id INTO v_auth FROM public.users WHERE id = p_user_id;
  IF v_auth IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_auth) THEN
    v_auth := NULL;
  END IF;
  IF v_auth IS NULL THEN
    -- 只复用本系统创建的 Auth 账号；同邮箱但不是本系统创建的账号（例如有人抢先注册）一律拒绝
    SELECT id INTO v_auth FROM auth.users
     WHERE email = v_email AND raw_app_meta_data->>'fos_user_id' = p_user_id LIMIT 1;
    IF v_auth IS NULL AND EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
      RAISE EXCEPTION 'auth_email_conflict: %', v_email;
    END IF;
  END IF;

  IF v_auth IS NULL THEN
    v_auth := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_auth, 'authenticated', 'authenticated', v_email, v_hash, now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'fos_user_id', p_user_id),
      '{}'::jsonb, now(), now(), '', '', '', ''
    );
    -- 不同版本的 auth.users 可空字符串列不同；GoTrue 读取 NULL 会报错，统一置为空串
    FOR v_col IN
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'auth' AND table_name = 'users'
         AND column_name IN ('email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token')
    LOOP
      EXECUTE format('UPDATE auth.users SET %1$I = coalesce(%1$I, '''') WHERE id = $1', v_col) USING v_auth;
    END LOOP;
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (v_auth::text, v_auth,
            jsonb_build_object('sub', v_auth::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
            'email', now(), now(), now());
  ELSE
    UPDATE auth.users
       SET encrypted_password = v_hash,
           email = v_email,
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('fos_user_id', p_user_id),
           updated_at = now()
     WHERE id = v_auth;
    -- 改密码后，已登录的设备全部失效（含 H5 门店会话）
    PERFORM public.fos_revoke_sessions(p_user_id);
  END IF;

  UPDATE public.users SET auth_user_id = v_auth WHERE id = p_user_id AND auth_user_id IS DISTINCT FROM v_auth;
  -- 停用账号同步封禁 Auth 登录
  UPDATE auth.users
     SET banned_until = CASE WHEN (SELECT active FROM public.users WHERE id = p_user_id) THEN NULL ELSE now() + interval '100 years' END
   WHERE id = v_auth;
  RETURN v_auth;
END;
$$;
REVOKE ALL ON FUNCTION public.fos_auth_upsert(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fos_auth_check_password(p_user_id text, p_password text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT au.encrypted_password = extensions.crypt(p_password, au.encrypted_password)
      FROM public.users u JOIN auth.users au ON au.id = u.auth_user_id
     WHERE u.id = p_user_id AND coalesce(p_password, '') <> '' AND au.encrypted_password LIKE '$2%'
  ), false);
$$;
REVOKE ALL ON FUNCTION public.fos_auth_check_password(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. 当前登录者身份函数（RLS 策略使用）
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fos_current_uid()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.active;
$$;

CREATE OR REPLACE FUNCTION public.fos_current_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.role FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.active;
$$;

-- 当前账号所属商家（不检查商家状态；用于读取自己的商家资料以显示“已停用”）
CREATE OR REPLACE FUNCTION public.fos_current_mid_raw()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(u.merchant_id, 'default') FROM public.users u
   WHERE u.auth_user_id = auth.uid() AND u.active AND u.role <> 'super_admin';
$$;

-- 当前可访问数据的商家：商家停用后返回 NULL，数据库端立即拒绝访问
CREATE OR REPLACE FUNCTION public.fos_current_mid()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m.id FROM public.users u JOIN public.merchants m ON m.id = coalesce(u.merchant_id, 'default')
   WHERE u.auth_user_id = auth.uid() AND u.active AND u.role <> 'super_admin' AND m.status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.fos_is_super()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT u.role = 'super_admin' FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.active), false);
$$;

-- 工厂管理者（factory / admin）
CREATE OR REPLACE FUNCTION public.fos_is_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.fos_current_role() IN ('factory', 'admin') AND public.fos_current_mid() IS NOT NULL;
$$;

-- 工厂侧员工（factory / admin / delivery）
CREATE OR REPLACE FUNCTION public.fos_is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.fos_current_role() IN ('factory', 'admin', 'delivery') AND public.fos_current_mid() IS NOT NULL;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['fos_current_uid()','fos_current_role()','fos_current_mid_raw()','fos_current_mid()',
                           'fos_is_super()','fos_is_manager()','fos_is_staff()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- 登录后读取自己的账号资料（不含任何密码字段）
CREATE OR REPLACE FUNCTION public.fos_me()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'id', u.id, 'name', u.name, 'role', u.role, 'active', u.active,
    'merchant_id', CASE WHEN u.role = 'super_admin' THEN NULL ELSE coalesce(u.merchant_id, 'default') END,
    'phone', u.phone, 'contact_name', u.contact_name, 'address', u.address,
    'zip_code', u.zip_code, 'settlement_type', u.settlement_type)
  FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.active;
$$;
REVOKE ALL ON FUNCTION public.fos_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fos_me() TO authenticated;

-- 登录页显示店名（只返回店名）
CREATE OR REPLACE FUNCTION public.fos_shop_display_name(p_shop_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.name FROM public.users u WHERE u.id = p_shop_id AND u.role = 'order' AND u.active;
$$;
GRANT EXECUTE ON FUNCTION public.fos_shop_display_name(text) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. 账号管理 RPC（替代前端直接写 users 表）
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fos_assert_password_policy(p_password text)
RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_password IS NULL OR length(p_password) < 6 THEN RAISE EXCEPTION 'password_too_short'; END IF;
  IF length(p_password) > 72 THEN RAISE EXCEPTION 'password_too_long'; END IF;
  IF lower(p_password) IN ('pass', 'password', '123456', '1234567', '12345678', '111111', '000000', 'qwerty', 'abc123', 'admin123')
    THEN RAISE EXCEPTION 'password_too_weak'; END IF;
END;
$$;

-- 套餐用户数 / 配送员数检查（锁定商家行，避免并发超额）
CREATE OR REPLACE FUNCTION public.fos_assert_account_quota(p_merchant_id text, p_role text, p_exclude_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  m public.merchants%ROWTYPE;
  v_users integer;
  v_drivers integer;
  v_max_drivers integer;
BEGIN
  SELECT * INTO m FROM public.merchants WHERE id = p_merchant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merchant_not_found'; END IF;
  SELECT count(*) INTO v_users FROM public.users
   WHERE coalesce(merchant_id, 'default') = p_merchant_id AND active AND role <> 'super_admin' AND id <> coalesce(p_exclude_id, '');
  IF v_users >= coalesce(m.max_users, 10) THEN RAISE EXCEPTION 'quota_users:%', m.max_users; END IF;
  IF p_role = 'delivery' THEN
    v_max_drivers := coalesce((to_jsonb(m)->>'max_drivers')::integer, 1);
    SELECT count(*) INTO v_drivers FROM public.users
     WHERE coalesce(merchant_id, 'default') = p_merchant_id AND active AND role = 'delivery' AND id <> coalesce(p_exclude_id, '');
    IF v_drivers >= v_max_drivers THEN RAISE EXCEPTION 'quota_drivers:%', v_max_drivers; END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fos_assert_account_quota(text, text, text) FROM PUBLIC, anon, authenticated;

-- 新建 / 更新 / 复活 账号
-- p: {id, name, role, password?, merchant_id?(仅总后台), create?:bool,
--     address?, zip_code?, phone?, contact_name?, settlement_type?}
CREATE OR REPLACE FUNCTION public.fos_save_account(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_is_super boolean := public.fos_is_super();
  v_is_mgr   boolean := public.fos_is_manager();
  v_id       text := trim(coalesce(p->>'id', ''));
  v_role     text := trim(coalesce(p->>'role', ''));
  v_name     text := nullif(trim(coalesce(p->>'name', '')), '');
  v_pass     text := coalesce(p->>'password', '');
  v_create   boolean := coalesce((p->>'create')::boolean, false);
  v_mid      text;
  v_existing public.users%ROWTYPE;
  v_settle   text := nullif(trim(coalesce(p->>'settlement_type', '')), '');
BEGIN
  IF NOT v_is_super AND NOT v_is_mgr THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_is_super THEN
    v_mid := nullif(trim(coalesce(p->>'merchant_id', '')), '');
    IF v_mid IS NULL THEN RAISE EXCEPTION 'merchant_required'; END IF;
    IF v_role NOT IN ('factory', 'admin', 'order', 'delivery') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  ELSE
    v_mid := public.fos_current_mid();
    IF v_role NOT IN ('order', 'delivery') THEN RAISE EXCEPTION 'forbidden_role'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE id = v_mid) THEN RAISE EXCEPTION 'merchant_not_found'; END IF;
  IF v_id = '' THEN RAISE EXCEPTION 'id_required'; END IF;
  IF length(v_id) > 64 OR v_id ~ '\s' OR v_id ILIKE 'public\_%' OR v_id = 'superadmin' THEN
    RAISE EXCEPTION 'invalid_id';
  END IF;
  IF v_settle IS NOT NULL AND v_settle NOT IN ('monthly', 'cash') THEN RAISE EXCEPTION 'invalid_settlement_type'; END IF;

  SELECT * INTO v_existing FROM public.users WHERE id = v_id FOR UPDATE;

  IF FOUND THEN
    IF coalesce(v_existing.merchant_id, 'default') <> v_mid THEN RAISE EXCEPTION 'id_taken_other_merchant'; END IF;
    IF v_existing.role <> v_role THEN RAISE EXCEPTION 'id_taken_other_role'; END IF;
    IF v_existing.active AND v_create THEN RAISE EXCEPTION 'id_taken'; END IF;
    IF NOT v_existing.active THEN
      PERFORM public.fos_assert_account_quota(v_mid, v_role, v_id);
      IF v_pass = '' THEN RAISE EXCEPTION 'password_required'; END IF;
    END IF;
    UPDATE public.users SET
      name            = coalesce(v_name, name),
      active          = true,
      address         = CASE WHEN p ? 'address' THEN coalesce(p->>'address', '') ELSE address END,
      zip_code        = CASE WHEN p ? 'zip_code' THEN coalesce(p->>'zip_code', '') ELSE zip_code END,
      phone           = CASE WHEN p ? 'phone' THEN nullif(trim(coalesce(p->>'phone', '')), '') ELSE phone END,
      contact_name    = CASE WHEN p ? 'contact_name' THEN nullif(trim(coalesce(p->>'contact_name', '')), '') ELSE contact_name END,
      settlement_type = coalesce(v_settle, settlement_type)
    WHERE id = v_id;
  ELSE
    IF v_pass = '' THEN RAISE EXCEPTION 'password_required'; END IF;
    PERFORM public.fos_assert_account_quota(v_mid, v_role, NULL);
    INSERT INTO public.users (id, name, role, password_hash, active, merchant_id,
                              address, zip_code, phone, contact_name, settlement_type)
    VALUES (v_id, coalesce(v_name, v_id), v_role, '!AUTH', true, v_mid,
            coalesce(p->>'address', ''), coalesce(p->>'zip_code', ''),
            nullif(trim(coalesce(p->>'phone', '')), ''), nullif(trim(coalesce(p->>'contact_name', '')), ''),
            coalesce(v_settle, 'monthly'));
  END IF;

  IF v_pass <> '' THEN
    PERFORM public.fos_assert_password_policy(v_pass);
    UPDATE public.users SET password_hash = '!AUTH' WHERE id = v_id;
    DELETE FROM public.fos_legacy_password_backup WHERE user_id = v_id;
    DELETE FROM public.fos_weak_password_report WHERE user_id = v_id;
    PERFORM public.fos_auth_upsert(v_id, v_pass);
  ELSE
    -- 同步封禁状态
    UPDATE auth.users SET banned_until = NULL
     WHERE id = (SELECT auth_user_id FROM public.users WHERE id = v_id);
  END IF;

  RETURN (SELECT jsonb_build_object('id', id, 'name', name, 'role', role, 'merchant_id', merchant_id, 'active', active)
            FROM public.users WHERE id = v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.fos_save_account(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fos_save_account(jsonb) TO authenticated;

-- 修改密码：总后台任意账号；工厂管理者可改本商家门店/配送；任何人可改自己
CREATE OR REPLACE FUNCTION public.fos_set_password(p_user_id text, p_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public.users%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF NOT (
       public.fos_is_super()
    OR (t.auth_user_id IS NOT NULL AND t.auth_user_id = auth.uid() AND t.active)
    OR (public.fos_is_manager() AND coalesce(t.merchant_id, 'default') = public.fos_current_mid()
        AND t.role IN ('order', 'delivery'))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF t.id LIKE 'public\_%' THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public.fos_assert_password_policy(p_password);
  UPDATE public.users SET password_hash = '!AUTH' WHERE id = p_user_id;
  DELETE FROM public.fos_legacy_password_backup WHERE user_id = p_user_id;
  DELETE FROM public.fos_weak_password_report WHERE user_id = p_user_id;
  PERFORM public.fos_auth_upsert(p_user_id, p_password);
END;
$$;
REVOKE ALL ON FUNCTION public.fos_set_password(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fos_set_password(text, text) TO authenticated;

-- 启用 / 停用账号（停用即“删除”）
CREATE OR REPLACE FUNCTION public.fos_set_account_active(p_user_id text, p_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public.users%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF t.role = 'super_admin' OR t.id LIKE 'public\_%' THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT (
       public.fos_is_super()
    OR (public.fos_is_manager() AND coalesce(t.merchant_id, 'default') = public.fos_current_mid()
        AND t.role IN ('order', 'delivery'))
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_active AND NOT t.active THEN
    PERFORM public.fos_assert_account_quota(coalesce(t.merchant_id, 'default'), t.role, t.id);
  END IF;
  UPDATE public.users SET active = p_active WHERE id = p_user_id;
  IF t.auth_user_id IS NOT NULL THEN
    UPDATE auth.users SET banned_until = CASE WHEN p_active THEN NULL ELSE now() + interval '100 years' END
     WHERE id = t.auth_user_id;
  END IF;
  IF NOT p_active THEN
    PERFORM public.fos_revoke_sessions(p_user_id);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fos_set_account_active(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fos_set_account_active(text, boolean) TO authenticated;

-- 管理员在 SQL Editor 中重置密码（不开放给客户端）：
--   SELECT public.fos_admin_reset_password('superadmin', '新的强密码');
CREATE OR REPLACE FUNCTION public.fos_admin_reset_password(p_user_id text, p_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN RAISE EXCEPTION 'user_not_found'; END IF;
  PERFORM public.fos_assert_password_policy(p_password);
  ALTER TABLE public.users DISABLE TRIGGER trg_fos_users_auth_sync;
  UPDATE public.users SET password_hash = '!AUTH' WHERE id = p_user_id;
  ALTER TABLE public.users ENABLE TRIGGER trg_fos_users_auth_sync;
  DELETE FROM public.fos_legacy_password_backup WHERE user_id = p_user_id;
  DELETE FROM public.fos_weak_password_report WHERE user_id = p_user_id;
  PERFORM public.fos_auth_upsert(p_user_id, p_password);
  PERFORM public.fos_revoke_sessions(p_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.fos_admin_reset_password(text, text) FROM PUBLIC, anon, authenticated;

-- 工厂修改本商家显示名称（不允许改套餐、配额等）
CREATE OR REPLACE FUNCTION public.fos_set_merchant_display_name(p_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public.fos_is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF nullif(trim(coalesce(p_name, '')), '') IS NULL THEN RAISE EXCEPTION 'name_required'; END IF;
  UPDATE public.merchants SET name = trim(p_name), updated_at = now() WHERE id = public.fos_current_mid();
END;
$$;
REVOKE ALL ON FUNCTION public.fos_set_merchant_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fos_set_merchant_display_name(text) TO authenticated;

-- 工厂修改本商家请求书（发票）信息：只允许 invoice_* 字段
CREATE OR REPLACE FUNCTION public.fos_set_merchant_invoice_profile(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_mid text := public.fos_current_mid(); r public.merchants%ROWTYPE;
BEGIN
  IF NOT public.fos_is_manager() THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.merchants SET
    invoice_company_name    = nullif(trim(coalesce(p->>'invoice_company_name', '')), ''),
    invoice_zip             = nullif(trim(coalesce(p->>'invoice_zip', '')), ''),
    invoice_address         = nullif(trim(coalesce(p->>'invoice_address', '')), ''),
    invoice_tel             = nullif(trim(coalesce(p->>'invoice_tel', '')), ''),
    invoice_fax             = nullif(trim(coalesce(p->>'invoice_fax', '')), ''),
    invoice_registration_no = nullif(trim(coalesce(p->>'invoice_registration_no', '')), ''),
    invoice_bank_info       = nullif(trim(coalesce(p->>'invoice_bank_info', '')), ''),
    updated_at = now()
  WHERE id = v_mid RETURNING * INTO r;
  RETURN to_jsonb(r);
END;
$$;
REVOKE ALL ON FUNCTION public.fos_set_merchant_invoice_profile(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fos_set_merchant_invoice_profile(jsonb) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. 迁移：备份旧明文密码 → 建立 Auth 账号（bcrypt）
-- ---------------------------------------------------------------------
INSERT INTO public.fos_legacy_password_backup (user_id, password_plain)
SELECT id, password_hash FROM public.users
 WHERE password_hash IS NOT NULL AND password_hash <> '' AND password_hash NOT LIKE '!%'
ON CONFLICT (user_id) DO UPDATE SET password_plain = EXCLUDED.password_plain, backed_up_at = now();

INSERT INTO public.fos_weak_password_report (user_id, role, merchant_id, reason)
SELECT id, role, merchant_id,
       CASE WHEN length(password_hash) < 6 THEN 'too_short'
            WHEN password_hash = id THEN 'same_as_id'
            ELSE 'common_password' END
  FROM public.users
 WHERE password_hash IS NOT NULL AND password_hash NOT LIKE '!%'
   AND (length(password_hash) < 6 OR password_hash = id
        OR lower(password_hash) IN ('pass', 'password', '123456', '1234567', '12345678', '111111', '000000', 'qwerty', 'abc123', 'admin123'))
ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, role = EXCLUDED.role,
  merchant_id = EXCLUDED.merchant_id, reported_at = now();

DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT id, password_hash FROM public.users
     WHERE password_hash IS NOT NULL AND password_hash <> '' AND password_hash NOT LIKE '!%'
       AND role IN ('factory', 'admin', 'order', 'delivery', 'super_admin')
       AND (auth_user_id IS NULL OR NOT public.fos_auth_check_password(id, password_hash))
     ORDER BY id
  LOOP
    PERFORM public.fos_auth_upsert(r.id, r.password_hash);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'fos security: % auth account(s) created/updated', n;
END $$;

-- 过渡期：旧客户端写入明文密码时自动同步到 Auth（第 2 步改为禁止写入）
CREATE OR REPLACE FUNCTION public.fos_users_auth_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.password_hash IS NOT NULL AND NEW.password_hash <> '' AND NEW.password_hash NOT LIKE '!%'
     AND (TG_OP = 'INSERT' OR NEW.password_hash IS DISTINCT FROM OLD.password_hash) THEN
    INSERT INTO public.fos_legacy_password_backup (user_id, password_plain) VALUES (NEW.id, NEW.password_hash)
    ON CONFLICT (user_id) DO UPDATE SET password_plain = EXCLUDED.password_plain, backed_up_at = now();
    PERFORM public.fos_auth_upsert(NEW.id, NEW.password_hash);
  ELSIF TG_OP = 'UPDATE' AND NEW.active IS DISTINCT FROM OLD.active AND NEW.auth_user_id IS NOT NULL THEN
    UPDATE auth.users SET banned_until = CASE WHEN NEW.active THEN NULL ELSE now() + interval '100 years' END
     WHERE id = NEW.auth_user_id;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fos_users_auth_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_fos_users_auth_sync ON public.users;
CREATE TRIGGER trg_fos_users_auth_sync
  AFTER INSERT OR UPDATE OF password_hash, active ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fos_users_auth_sync();

-- ---------------------------------------------------------------------
-- 6. 登录限流与 H5 会话令牌
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fos_throttle_blocked(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT locked_until > now() FROM public.fos_login_throttle WHERE k = p_key), false);
$$;

CREATE OR REPLACE FUNCTION public.fos_throttle_fail(p_key text, p_max integer DEFAULT 8)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.fos_login_throttle AS t (k, fails, window_start) VALUES (p_key, 1, now())
  ON CONFLICT (k) DO UPDATE SET
    fails = CASE WHEN t.window_start < now() - interval '15 minutes' THEN 1 ELSE t.fails + 1 END,
    window_start = CASE WHEN t.window_start < now() - interval '15 minutes' THEN now() ELSE t.window_start END;
  UPDATE public.fos_login_throttle SET locked_until = now() + interval '15 minutes'
   WHERE k = p_key AND fails >= p_max;
  DELETE FROM public.fos_login_throttle WHERE window_start < now() - interval '1 day' AND coalesce(locked_until, now()) <= now();
END;
$$;

CREATE OR REPLACE FUNCTION public.fos_throttle_reset(p_key text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public.fos_login_throttle WHERE k = p_key;
$$;

CREATE OR REPLACE FUNCTION public.fos_issue_public_session(p_kind text, p_subject text, p_merchant text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_token text := encode(extensions.gen_random_bytes(32), 'hex');
BEGIN
  DELETE FROM public.fos_public_sessions WHERE expires_at < now();
  INSERT INTO public.fos_public_sessions (token_hash, kind, subject_id, merchant_id, expires_at)
  VALUES (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_kind, p_subject, p_merchant, now() + interval '30 days');
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.fos_resolve_public_session(p_token text, p_kind text, p_merchant text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_subject text;
BEGIN
  IF coalesce(p_token, '') = '' THEN RETURN NULL; END IF;
  UPDATE public.fos_public_sessions SET last_used_at = now()
   WHERE token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     AND kind = p_kind AND merchant_id = p_merchant AND expires_at > now()
  RETURNING subject_id INTO v_subject;
  RETURN v_subject;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['fos_throttle_blocked(text)','fos_throttle_fail(text, integer)','fos_throttle_reset(text)',
    'fos_issue_public_session(text, text, text)','fos_resolve_public_session(text, text, text)',
    'fos_assert_password_policy(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;

-- 顾客密码校验：兼容尚未转换的明文（第 2 步全部转换为 bcrypt）
CREATE OR REPLACE FUNCTION public.fos_customer_password_ok(p_stored text, p_given text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN coalesce(p_given, '') = '' OR p_stored IS NULL THEN false
    WHEN p_stored ~ '^\$2[abxy]\$' THEN p_stored = extensions.crypt(p_given, p_stored)
    ELSE p_stored = p_given END;
$$;
REVOKE ALL ON FUNCTION public.fos_customer_password_ok(text, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. 门店 H5（扫码月结下单）登录：返回会话令牌，不再在浏览器保存密码
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fos_shop_login(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_merchant text := trim(coalesce(p->>'merchant_id', ''));
  v_shop_id  text := trim(coalesce(p->>'shop_id', ''));
  v_login    text := trim(coalesce(p->>'login_id', ''));
  v_phone    text := regexp_replace(trim(coalesce(p->>'login_id', '')), '\s', '', 'g');
  v_pass     text := coalesce(p->>'password', '');
  v_key      text;
  v_user_id  text;
  v_token    text;
BEGIN
  IF v_merchant = '' OR v_pass = '' OR (v_shop_id = '' AND v_login = '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'shop_login_required');
  END IF;
  -- 限流按账号计（用 ID / 店名 / 电话登录同一账号共用一个计数）
  SELECT min(u.id) INTO v_user_id FROM public.users u
   WHERE coalesce(u.merchant_id, 'default') = v_merchant AND u.role = 'order' AND u.active
     AND ((v_shop_id <> '' AND u.id = v_shop_id)
       OR (v_login <> '' AND (u.id = v_login OR trim(u.name) = v_login OR (v_phone <> '' AND u.phone = v_phone))));
  v_key := 'shop:' || v_merchant || ':' || coalesce(v_user_id, lower(coalesce(nullif(v_shop_id, ''), v_login)));
  v_user_id := NULL;
  IF public.fos_throttle_blocked(v_key) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  END IF;

  SELECT u.id INTO v_user_id
    FROM public.users u
   WHERE coalesce(u.merchant_id, 'default') = v_merchant AND u.role = 'order' AND u.active
     AND ((v_shop_id <> '' AND u.id = v_shop_id)
       OR (v_login <> '' AND (u.id = v_login OR trim(u.name) = v_login OR (v_phone <> '' AND u.phone = v_phone))))
     AND public.fos_auth_check_password(u.id, v_pass)
   ORDER BY (u.id = v_shop_id) DESC, (u.id = v_login) DESC, u.id
   LIMIT 1;

  IF v_user_id IS NULL THEN
    PERFORM public.fos_throttle_fail(v_key);
    RETURN jsonb_build_object('ok', false, 'error', 'shop_login_invalid');
  END IF;

  PERFORM public.fos_throttle_reset(v_key);
  v_token := public.fos_issue_public_session('shop', v_user_id, v_merchant);
  RETURN jsonb_build_object('ok', true, 'session_token', v_token, 'shop', public.fos_shop_session_json(v_user_id));
END;
$$;
GRANT EXECUTE ON FUNCTION public.fos_shop_login(jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fos_public_logout(p_token text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public.fos_public_sessions WHERE token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;
GRANT EXECUTE ON FUNCTION public.fos_public_logout(text) TO anon, authenticated;

-- 旧接口 shop_channel_login：过渡期继续可用，改为校验 bcrypt（第 2 步撤销）
CREATE OR REPLACE FUNCTION public.shop_channel_login(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb;
BEGIN
  r := public.fos_shop_login(p_payload);
  IF NOT coalesce((r->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '%', CASE WHEN r->>'error' = 'shop_login_required' THEN 'shop_login_required' ELSE 'shop_login_invalid' END;
  END IF;
  RETURN r->'shop';
END;
$$;

-- 门店扫码月结下单：包装原函数，改用会话令牌（过渡期兼容旧的 ID+密码）
DO $$
BEGIN
  IF to_regprocedure('public.create_shop_channel_order_impl(jsonb)') IS NULL
     AND to_regprocedure('public.create_shop_channel_order(jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.create_shop_channel_order(jsonb) RENAME TO create_shop_channel_order_impl;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.create_shop_channel_order_impl(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_shop_channel_order(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_token    text := coalesce(p_payload->>'shop_session_token', '');
  v_merchant text;
  v_shop     public.users%ROWTYPE;
  v_subject  text;
BEGIN
  SELECT merchant_id INTO v_merchant FROM public.order_channels
   WHERE id = trim(coalesce(p_payload->>'channel_id', '')) AND active;
  IF v_merchant IS NULL THEN RAISE EXCEPTION 'channel_not_found'; END IF;

  IF v_token <> '' THEN
    v_subject := public.fos_resolve_public_session(v_token, 'shop', v_merchant);
    IF v_subject IS NULL THEN RAISE EXCEPTION 'shop_session_expired'; END IF;
    SELECT * INTO v_shop FROM public.users
     WHERE id = v_subject AND role = 'order' AND active AND coalesce(merchant_id, 'default') = v_merchant;
    IF v_shop.id IS NULL THEN RAISE EXCEPTION 'shop_session_expired'; END IF;
    RETURN public.create_shop_channel_order_impl(
      (p_payload - 'shop_session_token' - 'shop_login_id' - 'shop_password')
      || jsonb_build_object('shop_login_id', v_shop.id, 'shop_password', v_shop.password_hash));
  ELSIF public.fos_legacy_auth_enabled() AND coalesce(p_payload->>'shop_password', '') NOT LIKE '!%' THEN
    RETURN public.create_shop_channel_order_impl(p_payload);
  ELSE
    RAISE EXCEPTION 'shop_login_required';
  END IF;
END;
$$;
COMMENT ON FUNCTION public.create_shop_channel_order(jsonb) IS 'fos_sec_wrapper';
GRANT EXECUTE ON FUNCTION public.create_shop_channel_order(jsonb) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. 顾客账号：bcrypt + 会话令牌 + 限流；历史订单必须凭令牌查询
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fos_customer_json(c public.customer_accounts)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id', c.id, 'merchant_id', c.merchant_id, 'phone', c.phone, 'name', c.name,
                            'address', c.address, 'settlement_type', c.settlement_type);
$$;
REVOKE ALL ON FUNCTION public.fos_customer_json(public.customer_accounts) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fos_customer_register(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_merchant text := trim(coalesce(p->>'merchant_id', ''));
  v_phone    text := regexp_replace(trim(coalesce(p->>'phone', '')), '\s', '', 'g');
  v_pass     text := coalesce(p->>'password', '');
  v_row      public.customer_accounts%ROWTYPE;
BEGIN
  IF v_merchant = '' OR v_phone = '' OR v_pass = '' THEN RAISE EXCEPTION 'phone_password_required'; END IF;
  IF trim(coalesce(p->>'address', '')) = '' THEN RAISE EXCEPTION 'address_required'; END IF;
  IF length(v_pass) < 6 THEN RAISE EXCEPTION 'password_too_short'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.merchants WHERE id = v_merchant AND status = 'active') THEN
    RAISE EXCEPTION 'merchant_not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_accounts WHERE merchant_id = v_merchant AND phone = v_phone) THEN
    RAISE EXCEPTION 'phone_already_registered';
  END IF;
  INSERT INTO public.customer_accounts (merchant_id, phone, password_hash, name, address, settlement_type, updated_at)
  VALUES (v_merchant, v_phone, extensions.crypt(v_pass, extensions.gen_salt('bf', 10)),
          trim(coalesce(p->>'name', '')), trim(coalesce(p->>'address', '')), 'cash', now())
  RETURNING * INTO v_row;
  RETURN public.fos_customer_json(v_row)
      || jsonb_build_object('session_token', public.fos_issue_public_session('customer', v_row.id::text, v_merchant));
END;
$$;
GRANT EXECUTE ON FUNCTION public.fos_customer_register(jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.fos_customer_login(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_merchant text := trim(coalesce(p->>'merchant_id', ''));
  v_phone    text := regexp_replace(trim(coalesce(p->>'phone', '')), '\s', '', 'g');
  v_pass     text := coalesce(p->>'password', '');
  v_key      text;
  v_row      public.customer_accounts%ROWTYPE;
BEGIN
  IF v_merchant = '' OR v_phone = '' OR v_pass = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'phone_password_required');
  END IF;
  v_key := 'cust:' || v_merchant || ':' || v_phone;
  IF public.fos_throttle_blocked(v_key) THEN RETURN jsonb_build_object('ok', false, 'error', 'too_many_attempts'); END IF;

  SELECT * INTO v_row FROM public.customer_accounts
   WHERE merchant_id = v_merchant AND phone = v_phone AND active;
  IF v_row.id IS NULL OR NOT public.fos_customer_password_ok(v_row.password_hash, v_pass) THEN
    PERFORM public.fos_throttle_fail(v_key);
    RETURN jsonb_build_object('ok', false, 'error', 'customer_login_invalid');
  END IF;
  PERFORM public.fos_throttle_reset(v_key);
  UPDATE public.customer_accounts SET updated_at = now(),
         password_hash = CASE WHEN password_hash ~ '^\$2[abxy]\$' THEN password_hash
                              ELSE extensions.crypt(v_pass, extensions.gen_salt('bf', 10)) END
   WHERE id = v_row.id;
  RETURN jsonb_build_object('ok', true,
    'session_token', public.fos_issue_public_session('customer', v_row.id::text, v_merchant),
    'customer', public.fos_customer_json(v_row));
END;
$$;
GRANT EXECUTE ON FUNCTION public.fos_customer_login(jsonb) TO anon, authenticated;

-- 顾客历史订单：必须有有效会话令牌，手机号取自会话而不是请求参数
CREATE OR REPLACE FUNCTION public.fos_customer_orders(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_merchant text := trim(coalesce(p->>'merchant_id', ''));
  v_subject  text;
  v_phone    text;
BEGIN
  v_subject := public.fos_resolve_public_session(p->>'session_token', 'customer', v_merchant);
  IF v_subject IS NULL THEN RAISE EXCEPTION 'customer_session_expired'; END IF;
  SELECT phone INTO v_phone FROM public.customer_accounts WHERE id::text = v_subject AND merchant_id = v_merchant AND active;
  IF v_phone IS NULL THEN RAISE EXCEPTION 'customer_session_expired'; END IF;
  RETURN public.list_customer_orders(jsonb_build_object('merchant_id', v_merchant, 'phone', v_phone,
                                                        'channel_id', coalesce(p->>'channel_id', '')));
END;
$$;
GRANT EXECUTE ON FUNCTION public.fos_customer_orders(jsonb) TO anon, authenticated;

-- 旧接口过渡兼容：登录兼容 bcrypt；注册改为保存 bcrypt（第 2 步撤销 anon 权限）
CREATE OR REPLACE FUNCTION public.customer_account_login(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb;
BEGIN
  r := public.fos_customer_login(p_payload);
  IF NOT coalesce((r->>'ok')::boolean, false) THEN RAISE EXCEPTION '%', r->>'error'; END IF;
  RETURN r->'customer';
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_account_register(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.fos_customer_register(p_payload) - 'session_token';
END;
$$;

-- 订单号+手机号查询：增加限流，防止枚举订单号
DO $$
BEGIN
  IF to_regprocedure('public.query_public_order_impl(text, text)') IS NULL
     AND to_regprocedure('public.query_public_order(text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.query_public_order(text, text) RENAME TO query_public_order_impl;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.query_public_order_impl(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.query_public_order(p_phone text, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_key text := 'pubq:' || regexp_replace(trim(coalesce(p_phone, '')), '\s', '', 'g');
  r     jsonb;
BEGIN
  IF public.fos_throttle_blocked(v_key) THEN RAISE EXCEPTION 'too_many_attempts'; END IF;
  r := public.query_public_order_impl(p_phone, p_code);
  IF r IS NULL THEN PERFORM public.fos_throttle_fail(v_key, 10); END IF;
  RETURN r;
END;
$$;
COMMENT ON FUNCTION public.query_public_order(text, text) IS 'fos_sec_wrapper';
GRANT EXECUTE ON FUNCTION public.query_public_order(text, text) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. 订单事务接口：改为按 Supabase Auth 识别操作者（包装原函数）
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.fos_mutate_order_impl(jsonb)') IS NULL
     AND to_regprocedure('public.fos_mutate_order(jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.fos_mutate_order(jsonb) RENAME TO fos_mutate_order_impl;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.fos_mutate_order_impl(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fos_mutate_order(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor public.users%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO v_actor FROM public.users WHERE auth_user_id = auth.uid() AND active;
    IF v_actor.id IS NULL THEN RAISE EXCEPTION '登录已失效，请重新登录'; END IF;
    -- 配送员只能把订单推进到“已发货/已送达”，不能改单、取消或回退
    IF v_actor.role = 'delivery' AND NOT (
         p_payload->>'operation' = 'status' AND p_payload->>'status' IN ('shipped', 'delivered')
         AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id::text = p_payload->>'order_id'
                       AND o.status IN ('preparing', 'shipped', 'delivered'))) THEN
      RAISE EXCEPTION '无操作权限';
    END IF;
    RETURN public.fos_mutate_order_impl(
      (p_payload - 'password' - 'actor_id')
      || jsonb_build_object('actor_id', v_actor.id, 'password', v_actor.password_hash));
  ELSIF public.fos_legacy_auth_enabled() AND coalesce(p_payload->>'password', '') NOT LIKE '!%' THEN
    RETURN public.fos_mutate_order_impl(p_payload);
  END IF;
  RAISE EXCEPTION '登录已失效，请重新登录';
END;
$$;
COMMENT ON FUNCTION public.fos_mutate_order(jsonb) IS 'fos_sec_wrapper';
REVOKE ALL ON FUNCTION public.fos_mutate_order(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fos_mutate_order(jsonb) TO anon, authenticated;

-- 旧客户端在过渡期仍可能直接传入 '!AUTH' 作为密码：在原函数里也要拒绝
-- （原函数已撤销 anon 执行权，只能经由上面的包装函数调用）

-- ---------------------------------------------------------------------
-- 10. 每商家独立设置：截单时间、公告（复制当前全局值）
-- ---------------------------------------------------------------------
INSERT INTO public.settings (key, value, updated_at)
SELECT 'cutoff_time_' || m.id, s.value, now()
  FROM public.merchants m JOIN public.settings s ON s.key = 'cutoff_time'
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.settings (key, value, updated_at)
SELECT 'order_notice_' || m.id, s.value, now()
  FROM public.merchants m JOIN public.settings s ON s.key = 'order_notice'
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fos_settings_owner(p_key text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_key ~ '^(printer_settings|paycloud_settings|invoice_profile|cutoff_time|order_notice)_.'
    THEN regexp_replace(p_key, '^(printer_settings|paycloud_settings|invoice_profile|cutoff_time|order_notice)_', '')
  END;
$$;

-- 库存流水：自动带上商家
CREATE OR REPLACE FUNCTION public.fos_stock_movement_merchant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.merchant_id IS NULL THEN
    NEW.merchant_id := coalesce(public.fos_current_mid(),
      (SELECT coalesce(p.merchant_id, 'default') FROM public.products p WHERE p.id::text = NEW.product_id), 'default');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fos_stock_movement_merchant() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF to_regclass('public.stock_movements') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_fos_stock_movement_merchant ON public.stock_movements;
    CREATE TRIGGER trg_fos_stock_movement_merchant BEFORE INSERT ON public.stock_movements
      FOR EACH ROW EXECUTE FUNCTION public.fos_stock_movement_merchant();
  END IF;
END $$;

-- 配送员直接更新订单时只允许改配送/收款相关字段，不能改金额、门店、派单
-- 注意：必须是 SECURITY INVOKER，才能用 current_user 区分“客户端直接更新”和“RPC 内部更新”
CREATE OR REPLACE FUNCTION public.fos_orders_delivery_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_allowed text[] := ARRAY['status', 'settlement_type', 'payment_method_id', 'payment_method_name',
                            'payment_recorded_at', 'updated_at', 'delivery_status', 'payment_status'];
BEGIN
  -- 仅针对客户端直接调用（RPC 内部以函数所有者身份执行，不受此限制）
  IF current_user <> 'authenticated' OR public.fos_current_role() IS DISTINCT FROM 'delivery' THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
    RAISE EXCEPTION 'delivery_update_not_allowed';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status NOT IN ('shipped', 'delivered') OR OLD.status NOT IN ('preparing', 'shipped', 'delivered')) THEN
    RAISE EXCEPTION 'delivery_update_not_allowed';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_fos_orders_delivery_guard ON public.orders;
CREATE TRIGGER trg_fos_orders_delivery_guard BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.fos_orders_delivery_guard();

-- 商品数量上限（数据库端；仅限制工厂端，总后台不受限）
CREATE OR REPLACE FUNCTION public.fos_products_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_max integer; v_count integer;
BEGIN
  IF auth.uid() IS NULL OR public.fos_is_super() THEN RETURN NEW; END IF;
  SELECT max_products INTO v_max FROM public.merchants WHERE id = NEW.merchant_id;
  SELECT count(*) INTO v_count FROM public.products WHERE merchant_id = NEW.merchant_id;
  IF v_max IS NOT NULL AND v_count >= v_max THEN RAISE EXCEPTION 'quota_products:%', v_max; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fos_products_quota() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_fos_products_quota ON public.products;
CREATE TRIGGER trg_fos_products_quota BEFORE INSERT ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.fos_products_quota();

-- ---------------------------------------------------------------------
-- 11. RLS 策略（本步只创建，第 2 步才 ENABLE ROW LEVEL SECURITY）
--     策略名统一以 fos_sec_ 开头
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fos_sec_create_policies()
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  r record;
  SUPER   constant text := '(SELECT public.fos_is_super())';
  MID     constant text := '(SELECT public.fos_current_mid())';
  STAFF   constant text := '(SELECT public.fos_is_staff())';
  MGR     constant text := '(SELECT public.fos_is_manager())';
  UID     constant text := '(SELECT public.fos_current_uid())';
BEGIN
  -- 先删除旧的 fos_sec_ 策略（可重复执行）
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies
            WHERE schemaname = 'public' AND policyname LIKE 'fos\_sec\_%' LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;

  -- users：员工可看本商家账号；门店只能看自己；只允许改资料字段（列权限见第 2 步）
  EXECUTE format($p$CREATE POLICY fos_sec_users_select ON public.users FOR SELECT TO authenticated
    USING (%1$s OR (coalesce(merchant_id, 'default') = %2$s AND (%3$s OR auth_user_id = auth.uid())))$p$, SUPER, MID, STAFF);
  EXECUTE format($p$CREATE POLICY fos_sec_users_update ON public.users FOR UPDATE TO authenticated
    USING (%1$s OR (coalesce(merchant_id, 'default') = %2$s AND %3$s AND role IN ('order', 'delivery')))
    WITH CHECK (%1$s OR (coalesce(merchant_id, 'default') = %2$s AND %3$s AND role IN ('order', 'delivery')))$p$, SUPER, MID, MGR);

  -- merchants：可读自己商家；只有总后台可写
  EXECUTE format($p$CREATE POLICY fos_sec_merchants_select ON public.merchants FOR SELECT TO authenticated
    USING (%1$s OR id = (SELECT public.fos_current_mid_raw()))$p$, SUPER);
  EXECUTE format($p$CREATE POLICY fos_sec_merchants_write ON public.merchants FOR ALL TO authenticated
    USING (%1$s) WITH CHECK (%1$s)$p$, SUPER);

  -- products
  EXECUTE format($p$CREATE POLICY fos_sec_products_select ON public.products FOR SELECT TO authenticated
    USING (%1$s OR merchant_id = %2$s)$p$, SUPER, MID);
  EXECUTE format($p$CREATE POLICY fos_sec_products_write ON public.products FOR ALL TO authenticated
    USING (%1$s OR (merchant_id = %2$s AND %3$s)) WITH CHECK (%1$s OR (merchant_id = %2$s AND %3$s))$p$, SUPER, MID, MGR);

  -- orders：员工看本商家；门店只看自己的单；写入只开放 UPDATE（新增/改单走 RPC）
  EXECUTE format($p$CREATE POLICY fos_sec_orders_select ON public.orders FOR SELECT TO authenticated
    USING (%1$s OR (merchant_id = %2$s AND (%3$s OR shop_id = %4$s)))$p$, SUPER, MID, STAFF, UID);
  EXECUTE format($p$CREATE POLICY fos_sec_orders_update ON public.orders FOR UPDATE TO authenticated
    USING (%1$s OR (merchant_id = %2$s AND (%3$s OR ((SELECT public.fos_current_role()) = 'delivery'
           AND (assigned_driver_id IS NULL OR assigned_driver_id = %4$s)))))
    WITH CHECK (%1$s OR merchant_id = %2$s)$p$, SUPER, MID, MGR, UID);
  EXECUTE format($p$CREATE POLICY fos_sec_orders_super ON public.orders FOR ALL TO authenticated
    USING (%1$s) WITH CHECK (%1$s)$p$, SUPER);

  -- order_items：跟随订单可见性；工厂管理者可写
  EXECUTE $p$CREATE POLICY fos_sec_order_items_select ON public.order_items FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id))$p$;
  EXECUTE format($p$CREATE POLICY fos_sec_order_items_write ON public.order_items FOR ALL TO authenticated
    USING (%1$s OR (%3$s AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.merchant_id = %2$s)))
    WITH CHECK (%1$s OR (%3$s AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.merchant_id = %2$s)))$p$,
    SUPER, MID, MGR);

  -- settings：按 key 后缀区分商家；全局 cutoff_time / order_notice 只读
  EXECUTE format($p$CREATE POLICY fos_sec_settings_select ON public.settings FOR SELECT TO authenticated
    USING (%1$s OR key IN ('cutoff_time', 'order_notice')
      OR (public.fos_settings_owner(key) = %2$s AND (%3$s OR key ~ '^(cutoff_time|order_notice)_'
          OR (%4$s AND key LIKE 'printer\_settings\_%%'))))$p$, SUPER, MID, MGR, STAFF);
  EXECUTE format($p$CREATE POLICY fos_sec_settings_write ON public.settings FOR ALL TO authenticated
    USING (%1$s OR (public.fos_settings_owner(key) = %2$s AND (%3$s OR (%4$s AND key LIKE 'printer\_settings\_%%'))))
    WITH CHECK (%1$s OR (public.fos_settings_owner(key) = %2$s AND (%3$s OR (%4$s AND key LIKE 'printer\_settings\_%%'))))$p$,
    SUPER, MID, MGR, STAFF);

  IF to_regclass('public.stock_movements') IS NOT NULL THEN
    EXECUTE format($p$CREATE POLICY fos_sec_stock_movements_rw ON public.stock_movements FOR ALL TO authenticated
      USING (%1$s OR (merchant_id = %2$s AND %3$s)) WITH CHECK (%1$s OR (merchant_id = %2$s AND %3$s))$p$, SUPER, MID, STAFF);
  END IF;

  IF to_regclass('public.payment_methods') IS NOT NULL THEN
    EXECUTE format($p$CREATE POLICY fos_sec_payment_methods_select ON public.payment_methods FOR SELECT TO authenticated
      USING (%1$s OR merchant_id = %2$s)$p$, SUPER, MID);
    EXECUTE format($p$CREATE POLICY fos_sec_payment_methods_write ON public.payment_methods FOR ALL TO authenticated
      USING (%1$s OR (merchant_id = %2$s AND %3$s)) WITH CHECK (%1$s OR (merchant_id = %2$s AND %3$s))$p$, SUPER, MID, MGR);
  END IF;

  IF to_regclass('public.order_channels') IS NOT NULL THEN
    EXECUTE format($p$CREATE POLICY fos_sec_order_channels_select ON public.order_channels FOR SELECT TO authenticated
      USING (%1$s OR (merchant_id = %2$s AND %3$s))$p$, SUPER, MID, STAFF);
    EXECUTE format($p$CREATE POLICY fos_sec_order_channels_write ON public.order_channels FOR ALL TO authenticated
      USING (%1$s OR (merchant_id = %2$s AND %3$s)) WITH CHECK (%1$s OR (merchant_id = %2$s AND %3$s))$p$, SUPER, MID, MGR);
  END IF;

  IF to_regclass('public.print_logs') IS NOT NULL THEN
    EXECUTE format($p$CREATE POLICY fos_sec_print_logs_rw ON public.print_logs FOR ALL TO authenticated
      USING (%1$s OR (merchant_id = %2$s AND %3$s)) WITH CHECK (%1$s OR (merchant_id = %2$s AND %3$s))$p$, SUPER, MID, STAFF);
  END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.fos_sec_create_policies() FROM PUBLIC, anon, authenticated;
SELECT public.fos_sec_create_policies();

-- ---------------------------------------------------------------------
-- 12. 商品图片 Storage：新增按商家目录的写入策略（旧的 anon 写入策略在第 2 步删除）
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS fos_sec_products_img_insert ON storage.objects;
CREATE POLICY fos_sec_products_img_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'products' AND ((SELECT public.fos_is_super())
    OR ((SELECT public.fos_is_manager()) AND (storage.foldername(name))[1] = (SELECT public.fos_current_mid()))));
DROP POLICY IF EXISTS fos_sec_products_img_update ON storage.objects;
CREATE POLICY fos_sec_products_img_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'products' AND ((SELECT public.fos_is_super())
    OR ((SELECT public.fos_is_manager()) AND (storage.foldername(name))[1] = (SELECT public.fos_current_mid()))));
DROP POLICY IF EXISTS fos_sec_products_img_delete ON storage.objects;
CREATE POLICY fos_sec_products_img_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'products' AND ((SELECT public.fos_is_super())
    OR ((SELECT public.fos_is_manager()) AND (storage.foldername(name))[1] = (SELECT public.fos_current_mid()))));

NOTIFY pgrst, 'reload schema';
COMMIT;

-- 执行后检查：
--   SELECT count(*) FILTER (WHERE auth_user_id IS NULL AND password_hash NOT LIKE '!%') AS not_migrated FROM users;
--   SELECT * FROM fos_weak_password_report ORDER BY role, user_id;   -- 建议上线前让这些账号改密码
