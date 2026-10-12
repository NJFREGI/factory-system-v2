-- =====================================================================
-- Factory System v2 · 安全改造 第 3 步（清理，可选）
-- security-03-cleanup.sql
-- 第 2 步稳定运行（建议至少 2 周）、确认不再需要回滚后执行。
-- 执行后无法再用 security-rollback-02.sql 恢复旧密码。
-- =====================================================================
BEGIN;
DELETE FROM public.fos_legacy_password_backup;
DELETE FROM public.fos_login_throttle WHERE coalesce(locked_until, now()) <= now();
DELETE FROM public.fos_public_sessions WHERE expires_at < now();
COMMIT;
