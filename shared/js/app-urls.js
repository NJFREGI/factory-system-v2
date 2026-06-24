/**
 * 公网 H5 基址（二维码 / 分享链接）
 * 优先使用 config.js 中的 PUBLIC_APP_BASE_URL（部署配置），商家无需手动填写。
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

  isInvalidPublicBase(url) {
    const u = String(url || '').trim().toLowerCase();
    if (!u) return true;
    if (u.includes('localhost') || u.includes('127.0.0.1')) return true;
    if (u.startsWith('capacitor://') || u.startsWith('ionic://') || u.startsWith('file://')) return true;
    try {
      const host = new URL(u.startsWith('http') ? u : `https://${u}`).hostname.toLowerCase();
      return host === 'localhost' || host === '127.0.0.1';
    } catch {
      return true;
    }
  },

  pathRoot(loc = location) {
    const path = loc.pathname || '';
    const idx = path.indexOf('/apps/');
    return idx >= 0 ? path.slice(0, idx) : '';
  },

  configBase() {
    const raw = FOS.config?.publicAppBaseUrl?.()
      || FOS.CONFIG?.PUBLIC_APP_BASE_URL
      || FOS.CONFIG?.public_h5_base_url
      || window.FOS_CONFIG?.PUBLIC_APP_BASE_URL
      || window.FOS_CONFIG?.public_h5_base_url
      || '';
    return FOS.appUrls.normalizeBase(raw);
  },

  normalizeBase(url) {
    const value = String(url || '').trim().replace(/\/+$/, '');
    return FOS.appUrls.isInvalidPublicBase(value) ? '' : value;
  },

  async loadPublicBase() {
    const fromConfig = FOS.appUrls.configBase();
    if (fromConfig) {
      FOS.appUrls._cachedPublicBase = fromConfig;
      return fromConfig;
    }
    FOS.appUrls._cachedPublicBase = '';
    return '';
  },

  publicBase(loc = location) {
    const fromConfig = FOS.appUrls.configBase();
    if (fromConfig) return fromConfig;

    const configured = FOS.appUrls.normalizeBase(FOS.appUrls._cachedPublicBase || '');
    if (configured) return configured;

    if (!FOS.appUrls.isLocalOrigin(loc.origin)) {
      return FOS.appUrls.normalizeBase(`${loc.origin}${FOS.appUrls.pathRoot(loc)}`);
    }
    return '';
  },

  requirePublicBase() {
    const base = FOS.config?.publicAppBaseUrl?.() || FOS.appUrls.publicBase();
    if (base) return base;
    const msg = FOS.i18n.t(
      '顧客注文URLが未設定です。管理者に連絡してください。',
      '顾客下单链接未配置，请联系系统管理员。',
    );
    FOS.ui?.toast?.(msg, 'error');
    return '';
  },
};
