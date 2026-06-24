/**
 * 顾客扫码下单 · RPC 封装与本地资料
 */
window.FOS = window.FOS || {};

FOS.publicOrder = {
  SOURCES: {
    SHOP_ACCOUNT: 'shop_account',
    PUBLIC_ORDER: 'public_order',
    WECHAT_GROUP: 'wechat_group',
  },

  PAYMENT_METHODS: [
    { id: 'cash', labelJa: '現金', labelZh: '现金' },
    { id: 'paypay', labelJa: 'PayPay', labelZh: 'PayPay' },
    { id: 'wechat', labelJa: 'WeChat', labelZh: '微信' },
    { id: 'alipay', labelJa: 'Alipay', labelZh: '支付宝' },
    { id: 'bank_transfer', labelJa: '銀行振込', labelZh: '银行转账' },
  ],

  DELIVERY_SLOTS: [
    { id: 'unspecified', labelJa: '指定なし', labelZh: '不指定' },
    { id: 'morning', labelJa: '午前', labelZh: '上午' },
    { id: 'afternoon', labelJa: '午後', labelZh: '下午' },
    { id: 'evening', labelJa: '夜間', labelZh: '晚上' },
  ],

  publicShopId(merchantId) {
    return `public_${String(merchantId || '').trim()}`;
  },

  isVirtualShopId(shopId) {
    return String(shopId || '').startsWith('public_');
  },

  isShopAccountOrder(order) {
    if (!order) return false;
    const src = order.order_source;
    return !src || src === FOS.publicOrder.SOURCES.SHOP_ACCOUNT;
  },

  isPublicOrder(order) {
    if (!order) return false;
    const src = order.order_source;
    return src === FOS.publicOrder.SOURCES.PUBLIC_ORDER
      || src === FOS.publicOrder.SOURCES.WECHAT_GROUP
      || src === 'public_qr';
  },

  isWechatGroupOrder(order) {
    return order?.order_source === FOS.publicOrder.SOURCES.WECHAT_GROUP;
  },

  orderSourceLabel(order) {
    if (FOS.publicOrder.isWechatGroupOrder(order)) {
      return FOS.i18n.t('微信群注文', '微信群订单');
    }
    if (FOS.publicOrder.isPublicOrder(order)) {
      return FOS.i18n.t('物産店注文', '物产店订单');
    }
    return FOS.i18n.t('店舗注文', '门店订单');
  },

  profileKey(merchantId, channelId) {
    return `public_profile_${merchantId}_${channelId}`;
  },

  loadProfile(merchantId, channelId) {
    return FOS.storage.get(FOS.publicOrder.profileKey(merchantId, channelId)) || {};
  },

  saveProfile(merchantId, channelId, profile) {
    FOS.storage.set(FOS.publicOrder.profileKey(merchantId, channelId), {
      name: String(profile.name || '').trim(),
      phone: String(profile.phone || '').trim(),
      address: String(profile.address || '').trim(),
    });
  },

  _decodeQueryPart(value) {
    if (!value) return '';
    let out = String(value).trim();
    for (let i = 0; i < 3; i++) {
      try {
        const next = decodeURIComponent(out.replace(/\+/g, ' '));
        if (next === out) break;
        out = next;
      } catch {
        break;
      }
    }
    return out.trim();
  },

  _pickQueryParam(search, keys) {
    const raw = String(search || '').startsWith('?') ? String(search).slice(1) : String(search || '');
    if (!raw) return '';

    const params = new URLSearchParams(raw);
    for (const key of keys) {
      const hit = params.get(key);
      if (hit) return FOS.publicOrder._decodeQueryPart(hit);
    }

    let decoded = raw;
    for (let i = 0; i < 3; i++) {
      try {
        const next = decodeURIComponent(decoded.replace(/\+/g, ' '));
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }

    for (const key of keys) {
      const re = new RegExp(`(?:^|[&?])${key}=([^&]*)`, 'i');
      const m = decoded.match(re);
      if (m) return FOS.publicOrder._decodeQueryPart(m[1]);
    }

    for (const [key, val] of params.entries()) {
      const blob = val || key;
      if (!/(?:^|[&?])(merchant|channel|group|view|code)=/i.test(blob)) continue;
      const inner = blob.startsWith('?') ? blob.slice(1) : blob;
      const nested = new URLSearchParams(inner);
      for (const nk of keys) {
        const hit = nested.get(nk);
        if (hit) return FOS.publicOrder._decodeQueryPart(hit);
      }
      for (const nk of keys) {
        const re = new RegExp(`(?:^|[&?])${nk}=([^&]*)`, 'i');
        const m = inner.match(re);
        if (m) return FOS.publicOrder._decodeQueryPart(m[1]);
      }
    }

    return '';
  },

  parseFromLocation(loc = window.location) {
    const settlement = FOS.publicOrder._pickQueryParam(loc.search, ['settlement', 'settle']);
    return {
      merchantId: FOS.publicOrder._pickQueryParam(loc.search, ['merchant', 'merchant_id']),
      channelId: FOS.publicOrder._pickQueryParam(loc.search, ['channel', 'group', 'group_id']),
      view: FOS.publicOrder._pickQueryParam(loc.search, ['view']),
      code: FOS.publicOrder._pickQueryParam(loc.search, ['code']),
      mode: FOS.publicOrder._pickQueryParam(loc.search, ['mode']),
      settlement: settlement === 'cash' || settlement === 'monthly' ? settlement : '',
      shopId: FOS.publicOrder._pickQueryParam(loc.search, ['shop', 'shop_id']),
    };
  },

  resolvePublicH5Base(loc = window.location) {
    const fromConfig = FOS.config?.publicAppBaseUrl?.(loc);
    if (fromConfig) return fromConfig;
    if (FOS.appUrls?.publicBase) {
      const fromAppUrls = FOS.appUrls.publicBase(loc);
      if (fromAppUrls) return fromAppUrls;
    }
    const cfg = FOS.CONFIG || window.FOS_CONFIG || {};
    const legacy = String(cfg.PUBLIC_APP_BASE_URL || cfg.public_h5_base_url || '')
      .trim()
      .replace(/\/+$/, '');
    if (legacy && !/localhost|127\.0\.0\.1/i.test(legacy)) return legacy;
    return '';
  },

  buildOrderUrl({ merchantId, channelId, mode, settlement, shopId } = {}) {
    const base = FOS.publicOrder.resolvePublicH5Base();
    if (!base) {
      throw new Error('PUBLIC_APP_BASE_URL_missing');
    }
    const url = new URL(`${base}/apps/customer-order/`);
    if (merchantId) url.searchParams.set('merchant', merchantId);
    if (channelId) url.searchParams.set('channel', channelId);
    if (mode) url.searchParams.set('mode', mode);
    if (settlement === 'cash' || settlement === 'monthly') url.searchParams.set('settlement', settlement);
    if (shopId) url.searchParams.set('shop', String(shopId).trim());
    return url.toString();
  },

  /** 散客渠道二维码：固定现结 + 顾客登录 */
  buildGuestChannelUrl({ merchantId, channelId } = {}) {
    return FOS.publicOrder.buildOrderUrl({
      merchantId,
      channelId,
      mode: 'customer',
      settlement: 'cash',
    });
  },

  /** 月结店铺扫码下单 */
  buildMonthlyShopOrderUrl({ merchantId, channelId, shopId } = {}) {
    return FOS.publicOrder.buildOrderUrl({
      merchantId,
      channelId,
      mode: 'shop',
      settlement: 'monthly',
      shopId,
    });
  },

  isShopLoginUrl(params) {
    if (!params) return false;
    return params.settlement === 'monthly';
  },

  isCustomerAuthUrl(params) {
    if (!params) return false;
    return params.settlement === 'cash';
  },

  customerSessionKey(merchantId) {
    return `co_customer_session_${merchantId}`;
  },

  loadCustomerSession(merchantId) {
    return FOS.storage.get(FOS.publicOrder.customerSessionKey(merchantId));
  },

  saveCustomerSession(merchantId, session) {
    FOS.storage.set(FOS.publicOrder.customerSessionKey(merchantId), {
      id: session.id,
      phone: session.phone,
      name: session.name || '',
      address: session.address || '',
      settlement_type: session.settlement_type || 'cash',
    });
  },

  clearCustomerSession(merchantId) {
    FOS.storage.set(FOS.publicOrder.customerSessionKey(merchantId), null);
  },

  async registerCustomer({ merchantId, phone, password, name, address }) {
    const { data, error } = await FOS.db.sb.rpc('customer_account_register', {
      p_payload: { merchant_id: merchantId, phone, password, name: name || '', address: address || '' },
    });
    if (error) throw error;
    return data;
  },

  async loginCustomer({ merchantId, phone, password }) {
    const { data, error } = await FOS.db.sb.rpc('customer_account_login', {
      p_payload: { merchant_id: merchantId, phone, password },
    });
    if (error) throw error;
    return data;
  },

  buildLookupUrl(loc = window.location) {
    const parsed = FOS.publicOrder.parseFromLocation(loc);
    const base = FOS.publicOrder.resolvePublicH5Base(loc);
    if (!base) {
      throw new Error('PUBLIC_APP_BASE_URL_missing');
    }
    const url = new URL(`${base}/apps/customer-order/`);
    url.searchParams.set('view', 'lookup');
    if (parsed.merchantId) url.searchParams.set('merchant', parsed.merchantId);
    if (parsed.channelId) url.searchParams.set('channel', parsed.channelId);
    return url.toString();
  },

  paymentLabel(id) {
    const m = FOS.publicOrder.PAYMENT_METHODS.find((x) => x.id === id);
    return m ? FOS.i18n.t(m.labelJa, m.labelZh) : id || '—';
  },

  slotLabel(id) {
    const s = FOS.publicOrder.DELIVERY_SLOTS.find((x) => x.id === id);
    return s ? FOS.i18n.t(s.labelJa, s.labelZh) : id || '—';
  },

  deliveryStatusLabel(status) {
    const map = {
      new: ['受付待ち', '待接单'],
      accepted: ['受付済', '已接单'],
      delivering: ['配送中', '配送中'],
      delivered: ['配達完了', '已送达'],
      cancelled: ['キャンセル', '已取消'],
    };
    const pair = map[status];
    return pair ? FOS.i18n.t(pair[0], pair[1]) : status || '—';
  },

  formatDeliveryWish(order) {
    if (!order) return '—';
    const parts = [];
    if (order.delivery_preferred_date) parts.push(order.delivery_preferred_date);
    if (order.delivery_preferred_slot && order.delivery_preferred_slot !== 'unspecified') {
      parts.push(FOS.publicOrder.slotLabel(order.delivery_preferred_slot));
    }
    if (order.delivery_time_note) parts.push(order.delivery_time_note);
    return parts.length ? parts.join(' · ') : FOS.i18n.t('指定なし', '不指定');
  },

  newChannelId() {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    return `ch_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  },

  async getContext(channelId) {
    const { data, error } = await FOS.db.sb.rpc('get_public_order_context', {
      p_channel_id: channelId,
    });
    if (error) throw error;
    return data;
  },

  async createOrder(payload) {
    const { data, error } = await FOS.db.sb.rpc('create_public_order', {
      p_payload: payload,
    });
    if (error) throw error;
    return data;
  },

  async createShopOrder(payload) {
    const { data, error } = await FOS.db.sb.rpc('create_shop_channel_order', {
      p_payload: payload,
    });
    if (error) throw error;
    return data;
  },

  async loginShopChannel({ merchantId, loginId, password, shopId } = {}) {
    const { data, error } = await FOS.db.sb.rpc('shop_channel_login', {
      p_payload: {
        merchant_id: merchantId,
        login_id: loginId,
        password,
        shop_id: shopId || '',
      },
    });
    if (error) throw error;
    return data;
  },

  shopSessionKey(merchantId, channelId) {
    return `co_shop_session_${merchantId}_${channelId}`;
  },

  loadShopSession(merchantId, channelId) {
    return FOS.storage.get(FOS.publicOrder.shopSessionKey(merchantId, channelId));
  },

  saveShopSession(merchantId, channelId, session) {
    FOS.storage.set(FOS.publicOrder.shopSessionKey(merchantId, channelId), {
      id: session.id,
      name: session.name,
      address: session.address || '',
      phone: session.phone || '',
      contact_name: session.contact_name || '',
      settlement_type: session.settlement_type || 'monthly',
      password: session.password || '',
    });
  },

  clearShopSession(merchantId, channelId) {
    FOS.storage.set(FOS.publicOrder.shopSessionKey(merchantId, channelId), null);
  },

  paymentTypeLabel(order) {
    const pt = order?.payment_type;
    if (pt === 'monthly') return FOS.i18n.t('月払い', '月结');
    if (pt) return FOS.publicOrder.paymentLabel(pt);
    return '—';
  },

  async listCustomerOrders({ merchantId, phone, channelId }) {
    const { data, error } = await FOS.db.sb.rpc('list_customer_orders', {
      p_payload: {
        merchant_id: merchantId,
        phone,
        channel_id: channelId || '',
      },
    });
    if (error) throw error;
    return Array.isArray(data) ? data : (data?.orders || []);
  },

  async queryOrder(phone, code) {
    const { data, error } = await FOS.db.sb.rpc('query_public_order', {
      p_phone: phone,
      p_code: code,
    });
    if (error) throw error;
    return data;
  },

  mapRpcError(err) {
    const msg = err?.message || '';
    const map = {
      channel_not_found: FOS.i18n.t('注文ページが無効です', '下单链接无效或已停用'),
      merchant_inactive: FOS.i18n.t('店舗は利用できません', '店铺暂不可用'),
      customer_info_required: FOS.i18n.t('氏名・電話・住所を入力してください', '请填写姓名、电话和地址'),
      items_required: FOS.i18n.t('商品を選択してください', '请选择商品'),
      insufficient_stock: FOS.i18n.t('在庫不足', '库存不足'),
      invalid_payment_method: FOS.i18n.t('支払方法を選択してください', '请选择支付方式'),
      phone_and_code_required: FOS.i18n.t('電話番号と注文番号を入力してください', '请输入手机号和订单号'),
      shop_login_required: FOS.i18n.t('店舗IDとパスワードを入力してください', '请输入店铺账号和密码'),
      shop_login_invalid: FOS.i18n.t('店舗IDまたはパスワードが違います', '店铺账号或密码错误'),
      shop_settlement_mismatch: FOS.i18n.t('このQRは月払い店舗専用です', '此二维码仅限月结店铺登录'),
      phone_password_required: FOS.i18n.t('電話番号とパスワードを入力してください', '请输入手机号和密码'),
      password_too_short: FOS.i18n.t('パスワードは4文字以上', '密码至少 4 位'),
      phone_already_registered: FOS.i18n.t('この電話番号は登録済みです', '该手机号已注册，请直接登录'),
      customer_login_invalid: FOS.i18n.t('電話番号またはパスワードが違います', '手机号或密码错误'),
      address_required: FOS.i18n.t('住所を入力してください', '请填写地址'),
      phone_required: FOS.i18n.t('電話番号を入力してください', '请输入手机号'),
    };
    for (const [key, label] of Object.entries(map)) {
      if (msg.includes(key)) return label;
    }
    return msg || FOS.i18n.t('エラーが発生しました', '发生错误');
  },
};
