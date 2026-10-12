-- =====================================================================
-- Factory System v2 · 回滚第 2 步（恢复到第 1 步之后的状态）
-- security-rollback-02.sql
--
-- 用途：执行 security-02-enforce.sql 后出现严重问题、需要让旧客户端临时恢复时使用。
-- 回滚后数据重新对 anon key 开放（与改造前同样不安全），请尽快修复后再执行第 2 步。
-- 第 1 步建立的 Auth 账号保留，新版客户端在回滚后仍可使用。
-- =====================================================================

BEGIN;

UPDATE public.fos_security_flags SET enabled = true, updated_at = now() WHERE key = 'legacy_auth';

-- 1. 恢复明文密码（仅对 fos_legacy_password_backup 中仍有备份的账号）
DROP TRIGGER IF EXISTS trg_fos_users_password_guard ON public.users;
ALTER TABLE public.users DISABLE TRIGGER trg_fos_users_auth_sync;
UPDATE public.users u SET password_hash = b.password_plain
  FROM public.fos_legacy_password_backup b
 WHERE b.user_id = u.id AND u.password_hash = '!AUTH';
ALTER TABLE public.users ENABLE TRIGGER trg_fos_users_auth_sync;

-- 2. 关闭 RLS，恢复 anon 权限与旧策略
DO $$
DECLARE
  t text;
  r record;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','merchants','products','orders','order_items','settings','stock_movements',
                           'payment_methods','order_channels','print_logs'] LOOP
    CONTINUE WHEN to_regclass('public.' || t) IS NULL;
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON public.%I TO anon, authenticated', t);
  END LOOP;
  FOR r IN SELECT DISTINCT ON (schemaname, tablename, policyname) * FROM public.fos_policy_backup
            ORDER BY schemaname, tablename, policyname, id DESC LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = r.schemaname AND p.tablename = r.tablename
                     AND p.policyname = r.policyname) THEN
      EXECUTE r.create_sql;
    END IF;
  END LOOP;
  -- 原来就启用了 RLS 的表（例如 products 带“全部允许”策略）在恢复策略后重新启用
  FOR t IN SELECT DISTINCT tablename FROM public.fos_policy_backup WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- 3. 恢复旧接口
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['shop_channel_login(jsonb)','customer_account_login(jsonb)','customer_account_register(jsonb)',
                           'list_customer_orders(jsonb)','fos_shop_session_json(text)','fos_ensure_public_shop(text)'] LOOP
    IF to_regprocedure('public.' || f) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated', f);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
