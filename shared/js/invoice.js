window.FOS = window.FOS || {};

FOS.invoice = {
  /** 请求书 PDF 固定使用中文标签 */
  LABELS: {
    title: '账单',
    closeSuffix: '截止',
    honorific: ' 御中',
    period: '账单期间',
    bank: '汇款账户',
    registration: '登记号',
    sales: '本次销售额',
    tax: '本次消费税',
    billAmount: '本次账单金额',
    orderDate: '订单日',
    productName: '商品名',
    spec: '规格',
    unitPrice: '单价（含税）',
    qty: '数量',
    amount: '金额',
    slipTotal: '传票计',
  },

  _label(key) {
    return FOS.invoice.LABELS[key] || key;
  },

  async load(month, shopId) {
    const lastDay = new Date(month.split('-')[0], month.split('-')[1], 0).getDate();
    let query = FOS.db.sb
      .from('orders')
      .select('*, order_items(*)')
      .gte('order_date', `${month}-01`)
      .lte('order_date', `${month}-${String(lastDay).padStart(2, '0')}`)
      .eq('receipt_confirmed', true)
      .or('order_source.eq.shop_account,order_source.is.null')
      .order('order_date');
    query = FOS.merchants.scopeFilter(query);
    if (shopId) query = query.eq('shop_id', shopId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).filter((o) => FOS.publicOrder?.isShopAccountOrder(o));
  },

  async loadShopsByIds(shopIds) {
    if (!shopIds.length) return {};
    let select = 'id, name, address, zip_code, phone';
    let { data, error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('users').select(select).in('id', shopIds)
    );
    if (error && /zip_code|column/i.test(error.message || '')) {
      ({ data } = await FOS.merchants.scopeFilter(
        FOS.db.sb.from('users').select('id, name, address, phone').in('id', shopIds)
      ));
    }
    const map = {};
    (data || []).forEach((s) => { map[s.id] = s; });
    return map;
  },

  taxInclUnit(item) {
    const rate = Number(item?.tax_rate) || 0;
    const up = Number(item?.unit_price) || 0;
    return Math.round(up * (1 + rate / 100));
  },

  _monthRange(month) {
    const [year, mo] = month.split('-').map(Number);
    const lastDay = new Date(year, mo, 0).getDate();
    const pad = (n) => String(n).padStart(2, '0');
    return {
      year,
      month: mo,
      lastDay,
      fromIso: `${month}-01`,
      toIso: `${month}-${pad(lastDay)}`,
    };
  },

  _fmtJaDate(iso, { padDay = false } = {}) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const day = padDay ? String(d).padStart(2, '0') : String(d);
    return `${y}年${m}月${day}日`;
  },

  _amount(n) {
    return String(Math.round(n || 0));
  },

  _zipLine(zip) {
    const z = String(zip || '').trim();
    if (!z) return '';
    const norm = z.replace(/[^\d-]/g, '');
    return norm.startsWith('〒') ? norm : `〒${norm}`;
  },

  _buildDetailTable(orders, e) {
    const byDate = new Map();
    orders
      .slice()
      .sort((a, b) => a.order_date.localeCompare(b.order_date) || (a.order_no || 0) - (b.order_no || 0))
      .forEach((o) => {
        if (!byDate.has(o.order_date)) byDate.set(o.order_date, []);
        byDate.get(o.order_date).push(o);
      });

    let rows = '';
    for (const [date, dayOrders] of byDate) {
      let slipTotal = 0;
      let firstRow = true;
      for (const order of dayOrders) {
        const items = (order.order_items || []).slice();
        for (const item of items) {
          const unitIncl = FOS.invoice.taxInclUnit(item);
          const amt = unitIncl * (item.qty || 0);
          slipTotal += amt;
          rows += `
            <tr>
              <td class="inv-date">${firstRow ? e(FOS.invoice._fmtJaDate(date)) : ''}</td>
              <td>${e(FOS.fmt.displayName(item.product_name))}</td>
              <td>${e(item.product_spec || '')}</td>
              <td class="inv-num">${e(FOS.invoice._amount(unitIncl))}</td>
              <td class="inv-qty">${e(item.qty)}</td>
              <td class="inv-num">${e(FOS.invoice._amount(amt))}</td>
            </tr>`;
          firstRow = false;
        }
      }
      rows += `
        <tr class="inv-slip-row">
          <td colspan="5" class="inv-slip-label">${e(FOS.invoice._label('slipTotal'))}</td>
          <td class="inv-num">${e(FOS.invoice._amount(slipTotal))}</td>
        </tr>`;
    }

    return `
      <table class="inv-detail">
        <thead>
          <tr>
            <th>${e(FOS.invoice._label('orderDate'))}</th>
            <th>${e(FOS.invoice._label('productName'))}</th>
            <th>${e(FOS.invoice._label('spec'))}</th>
            <th>${e(FOS.invoice._label('unitPrice'))}</th>
            <th>${e(FOS.invoice._label('qty'))}</th>
            <th>${e(FOS.invoice._label('amount'))}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  },

  _buildShopPage(shopOrders, shop, merchantProfile, month) {
    const e = FOS.printDoc.esc;
    const L = FOS.invoice._label;
    const range = FOS.invoice._monthRange(month);
    const shopName = FOS.fmt.displayName(shop?.name || shopOrders[0]?.shop_name || '', 'zh');
    const zipLine = FOS.invoice._zipLine(shop?.zip_code);
    const shopAddr = (shop?.address || '').trim();

    const tax = shopOrders.reduce((a, o) => a + (o.tax_total || 0), 0);
    const total = shopOrders.reduce((a, o) => a + (o.total || 0), 0);

    const m = merchantProfile || FOS.invoiceSettings.empty();
    const closeDate = `${FOS.invoice._fmtJaDate(range.toIso)}${L('closeSuffix')}`;
    const periodFrom = FOS.invoice._fmtJaDate(range.fromIso, { padDay: true });
    const periodTo = FOS.invoice._fmtJaDate(range.toIso, { padDay: true });

    return `
      <section class="inv-page">
        <h1 class="inv-title">${e(L('title'))}</h1>
        <div class="inv-close">${e(closeDate)}</div>

        <div class="inv-header">
          <div class="inv-to">
            <div class="inv-to-name">${e(shopName)}${e(L('honorific'))}</div>
            ${zipLine ? `<div class="inv-to-line">${e(zipLine)}</div>` : ''}
            ${shopAddr ? `<div class="inv-to-line">${e(shopAddr)}</div>` : ''}
          </div>
          <div class="inv-from">
            <div class="inv-from-name">${e(m.companyName)}</div>
            ${m.address ? `<div>${e(m.address)}</div>` : ''}
            ${m.tel ? `<div>TEL：${e(m.tel)}</div>` : ''}
            ${m.fax ? `<div>FAX：${e(m.fax)}</div>` : ''}
            ${m.registrationNo ? `<div>${e(L('registration'))}：${e(m.registrationNo)}</div>` : ''}
          </div>
        </div>

        <div class="inv-period">${e(L('period'))} ${e(periodFrom)}～${e(periodTo)}</div>
        ${m.bankInfo ? `<div class="inv-bank">${e(L('bank'))} ${e(m.bankInfo)}</div>` : ''}

        <table class="inv-summary">
          <thead>
            <tr>
              <th>${e(L('sales'))}</th>
              <th>${e(L('tax'))}</th>
              <th>${e(L('billAmount'))}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${e(FOS.invoice._amount(total))}</td>
              <td>${e(FOS.invoice._amount(tax))}</td>
              <td>${e(FOS.invoice._amount(total))}</td>
            </tr>
          </tbody>
        </table>

        ${FOS.invoice._buildDetailTable(shopOrders, e)}
      </section>`;
  },

  async exportPdf(month, orders) {
    if (!orders.length) {
      FOS.ui.toast(FOS.i18n.t('確認済み注文なし', '没有已确认订单'), 'error');
      return false;
    }

    let merchantProfile = await FOS.invoiceSettings.load();
    if (!FOS.invoiceSettings.isComplete(merchantProfile)) {
      const fallback = await FOS.invoiceSettings.loadFallbackFromSettings();
      if (fallback) merchantProfile = fallback;
    }

    const shopIds = [...new Set(orders.map((o) => o.shop_id))];
    const shopMap = await FOS.invoice.loadShopsByIds(shopIds);

    const pages = shopIds.map((sid) => {
      const shopOrders = orders.filter((o) => o.shop_id === sid);
      return FOS.invoice._buildShopPage(shopOrders, shopMap[sid], merchantProfile, month);
    }).join('<div class="inv-page-break"></div>');

    const shopSuffix = shopIds.length === 1 ? `_${shopIds[0]}` : '';
    return FOS.printDoc.downloadPdf({
      title: `${FOS.invoice._label('title')} ${month}`,
      bodyHtml: pages,
      filename: `invoice_${month}${shopSuffix}.pdf`,
      docClass: 'fos-pdf-root fos-pdf-root--invoice',
      htmlLang: 'zh-CN',
    });
  },
};
