window.FOS = window.FOS || {};

FOS.inventory = {
  _localKey: 'stock_movements',
  _useRemote: null,

  _localAll() {
    return FOS.storage.get(FOS.inventory._localKey) || [];
  },

  _localSave(rows) {
    FOS.storage.set(FOS.inventory._localKey, rows);
  },

  async _tryRemote() {
    if (FOS.inventory._useRemote !== null) return FOS.inventory._useRemote;
    const { error } = await FOS.db.sb.from('stock_movements').select('id').limit(1);
    FOS.inventory._useRemote = !error;
    return FOS.inventory._useRemote;
  },

  async record({ productId, type, qty, note, barcode }) {
    const row = {
      id: 'loc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      product_id: productId,
      movement_type: type,
      qty: parseInt(qty, 10) || 0,
      note: note || '',
      barcode: barcode || '',
      created_by: FOS.auth.user?.id || '',
      created_at: new Date().toISOString(),
    };
    if (row.qty <= 0) throw new Error(FOS.i18n.t('数量を入力', '请输入数量'));

    if (await FOS.inventory._tryRemote()) {
      const { data, error } = await FOS.db.sb.from('stock_movements').insert({
        product_id: row.product_id,
        movement_type: row.movement_type,
        qty: row.qty,
        note: row.note,
        barcode: row.barcode,
        created_by: row.created_by,
      }).select().single();
      if (error) throw error;
      return data;
    }

    const all = FOS.inventory._localAll();
    all.unshift(row);
    FOS.inventory._localSave(all);
    return row;
  },

  async list({ month } = {}) {
    if (await FOS.inventory._tryRemote()) {
      let q = FOS.db.sb.from('stock_movements').select('*').order('created_at', { ascending: false });
      if (month) {
        const last = new Date(month.split('-')[0], month.split('-')[1], 0).getDate();
        q = q.gte('created_at', `${month}-01T00:00:00`)
          .lte('created_at', `${month}-${String(last).padStart(2, '0')}T23:59:59`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }
    let rows = FOS.inventory._localAll();
    if (month) {
      rows = rows.filter((r) => r.created_at && r.created_at.startsWith(month));
    }
    return rows;
  },

  async monthlyStats(month, products) {
    const rows = await FOS.inventory.list({ month });
    const map = {};
    (products || []).forEach((p) => {
      map[p.id] = {
        product_id: p.id,
        name: p.name,
        spec: p.spec,
        emoji: p.emoji || '📦',
        needs_processing: p.needs_processing !== false,
        in_qty: 0,
        out_qty: 0,
      };
    });
    rows.forEach((r) => {
      if (!map[r.product_id]) {
        map[r.product_id] = {
          product_id: r.product_id,
          name: r.product_id,
          spec: '',
          emoji: '📦',
          needs_processing: true,
          in_qty: 0,
          out_qty: 0,
        };
      }
      if (r.movement_type === 'in') map[r.product_id].in_qty += r.qty;
      else map[r.product_id].out_qty += r.qty;
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  },

  async findProductByBarcode(code, products) {
    const c = FOS.productCatalog.normalizeBarcode(code);
    if (!c) return null;
    const list = products || [];
    return list.find((p) => FOS.productCatalog.normalizeBarcode(p.barcode) === c) || null;
  },

  async adjustProductStock(productId, delta) {
    const { data: p } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('products').select('stock').eq('id', productId)
    ).single();
    if (!p) return;
    const stock = Math.max(0, (p.stock || 0) + delta);
    await FOS.merchants.scopeFilter(
      FOS.db.sb.from('products').update({
        stock,
        updated_at: new Date().toISOString(),
      }).eq('id', productId)
    );
  },
};
