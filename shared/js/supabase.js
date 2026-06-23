window.FOS = window.FOS || {};

FOS.db = {
  client: null,

  async init(url, key) {
    const u = url || FOS.storage.get('sbUrl') || FOS.CONFIG.SUPABASE_URL;
    const k = key || FOS.storage.get('sbKey') || FOS.CONFIG.SUPABASE_KEY;
    if (!u || !k) throw new Error('Supabase URL / Key missing');
    FOS.storage.set('sbUrl', u);
    FOS.storage.set('sbKey', k);
    FOS.db.client = supabase.createClient(u, k);
    return FOS.db.client;
  },

  get sb() {
    return FOS.db.client;
  },
};
