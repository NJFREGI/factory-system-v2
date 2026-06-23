window.FOS = window.FOS || {};

FOS.dailySummary = {
  async load(date) {
    const { data: orders, error } = await FOS.orders.forFactoryQuery(
      FOS.db.sb
        .from('orders')
        .select('*, order_items(*)')
        .eq('order_date', date)
        .not('status', 'eq', 'confirmed')
    );
    if (error) throw error;
    const itemMap = {};
    let orderCount = 0;
    const shops = new Set();
    (orders || [])
      .filter((order) => FOS.publicOrder?.isShopAccountOrder(order))
      .forEach((order) => {
      orderCount += 1;
      shops.add(FOS.fmt.displayName(order.shop_name));
      (order.order_items || []).forEach((item) => {
        const key = item.product_id || item.product_name;
        if (!itemMap[key]) {
          itemMap[key] = {
            product_id: item.product_id,
            name: item.product_name,
            spec: item.product_spec,
            emoji: item.product_emoji || '📦',
            unit_price: item.unit_price,
            tax_rate: item.tax_rate,
            total_qty: 0,
            total_amount: 0,
          };
        }
        itemMap[key].total_qty += item.qty;
        itemMap[key].total_amount += item.unit_price * item.qty;
      });
    });
    const items = Object.values(itemMap).sort((a, b) => b.total_qty - a.total_qty);
    const grandSub = items.reduce((s, i) => s + i.total_amount, 0);
    const grandTax = items.reduce((s, i) => s + Math.round(i.total_amount * i.tax_rate / 100), 0);
    return { date, orderCount, shops: [...shops], items, grandSub, grandTax, orders: orders || [] };
  },

  tableHtml(data) {
    if (!data.items.length) {
      return FOS.ui.empty('📊', FOS.i18n.t('当日の注文なし', '当日暂无订单'));
    }
    const rows = data.items.map((item, idx) => {
      const spec = item.spec
        ? `<span class="order-line-item__spec">(${FOS.fmt.escapeHtml(item.spec)})</span>`
        : '';
      return `<li class="order-line-item${idx % 2 ? ' order-line-item--alt' : ''}">
        <span class="order-line-item__main">
          <span class="order-line-item__name">${FOS.fmt.escapeHtml(item.name)}</span>${spec}
        </span>
        <strong class="order-line-item__qty">×${item.total_qty}</strong>
      </li>`;
    }).join('');
    return `
      <div class="daily-summary-meta">
        <span>📅 <strong>${data.date}</strong></span>
        <span>${FOS.i18n.t('注文', '订单')}: <strong>${data.orderCount}</strong></span>
        <span>${FOS.i18n.t('品目', '品目')}: <strong>${data.items.length}</strong></span>
      </div>
      <ul class="order-line-items daily-summary-lines">${rows}</ul>`;
  },

  exportPdf(data) {
    if (!data?.items?.length) {
      FOS.ui.toast(FOS.i18n.t('データなし', '暂无数据'), 'error');
      return;
    }
    const e = FOS.printDoc.esc;
    const rows = data.items.map((item) => `
      <tr>
        <td class="ds-pdf-name"><strong>${e(item.name)}</strong></td>
        <td class="ds-pdf-spec">${e(item.spec)}</td>
        <td class="ds-pdf-qty">${item.total_qty}</td>
      </tr>`).join('');

    const body = `
      <style>
        .ds-pdf h1 { font-size: 26px !important; }
        .ds-pdf .meta { font-size: 15px !important; }
        .ds-pdf th { font-size: 15px !important; padding: 11px 12px !important; }
        .ds-pdf td { padding: 11px 12px !important; }
        .ds-pdf-name { font-size: 17px; font-weight: 700; }
        .ds-pdf-spec { font-size: 15px; color: #555; }
        .ds-pdf-qty { text-align: center; font-size: 24px; font-weight: 900; color: #2563eb; }
      </style>
      <div class="ds-pdf">
        <h1>${e(FOS.i18n.t('翌日仕入れ集計', '次日进货汇总'))}</h1>
        <div class="blue-line"></div>
        <div class="meta">
          <div><span>${e(FOS.i18n.t('対象日', '日期'))}: </span><strong>${e(data.date)}</strong></div>
          <div><span>${e(FOS.i18n.t('注文数', '订单数'))}: </span><strong>${data.orderCount}</strong></div>
          <div><span>${e(FOS.i18n.t('品目数', '品目数'))}: </span><strong>${data.items.length}</strong></div>
          <div><span>${e(FOS.i18n.t('発行', '发行'))}: </span><strong>${e(new Date().toLocaleString('ja-JP'))}</strong></div>
        </div>
        <table>
          <thead><tr>
            <th>${e(FOS.i18n.t('商品名', '商品名称'))}</th>
            <th>${e(FOS.i18n.t('規格', '规格'))}</th>
            <th style="text-align:center">${e(FOS.i18n.t('合計数量', '合计数量'))}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    return FOS.printDoc.downloadPdf({
      title: `${FOS.i18n.t('日次集計', '日统计')} ${data.date}`,
      bodyHtml: body,
      filename: `daily_summary_${data.date}.pdf`,
    });
  },
};
