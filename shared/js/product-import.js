/**
 * factory-system-v2 · 商品批量导入（Phase 5）
 */
window.FOS = window.FOS || {};

FOS.productImport = {
  COLUMNS: [
    { key: 'name', ja: '商品名', zh: '商品名（日文）', required: true, example: 'とうふ' },
    { key: 'name_zh', ja: '中文名', zh: '中文名', example: '豆腐' },
    { key: 'category', ja: '分類', zh: '分类', example: '野菜' },
    { key: 'spec', ja: '規格', zh: '规格', example: '300g' },
    { key: 'price', ja: '価格', zh: '价格', example: 120 },
    { key: 'tax_rate', ja: '税率', zh: '税率', example: 8 },
    { key: 'stock', ja: '在庫', zh: '库存', example: 50 },
    { key: 'barcode', ja: 'バーコード', zh: '条码', example: '4901234567890' },
    { key: 'active', ja: '公開', zh: '是否公开', example: 'はい' },
    { key: 'sort_order', ja: '並び順', zh: '排序', example: 1 },
    { key: 'image_filename', ja: '画像ファイル名', zh: '图片文件名', example: 'とうふ.jpg' },
  ],

  headerLabels() {
    const lang = FOS.i18n?.lang === 'zh' ? 'zh' : 'ja';
    return FOS.productImport.COLUMNS.map((c) => c[lang]);
  },

  headerMap() {
    const map = {};
    FOS.productImport.COLUMNS.forEach((c) => {
      map[c.ja] = c.key;
      map[c.zh] = c.key;
      map[c.key] = c.key;
    });
    map['商品名'] = 'name';
    return map;
  },

  downloadTemplate(filename) {
    if (!window.XLSX) {
      throw new Error(FOS.i18n.t('Excel ライブラリ未読込', 'Excel 库未加载'));
    }
    const headers = FOS.productImport.headerLabels();
    const example = FOS.productImport.COLUMNS.map((c) => c.example ?? '');
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = FOS.productImport.COLUMNS.map(() => ({ wch: 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'products');
    XLSX.writeFile(wb, filename || 'product-import-template.xlsx');
  },

  parseBool(value) {
    const v = String(value ?? '').trim().toLowerCase();
    if (!v) return true;
    if (['1', 'true', 'yes', 'y', 'はい', '公开', '公開', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'n', 'いいえ', '否', '非公開', 'off'].includes(v)) return false;
    return true;
  },

  parseNumber(value, fallback = 0) {
    if (value === '' || value === null || value === undefined) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  },

  normalizeRow(raw, rowIndex) {
    const map = FOS.productImport.headerMap();
    const src = {};
    Object.entries(raw || {}).forEach(([k, v]) => {
      const key = map[String(k).trim()];
      if (key) src[key] = v;
    });

    const name = String(src.name ?? '').trim();
    const row = {
      _rowIndex: rowIndex,
      name,
      name_zh: String(src.name_zh ?? '').trim(),
      category: String(src.category ?? '').trim() || '未分類',
      spec: String(src.spec ?? '').trim(),
      price: FOS.productImport.parseNumber(src.price, 0),
      tax_rate: FOS.productImport.parseNumber(src.tax_rate, 8),
      stock: Math.max(0, Math.floor(FOS.productImport.parseNumber(src.stock, 0))),
      barcode: String(src.barcode ?? '').trim(),
      active: FOS.productImport.parseBool(src.active),
      sort_order: Math.floor(FOS.productImport.parseNumber(src.sort_order, 0)),
      image_filename: String(src.image_filename ?? '').trim(),
      _imageFile: null,
      _imageUrl: '',
      _status: 'new',
      _errors: [],
      _existingId: null,
    };

    if (!name) row._errors.push(FOS.i18n.t('商品名は必須です', '商品名为必填'));
    if (row.price < 0) row._errors.push(FOS.i18n.t('価格が不正です', '价格无效'));
    if (row.tax_rate < 0 || row.tax_rate > 100) row._errors.push(FOS.i18n.t('税率が不正です', '税率无效'));

    return row;
  },

  async parseExcel(file) {
    if (!window.XLSX) throw new Error(FOS.i18n.t('Excel ライブラリ未読込', 'Excel 库未加载'));
    if (!file) throw new Error(FOS.i18n.t('Excel ファイルを選択してください', '请选择 Excel 文件'));

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error(FOS.i18n.t('シートが見つかりません', '未找到工作表'));

    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!matrix.length) throw new Error(FOS.i18n.t('データが空です', '文件无数据'));

    const headers = (matrix[0] || []).map((h) => String(h).trim());
    const rows = [];
    for (let i = 1; i < matrix.length; i++) {
      const line = matrix[i] || [];
      if (!line.some((cell) => String(cell).trim())) continue;
      const raw = {};
      headers.forEach((h, idx) => {
        if (h) raw[h] = line[idx];
      });
      rows.push(FOS.productImport.normalizeRow(raw, i + 1));
    }

    if (!rows.length) throw new Error(FOS.i18n.t('有効な行がありません', '没有有效数据行'));
    return rows;
  },

  imageMatchKey(name) {
    return String(name || '')
      .trim()
      .replace(/\.[^.]+$/, '')
      .toLowerCase();
  },

  attachImages(rows, imageFiles) {
    const fileMap = {};
    (imageFiles || []).forEach((file) => {
      fileMap[FOS.productImport.imageMatchKey(file.name)] = file;
    });

    rows.forEach((row) => {
      const keys = [];
      if (row.image_filename) keys.push(FOS.productImport.imageMatchKey(row.image_filename));
      keys.push(FOS.productImport.imageMatchKey(row.name));
      if (row.name_zh) keys.push(FOS.productImport.imageMatchKey(row.name_zh));

      let matched = null;
      for (const k of keys) {
        if (k && fileMap[k]) {
          matched = fileMap[k];
          break;
        }
      }
      row._imageFile = matched;
    });
    return rows;
  },

  async loadExistingProducts(merchantId) {
    let query = FOS.db.sb.from('products').select('id, name, merchant_id');
    if (merchantId) query = query.eq('merchant_id', merchantId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const byName = new Map();
    (data || []).forEach((p) => {
      const key = String(p.name || '').trim();
      if (key) byName.set(key, p);
    });
    return byName;
  },

  buildPreview(rows, existingByName) {
    return rows.map((row) => {
      const existing = existingByName.get(row.name);
      if (row._errors.length) {
        row._status = 'error';
      } else if (existing) {
        row._status = 'duplicate';
        row._existingId = existing.id;
      } else {
        row._status = 'new';
      }
      return row;
    });
  },

  toPayload(row, merchantId) {
    return {
      name: row.name,
      name_zh: row.name_zh || null,
      category: row.category || '未分類',
      spec: row.spec || '',
      price: row.price,
      tax_rate: row.tax_rate,
      stock: row.stock,
      active: row.active,
      sort_order: row.sort_order,
      emoji: '📦',
      barcode: row.barcode || null,
      image_url: row._imageUrl || null,
      merchant_id: merchantId,
      updated_at: new Date().toISOString(),
    };
  },

  trimOptionalFields(payload, sampleProduct) {
    const out = { ...payload };
    if (sampleProduct && !('image_url' in sampleProduct)) delete out.image_url;
    if (sampleProduct && !('barcode' in sampleProduct)) delete out.barcode;
    return out;
  },

  async runImport({ rows, merchantId, overwriteIds, sampleProduct, onProgress }) {
    const result = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    const overwriteSet = new Set(overwriteIds || []);
    const newRows = rows.filter((r) => r._status === 'new' && !r._errors.length);
    if (newRows.length) {
      await FOS.merchants.assertCanAddProduct(newRows.length);
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      onProgress?.(i + 1, rows.length, row.name);

      if (row._errors.length) {
        result.skipped++;
        continue;
      }

      if (row._status === 'duplicate') {
        if (!overwriteSet.has(row._existingId)) {
          result.skipped++;
          continue;
        }
      }

      try {
        if (row._imageFile && FOS.media?.uploadProductImage) {
          row._imageUrl = await FOS.media.uploadProductImage(row._imageFile);
        }

        let payload = FOS.productImport.toPayload(row, merchantId);
        payload = FOS.productImport.trimOptionalFields(payload, sampleProduct);
        if (row._imageUrl) payload.image_url = row._imageUrl;
        else delete payload.image_url;
        if (!row.barcode) delete payload.barcode;

        if (row._status === 'duplicate' && row._existingId) {
          const { error } = await FOS.db.sb
            .from('products')
            .update(payload)
            .eq('id', row._existingId);
          if (error) throw error;
          result.updated++;
        } else {
          payload.created_at = new Date().toISOString();
          const { error } = await FOS.db.sb.from('products').insert(payload);
          if (error) throw error;
          result.created++;
        }
      } catch (e) {
        result.failed++;
        result.errors.push({
          row: row._rowIndex,
          name: row.name,
          message: e.message || String(e),
        });
      }
    }

    return result;
  },

  statusLabel(status) {
    const map = {
      new: FOS.i18n.t('新規', '新增'),
      duplicate: FOS.i18n.t('上書き待ち', '待覆盖'),
      error: FOS.i18n.t('エラー', '错误'),
    };
    return map[status] || status;
  },

  statusBadgeClass(status) {
    if (status === 'new') return 'badge--green';
    if (status === 'duplicate') return 'badge--orange';
    return 'badge--red';
  },
};
