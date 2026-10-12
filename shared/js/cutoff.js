window.FOS = window.FOS || {};

FOS.cutoff = {
  time: FOS.CONFIG.DEFAULT_CUTOFF,

  /** 每个商家独立的截单时间；没有时沿用旧的全局设置 */
  key() {
    const mid = FOS.merchants?.scopeId?.();
    return mid ? `cutoff_time_${mid}` : 'cutoff_time';
  },

  async load() {
    try {
      const keys = [...new Set([FOS.cutoff.key(), 'cutoff_time'])];
      const { data } = await FOS.db.sb
        .from('settings')
        .select('key, value')
        .in('key', keys);
      const row = (data || []).find((r) => r.key === keys[0]) || (data || []).find((r) => r.key === 'cutoff_time');
      if (row?.value) FOS.cutoff.time = row.value;
    } catch {
      /* settings row may not exist */
    }
    return FOS.cutoff.time;
  },

  getOrderDate() {
    const now = new Date();
    const [h, m] = FOS.cutoff.time.split(':').map(Number);
    const passed = now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
    if (passed) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    return now.toISOString().slice(0, 10);
  },

  isPassed() {
    const now = new Date();
    const [h, m] = FOS.cutoff.time.split(':').map(Number);
    return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
  },

  async save(time) {
    const value = String(time || FOS.CONFIG.DEFAULT_CUTOFF).trim();
    const { error } = await FOS.db.sb.from('settings').upsert({
      key: FOS.cutoff.key(),
      value,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    FOS.cutoff.time = value;
    return value;
  },
};
