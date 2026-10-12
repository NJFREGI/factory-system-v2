// 前端登录 / 会话安全回归测试（无需网络，模拟 supabase-js）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');

const src = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');

function setup({ profile = { id: 'shop1', name: 'S', role: 'order', merchant_id: 'default' }, signInError = null, expectedRoles = ['order'] } = {}) {
  const store = new Map();
  const calls = { signIn: [], signOut: 0, rpc: [] };
  let session = null;
  const sb = {
    auth: {
      signInWithPassword: async (args) => { calls.signIn.push(args); if (signInError) return { error: signInError }; session = { access_token: 't' }; return { data: { session }, error: null }; },
      signOut: async () => { calls.signOut += 1; session = null; return { error: null }; },
      getSession: async () => ({ data: { session } }),
    },
    rpc: async (name, args) => { calls.rpc.push({ name, args }); if (name === 'fos_me') return { data: session ? profile : null, error: null }; return { data: null, error: null }; },
  };
  const ctx = {
    crypto: crypto.webcrypto, TextEncoder, Promise, console,
    FOS: {
      APP_ID: 'order',
      CONFIG: { DEFAULT_MERCHANT_ID: 'default', LOGIN_EMAIL_DOMAIN: 'login.njfregi.jp' },
      i18n: { t: (ja, zh) => zh },
      storage: { get: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), set: (k, v) => (v == null ? store.delete(k) : store.set(k, JSON.stringify(v))) },
      db: { sb },
      merchants: { assertAccess: async () => {}, resolveMerchantId: (u) => u.merchant_id, clearCache: () => {} },
    },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src('shared/js/auth.js'), ctx);
  ctx.FOS.auth.expectedRoles = expectedRoles;
  return { auth: ctx.FOS.auth, calls, store, ctx };
}

const expectedEmail = (id) => 'u' + crypto.createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 40) + '@login.njfregi.jp';

test('login email matches database fos_login_email() (ASCII and Japanese IDs)', async () => {
  const { auth } = setup();
  assert.equal(await auth.loginEmail('26004'), expectedEmail('26004'));
  assert.equal(await auth.loginEmail('店舗１'), expectedEmail('店舗１'));
});

test('login uses Supabase Auth; nothing credential-like is stored locally', async () => {
  const { auth, calls, store } = setup();
  const user = await auth.login(' shop1 ', ' secret1 ');
  assert.equal(user.id, 'shop1');
  assert.deepEqual(JSON.parse(JSON.stringify(calls.signIn)), [{ email: expectedEmail('shop1'), password: 'secret1' }]);
  const dump = JSON.stringify([...store]);
  assert.ok(!/secret1|password/.test(dump), dump);
  assert.ok(!calls.rpc.some((c) => c.name !== 'fos_me'), 'login must not query tables with the password');
});

test('wrong password is rejected with a generic message', async () => {
  const { auth } = setup({ signInError: { message: 'Invalid login credentials' } });
  await assert.rejects(auth.login('shop1', 'bad'), /ID或密码错误/);
});

test('account of another app type is signed out again', async () => {
  const { auth, calls } = setup({ profile: { id: 'f1', role: 'factory', merchant_id: 'default' } });
  await assert.rejects(auth.login('f1', 'x'), /账号类型不匹配/);
  assert.equal(calls.signOut, 1);
  assert.equal(auth.user, null);
});

test('session restore relies on the Supabase session, not a stored user id', async () => {
  const { auth, store } = setup();
  store.set('session', JSON.stringify({ id: 'superadmin', role: 'super_admin' })); // 旧版可伪造的本地会话
  assert.equal(await auth.restoreSession(), null);
  await auth.login('shop1', 'secret1');
  assert.equal((await auth.restoreSession()).id, 'shop1');
  await auth.logout();
  assert.equal(await auth.restoreSession(), null);
});

test('order RPC payload carries no actor id or password', async () => {
  const values = new Map(); const payloads = [];
  const ctx = { crypto, FOS: { auth: { user: { id: 'shop1' } }, storage: { get: (k) => values.get(k), set: (k, v) => (v == null ? values.delete(k) : values.set(k, v)) },
    db: { sb: { rpc: async (n, a) => { payloads.push(a.p_payload); return { data: { id: 'o1' } }; } } } } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src('shared/js/orders.js'), ctx);
  await ctx.FOS.orders.submit([{ product_id: 'p', qty: 1 }], '2026-10-12', '');
  assert.equal(payloads[0].password, undefined);
  assert.equal(payloads[0].actor_id, undefined);
});

test('H5 sessions: legacy stored passwords are wiped, new sessions keep only the token', () => {
  const store = new Map();
  const ctx = { FOS: { storage: { get: (k) => store.get(k) ?? null, set: (k, v) => (v == null ? store.delete(k) : store.set(k, v)) },
    db: { sb: { rpc: async () => ({}) } }, i18n: { t: (a, b) => b } }, URL, URLSearchParams, location: { href: 'https://x/', search: '' } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src('shared/js/public-order.js'), ctx);
  const po = ctx.FOS.publicOrder;
  store.set(po.shopSessionKey('m', 'c'), { id: 'shop1', password: 'secret1' });
  assert.equal(po.loadShopSession('m', 'c'), null);
  assert.equal(store.size, 0);
  po.saveShopSession('m', 'c', { id: 'shop1', name: 'S', session_token: 'tok', password: 'secret1' });
  assert.ok(!JSON.stringify([...store]).includes('secret1'));
  assert.equal(po.loadShopSession('m', 'c').session_token, 'tok');
  store.set(po.customerSessionKey('m'), { phone: '0901' });
  assert.equal(po.loadCustomerSession('m'), null);
});

test('no app code reads or writes users.password_hash or queries users by password', () => {
  const files = ['shared/js/auth.js', 'shared/js/merchants.js', 'shared/js/orders.js', 'shared/js/public-order.js',
    'apps/admin/app.js', 'apps/order/app.js', 'apps/production/app.js', 'apps/super-admin/app.js', 'apps/customer-order/app.js'];
  for (const f of files) {
    const s = src(f);
    assert.ok(!/password_hash/.test(s), `${f} still references password_hash`);
    assert.ok(!/shop_password/.test(s), `${f} still sends shop_password`);
  }
});
