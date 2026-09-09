window.FOS = window.FOS || {};

FOS.paycloudSettings = {
  defaults() {
    return {
      enabled: false,
      wechatEnabled: true,
      alipayEnabled: true,
      merchantNo: '',
      storeNo: '',
      appId: '',
      gatewayRsaPublicKey: '',
      appRsaPublicKey: '',
      privateKeyRef: '',
      hasPrivateKey: false,
    };
  },

  storageKey() {
    return `paycloud_settings_${FOS.merchants.scopeId()}`;
  },

  normalize(raw) {
    const cfg = { ...this.defaults(), ...(raw || {}) };
    cfg.enabled = !!cfg.enabled;
    cfg.wechatEnabled = cfg.wechatEnabled !== false;
    cfg.alipayEnabled = cfg.alipayEnabled !== false;
    cfg.merchantNo = String(cfg.merchantNo || cfg.merchant_no || '').trim();
    cfg.storeNo = String(cfg.storeNo || cfg.store_no || '').trim();
    cfg.appId = String(cfg.appId || cfg.app_id || '').trim();
    cfg.gatewayRsaPublicKey = String(cfg.gatewayRsaPublicKey || cfg.gateway_rsa_public_key || '').trim();
    cfg.appRsaPublicKey = String(cfg.appRsaPublicKey || cfg.app_rsa_public_key || '').trim();
    cfg.privateKeyRef = String(cfg.privateKeyRef || cfg.private_key_ref || '').trim();
    cfg.hasPrivateKey = !!cfg.hasPrivateKey || !!cfg.has_private_key || !!cfg.privateKeyRef;
    return cfg;
  },

  async load() {
    const key = this.storageKey();
    try {
      const { data } = await FOS.db.sb
        .from('settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (data?.value) {
        const value = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        this._cache = this.normalize(value);
        return this._cache;
      }
    } catch {
      /* fallback */
    }
    const local = FOS.storage.get(key);
    this._cache = this.normalize(local);
    return this._cache;
  },

  async save(raw) {
    const cfg = this.normalize(raw);
    const key = this.storageKey();
    const value = JSON.stringify(cfg);
    try {
      await FOS.db.sb.from('settings').upsert({
        key,
        value,
        updated_at: new Date().toISOString(),
      });
    } catch {
      FOS.storage.set(key, cfg);
    }
    this._cache = cfg;
    return cfg;
  },

  isReady(cfg) {
    const c = this.normalize(cfg || this._cache);
    return !!c.enabled && !!c.merchantNo && !!c.storeNo && !!c.appId && !!c.gatewayRsaPublicKey && !!c.privateKeyRef;
  },
};
