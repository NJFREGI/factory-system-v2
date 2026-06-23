-- Factory System v2 可选扩展表（在 Supabase SQL Editor 执行）
-- 原料出入库记录
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out')),
  qty INTEGER NOT NULL CHECK (qty > 0),
  note TEXT,
  barcode TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created ON stock_movements(created_at);

-- 商品表扩展字段（若尚未存在，在 SQL Editor 执行）
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS needs_processing BOOLEAN DEFAULT TRUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS public_price NUMERIC;

-- 实时同步：在 Supabase Dashboard → Database → Replication 中勾选表，或执行：
-- ALTER PUBLICATION supabase_realtime ADD TABLE products;
-- ALTER PUBLICATION supabase_realtime ADD TABLE orders;
-- ALTER PUBLICATION supabase_realtime ADD TABLE order_items;

-- ========== 商品图片 Storage（上传失败时请执行本节）==========
-- 方式 A：Dashboard → Storage → New bucket → 名称 products → Public bucket 开启
-- 方式 B：执行以下 SQL

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'products',
  'products',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "fos_v2_products_public_read" ON storage.objects;
CREATE POLICY "fos_v2_products_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'products');

DROP POLICY IF EXISTS "fos_v2_products_anon_insert" ON storage.objects;
CREATE POLICY "fos_v2_products_anon_insert"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'products');

DROP POLICY IF EXISTS "fos_v2_products_anon_update" ON storage.objects;
CREATE POLICY "fos_v2_products_anon_update"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'products');

DROP POLICY IF EXISTS "fos_v2_products_anon_delete" ON storage.objects;
CREATE POLICY "fos_v2_products_anon_delete"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'products');
