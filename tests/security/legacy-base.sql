-- Reconstructed legacy v1 core tables (production DDL is not in the repo; columns inferred from code)
CREATE TABLE users (id text PRIMARY KEY, name text NOT NULL, password_hash text NOT NULL, role text NOT NULL,
  active boolean NOT NULL DEFAULT true, address text DEFAULT '', created_at timestamptz DEFAULT now());
CREATE TABLE products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, spec text, emoji text,
  price numeric NOT NULL DEFAULT 0, tax_rate numeric DEFAULT 8, active boolean DEFAULT true, category text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_no integer, shop_id text NOT NULL REFERENCES users(id),
  shop_name text, order_date date, note text, status text DEFAULT 'pending', subtotal numeric DEFAULT 0, tax_total numeric DEFAULT 0,
  total numeric DEFAULT 0, factory_note text, receipt_confirmed boolean DEFAULT false, receipt_confirmed_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id), product_name text, product_spec text, product_emoji text, unit_price numeric,
  tax_rate numeric, qty integer, shortage boolean DEFAULT false, shortage_note text);
CREATE TABLE settings (key text PRIMARY KEY, value text, updated_at timestamptz NOT NULL DEFAULT now());
-- typical "open" policy pattern seen in early Supabase projects
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for anon" ON products FOR ALL USING (true) WITH CHECK (true);
