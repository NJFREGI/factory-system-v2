/**
 * factory-system-v2 · 商家销售额统计（Phase 4）
 * 口径：排除 cancelled；客单价 = 销售额 ÷ 订单数
 */
window.FOS = window.FOS || {};

FOS.merchantStats = {
  excludedStatuses() {
    return FOS.CONFIG.SALES_EXCLUDED_STATUSES || ['cancelled'];
  },

  isCountable(order) {
    return order && !FOS.merchantStats.excludedStatuses().includes(order.status);
  },

  todayRange() {
    const d = FOS.fmt.today();
    return { from: d, to: d };
  },

  monthRange(yearMonth) {
    const [y, m] = (yearMonth || '').split('-').map(Number);
    const year = y || new Date().getFullYear();
    const month = m || new Date().getMonth() + 1;
    const lastDay = new Date(year, month, 0).getDate();
    const mm = String(month).padStart(2, '0');
    return {
      from: `${year}-${mm}-01`,
      to: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
    };
  },

  currentMonthRange() {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return FOS.merchantStats.monthRange(ym);
  },

  normalizeRange(from, to) {
    const f = (from || '').trim();
    const t = (to || '').trim();
    if (!f || !t) throw new Error(FOS.i18n.t('期間を選択してください', '请选择日期范围'));
    if (f > t) throw new Error(FOS.i18n.t('開始日は終了日以前にしてください', '开始日期不能晚于结束日期'));
    return { from: f, to: t };
  },

  summarize(orders) {
    const list = orders || [];
    const orderCount = list.length;
    const salesTotal = list.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const aov = orderCount ? Math.round(salesTotal / orderCount) : 0;
    return { orderCount, salesTotal, aov };
  },

  resolveMerchantId(order) {
    return order?.merchant_id || FOS.CONFIG.DEFAULT_MERCHANT_ID;
  },

  async fetchOrders({ merchantId, from, to } = {}) {
    const range = FOS.merchantStats.normalizeRange(from, to);
    let query = FOS.db.sb
      .from('orders')
      .select('id, total, order_date, status, merchant_id')
      .gte('order_date', range.from)
      .lte('order_date', range.to);

    if (merchantId) query = query.eq('merchant_id', merchantId);

    const excluded = FOS.merchantStats.excludedStatuses();
    excluded.forEach((status) => {
      query = query.neq('status', status);
    });

    const { data, error } = await query.order('order_date', { ascending: false });
    if (error) throw new Error(error.message);
    return (data || []).filter(FOS.merchantStats.isCountable);
  },

  async getSummary({ merchantId, from, to } = {}) {
    const range = FOS.merchantStats.normalizeRange(from, to);
    const orders = await FOS.merchantStats.fetchOrders({
      merchantId,
      from: range.from,
      to: range.to,
    });
    return {
      ...FOS.merchantStats.summarize(orders),
      from: range.from,
      to: range.to,
      merchantId: merchantId || null,
    };
  },

  async getProductRanking({ merchantId, from, to, limit = 10 } = {}) {
    const range = FOS.merchantStats.normalizeRange(from, to);
    const orders = await FOS.merchantStats.fetchOrders({
      merchantId,
      from: range.from,
      to: range.to,
    });
    const orderIds = orders.map((o) => o.id);
    if (!orderIds.length) return [];

    const { data, error } = await FOS.db.sb
      .from('order_items')
      .select('product_id, product_name, qty, unit_price')
      .in('order_id', orderIds);
    if (error) throw new Error(error.message);

    const map = {};
    (data || []).forEach((item) => {
      const key = item.product_id || item.product_name || 'unknown';
      if (!map[key]) {
        map[key] = {
          product_id: item.product_id,
          product_name: item.product_name || key,
          qty: 0,
          amount: 0,
        };
      }
      map[key].qty += Number(item.qty) || 0;
      map[key].amount += (Number(item.unit_price) || 0) * (Number(item.qty) || 0);
    });

    return Object.values(map)
      .sort((a, b) => b.qty - a.qty || b.amount - a.amount)
      .slice(0, limit);
  },

  async getMerchantBreakdown({ from, to } = {}) {
    const range = FOS.merchantStats.normalizeRange(from, to);
    const orders = await FOS.merchantStats.fetchOrders({
      from: range.from,
      to: range.to,
    });
    const buckets = {};
    orders.forEach((order) => {
      const mid = FOS.merchantStats.resolveMerchantId(order);
      if (!buckets[mid]) buckets[mid] = [];
      buckets[mid].push(order);
    });
    return Object.entries(buckets)
      .map(([merchantId, list]) => ({
        merchantId,
        ...FOS.merchantStats.summarize(list),
      }))
      .sort((a, b) => b.salesTotal - a.salesTotal);
  },

  async getGlobalSnapshots() {
    const today = FOS.merchantStats.todayRange();
    const month = FOS.merchantStats.currentMonthRange();
    const [todayStats, monthStats] = await Promise.all([
      FOS.merchantStats.getSummary({ from: today.from, to: today.to }),
      FOS.merchantStats.getSummary({ from: month.from, to: month.to }),
    ]);
    return { today: todayStats, month: monthStats, todayRange: today, monthRange: month };
  },
};
