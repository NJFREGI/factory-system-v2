/**
 * 结账方式：月结 / 现结 + 现结方式管理 + 汇总
 */
window.FOS = window.FOS || {};

FOS.payment = {
  SETTLEMENT: { MONTHLY: 'monthly', CASH: 'cash' },

  DEFAULT_METHODS: [
    { id: 'local_cash', name: '現金', sort_order: 1 },
    { id: 'local_transfer', name: '振込', sort_order: 2 },
    { id: 'local_card', name: 'クレジット', sort_order: 3 },
    { id: 'local_paypay', name: 'PayPay', sort_order: 4 },
  ],

  settlementLabel(type, lang) {
    const l = lang || FOS.i18n?.lang || 'ja';
    if (type === FOS.payment.SETTLEMENT.CASH) {
      return l === 'zh' ? '现结' : '都度払い';
    }
    return l === 'zh' ? '月结' : '月締め';
  },

  methodLabel(order) {
    if (!order) return '—';
    if (order.settlement_type === FOS.payment.SETTLEMENT.MONTHLY) {
      return FOS.payment.settlementLabel(FOS.payment.SETTLEMENT.MONTHLY);
    }
    return order.payment_method_name || '—';
  },

  _methodsStorageKey() {
    return `payment_methods_${FOS.merchants.scopeId() || 'default'}`;
  },

  _isSchemaError(error) {
    const msg = `${error?.message || ''} ${error?.code || ''}`;
    return /payment_methods|settlement_type|payment_method|column|schema cache|42703|PGRST/i.test(msg);
  },

  _shopSettlementKey() {
    return `shop_settlement_${FOS.merchants.scopeId() || 'default'}`;
  },

  getShopSettlementOverrides() {
    return FOS.storage.get(FOS.payment._shopSettlementKey()) || {};
  },

  setShopSettlement(shopId, type) {
    const map = FOS.payment.getShopSettlementOverrides();
    map[shopId] = type;
    FOS.storage.set(FOS.payment._shopSettlementKey(), map);
  },

  clearShopSettlementOverride(shopId) {
    const map = FOS.payment.getShopSettlementOverrides();
    delete map[shopId];
    FOS.storage.set(FOS.payment._shopSettlementKey(), map);
  },

  resolveShopSettlement(shop) {
    const overrides = FOS.payment.getShopSettlementOverrides();
    if (shop?.id && overrides[shop.id]) return overrides[shop.id];
    return shop?.settlement_type || FOS.payment.SETTLEMENT.MONTHLY;
  },

  _localPaymentsKey() {
    return `payment_records_${FOS.merchants.scopeId() || 'default'}`;
  },

  saveLocalPaymentRecord(orderId, data) {
    const map = FOS.storage.get(FOS.payment._localPaymentsKey()) || {};
    map[String(orderId)] = { ...data, payment_recorded_at: data.payment_recorded_at || new Date().toISOString() };
    FOS.storage.set(FOS.payment._localPaymentsKey(), map);
  },

  mergeOrderPayment(order) {
    if (!order) return order;
    const local = (FOS.storage.get(FOS.payment._localPaymentsKey()) || {})[String(order.id)];
    if (!local) return order;
    return {
      ...order,
      settlement_type: local.settlement_type || order.settlement_type,
      payment_method_name: local.payment_method_name || order.payment_method_name,
      payment_recorded_at: local.payment_recorded_at || order.payment_recorded_at,
    };
  },

  _schemaReady: null,

  async isSchemaReady() {
    if (FOS.payment._schemaReady !== null) return FOS.payment._schemaReady;
    const { error } = await FOS.db.sb.from('orders').select('settlement_type, payment_method_name').limit(1);
    FOS.payment._schemaReady = !error || !FOS.payment._isSchemaError(error);
    return FOS.payment._schemaReady;
  },

  schemaBannerHtml() {
    return `<div class="alert alert--warn payment-schema-banner">${FOS.i18n.t(
      '決済機能の DB 設定が未完了です。Supabase SQL Editor で <strong>schema-payment.sql</strong> を実行してください。実行前は端末に一時保存されます。',
      '结账功能数据库尚未配置。请在 Supabase SQL Editor 执行 <strong>schema-payment.sql</strong>。执行前数据会暂存在本机浏览器。'
    )}</div>`;
  },

  async listMethods() {
    const { data, error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('payment_methods').select('*').eq('active', true).order('sort_order')
    );
    if (error) {
      if (FOS.payment._isSchemaError(error)) {
        return FOS.storage.get(FOS.payment._methodsStorageKey()) || FOS.payment.DEFAULT_METHODS.map((m) => ({ ...m }));
      }
      throw error;
    }
    if (!data?.length) return FOS.payment.DEFAULT_METHODS.map((m) => ({ ...m }));
    return data;
  },

  async listAllMethods() {
    const { data, error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('payment_methods').select('*').order('sort_order')
    );
    if (error) {
      if (FOS.payment._isSchemaError(error)) {
        return FOS.storage.get(FOS.payment._methodsStorageKey()) || FOS.payment.DEFAULT_METHODS.map((m) => ({ ...m, active: true }));
      }
      throw error;
    }
    return data || [];
  },

  async addMethod(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error(FOS.i18n.t('名称を入力してください', '请输入名称'));
    const merchantId = FOS.merchants.scopeId();
    const { data, error } = await FOS.db.sb.from('payment_methods').insert({
      merchant_id: merchantId,
      name: trimmed,
      sort_order: 99,
      active: true,
    }).select('*').single();
    if (error) {
      if (FOS.payment._isSchemaError(error)) {
        const list = FOS.storage.get(FOS.payment._methodsStorageKey()) || FOS.payment.DEFAULT_METHODS.map((m) => ({ ...m, active: true }));
        const row = { id: `local_${Date.now()}`, name: trimmed, sort_order: list.length + 1, active: true };
        list.push(row);
        FOS.storage.set(FOS.payment._methodsStorageKey(), list);
        return row;
      }
      throw error;
    }
    return data;
  },

  async deleteMethod(id) {
    if (String(id).startsWith('local_')) {
      const list = (FOS.storage.get(FOS.payment._methodsStorageKey()) || []).filter((m) => m.id !== id);
      FOS.storage.set(FOS.payment._methodsStorageKey(), list);
      return;
    }
    const { error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('payment_methods').update({ active: false }).eq('id', id)
    );
    if (error && !FOS.payment._isSchemaError(error)) throw error;
  },

  async recordDeliveryPayment(orderId, { settlementType, paymentMethodId, paymentMethodName }) {
    const ts = new Date().toISOString();
    const { data: order } = await FOS.db.sb
      .from('orders')
      .select('order_source')
      .eq('id', orderId)
      .maybeSingle();
    const payload = {
      status: 'delivered',
      settlement_type: settlementType,
      payment_method_id: paymentMethodId || null,
      payment_method_name: settlementType === FOS.payment.SETTLEMENT.MONTHLY
        ? FOS.payment.settlementLabel(FOS.payment.SETTLEMENT.MONTHLY)
        : (paymentMethodName || null),
      payment_recorded_at: ts,
      updated_at: ts,
    };
    if (order?.order_source && order.order_source !== 'shop_account') {
      payload.delivery_status = 'delivered';
      payload.payment_status = 'paid';
    }
    const { error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('orders').update(payload).eq('id', orderId)
    );
    if (error && FOS.payment._isSchemaError(error)) {
      const { error: statusErr } = await FOS.merchants.scopeFilter(
        FOS.db.sb.from('orders').update({ status: 'delivered', updated_at: ts }).eq('id', orderId)
      );
      if (statusErr) {
        throw new Error(FOS.i18n.t(
          'Supabaseで schema-payment.sql を実行してください',
          '请在 Supabase 执行 schema-payment.sql'
        ));
      }
      FOS.payment.saveLocalPaymentRecord(orderId, payload);
      return { local: true };
    }
    if (error) throw error;
    const localMap = FOS.storage.get(FOS.payment._localPaymentsKey()) || {};
    delete localMap[String(orderId)];
    FOS.storage.set(FOS.payment._localPaymentsKey(), localMap);
    return { local: false };
  },

  async loadShopSettlementMap() {
    let { data, error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('users').select('id, name, settlement_type, phone, address').eq('role', 'order').eq('active', true)
    );
    if (error && /settlement_type|phone|address|column/i.test(error.message || '')) {
      ({ data } = await FOS.merchants.scopeFilter(
        FOS.db.sb.from('users').select('id, name').eq('role', 'order').eq('active', true)
      ));
    }
    const map = {};
    (data || []).forEach((s) => {
      map[s.id] = {
        ...s,
        settlement_type: FOS.payment.resolveShopSettlement(s),
      };
    });
    return map;
  },

  enrichOrders(orders) {
    return (orders || []).map((o) => FOS.payment.mergeOrderPayment(o));
  },

  paidOrdersFilter(orders, date) {
    return FOS.payment.enrichOrders(orders).filter((o) => {
      if (!['delivered', 'confirmed'].includes(o.status)) return false;
      if (date && o.order_date !== date) return false;
      return o.payment_recorded_at || o.settlement_type;
    });
  },

  summarize(orders, { methodDefs = [] } = {}) {
    const monthly = { name: FOS.payment.settlementLabel(FOS.payment.SETTLEMENT.MONTHLY), count: 0, total: 0 };
    const byMethod = {};
    (orders || []).forEach((o) => {
      const amount = o.total || 0;
      const isShopMonthly = (o.settlement_type === FOS.payment.SETTLEMENT.MONTHLY || o.payment_type === 'monthly')
        && (!o.order_source || o.order_source === 'shop_account');
      if (isShopMonthly) {
        monthly.count += 1;
        monthly.total += amount;
        return;
      }
      let key = o.payment_method_name;
      if (!key && FOS.publicOrder?.isPublicOrder?.(o) && o.customer_payment_method) {
        key = FOS.publicOrder.paymentLabel(o.customer_payment_method);
      }
      key = key || FOS.i18n.t('未設定', '未设置');
      if (!byMethod[key]) byMethod[key] = { name: key, count: 0, total: 0 };
      byMethod[key].count += 1;
      byMethod[key].total += amount;
    });
    (methodDefs || []).forEach((m) => {
      const name = m.name || m.label;
      if (name && !byMethod[name]) byMethod[name] = { name, count: 0, total: 0 };
    });
    const methods = Object.values(byMethod).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return { monthly, methods, grandTotal: (orders || []).reduce((s, o) => s + (o.total || 0), 0) };
  },

  detailRowsHtml(orders) {
    if (!orders.length) {
      return `<tr><td colspan="5" class="table-empty">${FOS.i18n.t('データなし', '暂无数据')}</td></tr>`;
    }
    return orders.map((o) => {
      const time = o.payment_recorded_at
        ? new Date(o.payment_recorded_at).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '—';
      return `<tr>
        <td>#${o.order_no}</td>
        <td>${FOS.fmt.escapeHtml(FOS.fmt.displayName(o.shop_name))}</td>
        <td>${FOS.fmt.escapeHtml(FOS.payment.methodLabel(o))}</td>
        <td class="num">${FOS.fmt.money(o.total)}</td>
        <td>${time}</td>
      </tr>`;
    }).join('');
  },

  summaryCardsHtml(summary) {
    const cards = [];
    cards.push(`<div class="stat-card payment-sum-card${summary.monthly.count ? '' : ' payment-sum-card--empty'}">
      <div class="stat-card__label">${FOS.fmt.escapeHtml(summary.monthly.name)}</div>
      <div class="stat-card__value">${FOS.fmt.money(summary.monthly.total)}</div>
      <div class="stat-card__sub">${summary.monthly.count} ${FOS.i18n.t('件', '笔')}</div>
    </div>`);
    summary.methods.forEach((m) => {
      cards.push(`<div class="stat-card payment-sum-card${m.count ? '' : ' payment-sum-card--empty'}">
        <div class="stat-card__label">${FOS.fmt.escapeHtml(m.name)}</div>
        <div class="stat-card__value">${FOS.fmt.money(m.total)}</div>
        <div class="stat-card__sub">${m.count} ${FOS.i18n.t('件', '笔')}</div>
      </div>`);
    });
    if (!summary.methods.length && !summary.monthly.count) {
      return FOS.ui.empty('💰', FOS.i18n.t('集計なし', '暂无汇总'));
    }
    return `<div class="stat-grid payment-sum-grid">${cards.join('')}</div>
      <div class="payment-grand-total">
        <div class="payment-grand-total__box">
          <span class="payment-grand-total__label">${FOS.i18n.t('合計', '合计')}</span>
          <strong class="payment-grand-total__amount">${FOS.fmt.money(summary.grandTotal)}</strong>
        </div>
      </div>`;
  },
};
