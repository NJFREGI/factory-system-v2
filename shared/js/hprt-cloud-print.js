/**
 * 汉印云 · 出库配送单（XML 标记，print_type=ESC）
 * 布局与 escpos-print.js 共用 buildOutboundSlipLayout
 */
window.FOS = window.FOS || {};

FOS.hprtCloudPrint = {
  LINE_WIDTH: 46,

  escape(text) {
    return FOS.escpos.printableText(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  fontWrap(text, { font = 'F', bold = false } = {}) {
    const t = FOS.hprtCloudPrint.escape(text);
    const inner = `<${font}>${t}</${font}>`;
    return bold ? `<BOLD>${inner}</BOLD>` : inner;
  },

  line(text, { align = 'Left', font = 'F', bold = false } = {}) {
    const inner = FOS.hprtCloudPrint.fontWrap(text, { font, bold });
    return `<${align}>${inner}</${align}><BR>`;
  },

  /** Left+Right 真右对齐 */
  lrRow(left, right, { font = 'F', bold = false } = {}) {
    const l = FOS.hprtCloudPrint.fontWrap(left, { font, bold });
    const r = FOS.hprtCloudPrint.fontWrap(right, { font, bold });
    return `<Left>${l}</Left><Right>${r}</Right><BR>`;
  },

  /** 商品行（Left+Right，无 table 包裹，行距更紧凑） */
  itemRows(name, qty, { font = 'F' } = {}) {
    const nameMax = FOS.escpos.SLIP_LAYOUT.NAME_COL_CHARS;
    const parts = FOS.escpos.wrapDisplayWidth(String(name || ''), nameMax);
    let out = '';
    parts.forEach((part, i) => {
      if (i === 0) out += FOS.hprtCloudPrint.lrRow(part, String(qty ?? ''), { font });
      else out += FOS.hprtCloudPrint.line(part, { font });
    });
    return out;
  },

  qtyLine(prefix, qty, suffix) {
    const p = FOS.hprtCloudPrint.fontWrap(prefix, { font: 'F', bold: true });
    const q = FOS.hprtCloudPrint.fontWrap(qty, { font: 'FH', bold: true });
    const s = FOS.hprtCloudPrint.fontWrap(suffix, { font: 'F', bold: true });
    return `<Left>${p}${q}${s}</Left><BR>`;
  },

  buildOutboundSlip(order, fields = {}) {
    const lineWidth = FOS.hprtCloudPrint.LINE_WIDTH;
    const layout = FOS.escpos.buildOutboundSlipLayout(order, fields, { lineWidth });
    let c = '<Init>';

    layout.forEach((row) => {
      if (row.kind === 'sep' || row.kind === 'rule') {
        const text = row.kind === 'rule'
          ? FOS.escpos.ruleLine(row.char, lineWidth)
          : FOS.escpos.fullSepLine(lineWidth);
        c += FOS.hprtCloudPrint.line(text, { font: 'F' });
        return;
      }
      if (row.kind === 'merchant') {
        c += FOS.hprtCloudPrint.line(row.text, { align: 'Center', font: 'FH', bold: true });
        return;
      }
      if (row.kind === 'title') {
        c += FOS.hprtCloudPrint.line(row.text, { align: 'Center', font: 'F1', bold: true });
        return;
      }
      if (row.kind === 'label-lg') {
        c += FOS.hprtCloudPrint.line(row.text, { font: 'F', bold: true });
        return;
      }
      if (row.kind === 'dest') {
        c += FOS.hprtCloudPrint.line(row.text, { font: 'FH', bold: true });
        return;
      }
      if (row.kind === 'info') {
        const font = row.emphasize ? 'FH2' : 'F';
        c += FOS.hprtCloudPrint.lrRow(row.left, row.right, { font });
        return;
      }
      if (row.kind === 'phone') {
        c += FOS.hprtCloudPrint.line(row.text, { font: 'F' });
        return;
      }
      if (row.kind === 'row') {
        c += FOS.hprtCloudPrint.lrRow(row.left, row.right, { font: 'F', bold: true });
        return;
      }
      if (row.kind === 'total') {
        c += FOS.hprtCloudPrint.lrRow(row.left, row.right, { font: 'F', bold: true });
        return;
      }
      if (row.kind === 'total-text') {
        c += FOS.hprtCloudPrint.line(row.text, { font: 'F', bold: true });
        return;
      }
      if (row.kind === 'label') {
        c += FOS.hprtCloudPrint.line(row.text, { font: 'F', bold: true });
        return;
      }
      if (row.kind === 'item-name') {
        c += FOS.hprtCloudPrint.line(row.text, { font: 'FH', bold: true });
        return;
      }
      if (row.kind === 'item-qty-line') {
        c += FOS.hprtCloudPrint.qtyLine(row.prefix, row.qty, row.suffix);
        return;
      }
      if (row.kind === 'item') {
        c += FOS.hprtCloudPrint.itemRows(row.name, row.qty, { font: 'F' });
        return;
      }
      if (row.kind === 'text') {
        c += FOS.hprtCloudPrint.line(row.text, { font: 'F' });
      }
    });

    c += '<BR><DCUT m=65 n=0>';
    return c;
  },

  buildTestContent(hostOrSn) {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const lw = FOS.hprtCloudPrint.LINE_WIDTH;
    let c = '<Init>';
    c += FOS.hprtCloudPrint.line(FOS.i18n.t('印刷テスト', '打印测试'), { align: 'Center', font: 'F1', bold: true });
    c += FOS.hprtCloudPrint.line('HPRT Cloud');
    c += FOS.hprtCloudPrint.line(String(hostOrSn || ''));
    c += FOS.hprtCloudPrint.line(stamp);
    c += FOS.hprtCloudPrint.line(FOS.escpos.fullSepLine(lw));
    c += '<BR><DCUT m=65 n=0>';
    return c;
  },

  async buildOutboundPayload(order) {
    const fields = await FOS.escpos.resolvePrintFields(order);
    fields.factory = await FOS.escpos.resolveFactoryInfo();
    const content = FOS.hprtCloudPrint.buildOutboundSlip(order, fields);
    return { content, fields };
  },
};
