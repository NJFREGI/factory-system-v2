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
      const keys = [...new Set([this.noticeKey(), 'order_notice'])];
      const { data } = await FOS.db.sb
        .from('settings')
        .select('key, value')
        .in('key', keys);
      const row = (data || []).find((r) => r.key === keys[0]) || (data || []).find((r) => r.key === 'order_notice');
      this.notice = (row?.value || '').trim();
    } catch {
      this.notice = '';
    }
    return this;
  },

  /** 每个商家独立的门店公告；没有时沿用旧的全局公告 */
  noticeKey() {
    const mid = FOS.merchants.scopeId();
    return mid ? `order_notice_${mid}` : 'order_notice';
  },

  async saveNotice(text) {
    const value = String(text || '').trim();
    const { error } = await FOS.db.sb.from('settings').upsert({
      key: this.noticeKey(),
      value,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    this.notice = value;
    return value;
  },

  async saveDisplayName(name) {
    const mid = FOS.merchants.scopeId();
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      throw new Error(FOS.i18n.t('名称を入力してください', '请输入名称'));
    }
    // 工厂端只能改显示名称；套餐、配额等由总后台管理
    const { error } = await FOS.db.sb.rpc('fos_set_merchant_display_name', { p_name: trimmed });
    if (error) throw new Error(FOS.auth.errorMessage(error));
    this.displayName = trimmed;
    delete FOS.merchants._cache[mid];
    return trimmed;
  },
};
