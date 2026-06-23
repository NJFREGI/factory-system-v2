/**
 * 工厂生产端 · UI Redesign
 * 订单看板 + 配送执行
 */
(function () {
  FOS.APP_ID = 'production';
  FOS.auth.expectedRoles = ['factory', 'delivery'];
  let orders = [];
  let shopMap = {};
  let currentView = 'orders';
  let paymentDate = FOS.fmt.today();
  let paymentTab = 'detail';
  let paymentSettlementFilter = '';
  let orderSourceFilter = '';
  let factoryDateFilter = '';

  function orderPaymentSettlementKind(order) {
    if (order.settlement_type === FOS.payment.SETTLEMENT.CASH) return 'cash';
    if (order.settlement_type === FOS.payment.SETTLEMENT.MONTHLY) return 'monthly';
    if (order.payment_type === 'monthly') return 'monthly';
    if (FOS.publicOrder?.isPublicOrder?.(order)) return 'cash';
    const st = FOS.payment.resolveShopSettlement(shopMap[order.shop_id] || {});
    return st === FOS.payment.SETTLEMENT.MONTHLY ? 'monthly' : 'cash';
  }

  function isPublicOrder(order) {
    return FOS.publicOrder?.isPublicOrder(order);
  }

  function applySourceFilter(list) {
    if (!orderSourceFilter) return list;
    if (orderSourceFilter === 'shop') return list.filter((o) => FOS.publicOrder.isShopAccountOrder(o));
    if (orderSourceFilter === 'public') return list.filter((o) => isPublicOrder(o));
    if (orderSourceFilter === 'public_store') {
      return list.filter((o) => o.order_source === FOS.publicOrder.SOURCES.PUBLIC_ORDER || o.order_source === 'public_qr');
    }
    if (orderSourceFilter === 'wechat_group') {
      return list.filter((o) => o.order_source === FOS.publicOrder.SOURCES.WECHAT_GROUP);
    }
    if (orderSourceFilter === 'public_new') return list.filter((o) => isPublicOrder(o) && o.delivery_status === 'new');
    if (orderSourceFilter === 'public_active') return list.filter((o) => isPublicOrder(o) && ['accepted', 'delivering'].includes(o.delivery_status));
    if (orderSourceFilter === 'public_done') return list.filter((o) => isPublicOrder(o) && o.delivery_status === 'delivered');
    return list;
  }

  function orderSourceBadge(order) {
    if (!isPublicOrder(order)) return '';
    return `<span class="badge badge--blue order-source-badge">${FOS.fmt.escapeHtml(FOS.publicOrder.orderSourceLabel(order))}</span>`;
  }

  function publicCustomerMeta(order) {
    if (!isPublicOrder(order)) return '';
    return `
      <div class="alert alert--info public-order-meta">
        👤 ${FOS.fmt.escapeHtml(order.customer_name || '')} · ${FOS.fmt.escapeHtml(order.customer_phone || '')}<br>
        📍 ${FOS.fmt.escapeHtml(order.customer_address || '')}<br>
        🕐 ${FOS.fmt.escapeHtml(FOS.publicOrder.formatDeliveryWish(order))}
        ${order.public_order_code ? `<br>🔖 ${FOS.fmt.escapeHtml(order.public_order_code)}` : ''}
      </div>`;
  }

  function orderDateList() {
    return [...new Set(orders.map((o) => o.order_date).filter(Boolean))].sort();
  }

  function bindDateCalendarTrigger({ triggerId, labelId, getSelected, allowClear = false, onSelect }) {
    document.getElementById(triggerId)?.addEventListener('click', () => {
      FOS.ui.openActiveDateCalendar({
        activeDates: orderDateList(),
        selected: getSelected(),
        allowClear,
        onSelect: (date) => {
          onSelect(date || '');
          FOS.ui.syncDateTriggerLabel(labelId, date || '');
        },
      });
    });
  }

  function sourceFilterSelectHtml(id) {
    return `
      <select class="filter-select" id="${id}">
        <option value="">${FOS.i18n.t('全来源', '全部来源')}</option>
        <option value="shop">${FOS.i18n.t('店舗注文', '门店订单')}</option>
        <option value="public">${FOS.i18n.t('顧客注文', '顾客扫码订单')}</option>
        <option value="public_store">${FOS.i18n.t('物産店注文', '物产店订单')}</option>
        <option value="wechat_group">${FOS.i18n.t('微信群注文', '微信群订单')}</option>
        <option value="public_new">${FOS.i18n.t('未受付', '未接单')}</option>
        <option value="public_active">${FOS.i18n.t('配送中', '配送中')}</option>
        <option value="public_done">${FOS.i18n.t('完了', '已完成')}</option>
      </select>`;
  }

  FOS.onLogout = () => { FOS.realtime?.stop?.(); FOS.auth.logout(); boot(); };
  FOS.onLangChange = () => {
    if (!FOS.auth.user) return;
    applyProductionChrome();
    FOS.shell.refreshLabels(navForRole());
    renderCurrentView();
  };

  function applyProductionChrome() {
    const isDelivery = FOS.auth.user?.role === 'delivery';
    document.title = isDelivery
      ? FOS.i18n.t('配送', '配送')
      : FOS.i18n.t('工厂生产端', '工厂生产端');
  }

  async function boot() {
    FOS.i18n.init();
    FOS.theme.init();
    try {
      await FOS.db.init();
      if (await FOS.auth.restoreSession()) return startApp();
      const block = FOS.auth.consumeBlockReason();
      if (block) FOS.ui.toast(block, 'error');
      showLogin();
    } catch (e) {
      FOS.ui.toast('DB: ' + e.message, 'error');
      showLogin();
    }
  }

  function showLogin() {
    document.body.removeAttribute('data-role');
    FOS.ui.renderLogin({
      title: FOS.i18n.t('工厂生产', '工厂生产'),
      heroTitle: FOS.i18n.t('生産・配送', '生产与配送'),
      heroDesc: FOS.i18n.t('受注から出荷まで、現場で素早く処理', '从接单到出货，现场快速处理'),
      hint: FOS.i18n.t('工場・配送アカウントでログイン', '工厂或配送账号登录'),
      rolesLabel: 'factory | delivery',
      onSubmit: async (id, pass) => { await FOS.auth.login(id, pass); await startApp(); },
    });
  }

  function navForRole() {
    if (FOS.auth.user.role === 'delivery') {
      return [
        { id: 'delivery', icon: 'delivery', label: FOS.i18n.t('配送', '配送') },
        { id: 'payments', icon: 'payments', label: FOS.i18n.t('決済', '结账') },
      ];
    }
    return [{ id: 'orders', icon: 'orders', label: FOS.i18n.t('受注', '订单') }];
  }

  async function startApp() {
    document.body.setAttribute('data-role', FOS.auth.user.role);
    const isDelivery = FOS.auth.user.role === 'delivery';
    applyProductionChrome();
    const nav = navForRole();
    FOS.shell.mount({
      appId: 'production',
      brand: {
        icon: isDelivery ? 'delivery' : 'factory',
        title: isDelivery ? FOS.i18n.t('配送', '配送') : FOS.i18n.t('生产端', '生产端'),
        subtitle: isDelivery
          ? FOS.i18n.t('配達・決済', '配送与结账')
          : FOS.i18n.t('工場モード（受注・出荷）', '工厂模式（接单·出货）'),
      },
      nav,
      pageTitle: nav[0].label,
      onNavigate: (id) => {
        currentView = id || currentView;
        renderCurrentView();
      },
    });
    if (FOS.auth.user.role === 'factory' || FOS.auth.user.role === 'delivery') {
      FOS.realtime?.requestPermission?.();
      FOS.realtime?.start?.({ onNewOrder: refreshOnRealtime });
    }
    currentView = nav[0].id;
    await renderCurrentView();
  }

  async function renderCurrentView() {
    FOS.ui.showBottomNav();
    if (FOS.auth.user.role === 'delivery') {
      if (currentView === 'payments') await renderDeliveryPayments();
      else await renderDelivery();
      return;
    }
    await renderFactoryOrders();
  }

  async function refreshOnRealtime() {
    if (FOS.auth.user.role === 'delivery') {
      const filter = currentView === 'payments'
        ? (o) => ['delivered', 'confirmed'].includes(o.status)
        : (o) => ['preparing', 'shipped', 'delivered'].includes(o.status);
      await loadOrders(filter, { silent: true });
      if (currentView === 'payments' && document.getElementById('paymentBody')) {
        orders = FOS.payment.enrichOrders(orders);
        paintDeliveryPaymentsBody();
      } else if (document.getElementById('deliveryList')) {
        paintDeliveryList();
        updateDeliveryStats();
      } else {
        await renderCurrentView();
      }
      return;
    }
    await loadOrders(undefined, { silent: true });
    if (document.getElementById('orderList')) paintFactoryList();
    else await renderFactoryOrders();
  }

  async function loadOrders(filterFn, opts = {}) {
    if (!opts.silent) FOS.ui.showLoading();
    const { data } = await FOS.orders.forFactoryQuery(
      FOS.db.sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false })
    );
    orders = (data || []).filter(filterFn || (() => true));
    if (!opts.silent) FOS.ui.hideLoading();
  }

  async function renderFactoryOrders() {
    await loadOrders();
    shopMap = await FOS.payment.loadShopSettlementMap();
    FOS.shell.setPageTitle(FOS.i18n.t('受注管理', '订单管理'));
    const main = document.getElementById('appMain');
    const pending = orders.filter((o) => o.status === 'pending').length;
    const preparing = orders.filter((o) => o.status === 'preparing').length;

    main.innerHTML = `
      ${FOS.ui.pageHeader(FOS.i18n.t('受注一覧', '订单列表'), FOS.i18n.t('ステータスを更新して出荷へ', '更新状态推进出货'))}
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-card__label">${FOS.i18n.t('受付中', '待处理')}</div><div class="stat-card__value" style="color:var(--info)">${pending}</div></div>
        <div class="stat-card"><div class="stat-card__label">${FOS.i18n.t('準備中', '准备中')}</div><div class="stat-card__value" style="color:var(--warning)">${preparing}</div></div>
        <div class="stat-card"><div class="stat-card__label">${FOS.i18n.t('合計', '合计')}</div><div class="stat-card__value">${orders.length}</div></div>
      </div>
      <div class="toolbar">
        ${FOS.ui.dateTriggerHtml({ triggerId: 'factoryDateTrigger', labelId: 'factoryDateLabel', value: factoryDateFilter })}
        <select class="filter-select" id="statusFilter">
          <option value="">${FOS.i18n.t('全て', '全部')}</option>
          <option value="pending">${FOS.i18n.t('受付中', '待处理')}</option>
          <option value="preparing">${FOS.i18n.t('準備中', '准备中')}</option>
          <option value="shipped">${FOS.i18n.t('出荷済', '已发货')}</option>
        </select>
        ${sourceFilterSelectHtml('sourceFilter')}
        <div class="ext-slot" id="productionToolbarSlot">${FOS.plugins.renderSlot('productionToolbar')}</div>
      </div>
      <div id="orderList"></div>
    `;

    bindDateCalendarTrigger({
      triggerId: 'factoryDateTrigger',
      labelId: 'factoryDateLabel',
      getSelected: () => factoryDateFilter,
      allowClear: true,
      onSelect: (date) => {
        factoryDateFilter = date;
        paintFactoryList();
      },
    });
    document.getElementById('statusFilter').addEventListener('change', paintFactoryList);
    document.getElementById('sourceFilter')?.addEventListener('change', (e) => {
      orderSourceFilter = e.target.value;
      paintFactoryList();
    });
    if (orderSourceFilter) {
      const sf = document.getElementById('sourceFilter');
      if (sf) sf.value = orderSourceFilter;
    }
    paintFactoryList();
  }

  function paintFactoryList() {
    const fd = factoryDateFilter;
    const fs = document.getElementById('statusFilter')?.value;
    let list = orders;
    if (fd) list = list.filter((o) => o.order_date === fd);
    if (fs) list = list.filter((o) => o.status === fs);
    list = applySourceFilter(list);

    const el = document.getElementById('orderList');
    if (!list.length) {
      el.innerHTML = FOS.ui.empty('📋', FOS.i18n.t('注文なし', '暂无订单'));
      return;
    }

    el.innerHTML = list.map((order) => {
      const st = FOS.fmt.status(order.status);
      const items = (order.order_items || []).map((i, itemIdx) => FOS.orders.orderLineItemHtml(i, itemIdx)).join('');
      let actions = '';
      if (order.status === 'pending') actions = `<button class="btn btn--primary btn--sm" data-act="preparing" data-id="${order.id}">→ ${FOS.i18n.t('準備中', '准备')}</button>`;
      if (order.status === 'preparing') actions = `<button class="btn btn--success btn--sm" data-act="shipped" data-id="${order.id}">→ ${FOS.i18n.t('出荷', '发货')}</button>`;

      const shopSettlement = FOS.payment.resolveShopSettlement(shopMap[order.shop_id] || {});
      const isCashShop = !isPublicOrder(order) && shopSettlement === FOS.payment.SETTLEMENT.CASH;
      const isMonthlyShop = !isPublicOrder(order) && shopSettlement === FOS.payment.SETTLEMENT.MONTHLY;
      const shopSettleBadge = isCashShop
        ? `<span class="badge badge--orange order-source-badge">${FOS.i18n.t('現金', '现结')}</span>`
        : (isMonthlyShop ? `<span class="badge badge--blue order-source-badge">${FOS.i18n.t('月払い', '月结')}</span>` : '');

      return `
        <div class="order-card ${isPublicOrder(order) ? 'order-card--public' : ''}">
          <div class="order-card__head" data-toggle="fo_${order.id}">
            <strong>#${order.order_no}</strong>
            <span>${FOS.fmt.escapeHtml(isPublicOrder(order) ? (order.customer_name || order.shop_name) : FOS.fmt.displayName(order.shop_name))}</span>
            ${orderSourceBadge(order)}${shopSettleBadge}
            <span class="badge badge--${st.color}">${st.label}</span>
            <span style="color:var(--text-tertiary);font-size:12px">${order.order_date}</span>
            <span class="order-card__amount">${FOS.fmt.money(order.total)}</span>
            <button type="button" class="btn btn--secondary btn--sm" data-edit-order="${order.id}">✏️</button>
          </div>
          <div class="order-card__body" id="fo_${order.id}">
            ${publicCustomerMeta(order)}
            ${order.note ? `<div class="alert alert--info">📝 ${FOS.fmt.escapeHtml(order.note)}</div>` : ''}
            ${order.factory_note ? `<div class="alert alert--warn">🏭 ${FOS.fmt.escapeHtml(order.factory_note)}</div>` : ''}
            <ul class="order-line-items">${items}</ul>
            <div style="display:flex;gap:8px;flex-wrap:wrap">${actions}</div>
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('[data-toggle]').forEach((h) => {
      h.addEventListener('click', () => document.getElementById(h.dataset.toggle)?.classList.toggle('open'));
    });
    el.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await FOS.orders.updateStatus(btn.dataset.id, btn.dataset.act);
        FOS.ui.toast(FOS.i18n.t('更新しました', '已更新'), 'success');
        await renderFactoryOrders();
      });
    });
    el.querySelectorAll('[data-edit-order]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openOrderEdit(btn.dataset.editOrder);
      });
    });
  }

  async function openOrderEdit(orderId) {
    const order = await FOS.orders.fetchOne(orderId);
    if (!order) return;
    const st = FOS.fmt.status(order.status);
    const items = order.order_items || [];

    const itemsHtml = items.map((item, idx) => {
      const specInline = item.product_spec
        ? `<span class="edit-item-row__spec-inline">(${FOS.fmt.escapeHtml(item.product_spec)})</span>`
        : '';
      const adminCls = FOS.orders.adminEditRowClass(item);
      const shortageCls = FOS.orders.shortageRowClass(item);
      return `
      <div class="edit-item-row${shortageCls ? ` ${shortageCls}` : ''}${adminCls ? ` ${adminCls}` : ''}">
        <div class="edit-item-row__info edit-item-row__info--inline">
          <span class="edit-item-row__name">${FOS.fmt.escapeHtml(item.product_name)}</span>${specInline}
          ${FOS.orders.adminEditBadge(item)}
        </div>
        <label class="edit-item-row__qty">
          ${FOS.i18n.t('数量', '数量')}
          <input type="number" min="0" value="${item.qty}" class="field__input" id="eqty_${idx}" data-item-id="${item.id}">
        </label>
        ${FOS.orders.editShortageFieldHtml(item, idx)}
        <input class="field__input edit-item-row__note" placeholder="${FOS.i18n.t('備考', '备注')}" value="${FOS.fmt.escapeHtml(item.shortage_note || '')}" id="enote_${idx}">
      </div>`;
    }).join('');

    FOS.ui.openModal({
      title: `#${order.order_no} — ${FOS.fmt.escapeHtml(FOS.fmt.displayName(order.shop_name))}`,
      size: 'lg',
      bodyHtml: `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <span class="badge badge--${st.color}">${st.label}</span>
          <span style="font-size:13px;color:var(--text-secondary)">${order.order_date}</span>
          <select class="filter-select" id="editStatus" style="margin-left:auto">
            <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>${FOS.i18n.t('受付中', '待处理')}</option>
            <option value="preparing" ${order.status === 'preparing' ? 'selected' : ''}>${FOS.i18n.t('準備中', '准备中')}</option>
            <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>${FOS.i18n.t('出荷済', '已发货')}</option>
            <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>${FOS.i18n.t('配達完了', '已送达')}</option>
          </select>
        </div>
        <label class="field">
          <span class="field__label">${FOS.i18n.t('工場メモ', '工厂备注')}</span>
          <textarea class="field__input" id="editFactoryNote" rows="2">${FOS.fmt.escapeHtml(order.factory_note || '')}</textarea>
        </label>
        <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:16px">${itemsHtml}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn btn--secondary" data-modal-close>${FOS.i18n.t('閉じる', '关闭')}</button>
          <button type="button" class="btn btn--primary" id="saveOrderEditBtn">${FOS.i18n.t('保存', '保存')}</button>
        </div>`,
    });

    document.getElementById('saveOrderEditBtn')?.addEventListener('click', async () => {
      const editItems = items.map((item, idx) => ({
        id: item.id,
        qty: document.getElementById('eqty_' + idx)?.value,
        shortageQty: document.getElementById('eshortqty_' + idx)?.value,
        shortageNote: document.getElementById('enote_' + idx)?.value,
      }));
      FOS.ui.showLoading();
      try {
        await FOS.orders.saveEdit(orderId, {
          status: document.getElementById('editStatus').value,
          factoryNote: document.getElementById('editFactoryNote').value,
          items: editItems,
        });
        FOS.ui.closeModal();
        FOS.ui.toast(FOS.i18n.t('保存しました', '已保存'), 'success');
        await renderFactoryOrders();
      } catch (e) {
        FOS.ui.toast(e.message, 'error');
      } finally {
        FOS.ui.hideLoading();
      }
    });
  }

  let deliveryDateFilter = '';
  let unbindDeliveryReorder = null;

  const deliverySortKey = () => `delivery_sort_${FOS.auth.user?.id || ''}_${deliveryDateFilter || 'all'}`;

  function loadDeliverySortOrder() {
    return FOS.storage.get(deliverySortKey()) || [];
  }

  function saveDeliverySortOrder(ids) {
    FOS.storage.set(deliverySortKey(), ids);
  }

  function sortOrdersForDelivery(list) {
    const saved = loadDeliverySortOrder();
    if (!saved.length) return list;
    const map = new Map(list.map((o) => [String(o.id), o]));
    const sorted = [];
    saved.forEach((id) => {
      const o = map.get(String(id));
      if (o) {
        sorted.push(o);
        map.delete(String(id));
      }
    });
    map.forEach((o) => sorted.push(o));
    return sorted;
  }

  function deliveryItemsHtml(items, { showChecks = true } = {}) {
    return (items || []).map((item) => {
      const name = FOS.fmt.escapeHtml(item.product_name);
      const spec = item.product_spec ? FOS.fmt.escapeHtml(item.product_spec) : '';
      const specHtml = spec ? `<span class="delivery-item__spec">${spec}</span>` : '';
      const checkHtml = showChecks
        ? `<button type="button" class="check-box check-box--sm delivery-item__check" data-delivery-check="${item.id}" aria-label="${FOS.i18n.t('確認', '确认')}"></button>`
        : '';
      return `
        <div class="delivery-item${showChecks ? '' : ' delivery-item--readonly'}" data-delivery-item="${item.id}">
          ${checkHtml}
          <div class="delivery-item__main">
            <span class="delivery-item__name">${name}</span>${specHtml}
          </div>
          <span class="delivery-item__qty">×${item.qty}</span>
        </div>`;
    }).join('');
  }

  function bindDeliveryCheckboxes(root) {
    root?.querySelectorAll('[data-delivery-check]').forEach((box) => {
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        box.classList.toggle('check-box--on');
        box.textContent = box.classList.contains('check-box--on') ? '✓' : '';
        const row = box.closest('[data-delivery-item]');
        row?.classList.toggle('delivery-item--checked', box.classList.contains('check-box--on'));
      });
    });
  }

  function deliveryContactLine(order) {
    const isPublic = isPublicOrder(order);
    if (isPublic) {
      const parts = [];
      if (order.customer_phone) parts.push(`📞 ${order.customer_phone}`);
      if (order.customer_address) parts.push(`📍 ${order.customer_address}`);
      return parts.join(' · ');
    }
    const shop = shopMap[order.shop_id] || {};
    const parts = [];
    if (shop.phone) parts.push(`📞 ${shop.phone}`);
    if (shop.address) parts.push(`📍 ${shop.address}`);
    return parts.join(' · ');
  }

  async function recordMonthlyDelivery(order) {
    FOS.ui.showLoading();
    try {
      const result = await FOS.payment.recordDeliveryPayment(order.id, {
        settlementType: FOS.payment.SETTLEMENT.MONTHLY,
        paymentMethodId: null,
        paymentMethodName: FOS.payment.settlementLabel(FOS.payment.SETTLEMENT.MONTHLY),
      });
      order.status = 'delivered';
      order.settlement_type = FOS.payment.SETTLEMENT.MONTHLY;
      order.payment_method_name = FOS.payment.settlementLabel(FOS.payment.SETTLEMENT.MONTHLY);
      order.payment_recorded_at = new Date().toISOString();
      FOS.ui.toast(
        result?.local
          ? FOS.i18n.t('配達完了（端末に一時保存）', '配送完成（暂存本机）')
          : FOS.i18n.t('配達完了', '配送完成'),
        'success'
      );
      paintDeliveryList();
      updateDeliveryStats();
    } catch (e) {
      FOS.ui.toast(e.message, 'error');
    } finally {
      FOS.ui.hideLoading();
    }
  }

  async function completeDelivery(orderId, { editPayment = false } = {}) {
    const order = orders.find((o) => String(o.id) === String(orderId));
    if (!order) return;
    const shop = shopMap[order.shop_id];
    const settlementType = FOS.payment.resolveShopSettlement(shop);
    const isPublic = isPublicOrder(order);

    if (editPayment) {
      await openPaymentPicker(order, { editPayment: true });
      return;
    }
    if (!isPublic && settlementType === FOS.payment.SETTLEMENT.MONTHLY) {
      await recordMonthlyDelivery(order);
      return;
    }
    await openPaymentPicker(order);
  }

  async function openPaymentPicker(order, { editPayment = false } = {}) {
    const shop = shopMap[order.shop_id];
    const settlementType = FOS.payment.resolveShopSettlement(shop);
    let methods;
    try {
      methods = await FOS.payment.listMethods();
    } catch (e) {
      FOS.ui.toast(e.message, 'error');
      return;
    }
    if (!methods.length) {
      FOS.ui.toast(FOS.i18n.t('決済方法を設定してください', '请先在后台设置结账方式'), 'error');
      return;
    }
    FOS.ui.openModal({
      title: editPayment
        ? FOS.i18n.t('決済方法を変更', '修改结账方式')
        : FOS.i18n.t('決済方法を選択', '选择结账方式'),
      size: 'lg',
      bodyHtml: `
        <p class="payment-pick-shop">${FOS.fmt.escapeHtml(FOS.fmt.displayName(order.shop_name))}
          <span class="payment-pick-amount">${FOS.fmt.money(order.total)}</span></p>
        ${order.payment_method_name && editPayment ? `<p class="field__hint">${FOS.i18n.t('現在', '当前')}：${FOS.fmt.escapeHtml(order.payment_method_name)}</p>` : ''}
        <div class="payment-pick-grid">
          ${methods.map((m) => `
            <button type="button" class="btn btn--secondary btn--lg payment-pick-btn" data-pm-id="${FOS.fmt.escapeHtml(String(m.id))}">${FOS.fmt.escapeHtml(m.name)}</button>
          `).join('')}
        </div>
        <div style="margin-top:12px;text-align:right">
          <button type="button" class="btn btn--ghost" data-modal-close>${FOS.i18n.t('キャンセル', '取消')}</button>
        </div>`,
    });
    document.querySelectorAll('.payment-pick-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pmId = btn.dataset.pmId;
        const pm = methods.find((m) => String(m.id) === String(pmId));
        const pmName = pm?.name;
        if (!pmName) return;
        const monthlyLabel = FOS.payment.settlementLabel(FOS.payment.SETTLEMENT.MONTHLY);
        const useSettlement = editPayment || settlementType === FOS.payment.SETTLEMENT.CASH || isPublicOrder(order)
          ? FOS.payment.SETTLEMENT.CASH
          : settlementType;
        FOS.ui.showLoading();
        try {
          const result = await FOS.payment.recordDeliveryPayment(order.id, {
            settlementType: pmName === monthlyLabel ? FOS.payment.SETTLEMENT.MONTHLY : useSettlement,
            paymentMethodId: String(pmId).startsWith('local_') ? null : pmId,
            paymentMethodName: pmName,
          });
          order.status = 'delivered';
          order.settlement_type = pmName === monthlyLabel ? FOS.payment.SETTLEMENT.MONTHLY : useSettlement;
          order.payment_method_name = pmName === monthlyLabel ? monthlyLabel : pmName;
          order.payment_recorded_at = new Date().toISOString();
          FOS.ui.closeModal();
          FOS.ui.toast(
            result?.local
              ? (editPayment
                ? FOS.i18n.t('決済方法を更新（端末に一時保存）', '结账方式已更新（暂存本机）')
                : FOS.i18n.t('配達・決済完了（端末に一時保存）', '配送并记账完成（暂存本机）'))
              : (editPayment
                ? FOS.i18n.t('決済方法を更新しました', '结账方式已更新')
                : FOS.i18n.t('配達・決済完了', '配送并记账完成')),
            'success'
          );
          paintDeliveryList();
          updateDeliveryStats();
        } catch (e) {
          FOS.ui.toast(e.message, 'error');
        } finally {
          FOS.ui.hideLoading();
        }
      });
    });
  }

  function getDeliveryFilteredOrders() {
    let list = orders;
    if (deliveryDateFilter) list = list.filter((o) => o.order_date === deliveryDateFilter);
    return applySourceFilter(list);
  }

  function updateDeliveryStats() {
    const list = getDeliveryFilteredOrders();
    const c = FOS.orders.statCounts(list);
    const totalEl = document.querySelector('[data-delivery-total]');
    const doneEl = document.querySelector('[data-delivery-done]');
    if (totalEl) totalEl.textContent = String(c.total);
    if (doneEl) doneEl.textContent = String(c.delivered);
  }

  function formatDeliveryOrderTime(order) {
    if (!order?.created_at) return order?.order_date || '';
    const d = new Date(order.created_at);
    const date = order.order_date || d.toISOString().slice(0, 10);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  }

  function paintDeliveryList() {
    const el = document.getElementById('deliveryList');
    if (!el) return;

    const list = sortOrdersForDelivery(getDeliveryFilteredOrders());

    if (!list.length) {
      el.innerHTML = FOS.ui.empty('🚚', FOS.i18n.t('配送なし', '暂无配送'));
      unbindDeliveryReorder?.();
      unbindDeliveryReorder = null;
      return;
    }

    el.innerHTML = list.map((order) => {
      const st = FOS.fmt.status(order.status);
      const done = order.status === 'delivered';
      const panelId = `dv_${order.id}`;
      const itemsHtml = deliveryItemsHtml(order.order_items, { showChecks: !done });
      const shopSettlement = FOS.payment.resolveShopSettlement(shopMap[order.shop_id] || {});
      const isCash = shopSettlement === FOS.payment.SETTLEMENT.CASH;
      const isPublic = isPublicOrder(order);
      const isMonthlyShop = !isPublic && shopSettlement === FOS.payment.SETTLEMENT.MONTHLY;
      const settlementBadge = isCash && !done && !isPublic
        ? `<span class="badge badge--orange delivery-settlement-badge delivery-settlement-badge--cash">${FOS.i18n.t('都度払い・現金', '现结·现金')}</span>`
        : (isMonthlyShop && !done
          ? `<span class="badge badge--blue delivery-settlement-badge">${FOS.i18n.t('月払い', '月结')}</span>`
          : '');
      const publicPayBadge = isPublic && !done
        ? `<span class="badge badge--blue delivery-settlement-badge">${FOS.publicOrder.paymentLabel(order.customer_payment_method)}</span>`
        : '';
      const contactLine = deliveryContactLine(order);
      const cashClass = isCash && !done && !isPublic ? ' delivery-card--cash' : (isPublic && !done ? ' order-card--public' : '');
      const deliverBtnLabel = isMonthlyShop
        ? FOS.i18n.t('配送完了', '配送完成')
        : FOS.i18n.t('配送完了・決済選択', '配送完成并选择结账');
      return `
        <div class="order-card delivery-card drag-reorder__item ${done ? 'delivery-card--done' : 'delivery-card--pending'}${cashClass}" data-order-id="${order.id}">
          <div class="delivery-card__head" data-panel="${panelId}">
            <div class="delivery-card__row delivery-card__row--top">
              <strong class="delivery-card__no">#${order.order_no}</strong>
              <span class="delivery-card__shop">${FOS.fmt.escapeHtml(isPublic ? (order.customer_name || order.shop_name) : FOS.fmt.displayName(order.shop_name))}</span>
              <span class="delivery-card__badges">${settlementBadge}${publicPayBadge}</span>
              ${FOS.dragReorder.handleHtml(FOS.i18n.t('順序変更', '调整顺序'), 'delivery-card__sort-handle')}
            </div>
            ${contactLine ? `<div class="delivery-card__contact">${FOS.fmt.escapeHtml(contactLine)}</div>` : ''}
            <div class="delivery-card__row delivery-card__row--meta">
              <span class="delivery-card__time">${FOS.fmt.escapeHtml(formatDeliveryOrderTime(order))}</span>
              <span class="badge badge--${st.color} delivery-card__status">${st.label}</span>
              <span class="delivery-card__amount">${FOS.fmt.money(order.total)}</span>
            </div>
            ${isCash && !done ? `<div class="delivery-card__cash-hint">${FOS.i18n.t('💰 都度払い — 配達時に決済', '💰 现结客户 — 送达时结账')}</div>` : ''}
          </div>
          <div class="order-card__body" id="${panelId}">
            ${isPublic && !done ? publicCustomerMeta(order) : ''}
            ${order.note ? `<div class="delivery-card__note">${FOS.fmt.escapeHtml(order.note)}</div>` : ''}
            ${done ? '' : `<p class="delivery-card__tip">${FOS.i18n.t('商品を確認したらチェック（任意）', '核对商品后可勾选（可选）')}</p>`}
            <div class="delivery-items">${itemsHtml || FOS.ui.empty('📦', FOS.i18n.t('商品なし', '暂无商品'))}</div>
            <div class="delivery-card__actions">
              ${done
                ? `<button type="button" class="btn btn--secondary btn--block delivery-card__edit-pay-btn" data-edit-payment="${order.id}">✏️ ${FOS.i18n.t('決済方法を変更', '修改结账方式')}${order.payment_method_name ? `（${FOS.fmt.escapeHtml(order.payment_method_name)}）` : ''}</button>`
                : `<button type="button" class="btn btn--success btn--block delivery-card__deliver-btn" data-deliver="${order.id}">✅ ${deliverBtnLabel}</button>`}
            </div>
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('.delivery-card__head').forEach((head) => {
      head.addEventListener('click', (e) => {
        if (e.target.closest('.drag-reorder__handle')) return;
        if (e.target.closest('[data-deliver]') || e.target.closest('[data-delivery-check]')) return;
        const card = head.closest('.delivery-card');
        if (card?.dataset.dragJustDone === '1') return;
        document.getElementById(head.dataset.panel)?.classList.toggle('open');
      });
    });
    bindDeliveryCheckboxes(el);
    el.querySelectorAll('[data-deliver]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await completeDelivery(btn.dataset.deliver);
      });
    });
    el.querySelectorAll('[data-edit-payment]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await completeDelivery(btn.dataset.editPayment, { editPayment: true });
      });
    });

    unbindDeliveryReorder?.();
    if (FOS.dragReorder) {
      unbindDeliveryReorder = FOS.dragReorder.bind(el, {
        itemSelector: '.delivery-card',
        mode: 'float',
        longPressMs: 380,
        getLongPressMs: () => 280,
        canStart: (item, e) => !!e.target.closest('.drag-reorder__handle'),
        onReorder: (items) => {
          saveDeliverySortOrder(items.map((node) => node.dataset.orderId).filter(Boolean));
          FOS.ui.toast(FOS.i18n.t('配送順序を保存しました', '配送顺序已保存'), 'success');
        },
      });
    }
  }

  async function renderDelivery() {
    await loadOrders((o) => ['preparing', 'shipped', 'delivered'].includes(o.status));
    shopMap = await FOS.payment.loadShopSettlementMap();
    const schemaReady = await FOS.payment.isSchemaReady();
    if (!deliveryDateFilter) deliveryDateFilter = FOS.fmt.today();
    FOS.shell.setPageTitle(FOS.i18n.t('配送', '配送'));
    const main = document.getElementById('appMain');

    main.innerHTML = `
      <div class="delivery-page">
      ${FOS.ui.pageHeader(FOS.i18n.t('配送リスト', '配送列表'))}
      ${schemaReady ? '' : FOS.payment.schemaBannerHtml()}
      <div class="stat-grid stat-grid--delivery">
        <div class="stat-card stat-card--delivery stat-card--delivery-total">
          <div class="stat-card__label">${FOS.i18n.t('配送単数', '配送单数')}</div>
          <div class="stat-card__value" data-delivery-total>0</div>
        </div>
        <div class="stat-card stat-card--delivery stat-card--delivery-done">
          <div class="stat-card__label">${FOS.i18n.t('完了単数', '已完成单数')}</div>
          <div class="stat-card__value" data-delivery-done>0</div>
        </div>
      </div>
      <div class="toolbar toolbar--delivery">
        ${FOS.ui.dateTriggerHtml({
          triggerId: 'deliveryDateTrigger',
          labelId: 'deliveryDateLabel',
          value: deliveryDateFilter,
          extraClass: 'filter-select--delivery',
        })}
        ${sourceFilterSelectHtml('deliverySourceFilter')}
      </div>
      <div id="deliveryList" class="delivery-list drag-reorder__container"></div>
      <div class="fos-scroll-spacer" aria-hidden="true"></div>
      </div>
    `;

    bindDateCalendarTrigger({
      triggerId: 'deliveryDateTrigger',
      labelId: 'deliveryDateLabel',
      getSelected: () => deliveryDateFilter,
      allowClear: true,
      onSelect: (date) => {
        deliveryDateFilter = date;
        paintDeliveryList();
        updateDeliveryStats();
      },
    });
    document.getElementById('deliverySourceFilter')?.addEventListener('change', (e) => {
      orderSourceFilter = e.target.value;
      paintDeliveryList();
      updateDeliveryStats();
    });
    if (orderSourceFilter) {
      const sf = document.getElementById('deliverySourceFilter');
      if (sf) sf.value = orderSourceFilter;
    }
    paintDeliveryList();
    updateDeliveryStats();
  }

  async function renderDeliveryPayments() {
    await loadOrders((o) => ['delivered', 'confirmed'].includes(o.status));
    shopMap = await FOS.payment.loadShopSettlementMap();
    orders = FOS.payment.enrichOrders(orders);
    const schemaReady = await FOS.payment.isSchemaReady();
    FOS.shell.setPageTitle(FOS.i18n.t('決済', '结账'));
    const main = document.getElementById('appMain');
    const dates = orderDateList();
    if (!dates.includes(paymentDate)) paymentDate = dates[dates.length - 1] || FOS.fmt.today();

    main.innerHTML = `
      <div class="payments-page">
        ${FOS.ui.pageHeader(
          FOS.i18n.t('決済', '结账'),
          FOS.i18n.t('配送完了分の明細と集計', '配送完成订单的明细与汇总')
        )}
        ${schemaReady ? '' : FOS.payment.schemaBannerHtml()}
        <div class="toolbar toolbar--delivery">
          ${FOS.ui.dateTriggerHtml({
            triggerId: 'paymentDateTrigger',
            labelId: 'paymentDateLabel',
            value: paymentDate,
            extraClass: 'filter-select--delivery',
          })}
          <div class="segmented payment-tabs">
            <button type="button" class="segmented__btn ${paymentTab === 'detail' ? 'active' : ''}" data-pay-tab="detail">${FOS.i18n.t('明細', '明细')}</button>
            <button type="button" class="segmented__btn ${paymentTab === 'summary' ? 'active' : ''}" data-pay-tab="summary">${FOS.i18n.t('集計', '汇总')}</button>
          </div>
        </div>
        ${paymentTab === 'detail' ? `
        <div class="toolbar toolbar--delivery payment-settle-toolbar">
          <div class="segmented payment-settle-tabs">
            <button type="button" class="segmented__btn ${paymentSettlementFilter === '' ? 'active' : ''}" data-pay-settle="">${FOS.i18n.t('全て', '全部')}</button>
            <button type="button" class="segmented__btn ${paymentSettlementFilter === 'monthly' ? 'active' : ''}" data-pay-settle="monthly">${FOS.i18n.t('月払い', '月结')}</button>
            <button type="button" class="segmented__btn ${paymentSettlementFilter === 'cash' ? 'active' : ''}" data-pay-settle="cash">${FOS.i18n.t('都度払い', '现结')}</button>
          </div>
        </div>` : ''}
        <div id="paymentBody"></div>
        <div class="fos-scroll-spacer" aria-hidden="true"></div>
      </div>`;

    bindDateCalendarTrigger({
      triggerId: 'paymentDateTrigger',
      labelId: 'paymentDateLabel',
      getSelected: () => paymentDate,
      onSelect: (date) => {
        if (!date) return;
        paymentDate = date;
        paintDeliveryPaymentsBody();
      },
    });
    main.querySelectorAll('[data-pay-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        paymentTab = btn.dataset.payTab;
        main.querySelectorAll('[data-pay-tab]').forEach((b) => b.classList.toggle('active', b.dataset.payTab === paymentTab));
        const settleBar = main.querySelector('.payment-settle-toolbar');
        if (paymentTab !== 'detail') {
          settleBar?.remove();
        } else if (!settleBar) {
          const toolbar = main.querySelector('.toolbar--delivery');
          toolbar?.insertAdjacentHTML('afterend', `
            <div class="toolbar toolbar--delivery payment-settle-toolbar">
              <div class="segmented payment-settle-tabs">
                <button type="button" class="segmented__btn ${paymentSettlementFilter === '' ? 'active' : ''}" data-pay-settle="">${FOS.i18n.t('全て', '全部')}</button>
                <button type="button" class="segmented__btn ${paymentSettlementFilter === 'monthly' ? 'active' : ''}" data-pay-settle="monthly">${FOS.i18n.t('月払い', '月结')}</button>
                <button type="button" class="segmented__btn ${paymentSettlementFilter === 'cash' ? 'active' : ''}" data-pay-settle="cash">${FOS.i18n.t('都度払い', '现结')}</button>
              </div>
            </div>`);
          bindPaymentSettlementFilter(main);
        }
        paintDeliveryPaymentsBody();
      });
    });
    bindPaymentSettlementFilter(main);
    paintDeliveryPaymentsBody();
  }

  function bindPaymentSettlementFilter(root) {
    root?.querySelectorAll('[data-pay-settle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        paymentSettlementFilter = btn.dataset.paySettle || '';
        root.querySelectorAll('[data-pay-settle]').forEach((b) => {
          b.classList.toggle('active', (b.dataset.paySettle || '') === paymentSettlementFilter);
        });
        paintDeliveryPaymentsBody();
      });
    });
  }

  function paymentDetailCardsHtml(list) {
    if (!list.length) {
      return `<div class="payment-detail-empty">${FOS.i18n.t('データなし', '暂无数据')}</div>`;
    }
    return `<div class="payment-detail-list">${list.map((o) => {
      const settleKind = orderPaymentSettlementKind(o);
      const settleLabel = settleKind === 'monthly'
        ? FOS.i18n.t('月払い', '月结')
        : FOS.i18n.t('都度払い', '现结');
      return `
        <article class="payment-detail-card">
          <div class="payment-detail-card__head">
            <span class="payment-detail-card__no">#${o.order_no}</span>
            <span class="payment-detail-card__amount">${FOS.fmt.money(o.total)}</span>
          </div>
          <div class="payment-detail-card__body">
            <div class="payment-detail-card__row">
              <span class="payment-detail-card__label">${FOS.i18n.t('店舗', '店铺')}</span>
              <span class="payment-detail-card__value">${FOS.fmt.escapeHtml(FOS.fmt.displayName(o.shop_name || o.customer_name || ''))}</span>
            </div>
            <div class="payment-detail-card__row">
              <span class="payment-detail-card__label">${FOS.i18n.t('区分', '类型')}</span>
              <span class="payment-detail-card__value">${FOS.fmt.escapeHtml(settleLabel)}</span>
            </div>
            <div class="payment-detail-card__row">
              <span class="payment-detail-card__label">${FOS.i18n.t('決済', '结账')}</span>
              <span class="payment-detail-card__value">${FOS.fmt.escapeHtml(FOS.payment.methodLabel(o))}</span>
            </div>
          </div>
        </article>`;
    }).join('')}</div>`;
  }

  async function paintDeliveryPaymentsBody() {
    const el = document.getElementById('paymentBody');
    if (!el) return;
    const paid = FOS.payment.paidOrdersFilter(orders, paymentDate)
      .filter((o) => {
        if (!paymentSettlementFilter) return true;
        return orderPaymentSettlementKind(o) === paymentSettlementFilter;
      })
      .sort((a, b) => (b.payment_recorded_at || '').localeCompare(a.payment_recorded_at || ''));
    if (paymentTab === 'summary') {
      let methodDefs = [];
      try { methodDefs = await FOS.payment.listMethods(); } catch { /* */ }
      const summary = FOS.payment.summarize(paid, { methodDefs });
      el.innerHTML = FOS.payment.summaryCardsHtml(summary);
      return;
    }
    el.innerHTML = paymentDetailCardsHtml(paid);
  }

  boot();
})();
