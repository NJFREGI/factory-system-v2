window.FOS = window.FOS || {};

FOS.printerSettings = {
  defaults() {
    return {
      enabled: false,
      type: 'lan',
      ip: '',
      port: 9100,
      copies: 1,
    };
  },

  storageKey() {
    return `printer_settings_${FOS.merchants.scopeId()}`;
  },

  async load() {
    const mid = FOS.merchants.scopeId();
    const key = `printer_settings_${mid}`;
    try {
      const { data } = await FOS.db.sb
        .from('settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
      if (data?.value) {
        this._cache = { ...this.defaults(), ...JSON.parse(data.value) };
        return this._cache;
      }
    } catch {
      /* fallback */
    }
    const local = FOS.storage.get(this.storageKey());
    this._cache = { ...this.defaults(), ...(local || {}) };
    return this._cache;
  },

  normalize(raw) {
    const base = this.defaults();
    const cfg = { ...base, ...(raw || {}) };
    cfg.enabled = !!cfg.enabled;
    cfg.type = ['lan', 'usb', 'bluetooth'].includes(cfg.type) ? cfg.type : 'lan';
    cfg.ip = String(cfg.ip || '').trim();
    let port = parseInt(cfg.port, 10);
    if (!Number.isFinite(port) || port <= 0) port = 9100;
    cfg.port = port;
    let copies = parseInt(cfg.copies, 10);
    if (![1, 2, 3].includes(copies)) copies = 1;
    cfg.copies = copies;
    return cfg;
  },

  async save(raw) {
    const cfg = this.normalize(raw);
    const mid = FOS.merchants.scopeId();
    const key = `printer_settings_${mid}`;
    const value = JSON.stringify(cfg);
    try {
      await FOS.db.sb.from('settings').upsert({
        key,
        value,
        updated_at: new Date().toISOString(),
      });
    } catch {
      FOS.storage.set(this.storageKey(), cfg);
    }
    this._cache = cfg;
    return cfg;
  },

  isLanReady(cfg) {
    const c = cfg || this._cache || this.defaults();
    return !!c.enabled && c.type === 'lan' && !!c.ip;
  },

  deviceLabel(cfg) {
    const c = cfg || this._cache || this.defaults();
    if (c.type === 'lan') return `LAN ${c.ip}:${c.port || 9100}`;
    if (c.type === 'usb') return 'USB';
    if (c.type === 'bluetooth') return FOS.i18n.t('Bluetooth', '蓝牙');
    return '—';
  },
};
