/**
 * ESC/POS 出库配送单（80mm 热敏）
 * 兼容汉印 TP80NY / TP80R、ZYWELL、芯烨 LAN 及汉印云 ESC 标记
 */
window.FOS = window.FOS || {};

FOS.escpos = {
  LINE_WIDTH: 46,

  /** 80mm 安全打印区：左右各留 1 字符边距，46×12=552 dots */
  SLIP_LAYOUT: {
    LINE_CHARS: 46,
    DOTS_PER_CHAR: 12,
    PRINTABLE_DOTS: 552,
    RIGHT_EDGE_CHARS: 46,
    NAME_COL_CHARS: 40,
    QTY_COL_CHARS: 6,
  },

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

  // GBK printer fonts lack halfwidth kana and U+00A5. Normalize before
  // measuring/wrapping; normalize whole kana runs so voiced marks stay attached.
  printableText(text) {
    return String(text ?? '')
      .replace(/[\uFF61-\uFF9F]+/g, (run) => run.normalize('NFKC'))
      .replace(/\u3099/g, '\u309B')
      .replace(/\u309A/g, '\u309C')
      .replace(/\u00A5/g, '\uFFE5');
  },

  textBytes(text) {
    const str = FOS.escpos.printableText(text);
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
    const n = Math.max(0, lines | 0);
    if (n === 0) return new Uint8Array(0);
    return Uint8Array.from(Array(n).fill(0x0A));
  },

  /** ESC 3 n — 缩小行距（商品明细区用） */
  setLineSpacing(dots = 24) {
    return FOS.escpos.cmd(0x1B, 0x33, Math.max(0, Math.min(255, dots | 0)));
  },

  resetLineSpacing() {
    return FOS.escpos.cmd(0x1B, 0x32);
  },

  cut() {
    return FOS.escpos.cmd(0x1D, 0x56, 0x42, 0x00);
  },

  displayWidth(str) {
    let w = 0;
    for (const ch of FOS.escpos.printableText(str)) {
      const code = ch.codePointAt(0) || 0;
      w += code > 0xff ? 2 : 1;
    }
    return w;
  },

  wrapDisplayWidth(str, maxWidth) {
    const max = Math.max(4, maxWidth | 0);
    const text = FOS.escpos.printableText(str);
    if (!text) return [''];
    const lines = [];
    let cur = '';
    let curW = 0;
    for (const ch of text) {
      const cw = FOS.escpos.displayWidth(ch);
      if (cur && curW + cw > max) {
        lines.push(cur);
        cur = ch;
        curW = cw;
      } else {
        cur += ch;
        curW += cw;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  },

  padTwoCol(left, right, lineWidth) {
    const lw = lineWidth || FOS.escpos.LINE_WIDTH;
    const l = FOS.escpos.printableText(left);
    const r = FOS.escpos.printableText(right);
    const gap = Math.max(1, lw - FOS.escpos.displayWidth(l) - FOS.escpos.displayWidth(r));
    return l + ' '.repeat(gap) + r;
  },

  itemTwoColRows(name, qty, lineWidth) {
    const spec = FOS.escpos.SLIP_LAYOUT;
    const nameMax = lineWidth
      ? Math.max(4, (lineWidth | 0) - spec.QTY_COL_CHARS)
      : spec.NAME_COL_CHARS;
    const q = String(qty ?? '');
    const parts = FOS.escpos.wrapDisplayWidth(String(name || '').trim() || '—', nameMax);
    return parts.map((part, i) => ({ part, qty: i === 0 ? q : '', isFirst: i === 0 }));
  },

  /** ESC $ 横向绝对位置（dots，203dpi / 80mm） */
  horizontalPosDots(dots) {
    const n = Math.max(0, Math.min(65535, dots | 0));
    return FOS.escpos.cmd(0x1B, 0x24, n & 0xff, (n >> 8) & 0xff);
  },

  dotsPerChar(size = 0x00) {
    return FOS.escpos.SLIP_LAYOUT.DOTS_PER_CHAR * ((size & 0x10) ? 2 : 1);
  },

  /** 右列固定右边界（不用空格填充） */
  rightColStartDots(rightText, { size = 0x00, rightEdgeChars } = {}) {
    const edge = rightEdgeChars ?? FOS.escpos.SLIP_LAYOUT.RIGHT_EDGE_CHARS;
    const dpc = FOS.escpos.dotsPerChar(size);
    const rw = FOS.escpos.displayWidth(String(rightText ?? ''));
    return edge * dpc - rw * dpc;
  },

  slipRightEdge() {
    return FOS.escpos.SLIP_LAYOUT.RIGHT_EDGE_CHARS;
  },

  printLrCols(left, right, { bold = false, size = 0x00, rightEdgeChars } = {}) {
    const edge = rightEdgeChars ?? FOS.escpos.slipRightEdge();
    const pos = FOS.escpos.rightColStartDots(right, { size, rightEdgeChars: edge });
    return FOS.escpos.concat(
      FOS.escpos.align(0),
      FOS.escpos.bold(bold),
      FOS.escpos.size(size),
      FOS.escpos.textBytes(String(left ?? '')),
      FOS.escpos.horizontalPosDots(pos),
      FOS.escpos.textBytes(String(right ?? '')),
      FOS.escpos.feed(1),
      FOS.escpos.bold(false),
      FOS.escpos.size(0x00),
      FOS.escpos.align(0)
    );
  },

  printItemRows(name, qty, { size = 0x00 } = {}) {
    const edge = FOS.escpos.slipRightEdge();
    const rows = FOS.escpos.itemTwoColRows(name, qty);
    return FOS.escpos.concat(
      ...rows.map((row) => {
        if (row.isFirst) {
          return FOS.escpos.printLrCols(row.part, row.qty, { size, rightEdgeChars: edge });
        }
        return FOS.escpos.concat(
          FOS.escpos.align(0),
          FOS.escpos.size(size),
          FOS.escpos.lineText(row.part),
          FOS.escpos.size(0x00),
          FOS.escpos.align(0)
        );
      })
    );
  },

  printItemQtyLine(prefix, qty, suffix) {
    return FOS.escpos.concat(
      FOS.escpos.align(0),
      FOS.escpos.bold(true),
      FOS.escpos.size(0x00),
      FOS.escpos.textBytes(String(prefix ?? '')),
      FOS.escpos.size(0x11),
      FOS.escpos.textBytes(String(qty ?? '')),
      FOS.escpos.size(0x00),
      FOS.escpos.textBytes(String(suffix ?? '')),
      FOS.escpos.feed(1),
      FOS.escpos.bold(false),
      FOS.escpos.align(0)
    );
  },

  fullSepLine(lineWidth) {
    const lw = lineWidth || FOS.escpos.LINE_WIDTH;
    return '-'.repeat(lw);
  },

  padLine(left, right, width) {
    return FOS.escpos.padTwoCol(left, right, width);
  },

  lineText(text, { feedLines = 1 } = {}) {
    return FOS.escpos.concat(FOS.escpos.textBytes(text), FOS.escpos.feed(feedLines));
  },

  separator() {
    return FOS.escpos.lineText(FOS.escpos.fullSepLine());
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
    if (!order) return '';
    const parts = [];
    if (order.delivery_preferred_slot && order.delivery_preferred_slot !== 'unspecified') {
      parts.push(FOS.publicOrder?.slotLabel?.(order.delivery_preferred_slot) || order.delivery_preferred_slot);
    }
    if (order.delivery_time_note) parts.push(order.delivery_time_note);
    return parts.join(' ').trim();
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

  spacedTitle(text) {
    return String(text || '').split('').join('\u3000');
  },

  formatIssueDate(date = new Date()) {
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  },

  formatSlipNo(order) {
    const date = String(order?.order_date || '').replace(/-/g, '');
    const no = String(order?.order_no || order?.public_order_code || order?.id || '').trim();
    const padded = /^\d+$/.test(no) ? no.padStart(3, '0') : no;
    return `NO.${date || FOS.escpos.formatIssueDate().replace(/\D/g, '')}-${padded || '-'}`;
  },

  money(value) {
    const n = Number(value) || 0;
    return `￥${Math.round(n).toLocaleString('ja-JP')}`;
  },

  itemLineAmount(item) {
    return (Number(item?.unit_price) || 0) * FOS.orders.deliveredQty(item);
  },

  orderTotals(order) {
    const items = order?.order_items || [];
    const subtotal = items.reduce((sum, item) => sum + FOS.escpos.itemLineAmount(item), 0);
    const tax = items.reduce((sum, item) => {
      const rate = Number(item?.tax_rate) || 0;
      return sum + Math.round((FOS.escpos.itemLineAmount(item) * rate) / 100);
    }, 0);
    const hasNumber = (value) => value != null && value !== '' && Number.isFinite(Number(value));
    return {
      subtotal: hasNumber(order?.subtotal) ? Number(order.subtotal) : subtotal,
      tax: hasNumber(order?.tax_total) ? Number(order.tax_total) : tax,
      total: hasNumber(order?.total) ? Number(order.total) : subtotal + tax,
    };
  },

  formatTaxRate(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n)) return '';
    return Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, '');
  },

  taxBreakdown(order) {
    const byRate = new Map();
    (order?.order_items || []).forEach((item) => {
      const rate = Number(item?.tax_rate);
      if (!Number.isFinite(rate) || rate < 0) return;
      const amount = FOS.escpos.itemLineAmount(item);
      const tax = Math.round((amount * rate) / 100);
      byRate.set(rate, (byRate.get(rate) || 0) + tax);
    });
    const rates = [...new Set([8, 10, ...byRate.keys()])]
      .filter((rate) => Number.isFinite(rate) && rate >= 0)
      .sort((a, b) => a - b);
    return rates.map((rate) => ({ rate, tax: byRate.get(rate) || 0 }));
  },

  taxRateLabel(order) {
    const rates = [...new Set((order?.order_items || [])
      .map((item) => Number(item?.tax_rate))
      .filter((rate) => Number.isFinite(rate) && rate >= 0))]
      .sort((a, b) => a - b);
    if (!rates.length) return '';
    return `${rates.map((rate) => FOS.escpos.formatTaxRate(rate)).join('/')}%`;
  },

  displayCustomerName(name) {
    const raw = String(name || '').trim();
    return FOS.fmt?.displayName ? FOS.fmt.displayName(raw) : raw;
  },

  ruleLine(char = '-', lineWidth = FOS.escpos.LINE_WIDTH) {
    const ch = String(char || '-').charAt(0) || '-';
    const safeWidth = Math.max(8, Math.min(lineWidth || FOS.escpos.LINE_WIDTH, 42));
    return ch.repeat(safeWidth);
  },

  /** 共享配送单布局（ESC/POS 与汉印云共用） */
  buildOutboundSlipLayout(order, fields = {}, { lineWidth = 48 } = {}) {
    const items = (order?.order_items || []).slice();
    const destName = String(
      fields.customerName || order?.customer_name || order?.shop_name || ''
    ).trim() || '—';
    const phone = String(fields.phone || order?.customer_phone || '').trim();
    const address = String(fields.address || order?.customer_address || '').trim();
    const deliveryDate = FOS.escpos.formatDeliveryDate(order);
    const note = String(order?.note || order?.factory_note || '').trim();
    const factory = fields.factory || {};
    const issuerName = String(factory.name || '').trim();
    const totals = FOS.escpos.orderTotals(order);
    const taxBreakdown = FOS.escpos.taxBreakdown(order);
    const taxLine = taxBreakdown.length
      ? taxBreakdown.map(({ rate, tax }) => `消費税${FOS.escpos.money(tax)}（${FOS.escpos.formatTaxRate(rate)}%）`).join(' ')
      : `消費税${FOS.escpos.money(totals.tax)}`;
    const indent = '';

    const lines = [];
    lines.push({ kind: 'rule', char: '=' });
    if (issuerName) lines.push({ kind: 'merchant', text: issuerName });
    lines.push({ kind: 'title', text: FOS.escpos.spacedTitle('納品書') });
    lines.push({ kind: 'rule', char: '=' });
    lines.push({ kind: 'text', text: `発行日${FOS.escpos.formatIssueDate()}`, tight: true });
    lines.push({ kind: 'text', text: `伝票番号${FOS.escpos.formatSlipNo(order)}`, tight: true });
    lines.push({ kind: 'text', text: `納品日${deliveryDate}`, tight: true });
    lines.push({ kind: 'rule', char: '-' });
    lines.push({ kind: 'label-lg', text: 'お届け先' });
    lines.push({ kind: 'dest', text: FOS.escpos.displayCustomerName(destName) });
    if (address) {
      FOS.escpos.wrapDisplayWidth(`住所: ${address}`, lineWidth).forEach((text) => lines.push({ kind: 'text', text }));
    }
    if (phone) lines.push({ kind: 'phone', text: `TEL: ${phone}` });
    lines.push({ kind: 'rule', char: '=' });

    items.forEach((item, idx) => {
      const qty = FOS.orders.deliveredQty(item);
      const unitPrice = Number(item?.unit_price) || 0;
      const amount = unitPrice * qty;
      FOS.escpos.wrapDisplayWidth(FOS.escpos.nameWithSpec(item), lineWidth - 5).forEach((text, i) => {
        lines.push({ kind: 'item-name', text: i === 0 ? `${indent}${text}` : `${indent}   ${text}`, tight: true });
      });
      lines.push({
        kind: 'item-qty-line',
        prefix: `${indent}数量:`,
        qty: String(qty),
        suffix: `  単価:${FOS.escpos.money(unitPrice)}  金額:${FOS.escpos.money(amount)}`,
        tight: true,
      });
      if (FOS.orders.shortageQty(item) > 0) {
        const reason = String(item.shortage_note || '').trim();
        lines.push({ kind: 'item-name', text: `${indent}${`欠品 ${reason}`.trim()}`, tight: true });
      }
      lines.push({ kind: 'rule', char: '-' });
    });
    lines.push({ kind: 'text', text: `${indent}小計${FOS.escpos.money(totals.subtotal)}（税抜）`, tight: true });
    lines.push({ kind: 'text', text: `${indent}${taxLine}`, tight: true });
    lines.push({ kind: 'rule', char: '=' });
    lines.push({ kind: 'total-text', text: `${indent}合計金額（税込） ${FOS.escpos.money(totals.total)}`, tight: true });
    lines.push({ kind: 'rule', char: '=' });
    if (note) {
      lines.push({ kind: 'label', text: '【備考】' });
      FOS.escpos.wrapDisplayWidth(note, lineWidth).forEach((text) => lines.push({ kind: 'text', text }));
    }
    return lines;
  },

  buildOutboundSlip(order, fields = {}) {
    const lineWidth = FOS.escpos.LINE_WIDTH;
    const layout = FOS.escpos.buildOutboundSlipLayout(order, fields, { lineWidth });
    const chunks = [FOS.escpos.init()];
    let compactItems = false;

    layout.forEach((row) => {
      if (row.kind === 'sep' || row.kind === 'rule') {
        if (compactItems) {
          chunks.push(FOS.escpos.resetLineSpacing());
          compactItems = false;
        }
        const text = row.kind === 'rule'
          ? FOS.escpos.ruleLine(row.char, lineWidth)
          : FOS.escpos.fullSepLine(lineWidth);
        chunks.push(FOS.escpos.lineText(text));
        return;
      }
      const emit = (bytes) => {
        if (row.tight) chunks.push(FOS.escpos.setLineSpacing(18));
        chunks.push(bytes);
        if (row.tight) chunks.push(FOS.escpos.resetLineSpacing());
      };
      if (row.kind === 'merchant') {
        emit(FOS.escpos.styledLine(row.text, { align: 1, bold: true, size: 0x11 }));
        return;
      }
      if (row.kind === 'title') {
        emit(FOS.escpos.styledLine(row.text, { align: 1, bold: true, size: 0x01 }));
        return;
      }
      if (row.kind === 'dest') {
        emit(FOS.escpos.styledLine(row.text, { bold: true, size: 0x01 }));
        return;
      }
      if (row.kind === 'info') {
        emit(FOS.escpos.printLrCols(row.left, row.right, {
          size: row.emphasize ? 0x11 : 0x00,
          rightEdgeChars: FOS.escpos.slipRightEdge(),
        }));
        return;
      }
      if (row.kind === 'phone') {
        emit(FOS.escpos.lineText(row.text));
        return;
      }
      if (row.kind === 'label-lg') {
        emit(FOS.escpos.styledLine(row.text, { bold: true, size: 0x00 }));
        return;
      }
      if (row.kind === 'row') {
        chunks.push(FOS.escpos.setLineSpacing(22));
        compactItems = true;
        chunks.push(FOS.escpos.printLrCols(row.left, row.right, {
          bold: true,
          size: 0x00,
          rightEdgeChars: FOS.escpos.slipRightEdge(),
        }));
        return;
      }
      if (row.kind === 'total') {
        emit(FOS.escpos.printLrCols(row.left, row.right, {
          bold: true,
          size: 0x01,
          rightEdgeChars: FOS.escpos.slipRightEdge(),
        }));
        return;
      }
      if (row.kind === 'total-text') {
        emit(FOS.escpos.styledLine(row.text, { bold: true, size: 0x00 }));
        return;
      }
      if (row.kind === 'label') {
        emit(FOS.escpos.styledLine(row.text, { bold: true, size: 0x00 }));
        return;
      }
      if (row.kind === 'item-name') {
        emit(FOS.escpos.styledLine(row.text, { bold: true, size: 0x01 }));
        return;
      }
      if (row.kind === 'item-qty-line') {
        emit(FOS.escpos.printItemQtyLine(row.prefix, row.qty, row.suffix));
        return;
      }
      if (row.kind === 'item') {
        emit(FOS.escpos.printItemRows(row.name, row.qty, { size: 0x00 }));
        return;
      }
      if (row.kind === 'text') {
        emit(FOS.escpos.lineText(row.text));
      }
    });

    if (compactItems) chunks.push(FOS.escpos.resetLineSpacing());

    chunks.push(FOS.escpos.feed(1), FOS.escpos.cut());
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
      phone,
      address,
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
