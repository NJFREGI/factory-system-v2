-- 月次請求書：商家开票信息 + 店铺邮编
-- 在 Supabase SQL Editor 执行（可重复执行）

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS invoice_company_name TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS invoice_zip TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS invoice_address TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS invoice_tel TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS invoice_fax TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS invoice_registration_no TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS invoice_bank_info TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS zip_code TEXT;

NOTIFY pgrst, 'reload schema';
