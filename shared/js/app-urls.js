/**
 * 公网 H5 基址（二维码 / 分享链接）
 * 管理端 APK 内 location.origin 为 localhost，须配置可外网访问的域名。
 */
window.FOS = window.FOS || {};

FOS.appUrls = {
  _cachedPublicBase: '',

  isLocalOrigin(origin = location.origin) {
    const o = String(origin || '').toLowerCase();
    return !o
      || o.includes('localhost')
      || o.includes('127.0.0.1')
      || o.startsWith('capacitor://')
      || o.startsWith('ionic://')
      || o.startsWith('file://');
  },

  pathRoot(loc = location) {
    const path = loc.pathname || '';
    const idx = path.indexOf('/apps/');
    return idx >= 0 ? path.slice(0, idx) : '';
  },

  settingsKey(merchantId) {
    const mid = merchantId || FOS.merchants?.scopeId?.() || FOS.CONFIG.DEFAULT_MERCHANT_ID;
    return `public_h5_base_url_${mid}`;
  },

  normalizeBase(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  },

  async loadPublicBase() {
    const fallback = FOS.appUrls.normalizeBase(FOS.CONFIG.PUBLIC_APP_BASE_URL || '');
    try {
      const { data } = await FOS.db.sb
        .from('settings')
        .select('value')
        .eq('key', FOS.appUrls.settingsKey())
        .maybeSingle();
      FOS.appUrls._cachedPublicBase = FOS.appUrls.normalizeBase(data?.value || fallback);
    } catch {
      FOS.appUrls._cachedPublicBase = fallback;
    }
    return FOS.appUrls._cachedPublicBase;
  },

  publicBase(loc = location) {
    const configured = FOS.appUrls.normalizeBase(
      FOS.appUrls._cachedPublicBase || FOS.CONFIG.PUBLIC_APP_BASE_URL || '',
    );
    if (configured) return configured;
    if (!FOS.appUrls.isLocalOrigin(loc.origin)) {
      return FOS.appUrls.normalizeBase(`${loc.origin}${FOS.appUrls.pathRoot(loc)}`);
    }
    return '';
  },

  async savePublicBase(url) {
    const value = FOS.appUrls.normalizeBase(url);
    await FOS.db.sb.from('settings').upsert({
      key: FOS.appUrls.settingsKey(),
      value,
      updated_at: new Date().toISOString(),
    });
    FOS.appUrls._cachedPublicBase = value;
    return value;
  },

  requirePublicBase() {
    const base = FOS.appUrls.publicBase();
    if (base) return base;
    const msg = FOS.i18n.t(
      '設定で「顧客注文リンク」を入力してください（例：https://your-domain.com）',
      '请先在设置中填写「顾客下单链接」域名（例：https://your-domain.com）',
    );
    FOS.ui?.toast?.(msg, 'error');
    return '';
  },
};
