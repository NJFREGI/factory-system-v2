-- =====================================================================
-- Factory System v2 · 安全改造检查（只读，可随时执行）
-- security-verify.sql
-- 在 Supabase SQL Editor 执行，逐项查看结果。
-- =====================================================================

-- 1. 当前阶段：legacy_auth = true 表示第 1 步（过渡期），false 表示已执行第 2 步
SELECT key, enabled, updated_at FROM public.fos_security_flags;

-- 2. 账号迁移情况：not_migrated 必须为 0；plaintext 在第 2 步后必须为 0
SELECT
  count(*) FILTER (WHERE active AND role IN ('factory','admin','order','delivery','super_admin') AND auth_user_id IS NULL) AS not_migrated,
  count(*) FILTER (WHERE password_hash NOT LIKE '!%') AS plaintext_passwords,
  count(*) FILTER (WHERE auth_user_id IS NOT NULL) AS auth_accounts
FROM public.users;

-- 3. 建议尽快修改的弱密码账号（不显示密码）
SELECT user_id, role, merchant_id, reason FROM public.fos_weak_password_report ORDER BY role, user_id;

-- 4. 安全包装函数是否被旧脚本覆盖（三行都应为 fos_sec_wrapper）
SELECT p.oid::regprocedure AS fn, obj_description(p.oid, 'pg_proc') AS marker
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('fos_mutate_order', 'create_shop_channel_order', 'query_public_order');

-- 5. public 表的 RLS 状态与 anon 权限（第 2 步后：业务表 rls = true，anon_select = false）
SELECT c.relname AS table_name, c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
       has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
 ORDER BY rls, table_name;

-- 6. anon 可执行的函数（应只剩顾客 H5 / 登录辅助接口）
SELECT p.oid::regprocedure AS fn, p.prosecdef AS security_definer
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE')
 ORDER BY 1;

-- 7. Storage 商品图片策略（第 2 步后不应再有 fos_v2_products_anon_insert/update/delete）
SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' ORDER BY policyname;

-- 8. 没有商家归属的数据（应全部为 0）
SELECT
  (SELECT count(*) FROM public.products WHERE merchant_id IS NULL) AS products_without_merchant,
  (SELECT count(*) FROM public.orders WHERE merchant_id IS NULL) AS orders_without_merchant,
  (SELECT count(*) FROM public.users WHERE merchant_id IS NULL AND role <> 'super_admin') AS users_without_merchant;

-- 9. 仍在使用旧密码的账号（旧密码以前对外可读，应视为已泄露；管理类账号必须先改，第 2 步才能执行）
SELECT u.id, u.role, u.merchant_id
  FROM public.users u JOIN public.fos_legacy_password_backup b ON b.user_id = u.id
 WHERE u.active
 ORDER BY CASE WHEN u.role IN ('super_admin', 'factory', 'admin') THEN 0 ELSE 1 END, u.role, u.id;
