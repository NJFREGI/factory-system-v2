/**
 * factory-system-v2 · 全平台公用商品库（按条码匹配）
 * 任意商家已录入过的条码，可供其他商家新增时自动填入参考信息
 */
window.FOS = window.FOS || {};

FOS.productCatalog = {
  normalizeBarcode(code) {
    return String(code || '').trim().replace(/\s/g, '');
  },

  async lookup(barcode) {
    const code = FOS.productCatalog.normalizeBarcode(barcode);
    if (!code) return null;

    const { data, error } = await FOS.db.sb
      .from('products')
      .select(
        'id, name, name_zh, category, spec, price, tax_rate, barcode, image_url, needs_processing, emoji, merchant_id, updated_at'
      )
      .eq('barcode', code)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) throw new Error(error.message);
    return data?.[0] || null;
  },

  toFormDefaults(product) {
    if (!product) return null;
    return {
      name: product.name || '',
      name_zh: product.name_zh || '',
      category: product.category || '未分類',
      spec: product.spec || '',
      price: Number(product.price) || 0,
      tax_rate: Number.isFinite(Number(product.tax_rate)) ? Number(product.tax_rate) : 8,
      barcode: FOS.productCatalog.normalizeBarcode(product.barcode),
      image_url: product.image_url || '',
      needs_processing: product.needs_processing !== false,
      emoji: product.emoji || '📦',
      merchant_id: product.merchant_id || null,
    };
  },
};
