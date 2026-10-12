// 安全改造集成测试：在本地 PostgreSQL 上模拟 Supabase（anon / authenticated / auth.uid()）
// 运行：PGHOST=/tmp PGPORT=54329 node tests/security/security.test.mjs
// 依赖：本机 PostgreSQL（含 pgcrypto）、npm 包 pg、bcryptjs（tests/package.json）
import pg from 'pg';
import bcrypt from 'bcryptjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const DB = 'fos_security_test';
const conn = { host: process.env.PGHOST || '/tmp', port: Number(process.env.PGPORT || 54329), user: 'postgres', database: DB };

execFileSync(path.join(here, 'build-db.sh'), [DB], { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
const db = new pg.Client(conn);
await db.connect();
db.on('notice', () => {});
const sql = (f) => db.query(fs.readFileSync(path.join(root, f), 'utf8'));

let passed = 0;
const ok = (name) => { passed += 1; console.log('  ✓ ' + name); };

// ---------- seed: two merchants, accounts with legacy plaintext passwords ----------
await db.query(`
  INSERT INTO merchants (id, name, max_users, max_products) VALUES ('m2', 'M2', 4, 2) ON CONFLICT DO NOTHING;
  UPDATE merchants SET max_drivers = 1 WHERE id = 'm2';
  INSERT INTO users (id, name, password_hash, role, merchant_id, phone) VALUES
    ('shopA', 'Shop A', 'secret1', 'order', 'default', '0900001'),
    ('shopA2', 'Shop A2', 'secret2', 'order', 'default', NULL),
    ('fac1', 'Factory 1', 'pass', 'factory', 'default', NULL),
    ('drv1', 'Driver 1', 'drvpass1', 'delivery', 'default', NULL),
    ('drv2', 'Driver 2', 'drvpass2', 'delivery', 'default', NULL),
    ('shopB', 'Shop B', 'bpass99', 'order', 'm2', NULL),
    ('fac2', 'Factory 2', 'fpass22', 'factory', 'm2', NULL);
  INSERT INTO products (id, name, price, tax_rate, merchant_id, stock) VALUES
    ('00000000-0000-0000-0000-0000000000a1', 'A-prod', 100, 8, 'default', 100),
    ('00000000-0000-0000-0000-0000000000b1', 'B-prod', 200, 8, 'm2', 100);
  INSERT INTO order_channels (id, merchant_id, name, channel_type) VALUES ('ch_a', 'default', 'A channel', 'public_qr');
  INSERT INTO settings (key, value) VALUES ('cutoff_time', '16:00'), ('order_notice', 'hello'),
    ('printer_settings_default', '{"userSecret":"S3CRET"}'), ('printer_settings_m2', '{"userSecret":"M2SECRET"}');
  INSERT INTO customer_accounts (merchant_id, phone, password_hash, name, address) VALUES ('default', '0801111', 'cpass1', 'Cust', 'Tokyo');
`);

// ---------- helpers ----------
async function tx(fn) {
  await db.query('BEGIN');
  try { const r = await fn(); await db.query('COMMIT'); return r; } catch (e) { await db.query('ROLLBACK'); throw e; }
}
async function authUid(userId) {
  return (await db.query('SELECT auth_user_id FROM users WHERE id = $1', [userId])).rows[0]?.auth_user_id;
}
// Run a query as Supabase would: anon (no JWT) or authenticated (JWT sub = auth user id)
async function as(who, text, params = []) {
  return tx(async () => {
    if (who === 'anon') {
      await db.query(`SET LOCAL ROLE anon`);
      await db.query(`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    } else {
      const sub = await authUid(who);
      assert.ok(sub, 'no auth account for ' + who);
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
      await db.query(`SET LOCAL ROLE authenticated`);
    }
    return db.query(text, params);
  });
}
const rows = async (who, text, params) => (await as(who, text, params)).rows;
const rpc = async (who, fn, arg) => (await as(who, `SELECT ${fn}($1::jsonb) AS r`, [JSON.stringify(arg)])).rows[0].r;
let reqN = 0;
const reqId = () => `sec-test-request-${String(++reqN).padStart(8, '0')}`;

// =====================================================================
console.log('Phase 1 (prepare)');
await sql('security-01-prepare.sql');
await sql('security-01-prepare.sql'); // 可重复执行
ok('prepare script applies twice without error');

const authRow = (await db.query(`SELECT au.email, au.encrypted_password, au.banned_until, au.confirmation_token
  FROM users u JOIN auth.users au ON au.id = u.auth_user_id WHERE u.id = 'shopA'`)).rows[0];
assert.ok(bcrypt.compareSync('secret1', authRow.encrypted_password), 'pgcrypto bcrypt must verify with standard bcrypt');
assert.ok(!bcrypt.compareSync('wrong', authRow.encrypted_password));
assert.equal(authRow.confirmation_token, '');
const jsEmail = 'u' + createHash('sha256').update('shopA', 'utf8').digest('hex').slice(0, 40) + '@login.njfregi.jp';
assert.equal(authRow.email, jsEmail);
const jpEmail = (await db.query(`SELECT fos_login_email('店舗１') AS e`)).rows[0].e;
assert.equal(jpEmail, 'u' + createHash('sha256').update('店舗１', 'utf8').digest('hex').slice(0, 40) + '@login.njfregi.jp');
assert.equal((await db.query(`SELECT count(*)::int n FROM auth.identities`)).rows[0].n, 8);
ok('legacy passwords migrated to bcrypt Auth accounts; email mapping matches JS (incl. non-ASCII IDs)');

const weak = (await db.query(`SELECT user_id FROM fos_weak_password_report ORDER BY user_id`)).rows.map((r) => r.user_id);
assert.deepEqual(weak, ['fac1', 'superadmin']);
ok('weak password report lists fac1 / superadmin');

// old client (anon + plaintext) still works during transition
const legacySubmit = await rpc('anon', 'fos_mutate_order', { operation: 'submit', actor_id: 'shopA', password: 'secret1',
  request_id: reqId(), order_date: '2026-10-12', note: '', items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 2 }] });
assert.ok(legacySubmit.id);
await assert.rejects(rpc('anon', 'fos_mutate_order', { operation: 'submit', actor_id: 'shopA', password: 'wrong',
  request_id: reqId(), order_date: '2026-10-12', items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] }));
ok('transition: old client order submit with plaintext still works, wrong password rejected');

// new client: JWT identity, no password
const me = (await as('shopA', 'SELECT fos_me() AS r')).rows[0].r;
assert.equal(me.id, 'shopA'); assert.equal(me.merchant_id, 'default'); assert.equal(me.password_hash, undefined);
const newSubmit = await rpc('shopA', 'fos_mutate_order', { operation: 'submit', request_id: reqId(), order_date: '2026-10-13',
  note: '', items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] });
assert.ok(newSubmit.id);
await assert.rejects(rpc('shopB', 'fos_mutate_order', { operation: 'receipt', request_id: reqId(), order_id: newSubmit.id }),
  /订单不存在或无权限/);
const bOrder = await rpc('shopB', 'fos_mutate_order', { operation: 'submit', request_id: reqId(), order_date: '2026-10-13',
  items: [{ product_id: '00000000-0000-0000-0000-0000000000b1', qty: 1 }] });
assert.ok(bOrder.id);
await assert.rejects(rpc('shopB', 'fos_mutate_order', { operation: 'submit', request_id: reqId(), order_date: '2026-10-13',
  items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] }), /商品不存在/);
ok('new client: fos_me + order submit via JWT; other merchant cannot touch the order or order its products');

// account management
const created = await rpc('fac1', 'fos_save_account', { id: 'shopNew', name: 'New', role: 'order', password: 'Newpass1', create: true, phone: '0902222' });
assert.equal(created.merchant_id, 'default');
assert.equal((await db.query(`SELECT password_hash FROM users WHERE id='shopNew'`)).rows[0].password_hash, '!AUTH');
await assert.rejects(rpc('fac1', 'fos_save_account', { id: 'shopB', name: 'x', role: 'order', password: 'Zzzzzz9', create: true }), /id_taken_other_merchant/);
await assert.rejects(rpc('fac1', 'fos_save_account', { id: 'fac9', name: 'x', role: 'factory', password: 'Zzzzzz9', create: true }), /forbidden_role/);
await assert.rejects(rpc('fac1', 'fos_save_account', { id: 'shopX', name: 'x', role: 'order', password: '123', create: true }), /password_too_short/);
await assert.rejects(rpc('shopA', 'fos_save_account', { id: 'shopY', name: 'x', role: 'order', password: 'Yyyyyy9', create: true }), /forbidden/);
await assert.rejects(rpc('anon', 'fos_save_account', { id: 'shopY', name: 'x', role: 'order', password: 'Yyyyyy9' }), /permission denied/);
// m2: max_users 4 → shopB, fac2 + 2 more
await rpc('fac2', 'fos_save_account', { id: 'shopB2', name: 'B2', role: 'order', password: 'B2pass99', create: true });
await rpc('fac2', 'fos_save_account', { id: 'drvB', name: 'DB', role: 'delivery', password: 'Dbpass99', create: true });
await assert.rejects(rpc('fac2', 'fos_save_account', { id: 'shopB3', name: 'B3', role: 'order', password: 'B3pass99', create: true }), /quota_users/);
await as('fac2', `SELECT fos_set_account_active('shopB2', false)`);
await assert.rejects(rpc('fac2', 'fos_save_account', { id: 'drvB2', name: 'D2', role: 'delivery', password: 'Dbpass99', create: true }), /quota_drivers/);
const banned = (await db.query(`SELECT banned_until FROM auth.users WHERE id = (SELECT auth_user_id FROM users WHERE id='shopB2')`)).rows[0].banned_until;
assert.ok(banned instanceof Date && banned.getFullYear() > 2100, 'banned_until must be a finite far-future date (GoTrue cannot parse infinity)');
await assert.rejects(as('fac1', `SELECT fos_set_account_active('public_default', true)`), /forbidden/);
await assert.rejects(as('fac1', `SELECT fos_set_password('public_default', 'Hacked99')`), /forbidden/);
await assert.rejects(as('fac1', `SELECT fos_set_password('shopB', 'Hacked99')`), /forbidden/);
await assert.rejects(as('fac1', `SELECT fos_set_account_active('fac2', false)`), /forbidden/);
const shopAAuth = await authUid('shopA');
await db.query(`INSERT INTO auth.sessions (id, user_id) VALUES ('11111111-1111-1111-1111-111111111111', $1)`, [shopAAuth]);
await db.query(`INSERT INTO auth.refresh_tokens (token, user_id, session_id) VALUES ('rt', $1, '11111111-1111-1111-1111-111111111111')`, [shopAAuth]);
await as('shopA', `SELECT fos_set_password('shopA', 'Secret11')`);
assert.equal((await db.query(`SELECT count(*)::int n FROM auth.refresh_tokens`)).rows[0].n, 0, 'password change must revoke refresh tokens');
assert.ok(bcrypt.compareSync('Secret11', (await db.query(`SELECT encrypted_password e FROM auth.users WHERE id=(SELECT auth_user_id FROM users WHERE id='shopA')`)).rows[0].e));
// someone pre-registers the computed login e-mail of a future account → must not be linked
await db.query(`INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', fos_login_email('futureShop'), 'x', '{}', now(), now())`);
await assert.rejects(rpc('fac1', 'fos_save_account', { id: 'futureShop', name: 'F', role: 'order', password: 'Future99', create: true }), /auth_email_conflict/);
assert.equal((await db.query(`SELECT count(*)::int n FROM users WHERE id = 'futureShop'`)).rows[0].n, 0);
ok('account RPCs: merchant scoping, role limits, quotas, password policy, session revocation, pre-registered e-mail hijack blocked');

// trigger sync for old admin page writing plaintext during transition
await as('anon', `UPDATE users SET password_hash = 'shopA2new' WHERE id = 'shopA2'`);
assert.ok(bcrypt.compareSync('shopA2new', (await db.query(`SELECT encrypted_password e FROM auth.users WHERE id=(SELECT auth_user_id FROM users WHERE id='shopA2')`)).rows[0].e));
ok('transition: legacy plaintext password change is synced to Auth');

// shop H5 login (token) + throttle
const badShop = await rpc('anon', 'fos_shop_login', { merchant_id: 'default', login_id: 'shopA', password: 'nope' });
assert.equal(badShop.ok, false);
const shopLogin = await rpc('anon', 'fos_shop_login', { merchant_id: 'default', login_id: '0900001', password: 'Secret11' });
assert.equal(shopLogin.ok, true); assert.equal(shopLogin.shop.id, 'shopA'); assert.ok(shopLogin.session_token.length === 64);
assert.equal(JSON.stringify(shopLogin).includes('password'), false);
const chOrder = await rpc('anon', 'create_shop_channel_order', { channel_id: 'ch_a', shop_session_token: shopLogin.session_token,
  items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] });
assert.ok(chOrder.order_id);
await assert.rejects(rpc('anon', 'create_shop_channel_order', { channel_id: 'ch_a', shop_session_token: 'f'.repeat(64),
  items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] }), /shop_session_expired/);
await assert.rejects(rpc('anon', 'create_shop_channel_order', { channel_id: 'ch_a', shop_login_id: 'shopNew', shop_password: '!AUTH',
  items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] }));
await assert.rejects(rpc('anon', 'fos_mutate_order', { operation: 'submit', actor_id: 'shopNew', password: '!AUTH', request_id: reqId(),
  order_date: '2026-10-12', items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] }));
for (let i = 0; i < 8; i += 1) await rpc('anon', 'fos_shop_login', { merchant_id: 'default', login_id: 'shopA2', password: 'bad' + i });
const locked = await rpc('anon', 'fos_shop_login', { merchant_id: 'default', login_id: 'shopA2', password: 'shopA2new' });
assert.equal(locked.error, 'too_many_attempts');
ok('shop H5: token login (id/phone), order with token, forged token / "!AUTH" marker rejected, brute force locked');

// customers
const cBad = await rpc('anon', 'fos_customer_login', { merchant_id: 'default', phone: '0801111', password: 'x' });
assert.equal(cBad.ok, false);
const cLogin = await rpc('anon', 'fos_customer_login', { merchant_id: 'default', phone: '0801111', password: 'cpass1' });
assert.equal(cLogin.ok, true);
assert.match((await db.query(`SELECT password_hash FROM customer_accounts WHERE phone='0801111'`)).rows[0].password_hash, /^\$2/);
const cOld = await rpc('anon', 'customer_account_login', { merchant_id: 'default', phone: '0801111', password: 'cpass1' });
assert.equal(cOld.phone, '0801111');
const cReg = await rpc('anon', 'fos_customer_register', { merchant_id: 'default', phone: '0803333', password: 'Cust3333', address: 'Osaka' });
assert.ok(cReg.session_token);
const pub = await rpc('anon', 'create_public_order', { channel_id: 'ch_a', customer_name: 'C3', customer_phone: '0803333',
  customer_address: 'Osaka', customer_payment_method: 'cash', items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] });
const mine = await rpc('anon', 'fos_customer_orders', { merchant_id: 'default', session_token: cReg.session_token });
assert.equal(mine.length, 1);
await assert.rejects(rpc('anon', 'fos_customer_orders', { merchant_id: 'default', session_token: 'x', phone: '0803333' }), /customer_session_expired/);
await assert.rejects(rpc('anon', 'fos_customer_orders', { merchant_id: 'm2', session_token: cReg.session_token }), /customer_session_expired/);
ok('customers: bcrypt upgrade on login, token-only order history, token bound to merchant');

for (let i = 0; i < 10; i += 1) {
  const r = (await as('anon', `SELECT query_public_order('0803333', $1) AS r`, ['P000000-' + i])).rows[0].r;
  assert.equal(r, null);
}
await assert.rejects(as('anon', `SELECT query_public_order('0803333', $1)`, [pub.public_order_code]), /too_many_attempts/);
await db.query(`DELETE FROM fos_login_throttle`);
assert.equal((await as('anon', `SELECT query_public_order('0803333', $1) AS r`, [pub.public_order_code])).rows[0].r.public_order_code, pub.public_order_code);
ok('public order lookup: brute-force on order codes is throttled');

// phase 1 must not break old anon clients
assert.ok((await rows('anon', `SELECT id FROM orders`)).length >= 3);
ok('transition: anon direct table access still works before phase 2 (old clients keep running)');

// =====================================================================
console.log('Phase 2 (enforce)');
await assert.rejects(sql('security-02-enforce.sql'), /仍在使用旧密码[\s\S]*fac1/);
await db.query('ROLLBACK');
assert.equal((await db.query(`SELECT enabled FROM fos_security_flags WHERE key='legacy_auth'`)).rows[0].enabled, true, 'failed enforce must roll back');
for (const [id, pw] of [['superadmin', 'Sup3r-Strong!'], ['fac1', 'Fac1-Strong!'], ['fac2', 'Fac2-Strong!']]) {
  await db.query(`SELECT fos_admin_reset_password($1, $2)`, [id, pw]);
}
await sql('security-02-enforce.sql');
ok('enforce refuses to run while admin accounts keep leaked legacy passwords; applies after reset');

for (const t of ['users', 'orders', 'order_items', 'products', 'merchants', 'settings', 'customer_accounts', 'payment_methods', 'order_channels']) {
  await assert.rejects(as('anon', `SELECT * FROM ${t} LIMIT 1`), /permission denied/, `anon must not read ${t}`);
}
await assert.rejects(as('anon', `UPDATE products SET price = 1`), /permission denied/);
ok('anon key can no longer read or write any business table');

assert.equal((await db.query(`SELECT count(*)::int n FROM users WHERE password_hash NOT LIKE '!%'`)).rows[0].n, 0);
await assert.rejects(db.query(`UPDATE users SET password_hash = 'plain' WHERE id = 'shopA'`), /password_hash_writes_disabled/);
ok('no plaintext passwords left in users; plaintext writes are blocked');

// tenant isolation
const f2Orders = await rows('fac2', `SELECT merchant_id FROM orders`);
assert.ok(f2Orders.length >= 1 && f2Orders.every((o) => o.merchant_id === 'm2'));
const f1Orders = await rows('fac1', `SELECT merchant_id FROM orders`);
assert.ok(f1Orders.length >= 3 && f1Orders.every((o) => o.merchant_id === 'default'));
assert.equal((await rows('fac2', `SELECT oi.id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.merchant_id = 'default'`)).length, 0);
assert.equal((await rows('fac2', `SELECT id FROM order_items`)).length, 1);
assert.equal((await rows('fac2', `SELECT id FROM products WHERE merchant_id = 'default'`)).length, 0);
assert.equal((await rows('fac2', `SELECT id FROM users WHERE merchant_id = 'default'`)).length, 0);
assert.equal((await as('fac2', `UPDATE orders SET note = 'x' WHERE merchant_id = 'default'`)).rowCount, 0);
await assert.rejects(as('fac2', `INSERT INTO products (name, price, merchant_id) VALUES ('evil', 1, 'default')`), /row-level security/);
assert.equal((await as('fac2', `UPDATE products SET merchant_id = 'default' WHERE merchant_id = 'm2'`).catch((e) => e)).message ?? '', 'new row violates row-level security policy for table "products"');
assert.equal((await rows('fac2', `SELECT key FROM settings WHERE key = 'printer_settings_default'`)).length, 0);
assert.equal((await rows('fac2', `SELECT key FROM settings WHERE key = 'printer_settings_m2'`)).length, 1);
await assert.rejects(as('fac2', `INSERT INTO settings (key, value) VALUES ('cutoff_time', '01:00')`), /row-level security/);
assert.equal((await rows('fac2', `SELECT 1 FROM merchant_sales_orders WHERE merchant_id = 'default'`)).length, 0);
for (const v of ['merchant_public_sales_orders', 'merchant_sales_orders']) {
  await assert.rejects(as('anon', `SELECT * FROM ${v} LIMIT 1`), /permission denied/);
  await assert.rejects(as('fac2', `UPDATE ${v} SET total = 1`), /permission denied/);
}
assert.equal((await rows('fac2', `SELECT 1 FROM merchant_public_sales_orders WHERE merchant_id = 'default'`)).length, 0);
ok('merchant isolation: m2 factory cannot read/modify default merchant orders, products, users, settings, stats views');

// order role
const shopAOrders = await rows('shopA', `SELECT shop_id FROM orders`);
assert.ok(shopAOrders.length >= 2 && shopAOrders.every((o) => o.shop_id === 'shopA'));
assert.equal((await rows('shopA', `SELECT id FROM users`)).map((u) => u.id).join(), 'shopA');
assert.equal((await rows('shopA', `SELECT key FROM settings WHERE key LIKE 'printer%'`)).length, 0);
assert.equal((await rows('shopA', `SELECT value FROM settings WHERE key = 'cutoff_time_default'`))[0].value, '16:00');
assert.equal((await as('shopA', `UPDATE orders SET total = 0`)).rowCount, 0);
await assert.rejects(as('shopA', `UPDATE users SET role = 'factory' WHERE id = 'shopA'`), /permission denied/);
assert.equal((await as('shopA', `UPDATE merchants SET max_users = 999`)).rowCount, 0);
assert.equal((await as('fac1', `UPDATE merchants SET max_users = 999`)).rowCount, 0);
await as('fac1', `SELECT fos_set_merchant_display_name('NJF Factory')`);
await rpc('fac1', 'fos_set_merchant_invoice_profile', { invoice_company_name: 'NJF株式会社', max_users: 5, plan_type: 'trial', status: 'suspended' });
const mrow = (await db.query(`SELECT invoice_company_name, max_users, plan_type, status FROM merchants WHERE id='default'`)).rows[0];
assert.deepEqual(mrow, { invoice_company_name: 'NJF株式会社', max_users: 999, plan_type: 'enterprise', status: 'active' });
await assert.rejects(rpc('shopA', 'fos_set_merchant_invoice_profile', { invoice_company_name: 'x' }), /forbidden/);
assert.equal((await db.query(`SELECT name FROM merchants WHERE id='default'`)).rows[0].name, 'NJF Factory');
ok('store account: only own orders and own user row, no secrets, cannot modify orders/roles/merchant plan');

// factory manages own shops via columns-limited update
assert.equal((await as('fac1', `UPDATE users SET address = 'Shibuya' WHERE id = 'shopA'`)).rowCount, 1);
await assert.rejects(as('fac1', `UPDATE users SET merchant_id = 'm2' WHERE id = 'shopA'`), /permission denied/);
await assert.rejects(as('fac1', `UPDATE users SET password_hash = '!AUTH' WHERE id = 'shopA'`), /permission denied/);
await assert.rejects(as('fac1', `INSERT INTO users (id, name, password_hash, role) VALUES ('z','z','!AUTH','order')`), /permission denied/);
assert.equal((await as('fac1', `UPDATE users SET name = 'x' WHERE id = 'shopB'`)).rowCount, 0);
ok('factory: can edit own shop profile only; cannot move accounts, set passwords or insert users directly');

// delivery restrictions
await db.query(`UPDATE orders SET assigned_driver_id = 'drv2' WHERE id = $1`, [newSubmit.id]);
assert.equal((await as('drv1', `UPDATE orders SET payment_status = 'paid' WHERE id = $1`, [newSubmit.id])).rowCount, 0);
assert.equal((await as('drv2', `UPDATE orders SET payment_status = 'paid' WHERE id = $1`, [newSubmit.id])).rowCount, 1);
await assert.rejects(as('drv2', `UPDATE orders SET note = 'd2' WHERE id = $1`, [newSubmit.id]), /delivery_update_not_allowed/);
await assert.rejects(as('drv1', `UPDATE orders SET total = 1 WHERE id = $1`, [legacySubmit.id]), /delivery_update_not_allowed/);
await assert.rejects(as('drv1', `UPDATE orders SET shop_id = 'shopA2' WHERE id = $1`, [legacySubmit.id]), /delivery_update_not_allowed/);
await assert.rejects(as('drv1', `UPDATE orders SET assigned_driver_id = 'drv1' WHERE id = $1`, [newSubmit.id]).then((r) => { if (!r.rowCount) throw new Error('blocked'); }), /blocked|delivery_update_not_allowed/);
await assert.rejects(as('drv1', `UPDATE orders SET status = 'delivered' WHERE id = $1`, [legacySubmit.id]), /delivery_update_not_allowed/); // still pending
await rpc('fac1', 'fos_mutate_order', { operation: 'status', request_id: reqId(), order_id: legacySubmit.id, status: 'shipped' });
assert.equal((await as('drv1', `UPDATE orders SET status = 'delivered', payment_status = 'paid', settlement_type = 'cash',
  payment_method_name = '現金', payment_recorded_at = now(), updated_at = now() WHERE id = $1`, [legacySubmit.id])).rowCount, 1);
await assert.rejects(rpc('drv1', 'fos_mutate_order', { operation: 'status', request_id: reqId(), order_id: legacySubmit.id, status: 'cancelled' }), /无操作权限/);
await assert.rejects(rpc('drv1', 'fos_mutate_order', { operation: 'edit', request_id: reqId(), order_id: legacySubmit.id, status: 'delivered', items: [] }), /无操作权限/);
await db.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [bOrder.id]);
await db.query(`UPDATE orders SET status = 'cancelled' WHERE id = (SELECT id FROM orders WHERE merchant_id='default' AND assigned_driver_id IS NULL AND id <> $1 LIMIT 1) RETURNING id`, [legacySubmit.id]);
const cancelled = (await db.query(`SELECT id FROM orders WHERE merchant_id='default' AND status='cancelled' LIMIT 1`)).rows[0].id;
await assert.rejects(as('drv1', `UPDATE orders SET status = 'delivered' WHERE id = $1`, [cancelled]), /delivery_update_not_allowed/);
assert.equal((await rows('drv1', `SELECT key FROM settings WHERE key LIKE 'printer_settings_%'`)).length, 1);
await db.query(`INSERT INTO settings (key, value) VALUES ('paycloud_settings_default', '{"privateKeyRef":"x"}')`);
assert.equal((await rows('drv1', `SELECT key FROM settings WHERE key = 'paycloud_settings_default'`)).length, 0);
assert.equal((await rows('fac1', `SELECT key FROM settings WHERE key = 'paycloud_settings_default'`)).length, 1);
ok('delivery: only own/unassigned orders, only payment/status fields, no payment-gateway settings');

// new client RPC still works; legacy path closed
await rpc('shopA', 'fos_mutate_order', { operation: 'receipt', request_id: reqId(), order_id: legacySubmit.id });
const after = await rpc('shopA', 'fos_mutate_order', { operation: 'submit', request_id: reqId(), order_date: '2026-10-14',
  items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] });
assert.ok(after.id);
await rpc('fac1', 'fos_mutate_order', { operation: 'status', request_id: reqId(), order_id: after.id, status: 'delivered' });
await rpc('shopA', 'fos_mutate_order', { operation: 'receipt', request_id: reqId(), order_id: after.id });
await assert.rejects(rpc('anon', 'fos_mutate_order', { operation: 'submit', actor_id: 'shopA', password: 'Secret11', request_id: reqId(),
  order_date: '2026-10-12', items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] }), /登录已失效/);
await assert.rejects(rpc('anon', 'fos_mutate_order', { operation: 'submit', actor_id: 'shopA', password: '!AUTH', request_id: reqId(),
  order_date: '2026-10-12', items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] }), /登录已失效/);
await assert.rejects(as('anon', `SELECT fos_mutate_order_impl('{}'::jsonb)`), /permission denied/);
await assert.rejects(rpc('anon', 'shop_channel_login', { merchant_id: 'default', login_id: 'shopA', password: 'Secret11' }), /permission denied/);
await assert.rejects(rpc('anon', 'list_customer_orders', { merchant_id: 'default', phone: '0803333' }), /permission denied/);
await assert.rejects(rpc('anon', 'create_shop_channel_order', { channel_id: 'ch_a', shop_login_id: 'shopA', shop_password: 'Secret11',
  items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] }), /shop_login_required/);
await assert.rejects(rpc('anon', 'create_shop_channel_order', { channel_id: 'ch_a', shop_session_token: shopLogin.session_token,
  items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] }), /shop_session_expired/); // enforce revokes sessions
const shopLogin2 = await rpc('anon', 'fos_shop_login', { merchant_id: 'default', login_id: 'shopA', password: 'Secret11' });
const tokenOrder = await rpc('anon', 'create_shop_channel_order', { channel_id: 'ch_a', shop_session_token: shopLogin2.session_token,
  items: [{ product_id: '00000000-0000-0000-0000-0000000000a1', qty: 1 }] });
assert.ok(tokenOrder.order_id);
assert.equal((await rpc('anon', 'fos_customer_orders', { merchant_id: 'default', session_token: cReg.session_token })).length, 1);
ok('after enforce: JWT order flow works, legacy password/phone-only RPCs closed, H5 token flows still work');

// merchant suspended → immediate lockout at DB level
await db.query(`UPDATE merchants SET status = 'suspended' WHERE id = 'm2'`);
assert.equal((await rows('fac2', `SELECT id FROM orders`)).length, 0);
assert.equal((await rows('fac2', `SELECT id FROM merchants`)).length, 1); // can still read own merchant to show "suspended"
await assert.rejects(rpc('fac2', 'fos_save_account', { id: 'q', name: 'q', role: 'order', password: 'Qqqqqq99' }), /forbidden/);
await db.query(`UPDATE merchants SET status = 'active' WHERE id = 'm2'`);
ok('suspended merchant loses data access immediately (server-side)');

// deactivated account → no access even with a still-valid JWT
await as('fac1', `SELECT fos_set_account_active('shopA2', false)`);
assert.equal((await rows('shopA2', `SELECT id FROM orders`)).length, 0);
assert.equal((await as('shopA2', 'SELECT fos_me() AS r')).rows[0].r, null);
ok('deactivated account loses access even with an unexpired token');

// storage
await as('fac1', `INSERT INTO storage.objects (bucket_id, name) VALUES ('products', 'default/prod_1.jpg')`);
await assert.rejects(as('fac1', `INSERT INTO storage.objects (bucket_id, name) VALUES ('products', 'm2/prod_1.jpg')`), /row-level/);
await assert.rejects(as('anon', `INSERT INTO storage.objects (bucket_id, name) VALUES ('products', 'x.jpg')`), /row-level/);
assert.equal((await as('fac2', `DELETE FROM storage.objects WHERE name = 'default/prod_1.jpg'`)).rowCount, 0);
assert.equal((await rows('anon', `SELECT name FROM storage.objects WHERE bucket_id = 'products'`)).length, 1);
ok('product images: public read, write only into own merchant folder');

// super admin
assert.ok((await rows('superadmin', `SELECT DISTINCT merchant_id FROM orders`)).length >= 2);
await rpc('superadmin', 'fos_save_account', { id: 'fac3', name: 'F3', role: 'factory', merchant_id: 'm2', password: 'F3pass99', create: true }).catch((e) => {
  assert.match(e.message, /quota_users/);
});
ok('super admin sees all merchants and is still bound by plan quotas');

// =====================================================================
console.log('Rollback');
await sql('security-rollback-02.sql');
assert.ok((await rows('anon', `SELECT id FROM orders`)).length >= 3);
assert.equal((await db.query(`SELECT password_hash FROM users WHERE id = 'drv1'`)).rows[0].password_hash, 'drvpass1');
const legacyAgain = await rpc('anon', 'fos_mutate_order', { operation: 'submit', actor_id: 'drv1', password: 'drvpass1', request_id: reqId(),
  order_date: '2026-10-12', items: [] }).catch((e) => e.message);
assert.match(String(legacyAgain), /无操作权限|购物车为空|不可下单/);
assert.ok((await rows('shopA', `SELECT fos_me() AS r`))[0].r.id === 'shopA');
ok('rollback restores old behaviour (anon access, plaintext for untouched accounts) while new Auth logins keep working');

await sql('security-02-enforce.sql');
await assert.rejects(as('anon', `SELECT * FROM users LIMIT 1`), /permission denied/);
ok('enforce can be re-applied after rollback');

const verify = await db.query(fs.readFileSync(path.join(root, 'security-verify.sql'), 'utf8'));
assert.ok(Array.isArray(verify) && verify.length >= 8);
await sql('security-03-cleanup.sql');
assert.equal((await db.query('SELECT count(*)::int n FROM fos_legacy_password_backup')).rows[0].n, 0);
ok('verify and cleanup scripts run');

await db.end();
console.log(`\nPASS: ${passed} security checks`);
