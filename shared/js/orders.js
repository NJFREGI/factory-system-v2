window.FOS = window.FOS || {};

FOS.orders = {
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

  async markShopUnconfirmed(orderId) {
    const payload = {
      shop_submitted_at: null,
      updated_at: new Date().toISOString(),
    };
    if (FOS.auth.user?.role === 'order') {
      await FOS.db.sb.from('orders').update(payload).eq('id', orderId).eq('shop_id', FOS.auth.user.id);
      return;
    }
    await FOS.merchants.scopeFilter(
      FOS.db.sb.from('orders').update(payload).eq('id', orderId)
    );
  },

  async confirmShopSubmission(orderId) {
    const ts = new Date().toISOString();
    const payload = { shop_submitted_at: ts, updated_at: ts };
    const select = 'id, shop_submitted_at, order_no, order_date, total, shop_name, shop_id, merchant_id';
    let result;
    if (FOS.auth.user?.role === 'order') {
      result = await FOS.db.sb.from('orders').update(payload).eq('id', orderId).eq('shop_id', FOS.auth.user.id)
        .select(select).maybeSingle();
    } else {
      result = await FOS.merchants.scopeFilter(
        FOS.db.sb.from('orders').update(payload).eq('id', orderId)
      ).select(select).maybeSingle();
    }
    const { data, error } = result;
    if (error) throw error;
    if (!data?.shop_submitted_at) {
      throw new Error(FOS.i18n.t('注文の確定に失敗しました', '订单确认失败，请重试'));
    }
    return data;
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

  async _updateOrderItem(id, patch) {
    const tryPatch = { ...patch };
    for (let attempt = 0; attempt < 4; attempt++) {
      const { error } = await FOS.db.sb.from('order_items').update(tryPatch).eq('id', id);
      if (!error) return;
      const msg = error.message || '';
      if (/admin_edit/.test(msg) && Object.prototype.hasOwnProperty.call(tryPatch, 'admin_edit')) {
        delete tryPatch.admin_edit;
        continue;
      }
      if (/shortage_qty/.test(msg) && Object.prototype.hasOwnProperty.call(tryPatch, 'shortage_qty')) {
        if (tryPatch.shortage_qty > 0 && tryPatch.shortage_qty < tryPatch.qty) {
          throw new Error(FOS.i18n.t(
            '部分欠品には schema-order-item-admin-edit.sql の実行が必要です',
            '部分缺货需先在 Supabase 执行 schema-order-item-admin-edit.sql'
          ));
        }
        delete tryPatch.shortage_qty;
        continue;
      }
      throw error;
    }
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
    const { data: items } = await FOS.db.sb
      .from('order_items')
      .select('*')
      .eq('order_id', orderId);
    let sub = 0;
    let tax = 0;
    (items || []).forEach((i) => {
      const billQty = FOS.orders.deliveredQty(i);
      const lp = i.unit_price * billQty;
      sub += lp;
      tax += Math.round((lp * i.tax_rate) / 100);
    });
    await FOS.db.sb
      .from('orders')
      .update({
        subtotal: sub,
        tax_total: tax,
        total: sub + tax,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);
    return { sub, tax, total: sub + tax };
  },

  async fetchOne(orderId) {
    const { data } = await FOS.db.sb
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single();
    return data;
  },

  async fetchOneForFactory(orderId) {
    const { data } = await FOS.orders.forFactoryQuery(
      FOS.db.sb.from('orders').select('*, order_items(*)').eq('id', orderId).maybeSingle()
    );
    return data;
  },

  async findOpenOrder(shopId, orderDate) {
    const { data } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('orders').select('id, order_no')
        .eq('shop_id', shopId)
        .eq('order_date', orderDate)
        .in('status', ['pending', 'preparing'])
        .order('created_at', { ascending: true })
        .limit(1)
    );
    return data?.[0] || null;
  },

  async deductStock(cartItems, products) {
    for (const item of cartItems || []) {
      const p = (products || []).find((x) => String(x.id) === String(item.product_id));
      if (!p) continue;
      const ns = Math.max(0, p.stock - item.qty);
      await FOS.merchants.scopeFilter(
        FOS.db.sb.from('products').update({ stock: ns, updated_at: new Date().toISOString() }).eq('id', p.id)
      );
      p.stock = ns;
    }
  },

  async appendItems(orderId, cartItems, { adminSource = false } = {}) {
    const { data: existingItems } = await FOS.db.sb.from('order_items').select('*').eq('order_id', orderId);
    for (const item of cartItems || []) {
      const ex = (existingItems || []).find((e) => String(e.product_id) === String(item.product_id));
      if (ex) {
        const adminEdit = adminSource
          ? (ex.admin_edit === 'added' ? 'added' : 'modified')
          : ex.admin_edit;
        await FOS.db.sb.from('order_items').update({
          qty: ex.qty + item.qty,
          ...(adminEdit ? { admin_edit: adminEdit } : {}),
        }).eq('id', ex.id);
        ex.qty += item.qty;
        if (adminEdit) ex.admin_edit = adminEdit;
      } else {
        const row = { order_id: orderId, ...FOS.orders.itemPayload(item) };
        if (adminSource) row.admin_edit = 'added';
        await FOS.db.sb.from('order_items').insert(row);
      }
    }
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

  async updateStatus(orderId, status) {
    const { data: order } = await FOS.db.sb
      .from('orders')
      .select('order_source')
      .eq('id', orderId)
      .maybeSingle();
    const payload = { status, updated_at: new Date().toISOString() };
    const deliveryMap = {
      pending: 'new',
      preparing: 'accepted',
      shipped: 'delivering',
      delivered: 'delivered',
      cancelled: 'cancelled',
    };
    if (order && FOS.publicOrder?.isPublicOrder(order) && deliveryMap[status]) {
      payload.delivery_status = deliveryMap[status];
    }
    await FOS.db.sb.from('orders').update(payload).eq('id', orderId);
    FOS.realtime?.suppressOrderAlert?.(orderId);
  },

  async confirmReceipt(orderId) {
    await FOS.db.sb
      .from('orders')
      .update({
        receipt_confirmed: true,
        receipt_confirmed_at: new Date().toISOString(),
        status: 'confirmed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);
  },

  async saveEdit(orderId, { status, factoryNote, items, addItems }) {
    await FOS.db.sb
      .from('orders')
      .update({
        status,
        factory_note: factoryNote || '',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    const { data: existingItems } = await FOS.db.sb
      .from('order_items')
      .select('id, qty, admin_edit')
      .eq('order_id', orderId);
    const existingMap = Object.fromEntries((existingItems || []).map((e) => [e.id, e]));

    for (const item of items || []) {
      if (!item.id) continue;
      const qty = parseInt(item.qty, 10);
      if (item.remove || !Number.isFinite(qty) || qty <= 0) {
        const { error } = await FOS.db.sb.from('order_items').delete().eq('id', item.id);
        if (error) throw error;
        continue;
      }
      const orig = existingMap[item.id];
      let adminEdit = orig?.admin_edit || null;
      if (adminEdit !== 'added' && orig && qty !== orig.qty) adminEdit = 'modified';
      const shortageQty = FOS.orders.parseEditShortageQty(item.shortageQty, qty);
      if (shortageQty > 0 && shortageQty < qty && adminEdit !== 'modified' && orig && shortageQty !== FOS.orders.shortageQty(orig)) {
        if (adminEdit !== 'added') adminEdit = 'modified';
      }
      await FOS.orders._updateOrderItem(item.id, {
        qty,
        shortage: shortageQty > 0,
        shortage_qty: shortageQty,
        shortage_note: item.shortageNote || '',
        admin_edit: adminEdit,
      });
    }

    if (addItems?.length) {
      await FOS.orders.appendItems(orderId, addItems, { adminSource: true });
    }

    return FOS.orders.recalc(orderId);
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

