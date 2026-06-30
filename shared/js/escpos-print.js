/**
 * ESC/POS 出库配送单（80mm 热敏厨房单风格）
 * 兼容汉印 TP80NY / TP80R、ZYWELL、芯烨等 LAN 9100 口
 */
window.FOS = window.FOS || {};

FOS.escpos = {
  LINE_WIDTH: 48,

  bytesFromBase64(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  },

  bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  },

  concat(...parts) {
    const chunks = parts.filter(Boolean).map((p) => {
      if (p instanceof Uint8Array) return p;
      if (Array.isArray(p)) return Uint8Array.from(p);
      return FOS.escpos.textBytes(String(p));
    });
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((c) => {
      out.set(c, offset);
      offset += c.length;
    });
    return out;
  },

  textBytes(text) {
    const str = String(text ?? '');
    if (window.NjfAndroid?.textToGbkBase64) {
      return FOS.escpos.bytesFromBase64(window.NjfAndroid.textToGbkBase64(str));
    }
    return new TextEncoder().encode(str);
  },

  cmd(...bytes) {
    return Uint8Array.from(bytes);
  },

  init() {
    return FOS.escpos.concat(
      FOS.escpos.cmd(0x1B, 0x40),
      FOS.escpos.cmd(0x1C, 0x26)
    );
  },

  align(mode) {
    return FOS.escpos.cmd(0x1B, 0x61, mode);
  },

  bold(on) {
    return FOS.escpos.cmd(0x1B, 0x45, on ? 1 : 0);
  },

  size(mode) {
    return FOS.escpos.cmd(0x1D, 0x21, mode);
  },

  feed(lines = 1) {
    const n = Math.max(1, lines | 0);
    return Uint8Array.from(Array(n).fill(0x0A));
  },

  cut() {
    return FOS.escpos.cmd(0x1D, 0x56, 0x42, 0x00);
  },

  displayWidth(str) {
    let w = 0;
    for (const ch of String(str || '')) {
      const code = ch.codePointAt(0) || 0;
      w += code > 0xFF ? 2 : 1;
    }
    return w;
  },

  padLine(left, right, width) {
    const lineWidth = width || FOS.escpos.LINE_WIDTH;
    const l = String(left || '');
    const r = String(right || '');
    const gap = Math.max(1, lineWidth - FOS.escpos.displayWidth(l) - FOS.escpos.displayWidth(r));
    return l + ' '.repeat(gap) + r;
  },

  lineText(text) {
    return FOS.escpos.concat(FOS.escpos.textBytes(text), FOS.escpos.feed(1));
  },

  separator(char = '─') {
    const unit = FOS.escpos.displayWidth(char) || 1;
    const usable = FOS.escpos.LINE_WIDTH - 2;
    const count = Math.max(8, Math.floor(usable / unit));
    return FOS.escpos.lineText(String(char).repeat(count));
  },

  styledLine(text, { align = 0, bold = false, size = 0x00 } = {}) {
    return FOS.escpos.concat(
      FOS.escpos.align(align),
      FOS.escpos.bold(bold),
      FOS.escpos.size(size),
      FOS.escpos.lineText(text),
      FOS.escpos.bold(false),
      FOS.escpos.size(0x00),
      FOS.escpos.align(0)
    );
  },

  formatOrderNo(order) {
    const no = order?.order_no ?? order?.public_order_code ?? '';
    const s = String(no).trim();
    if (!s) return '#—';
    return s.startsWith('#') ? s : `#${s}`;
  },

  formatDeliveryDate(order) {
    return order?.delivery_preferred_date || order?.order_date || '—';
  },

  formatDeliveryTime(order) {
    if (!order) return '—';
    const parts = [];
    if (order.delivery_preferred_slot && order.delivery_preferred_slot !== 'unspecified') {
      parts.push(FOS.publicOrder?.slotLabel?.(order.delivery_preferred_slot) || order.delivery_preferred_slot);
    }
    if (order.delivery_time_note) parts.push(order.delivery_time_note);
    return parts.length ? parts.join(' ') : '—';
  },

  formatItemQty(item) {
    const qty = FOS.orders.deliveredQty(item);
    const unit = String(item?.product_spec || '').trim() || FOS.i18n.t('個', '个');
    return `${qty}${unit}`;
  },

  nameWithSpec(item) {
    const name = String(item?.product_name || '').trim() || '—';
    const spec = String(item?.product_spec || '').trim();
    return spec ? `${name} ${spec}` : name;
  },

  formatItemCount(item) {
    return String(FOS.orders.deliveredQty(item));
  },

  sumItemQty(items) {
    return (items || []).reduce((sum, item) => sum + FOS.orders.deliveredQty(item), 0);
  },

  sumItemUnitLabel(items) {
    const units = new Set(
      (items || [])
        .map((item) => String(item?.product_spec || '').trim())
        .filter(Boolean)
    );
    if (units.size === 1) return [...units][0];
    return FOS.i18n.t('個', '个');
  },

  spacedTitle(text) {
    return String(text || '').split('').join('\u3000');
  },

  infoRow(label, value) {
    return FOS.escpos.lineText(FOS.escpos.padLine(String(label || ''), String(value || '')));
  },

  tableRow(name, qty, { bold = false } = {}) {
    const n = String(name || '').trim() || '—';
    const q = String(qty || '').trim();
    const fits = FOS.escpos.displayWidth(n) + FOS.escpos.displayWidth(q) + 2 <= FOS.escpos.LINE_WIDTH;
    if (fits) {
      return FOS.escpos.styledLine(FOS.escpos.padLine(n, q), { bold });
    }
    return FOS.escpos.concat(
      FOS.escpos.styledLine(n, { bold }),
      FOS.escpos.lineText(FOS.escpos.padLine('', q))
    );
  },

  buildOutboundSlip(order, fields = {}) {
    const items = (order?.order_items || []).slice();
    const orderNo = FOS.escpos.formatOrderNo(order);
    const customer = fields.customerName || order?.customer_name || order?.shop_name || '—';
    const phone = fields.phone || '—';
    const address = fields.address || '—';
    const deliveryDate = FOS.escpos.formatDeliveryDate(order);
    const deliveryTime = FOS.escpos.formatDeliveryTime(order);
    const note = String(order?.note || order?.factory_note || '').trim();
    const totalQty = FOS.escpos.sumItemQty(items);
    const factory = fields.factory || {};

    const chunks = [
      FOS.escpos.init(),
      FOS.escpos.feed(1),
      FOS.escpos.styledLine(FOS.escpos.spacedTitle(FOS.i18n.t('納品書', '出库单')), { align: 1, bold: true, size: 0x11 }),
      FOS.escpos.feed(1),
      FOS.escpos.styledLine(FOS.i18n.t('下記の通り納品いたします', '配送明细如下'), { align: 1 }),
      FOS.escpos.separator(),
      FOS.escpos.infoRow(FOS.i18n.t('伝票No.', '单号'), orderNo),
      FOS.escpos.infoRow(FOS.i18n.t('納品日', '配送日'), deliveryDate),
    ];

    if (deliveryTime && deliveryTime !== '—') {
      chunks.push(FOS.escpos.infoRow(FOS.i18n.t('配送時間', '配送时间'), deliveryTime));
    }

    chunks.push(FOS.escpos.separator());
    chunks.push(FOS.escpos.styledLine(`${customer}\u3000${FOS.i18n.t('御中', '')}`.trim(), { bold: true, size: 0x11 }));
    if (address && address !== '—') chunks.push(FOS.escpos.lineText(address));
    if (phone && phone !== '—') chunks.push(FOS.escpos.lineText(`TEL ${phone}`));
    chunks.push(FOS.escpos.separator());

    chunks.push(
      FOS.escpos.lineText(FOS.escpos.padLine(FOS.i18n.t('品名', '品名'), FOS.i18n.t('数量', '数量'))),
      FOS.escpos.separator()
    );

    items.forEach((item) => {
      chunks.push(
        FOS.escpos.tableRow(
          FOS.escpos.nameWithSpec(item),
          FOS.escpos.formatItemCount(item),
          { bold: true }
        )
      );
    });

    chunks.push(
      FOS.escpos.separator(),
      FOS.escpos.styledLine(
        FOS.escpos.padLine(FOS.i18n.t('合計数量', '合计数量'), `${totalQty}`),
        { bold: true, size: 0x10 }
      ),
      FOS.escpos.separator()
    );

    if (note) {
      chunks.push(
        FOS.escpos.styledLine(FOS.i18n.t('備考', '备注'), { bold: true }),
        FOS.escpos.lineText(note),
        FOS.escpos.separator()
      );
    }

    if (factory.name || factory.address || factory.tel) {
      chunks.push(FOS.escpos.feed(1));
      if (factory.name) chunks.push(FOS.escpos.styledLine(factory.name, { bold: true }));
      if (factory.address) {
        const zip = factory.zip ? `〒${factory.zip} ` : '';
        chunks.push(FOS.escpos.lineText(`${zip}${factory.address}`));
      }
      if (factory.tel) chunks.push(FOS.escpos.lineText(`TEL ${factory.tel}`));
    }

    chunks.push(FOS.escpos.feed(3), FOS.escpos.cut());

    return FOS.escpos.concat(...chunks);
  },

  async resolveFactoryInfo() {
    try {
      if (FOS.invoiceSettings?.load) {
        const inv = await FOS.invoiceSettings.load();
        const name = String(inv?.companyName || '').trim();
        const address = String(inv?.address || '').trim();
        const tel = String(inv?.tel || '').trim();
        const zip = String(inv?.zip || '').trim();
        if (name || address || tel) return { name, address, tel, zip };
      }
    } catch {
      /* ignore */
    }
    try {
      const merchant = await FOS.merchants.getById(FOS.merchants.scopeId());
      return { name: String(merchant?.name || '').trim(), address: '', tel: '', zip: '' };
    } catch {
      return { name: '', address: '', tel: '', zip: '' };
    }
  },

  async resolvePrintFields(order) {
    let phone = String(order?.customer_phone || '').trim();
    let address = String(order?.customer_address || '').trim();
    const customerName = String(order?.customer_name || order?.shop_name || '').trim();

    if (order?.shop_id && (!phone || !address)) {
      try {
        const { data: shop } = await FOS.db.sb
          .from('users')
          .select('phone, address, name')
          .eq('id', order.shop_id)
          .maybeSingle();
        if (!phone) phone = String(shop?.phone || '').trim();
        if (!address) address = String(shop?.address || '').trim();
      } catch {
        /* ignore */
      }
    }

    return {
      customerName: customerName || '—',
      phone: phone || '—',
      address: address || '—',
    };
  },

  async buildOutboundPayload(order) {
    const fields = await FOS.escpos.resolvePrintFields(order);
    fields.factory = await FOS.escpos.resolveFactoryInfo();
    const bytes = FOS.escpos.buildOutboundSlip(order, fields);
    return {
      bytes,
      base64: FOS.escpos.bytesToBase64(bytes),
      fields,
    };
  },
};
