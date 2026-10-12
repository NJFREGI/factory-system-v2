window.FOS = window.FOS || {};

FOS.db = {
  client: null,

  async init(url, key) {
    const u = url || FOS.storage.get('sbUrl') || FOS.CONFIG.SUPABASE_URL;
    const k = key || FOS.storage.get('sbKey') || FOS.CONFIG.SUPABASE_KEY;
    if (!u || !k) throw new Error('Supabase URL / Key missing');
    FOS.storage.set('sbUrl', u);
    FOS.storage.set('sbKey', k);
    if (FOS.db.client && FOS.db._url === u && FOS.db._key === k) return FOS.db.client;
    // 每个端（管理/接单/生产/总后台）各自保存登录会话，同一浏览器可分别登录不同账号
    const app = FOS.APP_ID || 'app';
    FOS.db.client = supabase.createClient(u, k, {
      auth: {
        storageKey: `${FOS.CONFIG.STORAGE_PREFIX}auth_${app}`,
        persistSession: app !== 'customer-order',
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    FOS.db._url = u;
    FOS.db._key = k;
    // 旧版本在 localStorage 中保存的会话（只含账号 ID）不再用于登录
    FOS.storage.set('session', null);
    return FOS.db.client;
  },

  get sb() {
    return FOS.db.client;
  },
};
