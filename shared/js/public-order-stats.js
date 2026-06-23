/**
 * 顾客扫码订单 · 统计聚合（独立于门店日统计 / 月结）
 */
window.FOS = window.FOS || {};

FOS.publicOrderStats = {
  SOURCE_KEYS: {
    store: 'store',
    wechat: 'wechat',
    offline_qr: 'offline_qr',
  },

  DELIVERY_KEYS: {
    new: 'new',
    active: 'active',
    done: 'done',
    cancelled: 'cancelled',
  },

  sourceLabel(key) {
    const map = {
      store: ['物産店注文', '物产店订单'],
      wechat: ['微信群注文', '微信群订单'],
      offline_qr: ['店頭QR注文', '线下二维码订单'],
    };
    const pair = map[key];
    return pair ? FOS.i18n.t(pair[0], pair[1]) : key;
  },

  deliveryLabel(key) {
    const map = {
      new: ['未受付', '未接单'],
      active: ['配送中', '配送中'],
      done: ['完了', '已完成'],
      cancelled: ['キャンセル', '已取消'],
    };
    const pair = map[key];
    return pair ? FOS.i18n.t(pair[0], pair[1]) : key;
  },

  classifySource(order, channelMap) {
    const ch = order.channel_id ? channelMap[order.channel_id] : null;
    const type = ch?.channel_type;
    if (order.order_source === FOS.publicOrder.SOURCES.WECHAT_GROUP || type === 'wechat_group') {
      return FOS.publicOrderStats.SOURCE_KEYS.wechat;
    }
    if (type === 'public_qr') return FOS.publicOrderStats.SOURCE_KEYS.offline_qr;
    return FOS.publicOrderStats.SOURCE_KEYS.store;
  },

  classifyDelivery(order) {
    if (order.delivery_status === 'cancelled' || order.status === 'cancelled') {
      return FOS.publicOrderStats.DELIVERY_KEYS.cancelled;
    }
    if (order.delivery_status === 'delivered' || order.status === 'delivered' || order.status === 'confirmed') {
      return FOS.publicOrderStats.DELIVERY_KEYS.done;
    }
    if (order.delivery_status === 'new' || order.status === 'pending') {
      return FOS.publicOrderStats.DELIVERY_KEYS.new;
    }
    if (
      ['accepted', 'delivering'].includes(order.delivery_status)
      || ['preparing', 'shipped'].includes(order.status)
    ) {
      return FOS.publicOrderStats.DELIVERY_KEYS.active;
    }
    return FOS.publicOrderStats.DELIVERY_KEYS.new;
  },

  monthRange(month) {
    const [y, m] = String(month || '').split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return {
      from: `${month}-01`,
      to: `${month}-${String(lastDay).padStart(2, '0')}`,
    };
  },

  dayRange(date) {
    const d = String(date || '').slice(0, 10);
    return { from: d, to: d };
  },

  weekRange(date) {
    const anchor = new Date(`${String(date || '').slice(0, 10)}T12:00:00`);
    if (Number.isNaN(anchor.getTime())) return FOS.publicOrderStats.dayRange(date);
    const dow = anchor.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(anchor);
    monday.setDate(anchor.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };
    return { from: fmt(monday), to: fmt(sunday) };
  },

  periodRange(period, anchor) {
    if (period === 'day') return FOS.publicOrderStats.dayRange(anchor);
    if (period === 'week') return FOS.publicOrderStats.weekRange(anchor);
    return FOS.publicOrderStats.monthRange(String(anchor || '').slice(0, 7));
  },

  formatPeriodLabel(period, anchor) {
    const { from, to } = FOS.publicOrderStats.periodRange(period, anchor);
    const slash = (s) => String(s || '').replace(/-/g, '/');
    if (period === 'day') return slash(from);
    if (period === 'week') return `${slash(from)} - ${slash(to)}`;
    return slash(from.slice(0, 7));
  },

  weekDateSet(anchor) {
    const { from, to } = FOS.publicOrderStats.weekRange(anchor);
    const set = new Set();
    const start = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      set.add(`${y}-${m}-${day}`);
    }
    return set;
  },

  async loadChannels() {
    const { data, error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('order_channels').select('id, name, channel_type, active')
    );
    if (error && /order_channels|does not exist|schema cache/i.test(error.message || '')) {
      return {};
    }
    if (error) throw error;
    const map = {};
    (data || []).forEach((ch) => { map[ch.id] = ch; });
    return map;
  },

  async load(periodOrMonth, anchorDate) {
    const period = typeof periodOrMonth === 'object'
      ? (periodOrMonth.period || 'month')
      : 'month';
    const anchor = typeof periodOrMonth === 'object'
      ? (periodOrMonth.anchor || FOS.fmt.today())
      : `${periodOrMonth}-01`;
    const month = String(anchor).slice(0, 7);
    const { from, to } = FOS.publicOrderStats.periodRange(period, anchor);
    const { data, error } = await FOS.merchants.scopeFilter(
      FOS.db.sb
        .from('orders')
        .select('id, order_no, order_date, total, status, order_source, channel_id, shop_name, customer_name, customer_payment_method, delivery_status, payment_status, created_at')
        .gte('order_date', from)
        .lte('order_date', to)
        .in('order_source', ['public_order', 'wechat_group', 'public_qr'])
        .order('created_at', { ascending: false })
    );
    if (error) throw error;
    const channelMap = await FOS.publicOrderStats.loadChannels();
    const orders = (data || []).filter((o) => FOS.publicOrder.isPublicOrder(o));
    return FOS.publicOrderStats.summarize({ period, anchor, month, from, to }, orders, channelMap);
  },

  summarize(meta, orders, channelMap) {
    const month = meta?.month || meta;
    const period = meta?.period || 'month';
    const anchor = meta?.anchor || `${month}-01`;
    const from = meta?.from;
    const to = meta?.to;
    const sourceStats = {
      [FOS.publicOrderStats.SOURCE_KEYS.store]: { count: 0, total: 0 },
      [FOS.publicOrderStats.SOURCE_KEYS.wechat]: { count: 0, total: 0 },
      [FOS.publicOrderStats.SOURCE_KEYS.offline_qr]: { count: 0, total: 0 },
    };
    const deliveryStats = {
      [FOS.publicOrderStats.DELIVERY_KEYS.new]: { count: 0, total: 0 },
      [FOS.publicOrderStats.DELIVERY_KEYS.active]: { count: 0, total: 0 },
      [FOS.publicOrderStats.DELIVERY_KEYS.done]: { count: 0, total: 0 },
      [FOS.publicOrderStats.DELIVERY_KEYS.cancelled]: { count: 0, total: 0 },
    };
    const paymentStats = {};
    FOS.publicOrder.PAYMENT_METHODS.forEach((m) => {
      paymentStats[m.id] = { count: 0, total: 0, label: FOS.i18n.t(m.labelJa, m.labelZh) };
    });
    paymentStats._unknown = { count: 0, total: 0, label: FOS.i18n.t('未設定', '未设置') };

    const channelStats = {};

    let grandCount = 0;
    let grandTotal = 0;

    (orders || []).forEach((order) => {
      const total = Number(order.total) || 0;
      grandCount += 1;
      grandTotal += total;

      const srcKey = FOS.publicOrderStats.classifySource(order, channelMap);
      if (sourceStats[srcKey]) {
        sourceStats[srcKey].count += 1;
        sourceStats[srcKey].total += total;
      }

      const delKey = FOS.publicOrderStats.classifyDelivery(order);
      if (deliveryStats[delKey]) {
        deliveryStats[delKey].count += 1;
        deliveryStats[delKey].total += total;
      }

      const payKey = order.customer_payment_method || '_unknown';
      if (!paymentStats[payKey]) {
        paymentStats[payKey] = { count: 0, total: 0, label: payKey };
      }
      paymentStats[payKey].count += 1;
      paymentStats[payKey].total += total;

      const cid = order.channel_id || '_unknown';
      if (!channelStats[cid]) {
        const ch = channelMap[cid];
        channelStats[cid] = {
          id: cid,
          name: ch?.name || order.shop_name || FOS.i18n.t('不明チャンネル', '未知渠道'),
          channel_type: ch?.channel_type || '',
          count: 0,
          total: 0,
        };
      }
      channelStats[cid].count += 1;
      channelStats[cid].total += total;
    });

    const channels = Object.values(channelStats)
      .map((row) => ({
        ...row,
        avg: row.count ? Math.round(row.total / row.count) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    return {
      period,
      anchor,
      month,
      from,
      to,
      grandCount,
      grandTotal,
      grandAvg: grandCount ? Math.round(grandTotal / grandCount) : 0,
      sourceStats,
      deliveryStats,
      paymentStats,
      channels,
      orders,
    };
  },

  statCardsHtml(title, rows, { money = true } = {}) {
    return `
      <div class="public-stats-block">
        <h3 class="public-stats-block__title">${FOS.fmt.escapeHtml(title)}</h3>
        <div class="public-stats-grid">
          ${rows.map((row) => `
            <div class="public-stats-card">
              <div class="public-stats-card__label">${FOS.fmt.escapeHtml(row.label)}</div>
              <div class="public-stats-card__value">${row.count}<span class="public-stats-card__unit">${FOS.i18n.t('件', '笔')}</span></div>
              ${money ? `<div class="public-stats-card__sub">${FOS.fmt.money(row.total)}</div>` : ''}
            </div>`).join('')}
        </div>
      </div>`;
  },

  tableHtml(title, headers, bodyRows) {
    return `
      <div class="public-stats-block">
        <h3 class="public-stats-block__title">${FOS.fmt.escapeHtml(title)}</h3>
        <div class="table-wrap">
          <table class="public-stats-table">
            <thead><tr>${headers.map((h) => `<th>${FOS.fmt.escapeHtml(h)}</th>`).join('')}</tr></thead>
            <tbody>${bodyRows.join('')}</tbody>
          </table>
        </div>
      </div>`;
  },

  panelHtml(data) {
    if (!data.grandCount) {
      return FOS.ui.empty('📱', FOS.i18n.t('顧客注文データなし', '该时段暂无顾客扫码订单'));
    }

    const sourceRows = [
      FOS.publicOrderStats.SOURCE_KEYS.store,
      FOS.publicOrderStats.SOURCE_KEYS.wechat,
      FOS.publicOrderStats.SOURCE_KEYS.offline_qr,
    ].map((key) => ({
      label: FOS.publicOrderStats.sourceLabel(key),
      count: data.sourceStats[key]?.count || 0,
      total: data.sourceStats[key]?.total || 0,
    }));

    const deliveryRows = [
      FOS.publicOrderStats.DELIVERY_KEYS.new,
      FOS.publicOrderStats.DELIVERY_KEYS.active,
      FOS.publicOrderStats.DELIVERY_KEYS.done,
      FOS.publicOrderStats.DELIVERY_KEYS.cancelled,
    ].map((key) => ({
      label: FOS.publicOrderStats.deliveryLabel(key),
      count: data.deliveryStats[key]?.count || 0,
      total: data.deliveryStats[key]?.total || 0,
    }));

    const paymentRows = FOS.publicOrder.PAYMENT_METHODS.map((m) => ({
      label: FOS.i18n.t(m.labelJa, m.labelZh),
      count: data.paymentStats[m.id]?.count || 0,
      total: data.paymentStats[m.id]?.total || 0,
    })).filter((r) => r.count > 0);

    const channelRows = data.channels.map((ch) => `
      <tr>
        <td>${FOS.fmt.escapeHtml(ch.name)}</td>
        <td style="text-align:center">${ch.count}</td>
        <td class="money">${FOS.fmt.money(ch.total)}</td>
        <td class="money">${FOS.fmt.money(ch.avg)}</td>
      </tr>`);

    return `
      <div class="public-stats-hero">
        <div class="public-stats-hero__item">
          <div class="public-stats-hero__label">${FOS.i18n.t('顧客注文合計', '顾客扫码订单合计')}</div>
          <div class="public-stats-hero__value">${data.grandCount}<span>${FOS.i18n.t('件', '笔')}</span></div>
        </div>
        <div class="public-stats-hero__item">
          <div class="public-stats-hero__label">${FOS.i18n.t('売上', '销售额')}</div>
          <div class="public-stats-hero__value public-stats-hero__value--money">${FOS.fmt.money(data.grandTotal)}</div>
        </div>
        <div class="public-stats-hero__item">
          <div class="public-stats-hero__label">${FOS.i18n.t('客単価', '客单价')}</div>
          <div class="public-stats-hero__value public-stats-hero__value--money">${FOS.fmt.money(data.grandAvg)}</div>
        </div>
      </div>
      ${FOS.publicOrderStats.statCardsHtml(FOS.i18n.t('注文来源別', '按订单来源'), sourceRows)}
      ${FOS.publicOrderStats.tableHtml(
        FOS.i18n.t('チャンネル別', '按渠道'),
        [
          FOS.i18n.t('チャンネル', '渠道名称'),
          FOS.i18n.t('件数', '订单数'),
          FOS.i18n.t('売上', '销售额'),
          FOS.i18n.t('客単価', '客单价'),
        ],
        channelRows.length ? channelRows : [`<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary)">${FOS.i18n.t('データなし', '暂无数据')}</td></tr>`]
      )}
      ${FOS.publicOrderStats.statCardsHtml(FOS.i18n.t('配送状態別', '按配送状态'), deliveryRows)}
      ${FOS.publicOrderStats.statCardsHtml(FOS.i18n.t('支払方法別', '按支付方式'), paymentRows)}
    `;
  },
};
