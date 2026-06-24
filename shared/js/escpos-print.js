/**
 * ESC/POS 出库配送单（80mm 热敏厨房单风格）
 * 兼容汉印 TP80NY / TP80R、ZYWELL、芯烨等 LAN 9100 口
 */
window.FOS = window.FOS || {};

FOS.escpos = {
  LINE_WIDTH: 32,

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
    const w = FOS.escpos.LINE_WIDTH;
    const unit = FOS.escpos.displayWidth(char) || 1;
    const count = Math.max(8, Math.floor(w / unit));
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
    const totalUnit = FOS.escpos.sumItemUnitLabel(items);
    const title = FOS.i18n.t('出庫単', '出库单');

    const chunks = [
      FOS.escpos.init(),
      FOS.escpos.feed(1),
      FOS.escpos.separator(),
      FOS.escpos.styledLine(title, { align: 1, bold: true, size: 0x11 }),
      FOS.escpos.feed(1),
      FOS.escpos.styledLine(orderNo, { align: 1, bold: true, size: 0x11 }),
      FOS.escpos.feed(1),
      FOS.escpos.styledLine(customer, { bold: true, size: 0x10 }),
    ];

    if (phone && phone !== '—') {
      chunks.push(
        FOS.escpos.styledLine(`TEL ${phone}`, { bold: false }),
        FOS.escpos.feed(1)
      );
    }

    chunks.push(
      FOS.escpos.separator(),
      FOS.escpos.styledLine(FOS.i18n.t('配送日', '配送日期'), { bold: false }),
      FOS.escpos.lineText(deliveryDate),
      FOS.escpos.styledLine(FOS.i18n.t('配送時間', '配送时间'), { bold: false }),
      FOS.escpos.lineText(deliveryTime),
      FOS.escpos.separator()
    );

    if (address && address !== '—') {
      chunks.push(
        FOS.escpos.styledLine(FOS.i18n.t('配送先', '配送地址'), { bold: false }),
        FOS.escpos.lineText(address),
        FOS.escpos.separator()
      );
    }

    chunks.push(FOS.escpos.styledLine(FOS.i18n.t('商品明細', '商品明细'), { bold: true }));

    items.forEach((item) => {
      const name = String(item?.product_name || '').trim() || '—';
      const qtyText = FOS.escpos.formatItemQty(item);
      chunks.push(
        FOS.escpos.styledLine(name, { bold: true }),
        FOS.escpos.lineText(FOS.escpos.padLine('', qtyText)),
        FOS.escpos.feed(1)
      );
    });

    chunks.push(
      FOS.escpos.separator(),
      FOS.escpos.styledLine(
        `${FOS.i18n.t('合計', '合计')}：${totalQty}${totalUnit}`,
        { bold: true, size: 0x10 }
      ),
      FOS.escpos.separator()
    );

    if (note) {
      chunks.push(
        FOS.escpos.styledLine(FOS.i18n.t('備考', '备注'), { bold: false }),
        FOS.escpos.lineText(note),
        FOS.escpos.separator()
      );
    }

    chunks.push(
      FOS.escpos.styledLine(FOS.i18n.t('署名', '签收栏'), { bold: false }),
      FOS.escpos.lineText(`${FOS.i18n.t('署名', '签收')}：`),
      FOS.escpos.lineText('________________'),
      FOS.escpos.feed(1),
      FOS.escpos.lineText(`${FOS.i18n.t('時間', '时间')}：`),
      FOS.escpos.lineText('________________'),
      FOS.escpos.feed(2),
      FOS.escpos.cut()
    );

    return FOS.escpos.concat(...chunks);
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
    const bytes = FOS.escpos.buildOutboundSlip(order, fields);
    return {
      bytes,
      base64: FOS.escpos.bytesToBase64(bytes),
      fields,
    };
  },
};
