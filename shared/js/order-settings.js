window.FOS = window.FOS || {};

FOS.orderSettings = {
  displayName: '',
  notice: '',

  async load() {
    const mid = FOS.merchants.scopeId();
    try {
      const merchant = await FOS.merchants.getById(mid);
      this.displayName = (merchant?.name || '').trim();
    } catch {
      this.displayName = '';
    }
    try {
      const { data } = await FOS.db.sb
        .from('settings')
        .select('value')
        .eq('key', 'order_notice')
        .maybeSingle();
      this.notice = (data?.value || '').trim();
    } catch {
      this.notice = '';
    }
    return this;
  },

  async saveNotice(text) {
    const value = String(text || '').trim();
    await FOS.db.sb.from('settings').upsert({
      key: 'order_notice',
      value,
      updated_at: new Date().toISOString(),
    });
    this.notice = value;
    return value;
  },

  async saveDisplayName(name) {
    const mid = FOS.merchants.scopeId();
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      throw new Error(FOS.i18n.t('名称を入力してください', '请输入名称'));
    }
    const current = await FOS.merchants.getById(mid);
    await FOS.merchants.update(mid, { ...current, name: trimmed });
    this.displayName = trimmed;
    delete FOS.merchants._cache[mid];
    return trimmed;
  },
};
