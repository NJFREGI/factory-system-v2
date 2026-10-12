window.FOS = window.FOS || {};

FOS.orders = {
  async checked(query, requireRow = false) {
    const { data, error } = await query;
    if (error) throw new Error(error.message || '数据库操作失败');
    if (requireRow && (!data || (Array.isArray(data) && !data.length))) {
      throw new Error('数据未保存：记录不存在或无权限');
    }
    return data;
  },

  async mutate(operation, payload = {}) {
    const user = FOS.auth.user;
    if (!user?.id) throw new Error('请重新登录');
    const key = 'order_request_' + user.id + '_' + operation + '_' + (payload.order_id || 'cart');
    const fingerprint = JSON.stringify(payload);
    let pending = FOS.storage.get(key);
    if (pending && pending.fingerprint !== fingerprint) {
      throw new Error('上一次操作结果尚未确认，请先恢复原操作内容并重试，避免重复下单');
    }
    if (!pending) {
      pending = { fingerprint, id: crypto.randomUUID() };
      FOS.storage.set(key, pending);
    }
    const { data, error } = await FOS.db.sb.rpc('fos_mutate_order', {
      // 操作者由数据库根据 Supabase Auth 会话识别，不再传账号和密码
      p_payload: { ...payload, operation, request_id: pending.id },
    });
    if (error) {
      // Explicit database errors mean rollback; transport errors have an unknown commit outcome.
      if (error.code && error.code !== 'PGRST002' && error.code !== 'PGRST000') FOS.storage.set(key, null);
      throw new Error(error.code === 'PGRST202' ? '订单功能升级尚未完成，请联系管理员' : (error.message || '网络异常，请重试同一操作'));
    }
    if (!data?.id) throw new Error('订单操作结果不完整，请重试');
    FOS.storage.set(key, null);
    return data;
  },

  async submit(items, orderDate, note) {
    return FOS.orders.mutate('submit', {items: items.map(i => ({product_id: i.product_id, qty: i.qty})), order_date: orderDate, note});
  },

  hasSubmittedAtField(order) {
    return !!order && Object.prototype.hasOwnProperty.call(order, 'shop_submitted_at');
  },

  isShopSubmitted(order) {
    if (!order) return false;
    if (!FOS.orders.hasSubmittedAtField(order)) return true;
    return order.shop_submitted_at != null && order.shop_submitted_at !== '';
  },

  wasShopSubmitted(oldRow) {
    if (!oldRow) return false;
    if (!FOS.orders.hasSubmittedAtField(oldRow)) return false;
    return oldRow.shop_submitted_at != null && oldRow.shop_submitted_at !== '';
  },

  forFactoryQuery(query) {
    return FOS.merchants.scopeFilter(query).not('shop_submitted_at', 'is', null);
  },

  async confirmShopSubmission(orderId) {
    return FOS.orders.mutate('confirm', {order_id: orderId});
  },

  itemPayload(item) {
    const payload = {
      product_id: item.product_id,
      product_name: item.product_name,
      product_spec: item.product_spec,
      product_emoji: item.product_emoji,
      unit_price: item.unit_price,
      tax_rate: item.tax_rate,
      qty: item.qty,
    };
    if (item.admin_edit) payload.admin_edit = item.admin_edit;
    return payload;
  },

  shortageQty(item) {
    if (item?.shortage_qty != null && item.shortage_qty !== '') {
      const n = parseInt(item.shortage_qty, 10);
      if (Number.isFinite(n) && n > 0) return Math.min(n, item.qty || n);
    }
    if (item?.shortage) return item.qty || 0;
    return 0;
  },

  deliveredQty(item) {
    return Math.max(0, (item.qty || 0) - FOS.orders.shortageQty(item));
  },

  parseEditShortageQty(raw, orderQty) {
    const qty = parseInt(orderQty, 10) || 0;
    let sq = parseInt(raw, 10);
    if (!Number.isFinite(sq) || sq < 0) sq = 0;
    return Math.min(sq, qty);
  },

  shortageBadge(item) {
    const sq = FOS.orders.shortageQty(item);
    if (sq <= 0) return '';
    const total = item.qty || 0;
    const label = sq >= total
      ? FOS.i18n.t('欠品', '缺货')
      : FOS.i18n.t(`欠${sq}/${total}`, `缺${sq}/${total}`);
    return `<span class="badge badge--red order-item-shortage-tag">${FOS.fmt.escapeHtml(label)}</span>`;
  },

  shortageRowClass(item) {
    return FOS.orders.shortageQty(item) > 0 ? 'order-item-row--shortage' : '';
  },

  editShortageFieldHtml(item, idx) {
    const sq = FOS.orders.shortageQty(item);
    const max = item.qty || 0;
    return `
    <label class="edit-item-row__shortage-qty">
      ${FOS.i18n.t('欠品数', '缺货数')}
      <input type="number" min="0" max="${max}" value="${sq}" class="field__input" id="eshortqty_${idx}">
    </label>`;
  },

  adminEditLabel(edit) {
    if (edit === 'added') return FOS.i18n.t('管理追加', '后台添加');
    if (edit === 'modified') return FOS.i18n.t('管理変更', '后台修改');
    return '';
  },

  adminEditBadge(item) {
    const label = FOS.orders.adminEditLabel(item?.admin_edit);
    if (!label) return '';
    const cls = item.admin_edit === 'added' ? 'badge--blue' : 'badge--orange';
    return `<span class="badge ${cls} order-item-admin-tag">${FOS.fmt.escapeHtml(label)}</span>`;
  },

  adminEditRowClass(item) {
    if (item?.admin_edit === 'added') return 'order-item-row--admin-added';
    if (item?.admin_edit === 'modified') return 'order-item-row--admin-modified';
    return '';
  },

  orderLineItemHtml(item, itemIdx, opts = {}) {
    const { showEmoji = false, showShortage = true } = opts;
    const spec = item.product_spec
      ? `<span class="order-line-item__spec">(${FOS.fmt.escapeHtml(item.product_spec)})</span>`
      : '';
    const adminCls = FOS.orders.adminEditRowClass(item);
    const altCls = itemIdx % 2 ? ' order-line-item--alt' : '';
    const emoji = showEmoji
      ? `<span class="order-line-item__emoji" aria-hidden="true">${item.product_emoji || '📦'}</span>`
      : '';
    const shortage = showShortage ? FOS.orders.shortageBadge(item) : '';
    const shortageCls = showShortage ? FOS.orders.shortageRowClass(item) : '';
    const delivered = FOS.orders.deliveredQty(item);
    const qtyHint = showShortage && FOS.orders.shortageQty(item) > 0 && delivered < item.qty
      ? `<span class="order-line-item__delivered">${FOS.i18n.t('実発', '实发')}${delivered}</span>`
      : '';
    const adminBadge = FOS.orders.adminEditBadge(item);
    return `<li class="order-line-item${altCls}${adminCls ? ` ${adminCls}` : ''}${shortageCls ? ` ${shortageCls}` : ''}">
      <span class="order-line-item__main">
        ${emoji}<span class="order-line-item__name">${FOS.fmt.escapeHtml(item.product_name)}</span>${spec}
        ${shortage}${adminBadge}
      </span>
      <strong class="order-line-item__qty">×${item.qty}${qtyHint}</strong>
    </li>`;
  },

  async recalc(orderId) {
    return FOS.orders.mutate('recalc', {order_id: orderId});
  },

  async fetchOne(orderId) {
    return FOS.orders.checked(FOS.db.sb.from('orders').select('*, order_items(*)').eq('id', orderId).single(), true);
  },

  async fetchOneForFactory(orderId) {
    return FOS.orders.checked(FOS.orders.forFactoryQuery(
      FOS.db.sb.from('orders').select('*, order_items(*)').eq('id', orderId)
    ).maybeSingle(), true);
  },

  mergeItemMap(itemMap, items) {
    (items || []).forEach((item) => {
      const itemKey = item.product_id || `${item.product_name}::${item.product_spec || ''}`;
      if (!itemMap[itemKey]) {
        itemMap[itemKey] = {
          product_name: item.product_name,
          product_spec: item.product_spec,
          unit_price: item.unit_price,
          qty: 0,
          shortage_qty: 0,
          admin_edit: item.admin_edit || null,
        };
      }
      const row = itemMap[itemKey];
      row.qty += item.qty;
      if (item.admin_edit === 'added') row.admin_edit = 'added';
      else if (item.admin_edit === 'modified' && row.admin_edit !== 'added') row.admin_edit = 'modified';
      row.shortage_qty = (row.shortage_qty || 0) + FOS.orders.shortageQty(item);
      row.shortage = row.shortage_qty > 0;
    });
    return itemMap;
  },

  mergeByShop(orderList) {
    const shopOrders = (orderList || []).filter((o) => !FOS.publicOrder?.isPublicOrder(o));
    const shopMap = {};
    shopOrders.forEach((order) => {
      const key = order.shop_id || order.shop_name;
      if (!shopMap[key]) {
        shopMap[key] = {
          shop_id: order.shop_id,
          shop_name: order.shop_name,
          order_date: order.order_date,
          orders: [],
          itemMap: {},
          total: 0,
          primaryOrder: order,
        };
      }
      const group = shopMap[key];
      group.orders.push(order);
      group.total += order.total || 0;
      if ((order.order_no || 0) < (group.primaryOrder.order_no || 0)) group.primaryOrder = order;
      FOS.orders.mergeItemMap(group.itemMap, order.order_items);
    });
    return Object.values(shopMap).map((group) => ({
      ...group,
      items: Object.values(group.itemMap).sort((a, b) => a.product_name.localeCompare(b.product_name, 'ja')),
    }));
  },

  /** 统计口径：门店同日多单 mergeByShop 合并为 1 单；顾客单按单号各算 1 单 */
  statUnits(orderList) {
    const list = orderList || [];
    const shopList = list.filter((o) => FOS.publicOrder?.isShopAccountOrder?.(o));
    const publicList = list.filter((o) => FOS.publicOrder?.isPublicOrder?.(o));
    const otherList = list.filter((o) => !FOS.publicOrder?.isShopAccountOrder?.(o) && !FOS.publicOrder?.isPublicOrder?.(o));
    const units = [];

    FOS.orders.mergeByShop(shopList).forEach((group) => {
      units.push({
        orders: group.orders,
        order_no: group.primaryOrder?.order_no,
        status: FOS.orders.groupStatStatus(group.orders),
      });
    });

    [...publicList, ...otherList].forEach((order) => {
      units.push({
        orders: [order],
        order_no: order.order_no,
        status: order.status || 'pending',
      });
    });

    return units;
  },

  groupStatStatus(orders) {
    const rows = orders || [];
    if (!rows.length) return 'pending';
    if (rows.every((o) => o.status === 'confirmed')) return 'confirmed';
    if (rows.every((o) => o.status === 'delivered' || o.status === 'confirmed')) return 'delivered';
    const primary = rows.slice().sort((a, b) => (a.order_no || 0) - (b.order_no || 0))[0];
    return primary?.status || 'pending';
  },

  statCounts(orderList) {
    const units = FOS.orders.statUnits(orderList);
    const n = (status) => units.filter((u) => u.status === status).length;
    return {
      total: units.length,
      pending: n('pending'),
      preparing: n('preparing'),
      shipped: n('shipped'),
      delivered: n('delivered'),
      confirmed: n('confirmed'),
    };
  },

  mergeByDate(orderList) {
    const map = {};
    (orderList || []).forEach((order) => {
      const key = order.order_date;
      if (!map[key]) {
        map[key] = {
          order_date: key,
          orders: [],
          itemMap: {},
          total: 0,
          subtotal: 0,
          tax_total: 0,
          primaryOrder: order,
        };
      }
      const group = map[key];
      group.orders.push(order);
      group.total += order.total || 0;
      group.subtotal += order.subtotal || 0;
      group.tax_total += order.tax_total || 0;
      if ((order.order_no || 0) < (group.primaryOrder.order_no || 0)) group.primaryOrder = order;
      FOS.orders.mergeItemMap(group.itemMap, order.order_items);
    });
    return Object.values(map).map((group) => ({
      ...group,
      items: Object.values(group.itemMap).sort((a, b) => a.product_name.localeCompare(b.product_name, 'ja')),
    })).sort((a, b) => b.order_date.localeCompare(a.order_date));
  },

  async assignDriver(orderId, driverId, driverName) {
    const payload = {
      assigned_driver_id: driverId || null,
      assigned_driver_name: driverId ? (driverName || null) : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('orders').update(payload).eq('id', orderId)
    );
    if (error) throw new Error(error.message);
  },

  async updateStatus(orderId, status) {
    await FOS.orders.mutate('status', {order_id: orderId, status});
    FOS.realtime?.suppressOrderAlert?.(orderId);
  },

  async confirmReceipt(orderId) {
    return FOS.orders.mutate('receipt', {order_id: orderId});
  },

  async saveEdit(orderId, edit) {
    return FOS.orders.mutate('edit', {order_id: orderId, ...edit});
  },

  orderItemUnitPrice(product, order) {
    if (FOS.publicOrder?.isPublicOrder?.(order)) {
      if (product?.public_price != null && product.public_price !== '') {
        return Number(product.public_price) || 0;
      }
    }
    return Number(product?.price) || 0;
  },

  productToOrderItem(product, order, qty) {
    return {
      product_id: product.id,
      product_name: product.name,
      product_spec: product.spec || '',
      product_emoji: product.emoji || '📦',
      unit_price: FOS.orders.orderItemUnitPrice(product, order),
      tax_rate: product.tax_rate ?? 0,
      qty: parseInt(qty, 10) || 1,
      admin_edit: 'added',
    };
  },

  itemsTableHtml(items, opts = {}) {
    const { showReceiptCheck, hideEmoji } = opts;
    const rows = (items || []).map((i) => {
      const name = FOS.fmt.escapeHtml(i.product_name);
      const spec = FOS.fmt.escapeHtml(i.product_spec || '');
      const shortage = FOS.orders.shortageBadge(i);
      const adminBadge = FOS.orders.adminEditBadge(i);
      const adminCls = FOS.orders.adminEditRowClass(i);
      const shortageCls = FOS.orders.shortageRowClass(i);
      const check = showReceiptCheck
        ? `<div class="od-col od-col--check"><div class="check-box check-box--sm" data-hist-check="${i.id}"></div></div>`
        : '';
      const emoji = hideEmoji ? '' : `<span class="od-emoji">${i.product_emoji || '📦'}</span>`;
      const billQty = FOS.orders.deliveredQty(i);
      const qtyLabel = FOS.orders.shortageQty(i) > 0 && billQty < i.qty
        ? `×${i.qty} <span class="od-delivered">${FOS.i18n.t('実発', '实发')}${billQty}</span>`
        : `×${i.qty}`;
      return `<div class="order-detail-item order-detail-row ${shortageCls}${adminCls ? ` ${adminCls}` : ''}" data-item-row="${i.id}">
        <div class="order-detail-item__name">
          ${emoji}<span class="od-name">${name}</span>${shortage}${adminBadge}
          ${check}
        </div>
        <div class="order-detail-item__meta">
          <span class="od-col od-col--spec">${spec || '—'}</span>
          <span class="od-col od-col--qty">${qtyLabel}</span>
          <span class="od-col od-col--price">${FOS.fmt.money(i.unit_price)}</span>
          <span class="od-col od-col--amount">${FOS.fmt.money(i.unit_price * billQty)}</span>
        </div>
      </div>`;
    }).join('');
    const checkHead = showReceiptCheck
      ? `<span class="od-col od-col--check">${FOS.i18n.t('確認', '确认')}</span>`
      : '';
    let mod = showReceiptCheck ? ' order-detail-items--receipt' : '';
    if (hideEmoji) mod += ' order-detail-items--no-emoji';
    return `<div class="order-detail-items${mod}">
      <div class="order-detail-items__head">
        <div class="order-detail-items__head-name">
          <span>${FOS.i18n.t('商品', '商品')}</span>${checkHead}
        </div>
        <div class="order-detail-item__meta order-detail-item__meta--head">
          <span class="od-col od-col--spec">${FOS.i18n.t('規格', '规格')}</span>
          <span class="od-col od-col--qty">${FOS.i18n.t('数量', '数量')}</span>
          <span class="od-col od-col--price">${FOS.i18n.t('単価', '单价')}</span>
          <span class="od-col od-col--amount">${FOS.i18n.t('金額', '金额')}</span>
        </div>
      </div>
      <div class="order-detail-items__body">${rows}</div>
    </div>`;
  },
};

