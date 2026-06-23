window.FOS = window.FOS || {};

FOS.cutoff = {
  time: FOS.CONFIG.DEFAULT_CUTOFF,

  async load() {
    try {
      const { data } = await FOS.db.sb
        .from('settings')
        .select('value')
        .eq('key', 'cutoff_time')
        .single();
      if (data?.value) FOS.cutoff.time = data.value;
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
    await FOS.db.sb.from('settings').upsert({
      key: 'cutoff_time',
      value,
      updated_at: new Date().toISOString(),
    });
    FOS.cutoff.time = value;
    return value;
  },
};
