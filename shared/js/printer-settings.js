window.FOS = window.FOS || {};

FOS.printerSettings = {
  defaults() {
    return {
      enabled: false,
      type: 'cloud',
      ip: '',
      port: 9100,
      copies: 1,
      userKey: '',
      userSecret: '',
      equipmentSn: '',
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
    cfg.type = ['lan', 'cloud', 'usb', 'bluetooth'].includes(cfg.type) ? cfg.type : 'cloud';
    cfg.ip = String(cfg.ip || '').trim();
    let port = parseInt(cfg.port, 10);
    if (!Number.isFinite(port) || port <= 0) port = 9100;
    cfg.port = port;
    let copies = parseInt(cfg.copies, 10);
    if (![1, 2, 3].includes(copies)) copies = 1;
    cfg.copies = copies;
    cfg.userKey = String(cfg.userKey || '').trim();
    cfg.userSecret = String(cfg.userSecret || '').trim();
    cfg.equipmentSn = String(cfg.equipmentSn || cfg.equipment_sn || '').trim();
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

  isCloudReady(cfg) {
    const c = cfg || this._cache || this.defaults();
    return !!c.enabled && c.type === 'cloud' && !!c.userKey && !!c.userSecret && !!c.equipmentSn;
  },

  isReady(cfg) {
    const c = cfg || this._cache || this.defaults();
    if (!c.enabled) return false;
    if (c.type === 'cloud') return FOS.printerSettings.isCloudReady(c);
    if (c.type === 'lan') return FOS.printerSettings.isLanReady(c);
    return false;
  },

  deviceLabel(cfg) {
    const c = cfg || this._cache || this.defaults();
    if (c.type === 'cloud') return `Cloud ${c.equipmentSn || '—'}`;
    if (c.type === 'lan') return `LAN ${c.ip}:${c.port || 9100}`;
    if (c.type === 'usb') return 'USB';
    if (c.type === 'bluetooth') return FOS.i18n.t('Bluetooth', '蓝牙');
    return '—';
  },
};
