-- =====================================================================
-- Factory System v2 · 安全改造 第 2 步（强制启用）
-- security-02-enforce.sql
--
-- 前提（全部满足后才执行）：
--   1. security-01-prepare.sql 已执行成功；
--   2. 新版网页已发布，所有浏览器已刷新；
--   3. 新版 APK 已安装到所有门店 / 工厂 / 配送设备，旧 APK 已停用；
--   4. 已确认旧版系统（-factoryorder-system-main，与本项目共用同一个 Supabase）不再使用；
--   5. 已用测试账号在新版客户端走通：登录、下单、改单、配送、收款、账号管理。
--
-- 执行后：旧网页、旧 APK、旧版系统将无法登录或读写数据。
-- 回滚：security-rollback-02.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. 前置检查：每个可登录账号都必须已有 Auth 账号
-- ---------------------------------------------------------------------
DO $$
DECLARE v_missing text;
BEGIN
  IF to_regprocedure('public.fos_me()') IS NULL THEN
    RAISE EXCEPTION '请先执行 security-01-prepare.sql';
  END IF;
  SELECT string_agg(id, ', ' ORDER BY id) INTO v_missing FROM public.users
   WHERE active AND role IN ('factory', 'admin', 'order', 'delivery', 'super_admin')
     AND auth_user_id IS NULL;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '以下启用中的账号还没有 Auth 账号，请先重新执行 security-01-prepare.sql 或为其设置密码：%', v_missing;
  END IF;
  IF obj_description('public.fos_mutate_order(jsonb)'::regprocedure, 'pg_proc') IS DISTINCT FROM 'fos_sec_wrapper'
     OR obj_description('public.create_shop_channel_order(jsonb)'::regprocedure, 'pg_proc') IS DISTINCT FROM 'fos_sec_wrapper'
     OR obj_description('public.query_public_order(text,text)'::regprocedure, 'pg_proc') IS DISTINCT FROM 'fos_sec_wrapper' THEN
    RAISE EXCEPTION '安全包装函数被旧脚本覆盖，请重新执行 security-01-prepare.sql';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. 关闭旧认证方式
-- ---------------------------------------------------------------------
UPDATE public.fos_security_flags SET enabled = false, updated_at = now() WHERE key = 'legacy_auth';

-- 明文密码从业务表清除（备份仍在 fos_legacy_password_backup，仅供回滚）
INSERT INTO public.fos_legacy_password_backup (user_id, password_plain)
SELECT id, password_hash FROM public.users
 WHERE password_hash IS NOT NULL AND password_hash <> '' AND password_hash NOT LIKE '!%'
ON CONFLICT (user_id) DO UPDATE SET password_plain = EXCLUDED.password_plain, backed_up_at = now();
ALTER TABLE public.users DISABLE TRIGGER trg_fos_users_auth_sync;
UPDATE public.users SET password_hash = '!AUTH'
 WHERE password_hash IS NULL OR password_hash = '' OR password_hash NOT LIKE '!%';
ALTER TABLE public.users ENABLE TRIGGER trg_fos_users_auth_sync;

-- 以后禁止写入明文密码（只能通过 fos_save_account / fos_set_password）
CREATE OR REPLACE FUNCTION public.fos_users_password_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.password_hash IS NULL OR NEW.password_hash NOT LIKE '!%' THEN
    RAISE EXCEPTION 'password_hash_writes_disabled: use fos_save_account / fos_set_password';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fos_users_password_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_fos_users_password_guard ON public.users;
CREATE TRIGGER trg_fos_users_password_guard
  BEFORE INSERT OR UPDATE OF password_hash ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.fos_users_password_guard();

-- 顾客密码全部转为 bcrypt
UPDATE public.customer_accounts
   SET password_hash = extensions.crypt(password_hash, extensions.gen_salt('bf', 10)), updated_at = now()
 WHERE password_hash !~ '^\$2[abxy]\$';

-- ---------------------------------------------------------------------
-- 2. 备份并删除业务表上的旧策略，启用 RLS，收回 anon 权限
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t text;
  r record;
  v_tables text[] := ARRAY['users','merchants','products','orders','order_items','settings','stock_movements',
                           'payment_methods','order_channels','print_logs','customer_accounts',
                           'order_daily_counters','fos_order_requests'];
  v_roles text;
BEGIN
  FOREACH t IN ARRAY v_tables LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    FOR r IN SELECT * FROM pg_policies WHERE schemaname = 'public' AND tablename = t
               AND policyname NOT LIKE 'fos\_sec\_%' LOOP
      SELECT string_agg(CASE WHEN x = 'public' THEN 'public' ELSE quote_ident(x) END, ', ')
        INTO v_roles FROM unnest(r.roles) AS x;
      INSERT INTO public.fos_policy_backup (schemaname, tablename, policyname, create_sql)
      VALUES (r.schemaname, r.tablename, r.policyname,
        format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
               r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd, coalesce(v_roles, 'public'),
               CASE WHEN r.qual IS NOT NULL THEN ' USING (' || r.qual || ')' ELSE '' END,
               CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || r.with_check || ')' ELSE '' END));
      EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;

  -- authenticated：表级权限交给 RLS 精细控制
  FOREACH t IN ARRAY ARRAY['merchants','products','orders','order_items','settings','stock_movements',
                           'payment_methods','order_channels','print_logs'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;

  -- 内部表：完全不开放
  FOREACH t IN ARRAY ARRAY['customer_accounts','order_daily_counters','fos_order_requests'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- users：只能读；只允许改资料字段；新增/删除/改密码/启停走 RPC
REVOKE ALL ON public.users FROM anon, authenticated;
GRANT SELECT ON public.users TO authenticated;
GRANT UPDATE (name, address, zip_code, phone, contact_name, settlement_type) ON public.users TO authenticated;

-- 序列：客户端不直接插入订单
DO $$
DECLARE s record;
BEGIN
  FOR s IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'S' LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon', s.relname);
  END LOOP;
END $$;

-- 视图：全部改为按调用者权限执行（否则视图以所有者身份运行，会绕过 RLS），且不可经视图写入
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') LOOP
    IF v.relkind = 'v' THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.relname);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', v.relname);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM authenticated', v.relname);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', v.relname);
    ELSE
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v.relname);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 3. 撤销旧的、靠明文密码或只凭手机号的接口
-- ---------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['shop_channel_login(jsonb)','customer_account_login(jsonb)','customer_account_register(jsonb)',
                           'list_customer_orders(jsonb)','fos_shop_session_json(text)','fos_ensure_public_shop(text)'] LOOP
    IF to_regprocedure('public.' || f) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. Storage：删除旧的 anon 写入策略（公开读取保留，用于显示商品图片）
-- ---------------------------------------------------------------------
DO $$
DECLARE r record; v_roles text;
BEGIN
  FOR r IN SELECT * FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
             AND policyname IN ('fos_v2_products_anon_insert', 'fos_v2_products_anon_update', 'fos_v2_products_anon_delete') LOOP
    SELECT string_agg(CASE WHEN x = 'public' THEN 'public' ELSE quote_ident(x) END, ', ') INTO v_roles FROM unnest(r.roles) AS x;
    INSERT INTO public.fos_policy_backup (schemaname, tablename, policyname, create_sql)
    VALUES (r.schemaname, r.tablename, r.policyname,
      format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s', r.policyname, r.schemaname, r.tablename, r.permissive, r.cmd,
             coalesce(v_roles, 'public'),
             CASE WHEN r.qual IS NOT NULL THEN ' USING (' || r.qual || ')' ELSE '' END,
             CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || r.with_check || ')' ELSE '' END));
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. 让所有现有登录会话失效（第 1 步期间旧接口仍可写密码，强制全部重新登录）
--    仅限本系统账号，不影响同一项目中的其他 Auth 用户
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    DELETE FROM auth.refresh_tokens WHERE user_id IN (SELECT auth_user_id::text FROM public.users WHERE auth_user_id IS NOT NULL);
  END IF;
  IF to_regclass('auth.sessions') IS NOT NULL THEN
    DELETE FROM auth.sessions WHERE user_id IN (SELECT auth_user_id FROM public.users WHERE auth_user_id IS NOT NULL);
  END IF;
  DELETE FROM public.fos_public_sessions WHERE kind = 'shop';
END $$;

-- ---------------------------------------------------------------------
-- 6. 报告：未启用 RLS 的表；仍在使用旧密码的门店/配送账号
-- ---------------------------------------------------------------------
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF v IS NOT NULL THEN
    RAISE WARNING '以下 public 表仍未启用 RLS，anon key 可能可以读写，请确认：%', v;
  END IF;
  SELECT count(*)::text INTO v FROM public.fos_legacy_password_backup b JOIN public.users u ON u.id = b.user_id
   WHERE u.active AND u.role IN ('order', 'delivery');
  IF v <> '0' THEN
    RAISE WARNING '% 个门店/配送账号仍在使用旧密码，建议分批修改（见 security-verify.sql）', v;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 7. 最后检查（此时 users 表已被锁定，旧接口无法再写入密码）：
--    总后台 / 工厂管理账号必须已在第 1 步之后改过密码，否则整个第 2 步回滚。
--    旧密码以前可被任何人读取，必须视为已泄露。
--    改密码：总后台账号在 SQL Editor 执行 SELECT fos_admin_reset_password('账号ID', '新密码');
--            工厂账号可由总后台在商家编辑页设置新管理密码，或同样用上面的 SQL。
-- ---------------------------------------------------------------------
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(u.id || '(' || u.role || ')', ', ' ORDER BY u.role, u.id) INTO v
    FROM public.users u JOIN public.fos_legacy_password_backup b ON b.user_id = u.id
   WHERE u.active AND u.role IN ('super_admin', 'factory', 'admin');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION '以下管理类账号仍在使用旧密码（旧密码以前对外可读，视为已泄露），请先改密码再执行第 2 步：%', v;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
