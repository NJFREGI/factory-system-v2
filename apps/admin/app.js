/**
 * 管理后台 · Phase 3
 * 订单/统计/请求书/入库/商品图片
 */
(function () {
  FOS.APP_ID = 'admin';
  FOS.auth.expectedRoles = ['factory'];
  let products = [];
  let shops = [];
  let channels = [];
  let orders = [];
  let editProductId = null;
  let currentView = 'orders';
  let ordersDate = FOS.fmt.today();
  let orderSettlementFilter = 'all';
  let shopSettlementMap = {};
  let summaryDate = FOS.fmt.today();
  let invoiceMonth = '';
  let invShopId = '';
  let invMonth = '';
  let publicStatsPeriod = 'month';
  let publicStatsAnchor = '';
  let stockMonth = '';
  let stockMode = 'in';
  let productShelfTab = 'active';
  let productCatL1 = '';
  let productCatL2 = '';
  let pendingProductForm = null;
  let paymentDate = FOS.fmt.today();
  let paymentTab = 'detail';
  let summaryHubTab = 'daily';
  let adminDetailOrderId = null;
  let adminDetailOrderIds = null;
  let adminDetailReturn = null;
  let unbindProductReorder = null;
  let unbindCatReorder = null;

  function dragSortHandleHtml(ariaLabel) {
    return FOS.dragReorder.handleHtml(ariaLabel);
  }

  function productDelIconHtml() {
    return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12h10l1-12"/><path d="M9 7V5h6v2"/></svg>`;
  }

  function productPublicPriceDisplay(p) {
    if (p?.public_price != null && p.public_price !== '') return Number(p.public_price) || 0;
    return Number(p?.price) || 0;
  }

  function resolvePublicPriceForSave(shopPrice, publicPriceRaw) {
    const shop = Number(shopPrice) || 0;
    if (publicPriceRaw === '' || publicPriceRaw == null) return null;
    const pub = Number(publicPriceRaw);
    if (!Number.isFinite(pub)) return null;
    return pub === shop ? null : pub;
  }

  function productPricePair(p) {
    const shop = Number(p?.price) || 0;
    const pub = p?.public_price != null && p.public_price !== ''
      ? (Number(p.public_price) || 0)
      : shop;
    return { shop, pub };
  }

  function productHasDistinctPublicPrice(p) {
    if (p?.public_price == null || p.public_price === '') return false;
    const { shop, pub } = productPricePair(p);
    return shop !== pub;
  }

  function productCardPricesHtml(p) {
    const { shop, pub } = productPricePair(p);
    if (!productHasDistinctPublicPrice(p)) {
      return `<div class="admin-product-card__prices admin-product-card__prices--single">
        <div class="admin-product-card__price">${FOS.fmt.money(shop)}</div>
      </div>`;
    }
    const shopLabel = FOS.i18n.t('店舗', '店铺');
    const pubLabel = FOS.i18n.t('散客', '散客');
    return `<div class="admin-product-card__prices admin-product-card__prices--dual">
      <div class="admin-product-card__price-row">
        <span class="admin-product-card__price-tag">${shopLabel}</span>
        <span class="admin-product-card__price">${FOS.fmt.money(shop)}</span>
      </div>
      <div class="admin-product-card__price-row">
        <span class="admin-product-card__price-tag admin-product-card__price-tag--public">${pubLabel}</span>
        <span class="admin-product-card__price admin-product-card__price--public">${FOS.fmt.money(pub)}</span>
      </div>
    </div>`;
  }

  function compareProductOrder(a, b) {
    const sa = a.sort_order ?? 0;
    const sb = b.sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  }

  function mergeVisibleProductOrder(allProducts, visibleIds, newVisibleOrder) {
    const visibleSet = new Set(visibleIds.map(String));
    const sorted = [...allProducts].sort(compareProductOrder);
    const result = [];
    let injected = false;
    sorted.forEach((p) => {
      const id = String(p.id);
      if (visibleSet.has(id)) {
        if (!injected) {
          newVisibleOrder.forEach((vid) => {
            const prod = allProducts.find((x) => String(x.id) === String(vid));
            if (prod) result.push(prod);
          });
          injected = true;
        }
      } else {
        result.push(p);
      }
    });
    return result;
  }

  async function persistProductSortOrders(orderedProducts) {
    const stamped = orderedProducts.map((p, i) => ({
      ...p,
      sort_order: (i + 1) * 10,
    }));
    const changed = stamped.filter((p) => {
      const prev = products.find((x) => String(x.id) === String(p.id));
      return (prev?.sort_order ?? 0) !== p.sort_order;
    });
    if (!changed.length) return;

    await Promise.all(
      changed.map((p) =>
        FOS.merchants.scopeFilter(
          FOS.db.sb
            .from('products')
            .update({ sort_order: p.sort_order, updated_at: new Date().toISOString() })
            .eq('id', p.id)
        )
      )
    );
    products = stamped;
  }

  function nextProductSortOrder() {
    const max = products.reduce((m, p) => Math.max(m, p.sort_order ?? 0), 0);
    return max + 10;
  }

  function findCatGroupEnd(items, startIdx) {
    let i = startIdx;
    while (
      i + 1 < items.length
      && items[i + 1].dataset.catKind === 'child'
      && items[i + 1].dataset.parentId === items[startIdx].dataset.catId
    ) {
      i += 1;
    }
    return i;
  }

  function catSidebarItems(container) {
    return [...container.querySelectorAll('[data-cat-reorder]')];
  }

  function catMoveGroup(item, container) {
    const items = catSidebarItems(container);
    if (item.dataset.catKind === 'child') {
      const parentId = item.dataset.parentId;
      return items.filter((el) => el.dataset.catKind === 'child' && el.dataset.parentId === parentId);
    }
    const start = items.indexOf(item);
    if (start < 0) return [item];
    const end = findCatGroupEnd(items, start);
    return items.slice(start, end + 1);
  }

  function catAnchorGroup(item, container) {
    if (item.dataset.catKind === 'child') {
      const parent = catSidebarItems(container).find((el) => el.dataset.catId === item.dataset.parentId);
      if (parent) return catMoveGroup(parent, container);
    }
    return catMoveGroup(item, container);
  }

  function bindCatSidebarReorder() {
    unbindCatReorder?.();
    const el = document.getElementById('productCatSidebar');
    if (!el || !FOS.dragReorder) return;

    unbindCatReorder = FOS.dragReorder.bind(el, {
      itemSelector: '[data-cat-reorder]',
      mode: 'swap',
      longPressMs: 400,
      getLongPressMs: () => 400,
      canStart: (item, e) => !!e.target.closest('.drag-reorder__handle'),
      getMoveGroup: (item) => catMoveGroup(item, el),
      getAnchorGroup: (item) => catAnchorGroup(item, el),
      canDrop(from, to) {
        if (from.dataset.catKind === 'child') {
          return to.dataset.catKind === 'child' && from.dataset.parentId === to.dataset.parentId;
        }
        if (from.dataset.catKind === 'parent') {
          if (to.dataset.catKind === 'parent') return from.dataset.catId !== to.dataset.catId;
          if (to.dataset.catKind === 'child') {
            const parent = catSidebarItems(el).find((node) => node.dataset.catId === to.dataset.parentId);
            return parent && from.dataset.catId !== parent.dataset.catId;
          }
        }
        return false;
      },
      swapThreshold: 0.38,
      onReorder(items) {
        if (!items.length) return;
        const kind = items.find((node) => node.dataset.catKind)?.dataset.catKind;
        if (kind === 'parent') {
          FOS.categories.reorderParents(
            items.filter((node) => node.dataset.catKind === 'parent').map((node) => node.dataset.catId)
          );
        } else if (kind === 'child') {
          const parentId = items[0].dataset.parentId;
          FOS.categories.reorderChildren(
            parentId,
            items
              .filter((node) => node.dataset.catKind === 'child' && node.dataset.parentId === parentId)
              .map((node) => node.dataset.catId)
          );
        }
        paintCatSidebar();
      },
    });
  }

  function bindProductListReorder() {
    unbindProductReorder?.();
    const el = document.getElementById('productTable');
    if (!el || !FOS.dragReorder) return;

    unbindProductReorder = FOS.dragReorder.bind(el, {
      itemSelector: '.admin-product-card[data-reorder-id]',
      mode: 'float',
      longPressMs: 280,
      getLongPressMs: () => 280,
      canStart: (item, e) => !!e.target.closest('.drag-reorder__handle'),
      onReorder: async (items) => {
        const visible = filteredProducts();
        const visibleIds = visible.map((p) => String(p.id));
        const newVisibleOrder = items.map((node) => node.dataset.reorderId);
        const merged = mergeVisibleProductOrder(products, visibleIds, newVisibleOrder);
        FOS.ui.showLoading();
        try {
          await persistProductSortOrders(merged);
          paintProductList();
          FOS.ui.toast(FOS.i18n.t('商品順序を保存しました', '商品顺序已保存'), 'success');
        } catch (e) {
          FOS.ui.toast(e.message || FOS.i18n.t('並び順の保存に失敗', '保存顺序失败'), 'error');
          paintProductList();
        } finally {
          FOS.ui.hideLoading();
        }
      },
    });
  }

  FOS.onLogout = () => { FOS.realtime.stop(); FOS.auth.logout(); boot(); };

  function adminNav() {
    return [
      { id: 'orders', icon: 'orders', label: FOS.i18n.t('受注', '订单') },
      { id: 'summary', icon: 'summary', label: FOS.i18n.t('日次集計', '日统计') },
      { id: 'products', icon: 'products', label: FOS.i18n.t('商品', '商品') },
      { id: 'inventory', icon: 'inventory', label: FOS.i18n.t('入出庫', '出入库') },
      { id: 'invoices', icon: 'invoices', label: FOS.i18n.t('請求書', '账单') },
      { id: 'settings', icon: 'settings', label: FOS.i18n.t('設定', '设置') },
    ];
  }

  FOS.onLangChange = () => {
    if (!FOS.auth.user) return;
    FOS.shell.refreshLabels(adminNav());
    navigateView(currentView);
  };

  function navigateView(id) {
    FOS.ui.showBottomNav();
    adminDetailOrderId = null;
    adminDetailOrderIds = null;
    adminDetailReturn = null;
    if (id === 'public-stats') {
      summaryHubTab = 'public';
      id = 'summary';
    } else if (id === 'payments') {
      summaryHubTab = 'payments';
      id = 'summary';
    }
    currentView = id;
    if (id === 'orders') renderOrdersPage();
    else if (id === 'summary') renderSummaryPage();
    else if (id === 'inventory') renderInventoryPage();
    else if (id === 'invoices') renderInvoicesPage();
    else if (id === 'settings') renderSettings();
    else renderProductsPage();
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
    FOS.ui.renderLogin({
      title: FOS.i18n.t('管理后台', '管理后台'),
      heroTitle: FOS.i18n.t('工場管理', '工厂管理'),
      heroDesc: FOS.i18n.t('商品・店舗・設定を一元管理', '商品、店铺与设置统一管理'),
      hint: FOS.i18n.t('管理アカウントでログイン', '使用管理账号登录'),
      rolesLabel: 'factory',
      onSubmit: async (id, pass) => { await FOS.auth.login(id, pass); await startApp(); },
    });
  }

  async function startApp() {
    await FOS.realtime.requestPermission();
    if (!FOS.realtime.isAlertsEnabled()) await FOS.realtime.enableAlerts();
    await FOS.appUrls.loadPublicBase();
    FOS.shell.mount({
      appId: 'admin',
      brand: { icon: 'gear', title: FOS.i18n.t('管理后台', '管理后台'), subtitle: 'Admin · v2' },
      nav: adminNav(),
      pageTitle: FOS.i18n.t('受注管理', '订单管理'),
      onNavigate: navigateView,
    });
    FOS.realtime.start({
      onNewOrder: async (order) => {
        if (currentView !== 'orders') return;
        if (document.getElementById('adminOrderList')) await refreshOrdersList(order);
        else await renderOrdersPage();
      },
    });
    currentView = 'orders';
    FOS.shell.navigate('orders');
  }

  async function loadOrders() {
    const { data } = await FOS.orders.forFactoryQuery(
      FOS.db.sb.from('orders').select('*, order_items(*)').order('created_at', { ascending: false })
    );
    orders = (data || []).map((o) => FOS.payment.mergeOrderPayment(o));
  }

  async function buildShopSettlementMap() {
    shopSettlementMap = await FOS.payment.loadShopSettlementMap();
  }

  function resolveOrderSettlement(order) {
    if (!order) return FOS.payment.SETTLEMENT.MONTHLY;
    const merged = FOS.payment.mergeOrderPayment(order);

    if (FOS.publicOrder?.isPublicOrder?.(merged)) {
      return FOS.payment.SETTLEMENT.CASH;
    }

    if (merged.settlement_type === FOS.payment.SETTLEMENT.CASH
      || merged.settlement_type === FOS.payment.SETTLEMENT.MONTHLY) {
      return merged.settlement_type;
    }

    if (merged.payment_type === FOS.payment.SETTLEMENT.MONTHLY) {
      return FOS.payment.SETTLEMENT.MONTHLY;
    }

    const shopId = String(merged.shop_id || '');
    const shop = shopSettlementMap[shopId] || shopSettlementMap[merged.shop_id];
    if (shop) return shop.settlement_type || FOS.payment.resolveShopSettlement(shop);

    return FOS.payment.SETTLEMENT.MONTHLY;
  }

  function matchesOrderSettlementFilter(order) {
    if (orderSettlementFilter === 'all') return true;
    if (!FOS.publicOrder?.isShopAccountOrder?.(order) && !FOS.publicOrder?.isPublicOrder?.(order)) {
      return false;
    }
    return resolveOrderSettlement(order) === orderSettlementFilter;
  }

  function orderDateList() {
    return [...new Set(orders.map((o) => o.order_date).filter(Boolean))].sort();
  }

  function resolveOrdersDate() {
    const dates = orderDateList();
    if (dates.includes(ordersDate)) return ordersDate;
    return FOS.fmt.today();
  }

  function filteredOrdersForView() {
    const fd = ordersDate;
    let list = fd ? orders.filter((o) => o.order_date === fd) : orders.slice();
    if (orderSettlementFilter !== 'all') {
      list = list.filter((o) => matchesOrderSettlementFilter(o));
    }
    return list;
  }

  function mergeShopOrdersForList(list) {
    const groups = new Map();
    list.forEach((order) => {
      const settlement = resolveOrderSettlement(order);
      const key = [
        order.shop_id || '',
        order.shop_name || '',
        order.order_date || '',
        order.status || '',
        settlement || '',
      ].join('|');
      const arr = groups.get(key) || [];
      arr.push(order);
      groups.set(key, arr);
    });

    const merged = [];
    groups.forEach((arr) => {
      const sorted = arr.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      if (sorted.length <= 1) {
        merged.push({ ...sorted[0], _mergedCount: 1, _mergedOrderIds: [sorted[0].id] });
        return;
      }
      const base = { ...sorted[0] };
      base.total = sorted.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
      base._mergedCount = sorted.length;
      base._mergedOrderIds = sorted.map((o) => o.id);
      merged.push(base);
    });

    return merged.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }

  function orderSettlementFilterHtml() {
    const opts = [
      { id: 'all', ja: 'すべて', zh: '全部' },
      { id: 'monthly', ja: '月締め', zh: '月结' },
      { id: 'cash', ja: '都度払い', zh: '现结' },
    ];
    return `
      <div class="segmented orders-settlement-filter" role="group" aria-label="${FOS.i18n.t('顧客タイプ', '顾客类型')}">
        ${opts.map((o) => `
          <button type="button" class="segmented__btn ${orderSettlementFilter === o.id ? 'active' : ''}" data-order-settlement="${o.id}">
            ${FOS.i18n.t(o.ja, o.zh)}
          </button>`).join('')}
      </div>`;
  }

  function bindOrderSettlementFilter() {
    document.querySelectorAll('[data-order-settlement]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.orderSettlement;
        if (!next || next === orderSettlementFilter) return;
        orderSettlementFilter = next;
        document.querySelectorAll('[data-order-settlement]').forEach((b) => {
          b.classList.toggle('active', b.dataset.orderSettlement === next);
        });
        updateOrderStats();
        paintAdminOrders();
      });
    });
  }

  function syncAdmDateLabel() {
    FOS.ui.syncDateTriggerLabel('admDateLabel', ordersDate);
  }

  function openOrdersCalendar() {
    FOS.ui.openActiveDateCalendar({
      activeDates: orderDateList(),
      selected: ordersDate,
      onSelect: (date) => {
        if (!date) return;
        ordersDate = date;
        syncAdmDateLabel();
        updateOrderStats();
        paintAdminOrders();
      },
    });
  }

  function formatDateTriggerLabel(dateStr) {
    return FOS.ui.formatDateLabel(dateStr);
  }

  function syncSummaryDateLabel() {
    FOS.ui.syncDateTriggerLabel('summaryDateLabel', summaryDate);
  }

  function openSummaryCalendar() {
    FOS.ui.openActiveDateCalendar({
      activeDates: orderDateList(),
      selected: summaryDate,
      onSelect: (date) => {
        if (!date) return;
        summaryDate = date;
        syncSummaryDateLabel();
        loadSummary();
      },
    });
  }

  function orderStatusCounts(list) {
    return FOS.orders.statCounts(list);
  }

  function updateOrderStats() {
    const c = orderStatusCounts(filteredOrdersForView());
    const grid = document.querySelector('#appMain .stat-grid--orders');
    if (!grid) return;
    const set = (key, val) => {
      const el = grid.querySelector(`[data-stat="${key}"] .stat-card__value`);
      if (el) el.textContent = String(val);
    };
    set('pending', c.pending);
    set('preparing', c.preparing);
    set('shipped', c.shipped);
    set('total', c.total);
  }

  function admDateTriggerHtml() {
    return FOS.ui.dateTriggerHtml({
      triggerId: 'admDateTrigger',
      labelId: 'admDateLabel',
      value: ordersDate,
      emptyLabel: FOS.fmt.today(),
    });
  }

  function adminPageHeadHtml(title, actionsHtml = '') {
    return `<div class="admin-page-head">
      <h1 class="admin-page-head__title">${title}</h1>
      ${actionsHtml ? `<div class="admin-page-head__actions">${actionsHtml}</div>` : ''}
    </div>`;
  }

  function publicStatsPeriodTriggerHtml() {
    const label = FOS.publicOrderStats.formatPeriodLabel(publicStatsPeriod, publicStatsAnchor);
    return `<button type="button" class="adm-date-trigger" id="publicStatsPeriodTrigger">
      <span id="publicStatsPeriodLabel">${FOS.fmt.escapeHtml(label)}</span>
      <span class="adm-date-trigger__icon" aria-hidden="true">▾</span>
    </button>`;
  }

  function syncPublicStatsPeriodLabel() {
    const el = document.getElementById('publicStatsPeriodLabel');
    if (el) {
      el.textContent = FOS.publicOrderStats.formatPeriodLabel(publicStatsPeriod, publicStatsAnchor);
    }
  }

  function openPublicStatsPeriodPicker() {
    let period = publicStatsPeriod;
    let anchor = publicStatsAnchor || FOS.fmt.today();
    const parts = anchor.split('-').map(Number);
    let viewYear = parts[0] || new Date().getFullYear();
    let viewMonth = parts[1] || new Date().getMonth() + 1;
    let pendingAnchor = anchor;

    const overlay = document.createElement('div');
    overlay.className = 'cal-overlay';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const close = () => {
      overlay.remove();
      document.body.style.overflow = '';
    };

    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
    const monthLabel = (y, m) => FOS.i18n.t(`${y}年${m}月`, `${y}年${m}月`);

    const paint = () => {
      const pickedLabel = FOS.publicOrderStats.formatPeriodLabel(period, pendingAnchor);
      const years = [];
      for (let y = viewYear - 5; y <= viewYear + 5; y++) years.push(y);
      const yearOpts = years.map((y) => `<option value="${y}" ${y === viewYear ? 'selected' : ''}>${y}${FOS.i18n.t('年', '年')}</option>`).join('');

      let bodyHtml = '';
      if (period === 'month') {
        bodyHtml = `
          <div class="period-sheet__month-only">
            <div class="cal-month-bar">
              <button type="button" class="cal-month-bar__nav" data-period-prev aria-label="${FOS.i18n.t('前月', '上月')}">‹</button>
              <div class="cal-month-bar__label">${monthLabel(viewYear, viewMonth)}</div>
              <button type="button" class="cal-month-bar__nav" data-period-next aria-label="${FOS.i18n.t('翌月', '下月')}">›</button>
            </div>
          </div>`;
      } else {
        const firstDow = new Date(viewYear, viewMonth - 1, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
        const weekSet = period === 'week' ? FOS.publicOrderStats.weekDateSet(pendingAnchor) : null;
        const cells = [];
        for (let i = 0; i < firstDow; i++) cells.push('<span class="cal-day cal-day--blank"></span>');
        for (let d = 1; d <= daysInMonth; d++) {
          const ds = dateStr(viewYear, viewMonth, d);
          const isSel = pendingAnchor === ds;
          const inWeek = weekSet?.has(ds);
          const cls = [
            'cal-day',
            'cal-day--active',
            isSel ? 'cal-day--selected' : '',
            inWeek && !isSel ? 'cal-day--in-week' : '',
          ].filter(Boolean).join(' ');
          cells.push(`<button type="button" class="${cls}" data-period-date="${ds}">${d}</button>`);
        }
        bodyHtml = `
          <div class="cal-month-bar">
            <button type="button" class="cal-month-bar__nav" data-period-prev aria-label="${FOS.i18n.t('前月', '上月')}">‹</button>
            <div class="cal-month-bar__label">${monthLabel(viewYear, viewMonth)}</div>
            <button type="button" class="cal-month-bar__nav" data-period-next aria-label="${FOS.i18n.t('翌月', '下月')}">›</button>
          </div>
          <div class="cal-weekdays">
            ${[FOS.i18n.t('日', '日'), FOS.i18n.t('月', '一'), FOS.i18n.t('火', '二'), FOS.i18n.t('水', '三'), FOS.i18n.t('木', '四'), FOS.i18n.t('金', '五'), FOS.i18n.t('土', '六')].map((w) => `<span class="cal-weekdays__cell">${w}</span>`).join('')}
          </div>
          <div class="cal-grid">${cells.join('')}</div>`;
      }

      overlay.innerHTML = `
        <div class="cal-sheet period-sheet" role="dialog" aria-modal="true">
          <div class="period-sheet__tabs" role="tablist">
            <button type="button" class="period-sheet__tab ${period === 'day' ? 'period-sheet__tab--active' : ''}" data-period-kind="day">${FOS.i18n.t('日', '日')}</button>
            <button type="button" class="period-sheet__tab ${period === 'week' ? 'period-sheet__tab--active' : ''}" data-period-kind="week">${FOS.i18n.t('週', '周')}</button>
            <button type="button" class="period-sheet__tab ${period === 'month' ? 'period-sheet__tab--active' : ''}" data-period-kind="month">${FOS.i18n.t('月', '月')}</button>
          </div>
          <div class="cal-sheet__hero">
            <label class="cal-sheet__year-wrap">
              <select class="cal-sheet__year-select" data-period-year aria-label="${FOS.i18n.t('年を選択', '选择年份')}">${yearOpts}</select>
            </label>
            <div class="cal-sheet__picked">${FOS.fmt.escapeHtml(pickedLabel)}</div>
          </div>
          <div class="cal-sheet__body">${bodyHtml}</div>
          <div class="cal-sheet__footer">
            <button type="button" class="cal-sheet__link" data-period-cancel>${FOS.i18n.t('キャンセル', '取消')}</button>
            <button type="button" class="cal-sheet__link cal-sheet__link--primary" data-period-confirm>${FOS.i18n.t('確定', '确定')}</button>
          </div>
        </div>`;

      overlay.querySelectorAll('[data-period-kind]').forEach((btn) => {
        btn.addEventListener('click', () => {
          period = btn.dataset.periodKind;
          if (period === 'month') {
            pendingAnchor = dateStr(viewYear, viewMonth, 1);
          }
          paint();
        });
      });
      overlay.querySelector('[data-period-year]')?.addEventListener('change', (e) => {
        viewYear = parseInt(e.target.value, 10) || viewYear;
        if (period === 'month') pendingAnchor = dateStr(viewYear, viewMonth, 1);
        paint();
      });
      overlay.querySelector('[data-period-prev]')?.addEventListener('click', () => {
        if (viewMonth === 1) { viewYear -= 1; viewMonth = 12; } else viewMonth -= 1;
        if (period === 'month') pendingAnchor = dateStr(viewYear, viewMonth, 1);
        paint();
      });
      overlay.querySelector('[data-period-next]')?.addEventListener('click', () => {
        if (viewMonth === 12) { viewYear += 1; viewMonth = 1; } else viewMonth += 1;
        if (period === 'month') pendingAnchor = dateStr(viewYear, viewMonth, 1);
        paint();
      });
      overlay.querySelectorAll('[data-period-date]').forEach((btn) => {
        btn.addEventListener('click', () => {
          pendingAnchor = btn.dataset.periodDate;
          paint();
        });
      });
      overlay.querySelector('[data-period-cancel]')?.addEventListener('click', close);
      overlay.querySelector('[data-period-confirm]')?.addEventListener('click', () => {
        publicStatsPeriod = period;
        publicStatsAnchor = period === 'month'
          ? dateStr(viewYear, viewMonth, 1)
          : pendingAnchor;
        syncPublicStatsPeriodLabel();
        close();
        loadPublicStats();
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });
    };

    paint();
  }

  function monthTriggerHtml({ labelId, inputId, value }) {
    const label = value ? value.replace('-', '/') : '—';
    return `<label class="adm-date-trigger adm-month-trigger">
      <span id="${labelId}">${label}</span>
      <span class="adm-date-trigger__icon" aria-hidden="true">▾</span>
      <input type="month" class="adm-month-trigger__input" id="${inputId}" value="${value || ''}">
    </label>`;
  }

  function syncMonthLabel(labelId, value) {
    const el = document.getElementById(labelId);
    if (el) el.textContent = value ? value.replace('-', '/') : '—';
  }

  function orderStatsHtml(list) {
    const c = orderStatusCounts(list);
    return `
      <div class="stat-grid__total">
        <div class="stat-card stat-card--total" data-stat="total">
          <div class="stat-card__label">${FOS.i18n.t('合計', '合计')}</div>
          <div class="stat-card__value">${c.total}</div>
        </div>
      </div>
      <div class="stat-grid__flow">
        <div class="stat-card" data-stat="pending">
          <div class="stat-card__label">${FOS.i18n.t('受付中', '待处理')}</div>
          <div class="stat-card__value" style="color:var(--info)">${c.pending}</div>
        </div>
        <div class="stat-card" data-stat="preparing">
          <div class="stat-card__label">${FOS.i18n.t('準備中', '准备中')}</div>
          <div class="stat-card__value" style="color:var(--warning)">${c.preparing}</div>
        </div>
        <div class="stat-card" data-stat="shipped">
          <div class="stat-card__label">${FOS.i18n.t('出荷完了', '发货完成')}</div>
          <div class="stat-card__value" style="color:var(--accent)">${c.shipped}</div>
        </div>
      </div>`;
  }

  async function refreshOrdersList(hintOrder) {
    if (hintOrder?.order_date) ordersDate = hintOrder.order_date;

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let attempt = 0; attempt < 4; attempt++) {
      await loadOrders();
      await buildShopSettlementMap();
      if (!hintOrder?.id) break;
      const full = await FOS.orders.fetchOneForFactory(hintOrder.id);
      if (full) {
        const idx = orders.findIndex((o) => o.id === full.id);
        if (idx >= 0) orders[idx] = full;
        else orders.unshift(full);
        break;
      }
      if (attempt < 3) await wait(450);
    }

    ordersDate = resolveOrdersDate();
    updateOrderStats();
    syncAdmDateLabel();
    if (FOS.calendar.isOpen()) {
      FOS.calendar.refresh({ activeDates: orderDateList(), selected: ordersDate });
    }
    paintAdminOrders();
  }

  async function renderOrdersPage() {
    FOS.shell.setPageTitle(FOS.i18n.t('受注管理', '订单管理'));
    FOS.ui.showLoading();
    await loadOrders();
    await buildShopSettlementMap();
    FOS.ui.hideLoading();
    const main = document.getElementById('appMain');
    ordersDate = resolveOrdersDate();
    const statsList = filteredOrdersForView();

    main.innerHTML = `
      <div class="orders-page">
        ${adminPageHeadHtml(FOS.i18n.t('受注一覧', '订单列表'), admDateTriggerHtml())}
        <div class="orders-page__filters">${orderSettlementFilterHtml()}</div>
        <div class="stat-grid stat-grid--orders">${orderStatsHtml(statsList)}</div>
        <div id="adminOrderList"></div>
      </div>`;

    document.getElementById('admDateTrigger')?.addEventListener('click', openOrdersCalendar);
    bindOrderSettlementFilter();
    paintAdminOrders();
  }

  function statusBadgesHtml(orderList) {
    const counts = {};
    orderList.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
    const order = ['pending', 'preparing', 'shipped', 'delivered', 'confirmed'];
    return order
      .filter((s) => counts[s])
      .map((status) => {
        const st = FOS.fmt.status(status);
        const n = counts[status];
        return `<span class="badge badge--${st.color}">${st.label}${n > 1 ? ` ×${n}` : ''}</span>`;
      })
      .join('');
  }

  function orderEditBtnHtml(orderId) {
    return `<button type="button" class="btn btn--secondary btn--sm" data-edit-order="${orderId}">✏️ ${FOS.i18n.t('編集', '编辑')}</button>`;
  }

  function orderStatusActionsHtml(order) {
    if (order.status === 'pending') {
      return `<button class="btn btn--primary btn--sm" data-st="${order.id}" data-v="preparing">→ ${FOS.i18n.t('準備中', '准备')}</button>`;
    }
    if (order.status === 'preparing') {
      return `<button class="btn btn--success btn--sm" data-outbound="${order.id}">📤 ${FOS.i18n.t('出庫', '出库')}</button>`;
    }
    return '';
  }

  function orderPrintActionsHtml(order) {
    if (!['shipped', 'delivered', 'confirmed'].includes(order.status)) return '';
    return `<button type="button" class="btn btn--secondary btn--sm" data-reprint="${order.id}">🖨 ${FOS.i18n.t('配送単再印刷', '补打配送单')}</button>`;
  }

  async function handleOutboundOrder(orderId) {
    FOS.ui.showLoading();
    try {
      const result = await FOS.outboundPrint.shipAndPrint(orderId);
      FOS.ui.toast(result.message, result.printFailed ? 'error' : 'success');
      if (adminDetailOrderId) await renderAdminOrderDetailPage();
      else await renderOrdersPage();
    } catch (e) {
      FOS.ui.toast(e.message, 'error');
    } finally {
      FOS.ui.hideLoading();
    }
  }

  function bindOrderDetailActions(root) {
    root?.querySelectorAll('[data-st]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        FOS.ui.showLoading();
        try {
          await FOS.orders.updateStatus(btn.dataset.st, btn.dataset.v);
          FOS.ui.toast(FOS.i18n.t('更新しました', '已更新'), 'success');
          if (adminDetailOrderId) await renderAdminOrderDetailPage();
          else await renderOrdersPage();
        } catch (e) {
          FOS.ui.toast(e.message, 'error');
        } finally {
          FOS.ui.hideLoading();
        }
      });
    });
    root?.querySelectorAll('[data-outbound]').forEach((btn) => {
      btn.addEventListener('click', () => handleOutboundOrder(btn.dataset.outbound));
    });
    root?.querySelectorAll('[data-reprint]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        FOS.ui.showLoading();
        try {
          await FOS.outboundPrint.reprint(btn.dataset.reprint);
        } catch (e) {
          FOS.ui.toast(e.message, 'error');
        } finally {
          FOS.ui.hideLoading();
        }
      });
    });
    root?.querySelectorAll('[data-edit-order]').forEach((btn) => {
      btn.addEventListener('click', () => openOrderEdit(btn.dataset.editOrder));
    });
  }

  async function openOrderEdit(orderId) {
    const order = await FOS.orders.fetchOne(orderId);
    if (!order) return;

    const { data: productList } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('products').select('id, name, spec, emoji, price, public_price, tax_rate, active')
        .eq('active', true)
        .order('sort_order')
    );
    const productsForAdd = productList || [];
    const originalItems = (order.order_items || []).slice();
    let items = originalItems.slice();
    let pendingAdds = [];

    const orderTitle = FOS.publicOrder.isPublicOrder(order)
      ? `${FOS.fmt.escapeHtml(order.customer_name || order.shop_name || '')} · ${FOS.fmt.escapeHtml(order.public_order_code || ('#' + order.order_no))}`
      : `#${order.order_no} — ${FOS.fmt.escapeHtml(FOS.fmt.displayName(order.shop_name))}`;
    const st = FOS.fmt.status(order.status);

    function renderItemsHtml() {
      if (!items.length) {
        return `<div class="order-edit-empty">${FOS.i18n.t('商品なし', '暂无商品')}</div>`;
      }
      return items.map((item, idx) => {
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
            <input type="number" min="0" value="${item.qty}" class="field__input" id="eqty_${idx}">
          </label>
          ${FOS.orders.editShortageFieldHtml(item, idx)}
          <input class="field__input edit-item-row__note" placeholder="${FOS.i18n.t('備考', '备注')}" value="${FOS.fmt.escapeHtml(item.shortage_note || '')}" id="enote_${idx}">
          <button type="button" class="btn btn--del btn--sm" data-remove-item="${idx}">×</button>
        </div>`;
      }).join('');
    }

    function renderPendingAddsHtml() {
      if (!pendingAdds.length) return '';
      return `<div class="order-edit-pending">
        <div class="admin-order-section__label">${FOS.i18n.t('追加予定', '待添加')}</div>
        ${pendingAdds.map((a, i) => {
          const specInline = a.product_spec
            ? `<span class="edit-item-row__spec-inline">(${FOS.fmt.escapeHtml(a.product_spec)})</span>`
            : '';
          return `
          <div class="edit-item-row order-item-row--admin-added">
            <div class="edit-item-row__info edit-item-row__info--inline">
              <span class="edit-item-row__name">${FOS.fmt.escapeHtml(a.product_name)}</span>${specInline}
              <span class="badge badge--blue order-item-admin-tag">${FOS.i18n.t('管理追加', '后台添加')}</span>
            </div>
            <span class="edit-item-row__pending-qty">×${a.qty}</span>
            <button type="button" class="btn btn--ghost btn--sm" data-unpending="${i}">${FOS.i18n.t('取消', '取消')}</button>
          </div>`;
        }).join('')}
      </div>`;
    }

    function paintModalLists() {
      const wrap = document.getElementById('orderEditItemsWrap');
      const pendingEl = document.getElementById('orderEditPendingWrap');
      if (wrap) wrap.innerHTML = renderItemsHtml();
      if (pendingEl) pendingEl.innerHTML = renderPendingAddsHtml();
      document.querySelectorAll('[data-remove-item]').forEach((btn) => {
        btn.onclick = () => {
          items.splice(parseInt(btn.dataset.removeItem, 10), 1);
          paintModalLists();
        };
      });
      document.querySelectorAll('[data-unpending]').forEach((btn) => {
        btn.onclick = () => {
          pendingAdds.splice(parseInt(btn.dataset.unpending, 10), 1);
          paintModalLists();
        };
      });
      document.querySelectorAll('[id^="eqty_"]').forEach((input) => {
        input.addEventListener('input', () => {
          const idx = input.id.replace('eqty_', '');
          const sq = document.getElementById('eshortqty_' + idx);
          if (!sq) return;
          const max = parseInt(input.value, 10) || 0;
          sq.max = String(max);
          if ((parseInt(sq.value, 10) || 0) > max) sq.value = String(max);
        });
      });
    }

    FOS.ui.openModal({
      title: orderTitle,
      size: 'lg',
      bodyHtml: `
        <div class="order-edit-head">
          <span class="badge badge--${st.color}">${st.label}</span>
          <span class="order-edit-head__date">${order.order_date}</span>
          <select class="filter-select order-edit-head__status" id="editStatus">
            <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>${FOS.i18n.t('受付中', '待处理')}</option>
            <option value="preparing" ${order.status === 'preparing' ? 'selected' : ''}>${FOS.i18n.t('準備中', '准备中')}</option>
            <option value="shipped" ${order.status === 'shipped' ? 'selected' : ''}>${FOS.i18n.t('出荷済', '已发货')}</option>
            <option value="delivered" ${order.status === 'delivered' ? 'selected' : ''}>${FOS.i18n.t('配達完了', '已送达')}</option>
            <option value="confirmed" ${order.status === 'confirmed' ? 'selected' : ''}>${FOS.i18n.t('受取確認済', '已确认')}</option>
          </select>
        </div>
        <label class="field">
          <span class="field__label">${FOS.i18n.t('工場メモ', '后台备注')}</span>
          <textarea class="field__input" id="editFactoryNote" rows="2">${FOS.fmt.escapeHtml(order.factory_note || '')}</textarea>
        </label>
        <div class="admin-order-section__label">${FOS.i18n.t('商品明細', '商品明细')}</div>
        <div class="order-edit-items" id="orderEditItemsWrap"></div>
        <div id="orderEditPendingWrap"></div>
        <div class="order-edit-add">
          <select class="field__input" id="editAddProduct">
            <option value="">${FOS.i18n.t('商品を選択', '选择商品')}</option>
            ${productsForAdd.map((p) => {
              const price = FOS.orders.orderItemUnitPrice(p, order);
              return `<option value="${FOS.fmt.escapeHtml(String(p.id))}">${FOS.fmt.escapeHtml(FOS.fmt.displayName(p.name))} · ${FOS.fmt.money(price)}</option>`;
            }).join('')}
          </select>
          <input type="number" class="field__input order-edit-add__qty" id="editAddQty" min="1" value="1">
          <button type="button" class="btn btn--secondary btn--sm" id="editAddProductBtn">＋ ${FOS.i18n.t('追加', '添加')}</button>
        </div>
        <p class="field__hint">${FOS.i18n.t('数量0または×で削除。「欠品数」に不足数を入力（例：注文3・欠1）。', '数量为 0 或点 × 可删除；在「缺货数」填不足数量（例：订 3 缺 1）。')}</p>
        <div class="order-edit-footer">
          <button type="button" class="btn btn--secondary" data-modal-close>${FOS.i18n.t('閉じる', '关闭')}</button>
          <button type="button" class="btn btn--primary" id="saveOrderEditBtn">${FOS.i18n.t('保存', '保存')}</button>
        </div>`,
    });

    paintModalLists();

    document.getElementById('editAddProductBtn')?.addEventListener('click', () => {
      const pid = document.getElementById('editAddProduct')?.value;
      const qty = parseInt(document.getElementById('editAddQty')?.value, 10) || 0;
      if (!pid || qty <= 0) {
        FOS.ui.toast(FOS.i18n.t('商品と数量を入力', '请选择商品和数量'), 'error');
        return;
      }
      const product = productsForAdd.find((p) => String(p.id) === String(pid));
      if (!product) return;
      pendingAdds.push(FOS.orders.productToOrderItem(product, order, qty));
      paintModalLists();
    });

    document.getElementById('saveOrderEditBtn')?.addEventListener('click', async () => {
      const editItems = items.map((item, idx) => {
        const qty = document.getElementById('eqty_' + idx)?.value;
        return {
          id: item.id,
          qty,
          shortageQty: document.getElementById('eshortqty_' + idx)?.value,
          shortageNote: document.getElementById('enote_' + idx)?.value,
        };
      });
      const keptIds = new Set(items.map((i) => i.id));
      originalItems.forEach((orig) => {
        if (!keptIds.has(orig.id)) editItems.push({ id: orig.id, remove: true });
      });

      FOS.ui.showLoading();
      try {
        await FOS.orders.saveEdit(orderId, {
          status: document.getElementById('editStatus').value,
          factoryNote: document.getElementById('editFactoryNote').value,
          items: editItems,
          addItems: pendingAdds,
        });
        FOS.ui.closeModal();
        FOS.ui.toast(FOS.i18n.t('保存しました', '已保存'), 'success');
        if (adminDetailOrderId) await renderAdminOrderDetailPage();
        else await renderOrdersPage();
      } catch (e) {
        FOS.ui.toast(e.message, 'error');
      } finally {
        FOS.ui.hideLoading();
      }
    });
  }

  function paintAdminOrders() {
    const el = document.getElementById('adminOrderList');
    if (!el) return;
    const list = filteredOrdersForView();
    if (!list.length) {
      const emptyMsg = orderSettlementFilter === 'all'
        ? FOS.i18n.t('注文なし', '暂无订单')
        : FOS.i18n.t('該当する注文なし', '暂无符合筛选的订单');
      el.innerHTML = FOS.ui.empty('📋', emptyMsg);
      return;
    }

    const shopRawList = list.filter((o) => FOS.publicOrder.isShopAccountOrder(o))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const shopList = mergeShopOrdersForList(shopRawList);
    const publicList = list.filter((o) => FOS.publicOrder.isPublicOrder(o))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    const shopHtml = shopList.map((order) => hubOrderCardHtml(order)).join('');

    const publicHtml = publicList.map((order) => {
      const st = FOS.fmt.status(order.status);
      const code = order.public_order_code || ('#' + order.order_no);
      const created = order.created_at ? formatOrderDateTime(order.created_at) : order.order_date || '';
      return `
      <button type="button" class="hub-order-card" data-open-order="${order.id}">
        <div class="hub-order-card__top">
          <span class="hub-order-card__no">${FOS.i18n.t('注文番号', '订单号')}：${FOS.fmt.escapeHtml(code)}</span>
          <span class="badge badge--${st.color} hub-order-card__status">${st.label}</span>
        </div>
        <div class="hub-order-card__customer">${FOS.fmt.escapeHtml(order.customer_name || order.shop_name || '—')}</div>
        <div class="hub-order-card__meta">
          <div>${FOS.fmt.escapeHtml(FOS.publicOrder.orderSourceLabel(order))}</div>
          ${created ? `<div>${FOS.i18n.t('注文日時', '下单时间')}：${FOS.fmt.escapeHtml(created)}</div>` : ''}
        </div>
        <div class="hub-order-card__foot">
          <span class="hub-order-card__amount">${FOS.fmt.money(order.total)}</span>
        </div>
      </button>`;
    }).join('');

    const publicSection = publicList.length
      ? `<div class="admin-order-section__label" style="margin-top:4px">${FOS.i18n.t('顧客注文（個別）', '顾客订单（独立显示）')}</div>${publicHtml}`
      : '';

    el.innerHTML = `<div class="hub-order-list">${shopHtml}${publicSection}</div>`;
    el.querySelectorAll('[data-open-order]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const orderIds = (btn.dataset.openOrders || '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        openAdminOrderDetail(btn.dataset.openOrder, { view: 'orders' }, orderIds.length ? orderIds : null);
      });
    });
  }

  function summaryHubTitle() {
    if (summaryHubTab === 'public') return FOS.i18n.t('顧客注文統計', '顾客订单统计');
    if (summaryHubTab === 'payments') return FOS.i18n.t('オーダー', '订单');
    return FOS.i18n.t('商品集計', '商品汇总');
  }

  function summaryHubDateHtml() {
    if (summaryHubTab === 'public') {
      return publicStatsPeriodTriggerHtml();
    }
    if (summaryHubTab === 'payments') {
      return FOS.ui.dateTriggerHtml({ triggerId: 'paymentDateTrigger', labelId: 'paymentDateLabel', value: paymentDate });
    }
    return FOS.ui.dateTriggerHtml({ triggerId: 'summaryDateTrigger', labelId: 'summaryDateLabel', value: summaryDate });
  }

  function summaryHubToolbarHtml() {
    if (summaryHubTab === 'daily') {
      return `<div class="summary-page__toolbar">
        <button type="button" class="btn btn--primary btn--sm" id="loadSummaryBtn">${FOS.i18n.t('集計', '汇总')}</button>
        <button type="button" class="btn btn--secondary btn--sm" id="exportSummaryBtn">📥 ${FOS.i18n.t('PDF保存', '保存 PDF')}</button>
      </div>`;
    }
    if (summaryHubTab === 'public') {
      return `<div class="summary-page__toolbar">
        <button type="button" class="btn btn--primary btn--sm" id="loadPublicStatsBtn">${FOS.i18n.t('集計', '汇总')}</button>
      </div>`;
    }
    if (summaryHubTab === 'payments') {
      return `<div class="summary-page__toolbar">
        <div class="segmented payment-tabs">
          <button type="button" class="segmented__btn ${paymentTab === 'detail' ? 'active' : ''}" data-pay-tab="detail">${FOS.i18n.t('明細', '明细')}</button>
          <button type="button" class="segmented__btn ${paymentTab === 'summary' ? 'active' : ''}" data-pay-tab="summary">${FOS.i18n.t('集計', '汇总')}</button>
        </div>
      </div>`;
    }
    return '';
  }

  function summaryHubTabsHtml() {
    const tabs = [
      { id: 'daily', ja: '商品集計', zh: '商品汇总' },
      { id: 'public', ja: '顧客注文', zh: '顾客统计' },
      { id: 'payments', ja: 'オーダー', zh: '订单' },
    ];
    return `<div class="segmented summary-hub__tabs" role="tablist">${tabs.map((t) =>
      `<button type="button" class="segmented__btn ${summaryHubTab === t.id ? 'active' : ''}" data-hub-tab="${t.id}">${FOS.i18n.t(t.ja, t.zh)}</button>`
    ).join('')}</div>`;
  }

  async function renderSummaryPage() {
    FOS.shell.setPageTitle(FOS.i18n.t('日次集計', '日统计'));
    const now = new Date();
    if (!publicStatsAnchor) {
      publicStatsAnchor = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }
    if (summaryHubTab === 'daily' || summaryHubTab === 'payments') {
      FOS.ui.showLoading();
      await loadOrders();
      FOS.ui.hideLoading();
      if (summaryHubTab === 'payments') {
        const dates = [...new Set(orders.map((o) => o.order_date).filter(Boolean))].sort();
        if (!dates.includes(paymentDate)) paymentDate = dates[dates.length - 1] || FOS.fmt.today();
      }
    }

    const main = document.getElementById('appMain');
    main.innerHTML = `
      <div class="summary-page summary-hub">
        ${summaryHubTabsHtml()}
        ${adminPageHeadHtml(summaryHubTitle(), summaryHubDateHtml())}
        ${summaryHubToolbarHtml()}
        <div id="summaryHubBody"></div>
      </div>`;

    main.querySelectorAll('[data-hub-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        summaryHubTab = btn.dataset.hubTab;
        renderSummaryPage();
      });
    });

    if (summaryHubTab === 'daily') {
      document.getElementById('summaryDateTrigger')?.addEventListener('click', openSummaryCalendar);
      document.getElementById('loadSummaryBtn')?.addEventListener('click', loadSummary);
      document.getElementById('exportSummaryBtn')?.addEventListener('click', async () => {
        try {
          const data = await FOS.dailySummary.load(summaryDate);
          FOS.dailySummary.exportPdf(data);
        } catch (e) { FOS.ui.toast(e.message, 'error'); }
      });
      await loadSummary();
    } else if (summaryHubTab === 'public') {
      document.getElementById('publicStatsPeriodTrigger')?.addEventListener('click', openPublicStatsPeriodPicker);
      document.getElementById('loadPublicStatsBtn')?.addEventListener('click', loadPublicStats);
      await loadPublicStats();
    } else {
      document.getElementById('paymentDateTrigger')?.addEventListener('click', () => {
        FOS.ui.openActiveDateCalendar({
          activeDates: orderDateList(),
          selected: paymentDate,
          onSelect: (date) => {
            if (!date) return;
            paymentDate = date;
            FOS.ui.syncDateTriggerLabel('paymentDateLabel', paymentDate);
            paintPaymentsBody();
          },
        });
      });
      main.querySelectorAll('[data-pay-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          paymentTab = btn.dataset.payTab;
          main.querySelectorAll('[data-pay-tab]').forEach((b) => b.classList.toggle('active', b.dataset.payTab === paymentTab));
          paintPaymentsBody();
        });
      });
      paintPaymentsBody();
    }
  }

  async function loadPublicStats() {
    const el = document.getElementById('summaryHubBody');
    if (!el || !publicStatsAnchor) return;
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary)">...</div>';
    try {
      const data = await FOS.publicOrderStats.load({
        period: publicStatsPeriod,
        anchor: publicStatsAnchor,
      });
      el.innerHTML = FOS.publicOrderStats.panelHtml(data);
    } catch (e) {
      el.innerHTML = FOS.ui.empty('⚠️', e.message);
    }
  }

  async function loadSummary() {
    const el = document.getElementById('summaryHubBody');
    if (!el) return;
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-tertiary)">...</div>';
    try {
      const data = await FOS.dailySummary.load(summaryDate);
      el.innerHTML = FOS.dailySummary.tableHtml(data);
    } catch (e) {
      el.innerHTML = FOS.ui.empty('⚠️', e.message);
    }
  }

  async function renderInvoicesPage() {
    FOS.shell.setPageTitle(FOS.i18n.t('請求書', '账单'));
    await loadShops();
    const invoiceProfile = await FOS.invoiceSettings.load();
    const now = new Date();
    if (!invMonth) invMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const main = document.getElementById('appMain');
    main.innerHTML = `
      <div class="invoices-page">
        ${adminPageHeadHtml(
          FOS.i18n.t('月次請求書', '月度账单'),
          monthTriggerHtml({ labelId: 'invoiceMonthLabel', inputId: 'invoiceMonth', value: invMonth })
        )}
        ${FOS.invoiceSettings.isComplete(invoiceProfile) ? '' : `
        <div class="alert alert--warn" style="margin-bottom:12px">
          ${FOS.i18n.t(
            '請求書の発行元情報が未設定です。設定ページで会社名・住所・振込先を入力してください。',
            '尚未填写开票方信息，请在「设置」中填写公司名称、地址与汇款账户。'
          )}
        </div>`}
        <div class="invoices-page__toolbar">
          <label class="field invoices-page__shop">
            <span class="field__label">${FOS.i18n.t('顧客', '顾客')}</span>
            <select class="field__input" id="invoiceShopSel">
              <option value="">${FOS.i18n.t('全顧客', '全部顾客')}</option>
              ${shops.map((s) => `<option value="${s.id}" ${invShopId === s.id ? 'selected' : ''}>${FOS.fmt.escapeHtml(s.name)}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="btn btn--primary btn--sm" id="genInvoiceBtn">📥 ${FOS.i18n.t('PDF保存', '保存 PDF')}</button>
        </div>
        <div id="invoicePreview"></div>
      </div>`;
    document.getElementById('invoiceMonth')?.addEventListener('change', (e) => {
      invMonth = e.target.value;
      syncMonthLabel('invoiceMonthLabel', invMonth);
      previewInvoice();
    });
    document.getElementById('invoiceShopSel').addEventListener('change', (e) => { invShopId = e.target.value; previewInvoice(); });
    document.getElementById('genInvoiceBtn').addEventListener('click', async () => {
      try {
        const rows = await FOS.invoice.load(invMonth, invShopId || null);
        await FOS.invoice.exportPdf(invMonth, rows);
      } catch (e) { FOS.ui.toast(e.message, 'error'); }
    });
    await previewInvoice();
  }

  async function previewInvoice() {
    const el = document.getElementById('invoicePreview');
    if (!el || !invMonth) return;
    try {
      const rows = await FOS.invoice.load(invMonth, invShopId || null);
      if (!rows.length) { el.innerHTML = FOS.ui.empty('📄', FOS.i18n.t('対象注文なし', '暂无账单数据')); return; }
      const byShop = {};
      rows.forEach((o) => {
        if (!byShop[o.shop_id]) byShop[o.shop_id] = { name: o.shop_name, count: 0, total: 0 };
        byShop[o.shop_id].count += 1;
        byShop[o.shop_id].total += o.total || 0;
      });
      el.innerHTML = `
        <div class="invoice-preview">
          <div class="invoice-preview__head">
            <span>${FOS.i18n.t('顧客', '顾客')}</span>
            <span>${FOS.i18n.t('件数', '笔数')}</span>
            <span>${FOS.i18n.t('合計', '合计')}</span>
          </div>
          <div class="invoice-preview__body">
            ${Object.values(byShop).map((s) => `
              <div class="invoice-preview__row">
                <span class="invoice-preview__name">${FOS.fmt.escapeHtml(FOS.fmt.displayName(s.name))}</span>
                <span class="invoice-preview__count">${s.count}</span>
                <span class="invoice-preview__total">${FOS.fmt.money(s.total)}</span>
              </div>`).join('')}
          </div>
        </div>`;
    } catch (e) { el.innerHTML = FOS.ui.empty('⚠️', e.message); }
  }

  async function renderInventoryPage() {
    FOS.shell.setPageTitle(FOS.i18n.t('入出庫', '出入库'));
    await loadProducts();
    const now = new Date();
    if (!stockMonth) stockMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const main = document.getElementById('appMain');
    main.innerHTML = `
      ${adminPageHeadHtml(FOS.i18n.t('原料入出庫', '原料出入库'))}
      <div class="card scan-card" id="scanCard">
        <div class="card__body">
          <div class="scan-mode-tabs" role="tablist">
            <button type="button" class="scan-mode-tab ${stockMode === 'in' ? 'scan-mode-tab--active' : ''}" data-scan-mode="in" role="tab" aria-selected="${stockMode === 'in'}">📥 ${FOS.i18n.t('入庫', '入库')}</button>
            <button type="button" class="scan-mode-tab ${stockMode === 'out' ? 'scan-mode-tab--active' : ''}" data-scan-mode="out" role="tab" aria-selected="${stockMode === 'out'}">📤 ${FOS.i18n.t('出庫', '出库')}</button>
          </div>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('バーコードスキャン', '扫码')}</span>
            <input class="field__input scan-input" id="scanBarcode" placeholder="${FOS.i18n.t('バーコードをスキャン', '扫描条码')}" autocomplete="off">
          </label>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('商品名', '商品名称')}</span>
            <div class="scan-product-name scan-product-name--empty" id="scanProductName">${FOS.i18n.t('バーコードをスキャンしてください', '请扫描条码')}</div>
          </label>
          <div id="scanProductInfo" class="alert alert--info" style="display:none"></div>
          <div class="form-grid form-grid--2">
            <label class="field"><span class="field__label">${FOS.i18n.t('数量', '数量')}</span>
              <input type="number" class="field__input" id="scanQty" min="1" value="1"></label>
            <label class="field"><span class="field__label">${FOS.i18n.t('備考', '备注')}</span>
              <input class="field__input" id="scanNote"></label>
          </div>
          <button type="button" class="btn btn--primary btn--block btn--lg" id="scanSubmitBtn">${FOS.i18n.t('登録', '登记')}</button>
        </div>
      </div>
      <div class="toolbar" style="margin-top:16px">
        <input type="month" class="filter-select" id="stockMonth" value="${stockMonth}">
        <button type="button" class="btn btn--secondary btn--sm" id="reloadStockBtn">↻</button>
      </div>
      <div id="stockStatsBody"></div>`;

    let scannedProduct = null;
    const scanInput = document.getElementById('scanBarcode');
    if (window.innerWidth > 1023) scanInput.focus();

    function paintScanModeTabs() {
      scanCard.querySelectorAll('[data-scan-mode]').forEach((b) => {
        const active = b.dataset.scanMode === stockMode;
        b.classList.toggle('scan-mode-tab--active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    scanCard.querySelectorAll('[data-scan-mode]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        stockMode = btn.dataset.scanMode;
        paintScanModeTabs();
      });
    });

    function resetScanProductDisplay() {
      scannedProduct = null;
      const nameEl = document.getElementById('scanProductName');
      const info = document.getElementById('scanProductInfo');
      if (nameEl) {
        nameEl.className = 'scan-product-name scan-product-name--empty';
        nameEl.textContent = FOS.i18n.t('バーコードをスキャンしてください', '请扫描条码');
      }
      if (info) info.style.display = 'none';
    }

    async function resolveBarcode(code) {
      const nameEl = document.getElementById('scanProductName');
      const info = document.getElementById('scanProductInfo');
      scannedProduct = await FOS.inventory.findProductByBarcode(code, products);
      if (!scannedProduct) {
        nameEl.className = 'scan-product-name scan-product-name--empty';
        nameEl.textContent = FOS.i18n.t('商品が見つかりません', '未找到商品');
        info.style.display = 'none';
        return;
      }
      const zh = scannedProduct.name_zh ? ` <span style="color:var(--text-tertiary);font-weight:500">/ ${FOS.fmt.escapeHtml(scannedProduct.name_zh)}</span>` : '';
      nameEl.className = 'scan-product-name';
      nameEl.innerHTML = `${scannedProduct.emoji || '📦'} <strong>${FOS.fmt.escapeHtml(scannedProduct.name)}</strong>${zh}`;
      const direct = scannedProduct.needs_processing === false;
      if (direct) {
        info.style.display = 'block';
        info.innerHTML = `<span class="badge badge--green">${FOS.i18n.t('直出入庫可', '可直接出入库')}</span>`;
      } else {
        info.style.display = 'none';
      }
    }

    let scanResolveTimer = null;
    scanInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(scanResolveTimer);
      await resolveBarcode(scanInput.value.trim());
    });
    scanInput.addEventListener('input', () => {
      clearTimeout(scanResolveTimer);
      scanResolveTimer = setTimeout(() => resolveBarcode(scanInput.value.trim()), 280);
    });
    scanInput.addEventListener('blur', () => {
      const code = scanInput.value.trim();
      if (code) resolveBarcode(code);
    });

    document.getElementById('scanSubmitBtn').addEventListener('click', async () => {
      const code = scanInput.value.trim();
      if (!scannedProduct) await resolveBarcode(code);
      if (!scannedProduct) return;
      const qty = parseInt(document.getElementById('scanQty').value, 10) || 1;
      const note = document.getElementById('scanNote').value.trim();
      FOS.ui.showLoading();
      try {
        await FOS.inventory.record({
          productId: scannedProduct.id,
          type: stockMode,
          qty,
          note,
          barcode: code,
        });
        const delta = stockMode === 'in' ? qty : -qty;
        await FOS.inventory.adjustProductStock(scannedProduct.id, delta);
        FOS.ui.toast(FOS.i18n.t('登録しました', '已登记'), 'success');
        scanInput.value = '';
        resetScanProductDisplay();
        if (window.innerWidth > 1023) scanInput.focus();
        await paintStockStats();
      } catch (err) {
        FOS.ui.toast(err.message, 'error');
      } finally {
        FOS.ui.hideLoading();
      }
    });

    document.getElementById('stockMonth').addEventListener('change', (e) => { stockMonth = e.target.value; paintStockStats(); });
    document.getElementById('reloadStockBtn').addEventListener('click', paintStockStats);
    await paintStockStats();
  }

  async function paintStockStats() {
    const el = document.getElementById('stockStatsBody');
    if (!el) return;
    try {
      const stats = await FOS.inventory.monthlyStats(stockMonth, products);
      const active = stats.filter((s) => s.in_qty || s.out_qty);
      if (!active.length) { el.innerHTML = FOS.ui.empty('📥', FOS.i18n.t('今月の記録なし', '本月暂无记录')); return; }
      el.innerHTML = `<div class="card"><div class="card__body" style="padding:0"><div class="table-wrap"><table>
        <thead><tr>
          <th>${FOS.i18n.t('商品', '商品')}</th>
          <th>${FOS.i18n.t('入庫', '入库')}</th>
          <th>${FOS.i18n.t('出庫', '出库')}</th>
          <th>${FOS.i18n.t('差引', '净额')}</th>
          <th>${FOS.i18n.t('加工', '加工')}</th>
        </tr></thead>
        <tbody>${active.map((s) => `<tr>
          <td>${s.emoji} ${FOS.fmt.escapeHtml(s.name)}</td>
          <td style="color:var(--success);font-weight:700">${s.in_qty}</td>
          <td style="color:var(--danger);font-weight:700">${s.out_qty}</td>
          <td style="font-weight:800">${s.in_qty - s.out_qty}</td>
          <td>${s.needs_processing ? FOS.i18n.t('要', '需') : FOS.i18n.t('不要', '否')}</td>
        </tr>`).join('')}</tbody></table></div></div></div>`;
    } catch (e) { el.innerHTML = FOS.ui.empty('⚠️', e.message); }
  }

  function barcodeFieldHtml(p, prefix) {
    return `
      <label class="field">
        <span class="field__label">${FOS.i18n.t('バーコード', '条码')}</span>
        <div class="barcode-field-row">
          <input class="field__input" id="${prefix}Barcode" value="${FOS.fmt.escapeHtml(p?.barcode || '')}"
            placeholder="${FOS.i18n.t('スキャンまたは入力', '扫码或输入')}" autocomplete="off">
          <button type="button" class="btn btn--secondary btn--sm" data-barcode-scan="${prefix}" title="${FOS.i18n.t('カメラでスキャン', '摄像头扫码')}">📷</button>
        </div>
      </label>
      <div id="${prefix}CatalogHint" class="catalog-hint" hidden></div>`;
  }

  function productImageFields(p, prefix) {
    const url = p?.image_url || '';
    return `
      <label class="field"><span class="field__label">${FOS.i18n.t('商品画像', '商品图片')}</span>
        <div class="img-upload-row">
          <img class="img-preview" id="${prefix}ImgPreview" src="${FOS.fmt.escapeHtml(url)}" style="${url ? '' : 'display:none'}" alt="">
          <div>
            <input type="file" accept="image/*" id="${prefix}ImageFile" class="field__input">
            <input type="hidden" id="${prefix}ImageUrl" value="${FOS.fmt.escapeHtml(url)}">
            <span id="${prefix}UploadStatus" class="field__label"></span>
          </div>
        </div>
      </label>
      <label class="field" style="display:flex;align-items:flex-end;gap:8px;padding-bottom:14px">
        <input type="checkbox" id="${prefix}NeedsProc" ${p?.needs_processing === false ? '' : 'checked'}>
        <span>${FOS.i18n.t('加工が必要', '需要加工')}</span>
      </label>`;
  }

  function setSelectOption(selectEl, value) {
    if (!selectEl || !value) return;
    const exists = [...selectEl.options].some((o) => o.value === value);
    if (!exists) selectEl.add(new Option(value, value));
    selectEl.value = value;
  }

  function applyCatalogToForm(prefix, catalogProduct) {
    const d = FOS.productCatalog.toFormDefaults(catalogProduct);
    if (!d) return;

    if (prefix === 'add') {
      const set = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
      };
      set('addName', d.name);
      set('addNameZh', d.name_zh);
      set('addSpec', d.spec);
      set('addPrice', d.price);
      set('addPublicPrice', d.price);
      set('addTax', d.tax_rate);
      setCategoryOnForm('add', d.category);
      updateCategoryPreview('add');
    } else {
      const epName = document.getElementById('epName');
      if (epName) epName.value = d.name;
      const epNameZh = document.getElementById('epNameZh');
      if (epNameZh) epNameZh.value = d.name_zh;
      const epSpec = document.getElementById('epSpec');
      if (epSpec) epSpec.value = d.spec;
      const epPrice = document.getElementById('epPrice');
      if (epPrice) epPrice.value = d.price;
      const epPublicPrice = document.getElementById('epPublicPrice');
      if (epPublicPrice) epPublicPrice.value = d.price;
      const epTax = document.getElementById('epTax');
      if (epTax) epTax.value = d.tax_rate;
      setCategoryOnForm('ep', d.category);
      const epEmoji = document.getElementById('epEmoji');
      if (epEmoji && d.emoji) epEmoji.value = d.emoji;
    }

    const barcodeEl = document.getElementById(`${prefix}Barcode`);
    if (barcodeEl) barcodeEl.value = d.barcode;

    const needsProc = document.getElementById(`${prefix}NeedsProc`);
    if (needsProc) needsProc.checked = d.needs_processing;

    const urlInput = document.getElementById(`${prefix}ImageUrl`);
    const img = document.getElementById(`${prefix}ImgPreview`);
    if (d.image_url && urlInput) {
      urlInput.value = d.image_url;
      if (img) img.src = d.image_url;
    }
    syncProductImageUi(prefix);
  }

  function showCatalogHint(prefix, { type, message }) {
    const hint = document.getElementById(`${prefix}CatalogHint`);
    if (!hint) return;
    if (!message) {
      hint.hidden = true;
      hint.textContent = '';
      return;
    }
    hint.hidden = false;
    hint.className = `catalog-hint alert alert--${type || 'info'}`;
    hint.textContent = message;
  }

  async function lookupBarcodeCatalog(prefix, rawCode) {
    const code = FOS.productCatalog.normalizeBarcode(rawCode);
    const input = document.getElementById(`${prefix}Barcode`);
    if (input && code) input.value = code;
    if (!code) {
      showCatalogHint(prefix, { type: '', message: '' });
      return;
    }

    const local = products.find(
      (p) => FOS.productCatalog.normalizeBarcode(p.barcode) === code
    );
    if (local) {
      showCatalogHint(prefix, {
        type: 'warn',
        message: FOS.i18n.t(
          `この商家には既に登録済み：${local.name}`,
          `本商家已有此条码商品：${local.name}`
        ),
      });
      return;
    }

    try {
      const hit = await FOS.productCatalog.lookup(code);
      if (hit) {
        applyCatalogToForm(prefix, hit);
        const from = hit.merchant_id || FOS.CONFIG.DEFAULT_MERCHANT_ID;
        showCatalogHint(prefix, {
          type: 'info',
          message: FOS.i18n.t(
            `共通商品庫から自動入力（参照：${from}）`,
            `已从公用商品库自动填入（参考商家：${from}）`
          ),
        });
        FOS.ui.toast(FOS.i18n.t('商品情報を自動入力しました', '已自动填入商品信息'), 'success');
      } else {
        showCatalogHint(prefix, {
          type: 'info',
          message: FOS.i18n.t(
            '新しいバーコードです。商品情報を入力してください',
            '新条码，请填写商品信息'
          ),
        });
      }
    } catch (e) {
      FOS.ui.toast(e.message, 'error');
    }
  }

  function bindBarcodeCatalog(root, prefix) {
    if (!root) return;
    let lookupTimer = null;

    root.querySelector(`[data-barcode-scan="${prefix}"]`)?.addEventListener('click', async () => {
      try {
        const code = await FOS.barcodeScanner.scan();
        if (code) await lookupBarcodeCatalog(prefix, code);
      } catch (e) {
        if (e.message !== 'cancelled') FOS.ui.toast(e.message, 'error');
      }
    });

    const input = root.querySelector(`#${prefix}Barcode`);
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        lookupBarcodeCatalog(prefix, input.value);
      }
    });
    input?.addEventListener('blur', () => {
      clearTimeout(lookupTimer);
      lookupTimer = setTimeout(() => {
        if (input.value.trim()) lookupBarcodeCatalog(prefix, input.value);
      }, 200);
    });
  }

  function bindImageUpload(prefix) {
    document.getElementById(prefix + 'ImageFile')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      const img = document.getElementById(prefix + 'ImgPreview');
      if (file && img) {
        FOS.media.previewFile(file, img);
      }
      syncProductImageUi(prefix);
    });
    document.getElementById(prefix + 'ImgRemove')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearProductImage(prefix);
    });
    syncProductImageUi(prefix);
  }

  const PRODUCT_OPTIONAL_V2 = ['barcode', 'needs_processing', 'image_url', 'public_price'];

  function trimProductPayload(payload, sampleProduct) {
    const out = { ...payload };
    const sample = sampleProduct || products[0];
    PRODUCT_OPTIONAL_V2.forEach((key) => {
      if (!sample || !(key in sample)) delete out[key];
    });
    return out;
  }

  function formatDbError(error) {
    if (!error) return FOS.i18n.t('保存に失敗しました', '保存失败');
    const msg = error.message || String(error);
    if (/column|schema cache/i.test(msg)) {
      return `${msg} — ${FOS.i18n.t('Supabaseで schema.sql を実行してください', '请在 Supabase 执行 schema.sql')}`;
    }
    if (/image_url/i.test(msg)) {
      return `${msg} — ${FOS.i18n.t('image_url 列を追加してください', '请添加 image_url 字段')}`;
    }
    if (/public_price/i.test(msg)) {
      return `${msg} — ${FOS.i18n.t('Supabaseで schema-product-public-price.sql を実行してください', '请在 Supabase 执行 schema-product-public-price.sql')}`;
    }
    if (/foreign key|violates foreign key|order_items_product_id/i.test(msg)) {
      return FOS.i18n.t(
        '注文履歴があるため削除できません。下架してください。',
        '该商品已有订单记录，无法删除，请使用「下架」。'
      );
    }
    return msg;
  }

  function formatSaveError(err) {
    return err?.message || FOS.media?.formatStorageError?.(err) || FOS.i18n.t('保存に失敗しました', '保存失败');
  }

  async function uploadFromForm(prefix) {
    const file = document.getElementById(prefix + 'ImageFile')?.files?.[0];
    if (!file) return document.getElementById(prefix + 'ImageUrl')?.value || '';
    const status = document.getElementById(prefix + 'UploadStatus');
    if (status) status.textContent = FOS.i18n.t('アップロード中...', '上传中...');
    try {
      const url = await FOS.media.uploadProductImage(file);
      document.getElementById(prefix + 'ImageUrl').value = url;
      if (status) status.textContent = '✅';
      return url;
    } catch (e) {
      const msg = formatSaveError(e);
      if (status) status.textContent = msg;
      throw new Error(msg);
    }
  }

  async function loadProducts() {
    FOS.ui.showLoading();
    const { data } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('products').select('*').order('sort_order').order('created_at')
    );
    products = data || [];
    FOS.categories.getTree(products);
    FOS.ui.hideLoading();
  }

  function categoryL1Options(selectedL1) {
    return FOS.categories.getTree(products).map((n) =>
      `<option value="${FOS.fmt.escapeHtml(n.name)}" ${n.name === selectedL1 ? 'selected' : ''}>${FOS.fmt.escapeHtml(n.name)}</option>`
    ).join('');
  }

  function categoryL2Options(parentL1, selectedL2) {
    const children = FOS.categories.getTree(products).find((n) => n.name === parentL1)?.children || [];
    return children.map((c) =>
      `<option value="${FOS.fmt.escapeHtml(c.name)}" ${c.name === selectedL2 ? 'selected' : ''}>${FOS.fmt.escapeHtml(c.name)}</option>`
    ).join('');
  }

  function categoryPreviewText(l1, l2) {
    if (!l1 || l1 === '未分類') return FOS.i18n.t('未分類', '未分类');
    return l2 ? `${l1} > ${l2}` : l1;
  }

  function updateCategoryPreview(prefix) {
    const l1 = document.getElementById(`${prefix}CatL1`)?.value?.trim() || '未分類';
    const l2 = document.getElementById(`${prefix}CatL2`)?.value?.trim() || '';
    const el = document.getElementById(`${prefix}CatPreview`);
    if (el) el.textContent = categoryPreviewText(l1, l2);
  }

  function refreshCategoryL2(prefix, selectedL2) {
    const l1 = document.getElementById(`${prefix}CatL1`)?.value || '';
    const l2el = document.getElementById(`${prefix}CatL2`);
    if (!l2el) return;
    const sel = selectedL2 ?? l2el.value;
    l2el.innerHTML = `<option value="">—</option>${categoryL2Options(l1, sel)}`;
  }

  function refreshFormCategorySelects(prefix) {
    const l1el = document.getElementById(`${prefix}CatL1`);
    if (!l1el) return;
    const curL1 = l1el.value;
    const curL2 = document.getElementById(`${prefix}CatL2`)?.value || '';
    l1el.innerHTML = `<option value="">未分類</option>${categoryL1Options(curL1)}`;
    l1el.value = curL1;
    refreshCategoryL2(prefix, curL2);
    updateCategoryPreview(prefix);
  }

  function bindCategorySelects(prefix) {
    document.getElementById(`${prefix}CatL1`)?.addEventListener('change', () => {
      refreshCategoryL2(prefix, '');
      updateCategoryPreview(prefix);
    });
    document.getElementById(`${prefix}CatL2`)?.addEventListener('change', () => updateCategoryPreview(prefix));
  }

  function productEditorImageHtml(p, prefix) {
    const url = p?.image_url || '';
    const hasImage = !!url;
    return `
      <div class="product-editor__section">
        <span class="product-editor__label">${FOS.i18n.t('商品画像', '商品图片')}</span>
        <div class="product-editor__img-zone">
          <div class="product-editor__img-thumb" id="${prefix}ImgThumbWrap" style="${hasImage ? '' : 'display:none'}">
            <img id="${prefix}ImgPreview" src="${FOS.fmt.escapeHtml(url)}" alt="">
            <button type="button" class="product-editor__img-remove" id="${prefix}ImgRemove" aria-label="${FOS.i18n.t('画像を削除', '删除图片')}">×</button>
          </div>
          <label class="product-editor__img-add" id="${prefix}ImgAddWrap" style="${hasImage ? 'display:none' : ''}">
            <input type="file" accept="image/*" id="${prefix}ImageFile">
            ＋
          </label>
        </div>
        <input type="hidden" id="${prefix}ImageUrl" value="${FOS.fmt.escapeHtml(url)}">
        <p class="product-editor__img-hint">${FOS.i18n.t('推奨 800×800px、1MB 以内', '建议 800×800px，不超过 1MB')}</p>
      </div>`;
  }

  function syncProductImageUi(prefix) {
    const wrap = document.getElementById(`${prefix}ImgThumbWrap`);
    const addWrap = document.getElementById(`${prefix}ImgAddWrap`);
    const urlInput = document.getElementById(`${prefix}ImageUrl`);
    const fileInput = document.getElementById(`${prefix}ImageFile`);
    const img = document.getElementById(`${prefix}ImgPreview`);
    const url = urlInput?.value?.trim() || '';
    const hasFile = !!(fileInput?.files?.[0]);
    const imgSrc = img?.src || '';
    const hasPreview = hasFile || !!url || imgSrc.startsWith('blob:') || (!!url && imgSrc.includes(url));
    if (hasPreview) {
      if (wrap) wrap.style.display = '';
      if (addWrap) addWrap.style.display = 'none';
    } else {
      if (wrap) wrap.style.display = 'none';
      if (addWrap) addWrap.style.display = '';
      if (img) img.removeAttribute('src');
    }
  }

  function clearProductImage(prefix) {
    const urlInput = document.getElementById(`${prefix}ImageUrl`);
    if (urlInput) urlInput.value = '';
    const fileInput = document.getElementById(`${prefix}ImageFile`);
    if (fileInput) fileInput.value = '';
    const img = document.getElementById(`${prefix}ImgPreview`);
    if (img) img.removeAttribute('src');
    syncProductImageUi(prefix);
  }

  function defaultCategoryFromSidebar() {
    if (!productCatL1) return '';
    return FOS.categories.encode(productCatL1, productCatL2);
  }

  function newProductFormDefaults() {
    const category = defaultCategoryFromSidebar();
    return category ? { category } : null;
  }

  function productFormHtml(prefix, p, isAdd) {
    const active = isAdd ? true : (p?.active !== false);
    const { l1, l2 } = FOS.categories.decode(p?.category);
    const selL1 = l1 === '未分類' ? '' : l1;
    const preview = categoryPreviewText(selL1 || '未分類', l2);
    return `
      <form id="${prefix}ProductForm" class="product-editor">
        <div class="product-editor__body">
          <div class="product-editor__section">
            <span class="product-editor__label product-editor__label--req">${FOS.i18n.t('商品分類', '商品分类')}</span>
            <div class="product-editor__category-row">
              <select class="field__input" id="${prefix}CatL1"><option value="">未分類</option>${categoryL1Options(selL1)}</select>
              <span class="product-editor__cat-sep">&gt;</span>
              <select class="field__input" id="${prefix}CatL2"><option value="">—</option>${categoryL2Options(selL1, l2)}</select>
            </div>
            <div class="product-editor__cat-preview" id="${prefix}CatPreview">${FOS.fmt.escapeHtml(preview)}</div>
            <button type="button" class="product-editor__cat-manage" data-open-cats>${FOS.i18n.t('分類を管理・変更', '管理/修改分类')}</button>
          </div>
          <div class="product-editor__section">
            <span class="product-editor__label product-editor__label--req">${FOS.i18n.t('商品名称', '商品名称')}</span>
            <div class="product-editor__lang-row">
              <span class="product-editor__lang-tag">${FOS.i18n.t('日本語', '日本語')}</span>
              <input id="${prefix}Name" value="${FOS.fmt.escapeHtml(p?.name || '')}" required placeholder="${FOS.i18n.t('商品名を入力', '请输入商品名')}">
            </div>
            <div class="product-editor__lang-row">
              <span class="product-editor__lang-tag">${FOS.i18n.t('简体中文', '简体中文')}</span>
              <input id="${prefix}NameZh" value="${FOS.fmt.escapeHtml(p?.name_zh || '')}" placeholder="${FOS.i18n.t('中文名（任意）', '中文名（选填）')}">
            </div>
          </div>
          <div class="product-editor__section">
            <span class="product-editor__label">${FOS.i18n.t('規格', '规格')}</span>
            <input class="field__input" id="${prefix}Spec" value="${FOS.fmt.escapeHtml(p?.spec || '')}" placeholder="${FOS.i18n.t('例: 1kg', '例: 1kg')}">
          </div>
          <div class="product-editor__section">
            <span class="product-editor__label">${FOS.i18n.t('価格設定', '价格设置')}</span>
            <div class="form-grid form-grid--2 product-editor__price-grid">
              <label class="field">
                <span class="field__label">${FOS.i18n.t('店舗注文価格', '店铺下单价格')}</span>
                <input class="field__input product-editor__price-input" id="${prefix}Price" type="number" min="0" step="1" value="${p?.price ?? 0}">
              </label>
              <label class="field">
                <span class="field__label">${FOS.i18n.t('一般顧客価格', '一般顾客价格')}</span>
                <input class="field__input product-editor__price-input" id="${prefix}PublicPrice" type="number" min="0" step="1" value="${productPublicPriceDisplay(p)}">
              </label>
            </div>
            <p class="product-editor__price-hint">${FOS.i18n.t('一般顧客価格が店舗価格と同じ場合は自動的に共通価格になります', '一般顾客价格与店铺价格相同时，将自动视为同一价格')}</p>
            <div class="form-grid form-grid--2 product-editor__price-grid">
              <label class="field"><span class="field__label">${FOS.i18n.t('在庫', '库存')}</span>
                <input class="field__input" id="${prefix}Stock" type="number" min="0" value="${p?.stock ?? 0}">
              </label>
              <label class="field"><span class="field__label">${FOS.i18n.t('税率(%)', '税率(%)')}</span>
                <input class="field__input" id="${prefix}Tax" type="number" value="${p?.tax_rate ?? 8}">
              </label>
            </div>
          </div>
          <div class="product-editor__section">
            ${barcodeFieldHtml(p, prefix)}
          </div>
          ${productEditorImageHtml(p, prefix)}
          <div class="product-editor__section">
            <label style="display:flex;align-items:center;gap:8px;font-size:14px">
              <input type="checkbox" id="${prefix}NeedsProc" ${p?.needs_processing === false ? '' : 'checked'}>
              <span>${FOS.i18n.t('加工が必要', '需要加工')}</span>
            </label>
          </div>
          <div class="product-editor__section">
            <span class="product-editor__label">${FOS.i18n.t('上架する', '是否上架')}</span>
            <div class="product-editor__radio-group">
              <label class="product-editor__radio">
                <input type="radio" name="${prefix}Active" value="1" ${active ? 'checked' : ''}> ${FOS.i18n.t('はい', '是')}
              </label>
              <label class="product-editor__radio">
                <input type="radio" name="${prefix}Active" value="0" ${!active ? 'checked' : ''}> ${FOS.i18n.t('いいえ', '否')}
              </label>
            </div>
          </div>
        </div>
        <div class="product-editor__footer ${isAdd ? 'product-editor__footer--dual' : 'product-editor__footer--single'}">
          <button type="submit" class="btn btn--primary product-editor__btn-save">${FOS.i18n.t('保存', '保存')}</button>
          ${isAdd ? `<button type="button" class="btn btn--primary product-editor__btn-continue" id="${prefix}SaveContinue">${FOS.i18n.t('保存して続けて追加', '保存后继续新增')}</button>` : ''}
        </div>
      </form>`;
  }

  function readProductForm(prefix) {
    const shopPrice = parseFloat(document.getElementById(`${prefix}Price`)?.value) || 0;
    const publicPriceRaw = document.getElementById(`${prefix}PublicPrice`)?.value;
    return {
      name: document.getElementById(`${prefix}Name`)?.value?.trim() || '',
      name_zh: document.getElementById(`${prefix}NameZh`)?.value?.trim() || '',
      category: readCategoryFromForm(prefix),
      spec: document.getElementById(`${prefix}Spec`)?.value?.trim() || '',
      price: shopPrice,
      public_price: resolvePublicPriceForSave(shopPrice, publicPriceRaw),
      tax_rate: parseInt(document.getElementById(`${prefix}Tax`)?.value, 10) || 8,
      stock: parseInt(document.getElementById(`${prefix}Stock`)?.value, 10) || 0,
      active: document.querySelector(`input[name="${prefix}Active"]:checked`)?.value === '1',
      barcode: document.getElementById(`${prefix}Barcode`)?.value?.trim() || '',
      needs_processing: document.getElementById(`${prefix}NeedsProc`)?.checked !== false,
    };
  }

  function resetAddProductForm() {
    const prefix = 'add';
    ['Name', 'NameZh', 'Spec', 'Price', 'PublicPrice', 'Stock', 'Barcode'].forEach((k) => {
      const el = document.getElementById(prefix + k);
      if (el) el.value = k === 'Price' || k === 'PublicPrice' || k === 'Stock' ? '0' : '';
    });
    const tax = document.getElementById('addTax');
    if (tax) tax.value = '8';
    const defaultCat = defaultCategoryFromSidebar();
    if (defaultCat) {
      setCategoryOnForm('add', defaultCat);
    } else {
      const l1 = document.getElementById('addCatL1');
      if (l1) l1.value = '';
      refreshCategoryL2('add', '');
      updateCategoryPreview('add');
    }
    const urlInput = document.getElementById('addImageUrl');
    if (urlInput) urlInput.value = '';
    const file = document.getElementById('addImageFile');
    if (file) file.value = '';
    syncProductImageUi('add');
    const proc = document.getElementById('addNeedsProc');
    if (proc) proc.checked = true;
    document.querySelector('input[name="addActive"][value="1"]')?.click();
    showCatalogHint('add', { type: '', message: '' });
  }

  function savePendingProductForm(prefix, isAdd) {
    pendingProductForm = {
      prefix,
      isAdd,
      editProductId,
      data: readProductForm(prefix),
      imageUrl: document.getElementById(`${prefix}ImageUrl`)?.value || '',
      imagePreview: document.getElementById(`${prefix}ImgPreview`)?.getAttribute('src') || '',
    };
  }

  function applySnapshotToForm(prefix, snap) {
    const d = snap.data;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val ?? '';
    };
    set(`${prefix}Name`, d.name);
    set(`${prefix}NameZh`, d.name_zh);
    set(`${prefix}Spec`, d.spec);
    set(`${prefix}Price`, d.price);
    set(`${prefix}PublicPrice`, d.public_price != null ? d.public_price : d.price);
    set(`${prefix}Tax`, d.tax_rate);
    set(`${prefix}Stock`, d.stock);
    set(`${prefix}Barcode`, d.barcode);
    setCategoryOnForm(prefix, d.category);
    const proc = document.getElementById(`${prefix}NeedsProc`);
    if (proc) proc.checked = d.needs_processing;
    document.querySelector(`input[name="${prefix}Active"][value="${d.active ? '1' : '0'}"]`)?.click();
    const urlInput = document.getElementById(`${prefix}ImageUrl`);
    if (urlInput) urlInput.value = snap.imageUrl || '';
    const img = document.getElementById(`${prefix}ImgPreview`);
    if (img && snap.imagePreview) img.src = snap.imagePreview;
    syncProductImageUi(prefix);
  }

  function restorePendingProductForm() {
    const snap = pendingProductForm;
    if (!snap) return;
    pendingProductForm = null;
    if (snap.isAdd) {
      FOS.ui.openModal({
        title: FOS.i18n.t('新規商品', '新增商品'),
        size: 'full',
        bodyHtml: productFormHtml('add', newProductFormDefaults(), true),
      });
      bindProductFormModal('add', true);
      applySnapshotToForm('add', snap);
    } else {
      const p = products.find((x) => String(x.id) === String(snap.editProductId)) || {};
      editProductId = snap.editProductId;
      FOS.ui.openModal({
        title: FOS.i18n.t('商品編集', '编辑商品'),
        size: 'full',
        bodyHtml: productFormHtml('ep', p, false),
      });
      bindProductFormModal('ep', false);
      applySnapshotToForm('ep', snap);
    }
  }

  async function refreshProductsListUi() {
    await loadProducts();
    updateShelfBadges();
    paintCatSidebar();
    paintProductList();
  }

  function lockEditorViewportHeight() {
    document.documentElement.style.setProperty('--editor-locked-vh', `${window.innerHeight}px`);
  }

  function unlockEditorViewportHeight() {
    document.documentElement.style.removeProperty('--editor-locked-vh');
  }
  FOS.ui.unlockEditorModal = unlockEditorViewportHeight;

  let productEditorBlurTimer = null;

  function cancelProductEditorBlurTimer() {
    clearTimeout(productEditorBlurTimer);
    productEditorBlurTimer = null;
  }

  function injectModalHeadActions(prefix, isAdd) {
    const head = document.querySelector('.fos-modal__head');
    if (!head) return;
    head.querySelector('.product-editor__head-actions')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'product-editor__head-actions product-editor__head-actions--hidden';
    wrap.innerHTML = `
      <button type="button" class="btn btn--primary btn--sm" data-head-save>${FOS.i18n.t('保存', '保存')}</button>
      ${isAdd ? `<button type="button" class="btn btn--secondary btn--sm" data-head-continue>${FOS.i18n.t('続けて追加', '继续新增')}</button>` : ''}`;
    const closeBtn = head.querySelector('[data-modal-close]');
    if (closeBtn) head.insertBefore(wrap, closeBtn);
    else head.appendChild(wrap);
    wrap.querySelector('[data-head-save]')?.addEventListener('click', () => {
      cancelProductEditorBlurTimer();
      saveProductForm(prefix, isAdd, false);
    });
    wrap.querySelector('[data-head-continue]')?.addEventListener('click', () => {
      cancelProductEditorBlurTimer();
      saveProductForm(prefix, true, true);
    });
  }

  function bindEditorKeyboardFooter(form) {
    const footer = form?.querySelector('.product-editor__footer');
    const headActions = document.querySelector('.product-editor__head-actions');
    if (!footer) return;
    const showKeyboardActions = () => {
      footer.classList.add('product-editor__footer--hidden');
      headActions?.classList.remove('product-editor__head-actions--hidden');
    };
    const showFooterActions = () => {
      footer.classList.remove('product-editor__footer--hidden');
      headActions?.classList.add('product-editor__head-actions--hidden');
    };
    showFooterActions();
    form.addEventListener('focusin', (e) => {
      if (e.target.matches('input, textarea, select')) showKeyboardActions();
    });
    form.addEventListener('focusout', () => {
      cancelProductEditorBlurTimer();
      productEditorBlurTimer = setTimeout(() => {
        if (!form.querySelector('input:focus, textarea:focus, select:focus')) showFooterActions();
      }, 120);
    });
  }

  function bindProductFormModal(prefix, isAdd) {
    const modal = document.getElementById('fosModal');
    lockEditorViewportHeight();
    injectModalHeadActions(prefix, isAdd);
    const form = document.getElementById(`${prefix}ProductForm`);
    bindEditorKeyboardFooter(form);
    bindCategorySelects(prefix);
    updateCategoryPreview(prefix);
    bindImageUpload(prefix);
    bindBarcodeCatalog(modal, prefix);
    const priceInput = document.getElementById(`${prefix}Price`);
    const publicPriceInput = document.getElementById(`${prefix}PublicPrice`);
    publicPriceInput?.addEventListener('input', () => {
      if (!priceInput || !publicPriceInput) return;
      publicPriceInput.dataset.synced = Number(publicPriceInput.value) === Number(priceInput.value) ? '1' : '0';
    });
    priceInput?.addEventListener('input', () => {
      if (!publicPriceInput || publicPriceInput.dataset.synced !== '1') return;
      publicPriceInput.value = priceInput.value;
    });
    if (publicPriceInput && priceInput) {
      publicPriceInput.dataset.synced = Number(publicPriceInput.value) === Number(priceInput.value) ? '1' : '0';
    }
    modal.querySelector('[data-open-cats]')?.addEventListener('click', () => {
      savePendingProductForm(prefix, isAdd);
      openCategoryModal({ formPrefix: prefix, fromForm: true });
    });
    document.getElementById(`${prefix}ProductForm`)?.addEventListener('submit', (e) => {
      e.preventDefault();
      saveProductForm(prefix, isAdd, false);
    });
    if (isAdd) {
      document.getElementById(`${prefix}SaveContinue`)?.addEventListener('click', () => {
        saveProductForm(prefix, true, true);
      });
    }
  }

  function openAddProductModal() {
    FOS.ui.openModal({
      title: FOS.i18n.t('新規商品', '新增商品'),
      size: 'full',
      bodyHtml: productFormHtml('add', newProductFormDefaults(), true),
    });
    bindProductFormModal('add', true);
    showCatalogHint('add', { type: '', message: '' });
  }

  function openEditProductModal(p) {
    editProductId = p.id;
    clearTapArtifacts();
    FOS.ui.openModal({
      title: FOS.i18n.t('商品編集', '编辑商品'),
      size: 'full',
      bodyHtml: productFormHtml('ep', p, false),
    });
    bindProductFormModal('ep', false);
  }

  function readCategoryFromForm(prefix) {
    const l1 = document.getElementById(`${prefix}CatL1`)?.value?.trim();
    const l2 = document.getElementById(`${prefix}CatL2`)?.value?.trim();
    return FOS.categories.encode(l1 || '未分類', l2);
  }

  function setCategoryOnForm(prefix, categoryValue) {
    const { l1, l2 } = FOS.categories.decode(categoryValue);
    const l1el = document.getElementById(`${prefix}CatL1`);
    if (!l1el) return;
    const selL1 = l1 === '未分類' ? '' : l1;
    if (selL1 && ![...l1el.options].some((o) => o.value === selL1)) {
      l1el.add(new Option(selL1, selL1));
    }
    l1el.value = selL1;
    refreshCategoryL2(prefix, l2);
    updateCategoryPreview(prefix);
  }

  async function renderProductsPage() {
    FOS.shell.setPageTitle(FOS.i18n.t('商品管理', '商品管理'));
    await loadProducts();
    const main = document.getElementById('appMain');
    const activeCount = products.filter((p) => p.active).length;
    const inactiveCount = products.length - activeCount;

    main.innerHTML = `
      ${adminPageHeadHtml(FOS.i18n.t('商品', '商品'))}
      <div class="product-hub">
        <div class="product-hub__tabs" id="productShelfTabs">
          <button type="button" class="product-hub__tab ${productShelfTab === 'active' ? 'product-hub__tab--active' : ''}" data-shelf="active">
            ${FOS.i18n.t('販売中', '上架中')}
            <span class="product-hub__badge" id="badgeActive">${activeCount}</span>
          </button>
          <button type="button" class="product-hub__tab ${productShelfTab === 'inactive' ? 'product-hub__tab--active' : ''}" data-shelf="inactive">
            ${FOS.i18n.t('下架中', '下架中')}
            <span class="product-hub__badge" id="badgeInactive">${inactiveCount}</span>
          </button>
        </div>
        <div class="product-hub__layout">
          <aside class="product-hub__sidebar">
            <div class="product-hub__sidebar-scroll drag-reorder__container" id="productCatSidebar"></div>
            <button type="button" class="product-hub__cat-add" id="manageCatsBtn" title="${FOS.i18n.t('分類管理', '分类管理')}">＋</button>
          </aside>
          <div class="product-hub__main">
            <div class="product-hub__toolbar">
              <button type="button" class="btn btn--secondary btn--sm product-hub__import-btn" id="importProductsBtn">📥 ${FOS.i18n.t('一括取込', '批量导入')}</button>
              <button type="button" class="product-hub__add-btn" id="addProductBtn">＋ ${FOS.i18n.t('追加', '添加')}</button>
            </div>
            <div class="admin-product-list drag-reorder__container" id="productTable"></div>
          </div>
        </div>
      </div>
    `;

    paintCatSidebar();
    paintProductList();
    document.getElementById('productShelfTabs')?.querySelectorAll('[data-shelf]').forEach((btn) => {
      btn.addEventListener('click', () => {
        productShelfTab = btn.dataset.shelf;
        document.querySelectorAll('.product-hub__tab').forEach((t) => t.classList.remove('product-hub__tab--active'));
        btn.classList.add('product-hub__tab--active');
        paintProductList();
      });
    });
    document.getElementById('addProductBtn').addEventListener('click', openAddProductModal);
    document.getElementById('manageCatsBtn').addEventListener('click', () => openCategoryModal());
    document.getElementById('importProductsBtn').addEventListener('click', openProductImportModal);
  }

  let importPreviewRows = [];

  function importPreviewTableHtml(rows) {
    if (!rows.length) {
      return FOS.ui.empty('📄', FOS.i18n.t('プレビューなし', '暂无预览'));
    }
    const dupCount = rows.filter((r) => r._status === 'duplicate').length;
    const errCount = rows.filter((r) => r._status === 'error').length;
    const newCount = rows.filter((r) => r._status === 'new').length;
    const imgCount = rows.filter((r) => r._imageFile).length;

    return `
      <div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">
        ${FOS.i18n.t('新規', '新增')} ${newCount} ·
        ${FOS.i18n.t('上書き待ち', '待覆盖')} ${dupCount} ·
        ${FOS.i18n.t('エラー', '错误')} ${errCount} ·
        ${FOS.i18n.t('画像一致', '图片匹配')} ${imgCount}
      </div>
      ${dupCount ? `<p style="font-size:13px;color:var(--warning);margin:0 0 8px">
        ${FOS.i18n.t('同名商品はチェックした行のみ上書きします', '同名商品仅覆盖已勾选的行')}
      </p>` : ''}
      <div class="import-preview-wrap">
        <table class="import-preview-table">
          <thead>
            <tr>
              <th>${FOS.i18n.t('行', '行')}</th>
              <th>${FOS.i18n.t('状態', '状态')}</th>
              <th>${FOS.i18n.t('商品名（日文）', '商品名（日文）')}</th>
              <th>${FOS.i18n.t('分類', '分类')}</th>
              <th>${FOS.i18n.t('価格', '价格')}</th>
              <th>${FOS.i18n.t('在庫', '库存')}</th>
              <th>${FOS.i18n.t('バーコード', '条码')}</th>
              <th>${FOS.i18n.t('画像', '图片')}</th>
              <th>${dupCount ? FOS.i18n.t('上書き', '覆盖') : ''}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const img = row._imageFile
                ? `<span class="badge badge--green">✓ ${FOS.fmt.escapeHtml(row._imageFile.name)}</span>`
                : (row.image_filename
                  ? `<span class="badge badge--gray">${FOS.fmt.escapeHtml(row.image_filename)}</span>`
                  : '—');
              const err = row._errors.length
                ? `<div style="font-size:11px;color:var(--danger)">${FOS.fmt.escapeHtml(row._errors.join('; '))}</div>`
                : '';
              const overwriteCell = row._status === 'duplicate'
                ? `<input type="checkbox" class="import-overwrite-cb" data-existing-id="${row._existingId}" title="${FOS.i18n.t('上書き', '覆盖')}">`
                : '';
              return `
              <tr>
                <td>${row._rowIndex}</td>
                <td><span class="badge ${FOS.productImport.statusBadgeClass(row._status)}">${FOS.productImport.statusLabel(row._status)}</span>${err}</td>
                <td>${FOS.fmt.escapeHtml(row.name)}</td>
                <td>${FOS.fmt.escapeHtml(row.category)}</td>
                <td>${FOS.fmt.money(row.price)}</td>
                <td>${row.stock}</td>
                <td>${row.barcode ? FOS.fmt.escapeHtml(row.barcode) : '—'}</td>
                <td>${img}</td>
                <td>${overwriteCell}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function importReportHtml(result) {
    return `
      <div class="import-report">
        <div class="import-report__row"><span>${FOS.i18n.t('追加成功', '新增成功')}</span><strong style="color:var(--success)">${result.created}</strong></div>
        <div class="import-report__row"><span>${FOS.i18n.t('上書き成功', '覆盖成功')}</span><strong style="color:var(--accent)">${result.updated}</strong></div>
        <div class="import-report__row"><span>${FOS.i18n.t('スキップ', '跳过')}</span><strong>${result.skipped}</strong></div>
        <div class="import-report__row"><span>${FOS.i18n.t('失敗', '失败')}</span><strong style="color:var(--danger)">${result.failed}</strong></div>
        ${result.errors.length ? `
          <div style="margin-top:10px;font-size:12px;color:var(--danger)">
            ${result.errors.map((e) => `${FOS.i18n.t('行', '行')}${e.row} ${FOS.fmt.escapeHtml(e.name)}: ${FOS.fmt.escapeHtml(e.message)}`).join('<br>')}
          </div>` : ''}
      </div>`;
  }

  async function refreshImportPreview(modal) {
    const excelFile = modal.querySelector('#importExcelFile')?.files?.[0];
    const imageFiles = [...(modal.querySelector('#importImageFiles')?.files || [])];
    const previewEl = modal.querySelector('#importPreview');
    if (!excelFile) {
      importPreviewRows = [];
      if (previewEl) previewEl.innerHTML = FOS.ui.empty('📄', FOS.i18n.t('Excel を選択してください', '请选择 Excel 文件'));
      return;
    }

    if (previewEl) previewEl.innerHTML = `<div class="empty-state" style="padding:20px">${FOS.i18n.t('読み込み中...', '加载中...')}</div>`;
    try {
      let rows = await FOS.productImport.parseExcel(excelFile);
      rows = FOS.productImport.attachImages(rows, imageFiles);
      const existing = await FOS.productImport.loadExistingProducts(FOS.merchants.scopeId());
      importPreviewRows = FOS.productImport.buildPreview(rows, existing);
      if (previewEl) previewEl.innerHTML = importPreviewTableHtml(importPreviewRows);
    } catch (e) {
      importPreviewRows = [];
      if (previewEl) previewEl.innerHTML = `<div class="alert alert--warn">${FOS.fmt.escapeHtml(e.message)}</div>`;
    }
  }

  function openProductImportModal() {
    importPreviewRows = [];
    const modal = FOS.ui.openModal({
      title: `📥 ${FOS.i18n.t('商品一括取込', '批量导入商品')}`,
      size: 'lg',
      bodyHtml: `
        <p style="font-size:14px;color:var(--text-secondary);margin:0 0 8px">
          ${FOS.i18n.t('Excel で商品を登録し、画像ファイル名で写真を紐付けます', '通过 Excel 录入商品，并按图片文件名匹配照片')}
        </p>
        <p style="font-size:13px;color:var(--text-tertiary);margin:0 0 12px;line-height:1.5">
          ${FOS.i18n.t(
            '「商品名」は主名称（日文表記）。接单端・订单に表示されます。「中文名」は補助用（検索・参考）。同名判定は商品名のみです。',
            '「商品名（日文）」为主名称，接单端和订单上显示此项。「中文名」为辅助（便于中文搜索/备注）。判断是否同名只看商品名。'
          )}
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <button type="button" class="btn btn--secondary btn--sm" id="importDownloadTpl">
            ⬇ ${FOS.i18n.t('テンプレート', '下载模板')}
          </button>
        </div>
        <div class="import-step">
          <label class="field">
            <span class="field__label">Excel *</span>
            <input type="file" class="field__input" id="importExcelFile" accept=".xlsx,.xls,.csv">
          </label>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('画像（複数可）', '图片（可多选）')}</span>
            <input type="file" class="field__input" id="importImageFiles" accept="image/*" multiple>
          </label>
          <button type="button" class="btn btn--secondary btn--sm" id="importPreviewBtn">
            ${FOS.i18n.t('プレビュー', '预览')}
          </button>
        </div>
        <div id="importPreview">${FOS.ui.empty('📄', FOS.i18n.t('Excel を選択してプレビュー', '选择 Excel 后预览'))}</div>
        <div id="importReport"></div>
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <button type="button" class="btn btn--primary" id="importRunBtn" disabled>
            ${FOS.i18n.t('取り込み実行', '开始导入')}
          </button>
          <button type="button" class="btn btn--secondary" data-modal-close>${FOS.i18n.t('閉じる', '关闭')}</button>
        </div>
      `,
    });

    modal.querySelector('#importDownloadTpl')?.addEventListener('click', () => {
      try {
        FOS.productImport.downloadTemplate('product-import-template.xlsx');
        FOS.ui.toast(FOS.i18n.t('ダウンロードしました', '已下载'), 'success');
      } catch (e) {
        FOS.ui.toast(e.message, 'error');
      }
    });

    const updateRunState = () => {
      const runBtn = modal.querySelector('#importRunBtn');
      const ok = importPreviewRows.some((r) => !r._errors.length && (r._status === 'new' || r._status === 'duplicate'));
      if (runBtn) runBtn.disabled = !ok;
    };

    modal.querySelector('#importPreviewBtn')?.addEventListener('click', async () => {
      await refreshImportPreview(modal);
      updateRunState();
    });
    modal.querySelector('#importExcelFile')?.addEventListener('change', () => {
      importPreviewRows = [];
      modal.querySelector('#importRunBtn').disabled = true;
      modal.querySelector('#importReport').innerHTML = '';
    });
    modal.querySelector('#importImageFiles')?.addEventListener('change', async () => {
      if (modal.querySelector('#importExcelFile')?.files?.[0]) {
        await refreshImportPreview(modal);
        updateRunState();
      }
    });

    modal.querySelector('#importRunBtn')?.addEventListener('click', async () => {
      if (!importPreviewRows.length) return;

      const overwriteIds = [...modal.querySelectorAll('.import-overwrite-cb:checked')].map(
        (el) => el.dataset.existingId
      );
      const dupRows = importPreviewRows.filter((r) => r._status === 'duplicate');
      const checkedDup = dupRows.filter((r) => overwriteIds.includes(String(r._existingId)));

      if (dupRows.length && !checkedDup.length) {
        const proceed = FOS.ui.confirm(
          FOS.i18n.t(
            '同名商品はスキップされます。新規のみ取り込みますか？',
            '同名商品将跳过，仅导入新增项，是否继续？'
          )
        );
        if (!proceed) return;
      } else if (checkedDup.length) {
        const proceed = FOS.ui.confirm(
          FOS.i18n.t(
            `同名商品 ${checkedDup.length} 件を上書きします。よろしいですか？`,
            `将覆盖 ${checkedDup.length} 个同名商品，是否继续？`
          )
        );
        if (!proceed) return;
      }

      const runBtn = modal.querySelector('#importRunBtn');
      const reportEl = modal.querySelector('#importReport');
      runBtn.disabled = true;
      FOS.ui.showLoading();

      try {
        const sampleProduct = products[0];
        const result = await FOS.productImport.runImport({
          rows: importPreviewRows,
          merchantId: FOS.merchants.scopeId(),
          overwriteIds,
          sampleProduct,
        });
        reportEl.innerHTML = importReportHtml(result);
        FOS.ui.toast(
          FOS.i18n.t(
            `完了：追加 ${result.created} / 上書き ${result.updated}`,
            `完成：新增 ${result.created} / 覆盖 ${result.updated}`
          ),
          result.failed ? 'error' : 'success'
        );
        if (result.created || result.updated) {
          await loadProducts();
        }
      } catch (e) {
        FOS.ui.toast(e.message, 'error');
        reportEl.innerHTML = `<div class="alert alert--warn">${FOS.fmt.escapeHtml(e.message)}</div>`;
      } finally {
        FOS.ui.hideLoading();
        runBtn.disabled = false;
      }
    });
  }

  function updateShelfBadges() {
    const active = products.filter((p) => p.active).length;
    const inactive = products.length - active;
    const b1 = document.getElementById('badgeActive');
    const b2 = document.getElementById('badgeInactive');
    if (b1) b1.textContent = String(active);
    if (b2) b2.textContent = String(inactive);
  }

  function paintCatSidebar() {
    const el = document.getElementById('productCatSidebar');
    if (!el) return;
    const tree = FOS.categories.getTree(products);
    const allActive = !productCatL1;
    let html = `<button type="button" class="product-hub__cat ${allActive ? 'product-hub__cat--active' : ''}" data-l1="" data-l2=""><span class="product-hub__cat-label">${FOS.i18n.t('全て', '全部')}</span></button>`;
    tree.forEach((parent) => {
      const parentActive = productCatL1 === parent.name && !productCatL2;
      html += `<button type="button" class="product-hub__cat drag-reorder__item ${parentActive ? 'product-hub__cat--active' : ''}" data-l1="${FOS.fmt.escapeHtml(parent.name)}" data-l2="" data-cat-reorder data-cat-kind="parent" data-cat-id="${parent.id}"><span class="product-hub__cat-label">${FOS.fmt.escapeHtml(parent.name)}</span>${dragSortHandleHtml()}</button>`;
      parent.children.forEach((child) => {
        const childActive = productCatL1 === parent.name && productCatL2 === child.name;
        html += `<button type="button" class="product-hub__cat product-hub__cat--child drag-reorder__item ${childActive ? 'product-hub__cat--active' : ''}" data-l1="${FOS.fmt.escapeHtml(parent.name)}" data-l2="${FOS.fmt.escapeHtml(child.name)}" data-cat-reorder data-cat-kind="child" data-cat-id="${child.id}" data-parent-id="${parent.id}"><span class="product-hub__cat-branch" aria-hidden="true"></span><span class="product-hub__cat-label">${FOS.fmt.escapeHtml(child.name)}</span>${dragSortHandleHtml()}</button>`;
      });
    });
    el.innerHTML = html;
    el.querySelectorAll('[data-l1]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (e.target.closest('.drag-reorder__handle')) return;
        if (btn.dataset.dragJustDone === '1') return;
        productCatL1 = btn.dataset.l1 || '';
        productCatL2 = btn.dataset.l2 || '';
        paintCatSidebar();
        paintProductList();
      });
    });
    bindCatSidebarReorder();
  }

  function filteredProducts() {
    return products.filter((p) => {
      const shelfOk = productShelfTab === 'active' ? p.active : !p.active;
      const catOk = FOS.categories.matches(p.category, productCatL1, productCatL2);
      return shelfOk && catOk;
    });
  }

  function paintProductList() {
    const el = document.getElementById('productTable');
    if (!el) return;
    const list = filteredProducts();
    if (!list.length) {
      el.innerHTML = FOS.ui.empty('📦', FOS.i18n.t('商品なし', '暂无商品'));
      return;
    }
    el.innerHTML = list.map((p) => {
      const thumb = p.image_url
        ? `<img src="${FOS.fmt.escapeHtml(p.image_url)}" class="admin-product-card__img" alt="" draggable="false">`
        : `<span class="admin-product-card__emoji">${p.emoji || '📦'}</span>`;
      const shelfLabel = p.active
        ? FOS.i18n.t('下架', '下架')
        : FOS.i18n.t('上架', '上架');
      return `
      <div class="admin-product-card drag-reorder__item" data-reorder-id="${p.id}" data-card-id="${p.id}">
        <div class="admin-product-card__top">
          <span class="admin-product-card__stock">${FOS.i18n.t('在庫', '库存')}: <strong>${p.stock}</strong></span>
          ${dragSortHandleHtml()}
        </div>
        <div class="admin-product-card__body" data-card-open="${p.id}">
          <div class="admin-product-card__thumb">${thumb}</div>
          <div class="admin-product-card__main">
            <div class="admin-product-card__name">${FOS.fmt.escapeHtml(p.name)}</div>
            ${p.name_zh ? `<div class="admin-product-card__sub">${FOS.fmt.escapeHtml(p.name_zh)}</div>` : ''}
            ${productCardPricesHtml(p)}
          </div>
        </div>
        <div class="admin-product-card__footer">
          <button type="button" class="admin-product-card__del" data-del="${p.id}" title="${FOS.i18n.t('削除', '删除')}">${productDelIconHtml()}</button>
          <button type="button" class="btn btn--sm admin-product-card__toggle ${p.active ? 'btn--secondary' : 'btn--success'}" data-toggle="${p.id}">${shelfLabel}</button>
        </div>
      </div>`;
    }).join('');

    el.querySelectorAll('[data-card-open]').forEach((zone) => {
      zone.addEventListener('click', (e) => {
        if (e.target.closest('.drag-reorder__handle')) return;
        const card = zone.closest('.admin-product-card');
        if (card?.dataset.dragJustDone === '1') return;
        e.preventDefault();
        clearTapArtifacts();
        openEditProduct(zone.dataset.cardOpen);
      });
    });
    el.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const p = products.find((x) => String(x.id) === btn.dataset.toggle);
        if (!p) return;
        p.active = !p.active;
        await FOS.merchants.scopeFilter(
          FOS.db.sb.from('products').update({ active: p.active, updated_at: new Date().toISOString() }).eq('id', p.id)
        );
        updateShelfBadges();
        paintProductList();
        FOS.ui.toast(FOS.i18n.t('更新しました', '已更新'), 'success');
      });
    });
    el.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteProduct(btn.dataset.del);
      });
    });
    bindProductListReorder();
  }

  function clearTapArtifacts() {
    window.getSelection()?.removeAllRanges();
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) {
      active.blur();
    }
  }

  function openEditProduct(pid) {
    const p = products.find((x) => String(x.id) === String(pid));
    if (!p) return;
    clearTapArtifacts();
    openEditProductModal(p);
  }

  async function saveProductForm(prefix, isAdd, continueAdd) {
    const data = readProductForm(prefix);
    if (!data.name) {
      FOS.ui.toast(FOS.i18n.t('商品名必須', '请输入商品名'), 'error');
      return;
    }
    FOS.ui.showLoading();
    let imageUrl = '';
    try {
      imageUrl = await uploadFromForm(prefix);
    } catch (err) {
      FOS.ui.hideLoading();
      FOS.ui.toast(formatSaveError(err), 'error');
      return;
    }
    const sampleProduct = isAdd ? null : products.find((x) => String(x.id) === String(editProductId));
    const payload = trimProductPayload({
      ...data,
      emoji: sampleProduct?.emoji || '📦',
      image_url: imageUrl,
      updated_at: new Date().toISOString(),
    }, sampleProduct);

    if (isAdd) {
      try {
        await FOS.merchants.assertCanAddProduct();
      } catch (err) {
        FOS.ui.hideLoading();
        FOS.ui.toast(err.message, 'error');
        return;
      }
      payload.merchant_id = FOS.merchants.scopeId();
      payload.sort_order = nextProductSortOrder();
      const { error } = await FOS.db.sb.from('products').insert(payload);
      FOS.ui.hideLoading();
      if (error) { FOS.ui.toast(formatDbError(error), 'error'); return; }
      FOS.ui.toast(FOS.i18n.t('追加しました', '已添加'), 'success');
      if (continueAdd) {
        resetAddProductForm();
        await refreshProductsListUi();
        setTimeout(() => document.getElementById('addName')?.focus(), 200);
      } else {
        FOS.ui.closeModal();
        await renderProductsPage();
      }
      return;
    }

    const { error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('products').update(payload).eq('id', editProductId)
    );
    FOS.ui.hideLoading();
    if (error) { FOS.ui.toast(formatDbError(error), 'error'); return; }
    FOS.ui.closeModal();
    FOS.ui.toast(FOS.i18n.t('保存しました', '已保存'), 'success');
    const decoded = FOS.categories.decode(payload.category || '');
    productCatL1 = decoded.l1 === '未分類' ? '' : decoded.l1;
    productCatL2 = decoded.l2 || '';
    await refreshProductsListUi();
  }

  async function productHasReferences(pid) {
    const { count, error } = await FOS.db.sb
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', pid);
    if (error) return null;
    if (count > 0) return true;
    const sm = await FOS.db.sb
      .from('stock_movements')
      .select('id', { count: 'exact', head: true })
      .eq('product_id', pid);
    if (sm.error) {
      if (/does not exist|schema cache|PGRST205/i.test(sm.error.message || '')) return false;
      return null;
    }
    return (sm.count || 0) > 0;
  }

  async function shelfOffProduct(pid) {
    const { error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('products').update({ active: false, updated_at: new Date().toISOString() }).eq('id', pid)
    );
    if (error) throw error;
    const p = products.find((x) => String(x.id) === String(pid));
    if (p) p.active = false;
    updateShelfBadges();
    paintProductList();
    FOS.ui.toast(FOS.i18n.t('下架しました', '已下架'), 'success');
  }

  async function deleteProduct(pid) {
    if (!FOS.ui.confirm(FOS.i18n.t('この商品を削除しますか？', '确定删除此商品？'))) return;
    FOS.ui.showLoading();
    try {
      const referenced = await productHasReferences(pid);
      if (referenced === null) throw new Error(FOS.i18n.t('確認に失敗しました', '检查失败，请重试'));
      if (referenced) {
        FOS.ui.hideLoading();
        if (!FOS.ui.confirm(
          FOS.i18n.t(
            'この商品は注文または入出庫の記録があります。完全削除はできません。下架にしますか？',
            '该商品已有订单或出入库记录，无法彻底删除。是否改为下架？'
          )
        )) return;
        FOS.ui.showLoading();
        await shelfOffProduct(pid);
        return;
      }
      const { error } = await FOS.merchants.scopeFilter(
        FOS.db.sb.from('products').delete().eq('id', pid)
      );
      if (error) throw error;
      products = products.filter((x) => String(x.id) !== String(pid));
      FOS.ui.toast(FOS.i18n.t('削除しました', '已删除'), 'success');
      updateShelfBadges();
      paintProductList();
    } catch (e) {
      FOS.ui.toast(formatDbError(e) || FOS.i18n.t('削除に失敗しました', '删除失败'), 'error');
    } finally {
      FOS.ui.hideLoading();
    }
  }

  function afterCategoryChanged(opts = {}) {
    paintCatSidebar();
    paintProductList();
    if (opts.formPrefix) refreshFormCategorySelects(opts.formPrefix);
  }

  function openCategoryModal(opts = {}) {
    const tree = FOS.categories.getTree(products);
    FOS.ui.openModal({
      title: `🏷️ ${FOS.i18n.t('分類管理', '分类管理')}`,
      size: 'lg',
      bodyHtml: `
        ${opts.fromForm ? `<button type="button" class="btn btn--secondary btn--sm" id="catModalBack" style="margin-bottom:12px">← ${FOS.i18n.t('商品編集に戻る', '返回商品编辑')}</button>` : ''}
        <p style="font-size:13px;color:var(--text-secondary);margin:0 0 12px;line-height:1.5">
          ${FOS.i18n.t(
            '分類名を入力欄で直接変更し「保存」を押してください。改名後、既存商品の分類は自動更新されないため、必要に応じて商品編集で再選択してください。',
            '在输入框中直接修改分类名称后点「保存」。改名后已有商品的分类不会自动更新，如有需要请在商品编辑里重新选择。'
          )}
        </p>
        <div id="catTreeList">${tree.map((parent) => `
          <div class="cat-manage-block">
            <div class="cat-manage-block__title">${FOS.i18n.t('一級分類', '一级分类')}</div>
            <div class="cat-manage-row">
              <input class="field__input" id="parentInput_${parent.id}" value="${FOS.fmt.escapeHtml(parent.name)}">
              <button type="button" class="btn btn--primary btn--sm" data-parent-save="${parent.id}">${FOS.i18n.t('保存', '保存')}</button>
              <button type="button" class="btn btn--del btn--sm" data-parent-del="${parent.id}">🗑</button>
            </div>
            <div class="cat-manage-children">
              <div class="cat-manage-block__title">${FOS.i18n.t('二級分類', '二级分类')}</div>
              ${parent.children.map((child) => `
                <div class="cat-manage-row cat-manage-child">
                  <input class="field__input" id="childInput_${parent.id}_${child.id}" value="${FOS.fmt.escapeHtml(child.name)}">
                  <button type="button" class="btn btn--primary btn--sm" data-child-save="${parent.id}|${child.id}">${FOS.i18n.t('保存', '保存')}</button>
                  <button type="button" class="btn btn--del btn--sm" data-child-del="${parent.id}|${child.id}">🗑</button>
                </div>`).join('')}
              <div class="cat-manage-row">
                <input class="field__input" id="childNew_${parent.id}" placeholder="${FOS.i18n.t('新しい二級分類', '新二级分类')}" style="flex:1">
                <button type="button" class="btn btn--secondary btn--sm" data-child-add="${parent.id}">＋</button>
              </div>
            </div>
          </div>`).join('')}</div>
        <div class="form-grid" style="margin-top:12px">
          <label class="field"><span class="field__label">${FOS.i18n.t('新一級分類', '新一级分类')}</span>
            <input class="field__input" id="newParentCatName" placeholder="${FOS.i18n.t('例: 料理', '例: 料理')}">
          </label>
          <button type="button" class="btn btn--primary" id="addParentCatBtn">＋ ${FOS.i18n.t('追加', '添加')}</button>
        </div>`,
    });

    const findParent = (id) => FOS.categories.getTree(products).find((n) => n.id === id);
    const findChild = (parentId, childId) => findParent(parentId)?.children?.find((c) => c.id === childId);
    const reopen = () => openCategoryModal(opts);

    document.getElementById('catModalBack')?.addEventListener('click', () => {
      FOS.ui.closeModal();
      restorePendingProductForm();
    });

    document.querySelectorAll('[data-parent-save]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const node = findParent(btn.dataset.parentSave);
        if (!node) return;
        const val = document.getElementById('parentInput_' + node.id)?.value?.trim();
        if (val && val !== node.name) {
          FOS.categories.updateParent(node.name, val);
          if (productCatL1 === node.name) productCatL1 = val;
        }
        reopen();
        afterCategoryChanged(opts);
      });
    });
    document.querySelectorAll('[data-parent-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const node = findParent(btn.dataset.parentDel);
        if (!node) return;
        if (!FOS.ui.confirm(FOS.i18n.t('この一級分類を削除しますか？', '确定删除此一级分类？'))) return;
        FOS.categories.deleteParent(node.name);
        if (productCatL1 === node.name) {
          productCatL1 = '';
          productCatL2 = '';
        }
        reopen();
        afterCategoryChanged(opts);
      });
    });
    document.querySelectorAll('[data-child-save]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [pId, cId] = btn.dataset.childSave.split('|');
        const parent = findParent(pId);
        const child = findChild(pId, cId);
        if (!parent || !child) return;
        const val = document.getElementById('childInput_' + pId + '_' + cId)?.value?.trim();
        if (val && val !== child.name) {
          FOS.categories.updateChild(parent.name, child.name, val);
          if (productCatL1 === parent.name && productCatL2 === child.name) productCatL2 = val;
        }
        reopen();
        afterCategoryChanged(opts);
      });
    });
    document.querySelectorAll('[data-child-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [pId, cId] = btn.dataset.childDel.split('|');
        const parent = findParent(pId);
        const child = findChild(pId, cId);
        if (!parent || !child) return;
        if (!FOS.ui.confirm(FOS.i18n.t('この二級分類を削除しますか？', '确定删除此二级分类？'))) return;
        FOS.categories.deleteChild(parent.name, child.name);
        if (productCatL1 === parent.name && productCatL2 === child.name) productCatL2 = '';
        reopen();
        afterCategoryChanged(opts);
      });
    });
    document.querySelectorAll('[data-child-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const parent = findParent(btn.dataset.childAdd);
        const name = document.getElementById('childNew_' + btn.dataset.childAdd)?.value?.trim();
        if (parent && name) FOS.categories.addChild(parent.name, name);
        reopen();
        afterCategoryChanged(opts);
      });
    });
    document.getElementById('addParentCatBtn')?.addEventListener('click', () => {
      const name = document.getElementById('newParentCatName')?.value?.trim();
      if (name) FOS.categories.addParent(name);
      reopen();
      afterCategoryChanged(opts);
    });
  }

  const SHOP_USER_FIELDS = 'id, name, password_hash, address, zip_code, phone, contact_name, settlement_type';

  function settlementTypeFieldHtml(prefix, value) {
    const v = value || FOS.payment.SETTLEMENT.MONTHLY;
    return `
      <div class="product-editor__section">
        <span class="product-editor__label">${FOS.i18n.t('決済区分', '结账方式')}</span>
        <div class="settlement-type-row">
          <label class="settlement-type-opt">
            <input type="radio" name="${prefix}Settlement" value="monthly" ${v === 'monthly' ? 'checked' : ''}>
            ${FOS.payment.settlementLabel('monthly')}
          </label>
          <label class="settlement-type-opt">
            <input type="radio" name="${prefix}Settlement" value="cash" ${v === 'cash' ? 'checked' : ''}>
            ${FOS.payment.settlementLabel('cash')}
          </label>
        </div>
      </div>`;
  }

  function readSettlementType(prefix) {
    const checked = document.querySelector(`input[name="${prefix}Settlement"]:checked`);
    return checked?.value === 'cash' ? FOS.payment.SETTLEMENT.CASH : FOS.payment.SETTLEMENT.MONTHLY;
  }

  function formatOrderDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function hubOrderCustomerLabel(order) {
    if (FOS.publicOrder?.isPublicOrder?.(order)) {
      return order.customer_name || order.shop_name || '—';
    }
    return FOS.fmt.displayName(order.shop_name) || '—';
  }

  function hubOrderCardHtml(order) {
    const st = FOS.fmt.status(order.status);
    const payMethod = FOS.payment.methodLabel(order);
    const recorded = order.payment_recorded_at ? formatOrderDateTime(order.payment_recorded_at) : '';
    const created = order.created_at ? formatOrderDateTime(order.created_at) : order.order_date || '';
    const mergedCount = Number(order._mergedCount || 1);
    const noSuffix = mergedCount > 1 ? ` (+${mergedCount - 1})` : '';
    const openOrdersAttr = Array.isArray(order._mergedOrderIds) && order._mergedOrderIds.length > 1
      ? ` data-open-orders="${order._mergedOrderIds.map((id) => String(id)).join(',')}"`
      : '';
    return `
      <button type="button" class="hub-order-card" data-open-order="${order.id}"${openOrdersAttr}>
        <div class="hub-order-card__top">
          <span class="hub-order-card__no">${FOS.i18n.t('注文番号', '订单号')}：#${order.order_no}${noSuffix}</span>
          <span class="badge badge--${st.color} hub-order-card__status">${st.label}</span>
        </div>
        <div class="hub-order-card__customer">${FOS.fmt.escapeHtml(hubOrderCustomerLabel(order))}</div>
        <div class="hub-order-card__meta">
          ${created ? `<div>${FOS.i18n.t('注文日時', '下单时间')}：${FOS.fmt.escapeHtml(created)}</div>` : ''}
          ${recorded ? `<div>${FOS.i18n.t('記録時刻', '记录时间')}：${FOS.fmt.escapeHtml(recorded)}</div>` : ''}
          ${mergedCount > 1 ? `<div>${FOS.i18n.t('同店注文', '同店订单')}：${mergedCount}${FOS.i18n.t('件', '单')}</div>` : ''}
          <div>${FOS.i18n.t('決済方法', '结账方式')}：${FOS.fmt.escapeHtml(payMethod)}</div>
        </div>
        <div class="hub-order-card__foot">
          <span class="hub-order-card__amount">${FOS.fmt.money(order.total)}</span>
        </div>
      </button>`;
  }

  function bindHubOrderCards(root) {
    root?.querySelectorAll('[data-open-order]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const orderIds = (btn.dataset.openOrders || '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        openAdminOrderDetail(btn.dataset.openOrder, { view: 'summary', hubTab: summaryHubTab }, orderIds.length ? orderIds : null);
      });
    });
  }

  function openAdminOrderDetail(orderId, returnCtx, orderIds = null) {
    adminDetailOrderId = orderId;
    adminDetailOrderIds = Array.isArray(orderIds) && orderIds.length ? orderIds.slice() : null;
    adminDetailReturn = returnCtx || { view: 'orders' };
    renderAdminOrderDetailPage();
  }

  function closeAdminOrderDetail() {
    const ctx = adminDetailReturn;
    adminDetailOrderId = null;
    adminDetailOrderIds = null;
    adminDetailReturn = null;
    if (ctx?.view === 'summary') {
      summaryHubTab = ctx.hubTab || 'payments';
      renderSummaryPage();
      return;
    }
    renderOrdersPage();
  }

  async function renderAdminOrderDetailPage() {
    if (!adminDetailOrderId) return;
    FOS.shell.setPageTitle(FOS.i18n.t('注文詳細', '订单详情'));
    FOS.ui.showLoading();
    const order = await FOS.orders.fetchOne(adminDetailOrderId);
    let mergedOrders = [];
    if (Array.isArray(adminDetailOrderIds) && adminDetailOrderIds.length > 1) {
      const ids = adminDetailOrderIds.slice(0, 20);
      const rows = await Promise.all(ids.map(async (id) => FOS.orders.fetchOne(id)));
      mergedOrders = rows.filter(Boolean)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    }
    FOS.ui.hideLoading();
    if (!order) {
      FOS.ui.toast(FOS.i18n.t('注文が見つかりません', '未找到订单'), 'error');
      closeAdminOrderDetail();
      return;
    }

    const st = FOS.fmt.status(order.status);
    const customer = hubOrderCustomerLabel(order);
    const payMethod = FOS.payment.methodLabel(order);
    const created = order.created_at ? formatOrderDateTime(order.created_at) : order.order_date || '';
    const recorded = order.payment_recorded_at ? formatOrderDateTime(order.payment_recorded_at) : '';
    const items = (order.order_items || []).map((i, idx) => FOS.orders.orderLineItemHtml(i, idx)).join('');
    const isPublic = FOS.publicOrder?.isPublicOrder?.(order);
    const publicMeta = isPublic ? `
      <div class="admin-order-detail__block">
        <div class="admin-order-detail__row"><span>${FOS.i18n.t('電話', '电话')}</span><strong>${FOS.fmt.escapeHtml(order.customer_phone || '—')}</strong></div>
        <div class="admin-order-detail__row"><span>${FOS.i18n.t('住所', '地址')}</span><strong>${FOS.fmt.escapeHtml(order.customer_address || '—')}</strong></div>
        <div class="admin-order-detail__row"><span>${FOS.i18n.t('配達希望', '配送希望')}</span><strong>${FOS.fmt.escapeHtml(FOS.publicOrder.formatDeliveryWish(order) || '—')}</strong></div>
      </div>` : '';

    const mergedBlock = mergedOrders.length > 1
      ? `<div class="admin-order-section__label">${FOS.i18n.t('同店注文明細', '同店订单明细')}</div>
        <div class="hub-order-list">${mergedOrders.filter((mo) => mo.id !== order.id).map((mo) => {
          const createdAt = mo.created_at ? formatOrderDateTime(mo.created_at) : mo.order_date || '';
          const moItems = (mo.order_items || []).map((i, idx) => FOS.orders.orderLineItemHtml(i, idx)).join('');
          return `<div class="hub-order-card hub-order-card--static">
            <div class="hub-order-card__top">
              <span class="hub-order-card__no">${FOS.i18n.t('注文番号', '订单号')}：#${FOS.fmt.escapeHtml(String(mo.order_no || ''))}</span>
              <span class="badge badge--${FOS.fmt.status(mo.status).color} hub-order-card__status">${FOS.fmt.status(mo.status).label}</span>
            </div>
            <div class="hub-order-card__meta">${createdAt ? `<div>${FOS.i18n.t('注文日時', '下单时间')}：${FOS.fmt.escapeHtml(createdAt)}</div>` : ''}</div>
            <ul class="order-line-items">${moItems || `<li class="order-line-item">${FOS.i18n.t('商品なし', '暂无商品')}</li>`}</ul>
            <div class="hub-order-card__foot"><span class="hub-order-card__amount">${FOS.fmt.money(mo.total)}</span></div>
          </div>`;
        }).join('')}</div>`
      : '';

    const main = document.getElementById('appMain');
    main.innerHTML = `
      <div class="admin-order-detail">
        <button type="button" class="admin-order-detail__back" id="adminOrderDetailBack">← ${FOS.i18n.t('戻る', '返回')}</button>
        <div class="hub-order-card hub-order-card--static">
          <div class="hub-order-card__top">
            <span class="hub-order-card__no">${FOS.i18n.t('注文番号', '订单号')}：#${order.order_no}</span>
            <span class="badge badge--${st.color} hub-order-card__status">${st.label}</span>
          </div>
          <div class="hub-order-card__customer">${FOS.fmt.escapeHtml(customer)}</div>
          <div class="hub-order-card__meta">
            ${created ? `<div>${FOS.i18n.t('注文日時', '下单时间')}：${FOS.fmt.escapeHtml(created)}</div>` : ''}
            ${recorded ? `<div>${FOS.i18n.t('記録時刻', '记录时间')}：${FOS.fmt.escapeHtml(recorded)}</div>` : ''}
            <div>${FOS.i18n.t('決済方法', '结账方式')}：${FOS.fmt.escapeHtml(payMethod)}</div>
          </div>
          <div class="hub-order-card__foot">
            <span class="hub-order-card__amount">${FOS.fmt.money(order.total)}</span>
          </div>
        </div>
        ${publicMeta}
        ${order.note ? `<div class="admin-order-detail__note">${FOS.fmt.escapeHtml(order.note)}</div>` : ''}
        <div class="admin-order-section__label">${FOS.i18n.t('商品一覧', '商品列表')}</div>
        <ul class="order-line-items">${items || `<li class="order-line-item">${FOS.i18n.t('商品なし', '暂无商品')}</li>`}</ul>
        ${mergedBlock}
        <div class="admin-order-actions admin-order-detail__actions">
          ${orderEditBtnHtml(order.id)}
          ${orderStatusActionsHtml(order)}
          ${orderPrintActionsHtml(order)}
        </div>
      </div>`;

    document.getElementById('adminOrderDetailBack')?.addEventListener('click', closeAdminOrderDetail);
    bindOrderDetailActions(main);
  }

  function paintPaymentsBody() {
    const el = document.getElementById('summaryHubBody');
    if (!el) return;
    const paid = FOS.payment.paidOrdersFilter(orders, paymentDate)
      .sort((a, b) => (b.payment_recorded_at || b.created_at || '').localeCompare(a.payment_recorded_at || a.created_at || ''));
    if (paymentTab === 'summary') {
      el.innerHTML = FOS.payment.summaryCardsHtml(FOS.payment.summarize(paid));
      return;
    }
    if (!paid.length) {
      el.innerHTML = FOS.ui.empty('📋', FOS.i18n.t('データなし', '暂无数据'));
      return;
    }
    el.innerHTML = `<div class="hub-order-list">${paid.map(hubOrderCardHtml).join('')}</div>`;
    bindHubOrderCards(el);
  }

  async function paintPaymentMethodsList() {
    const el = document.getElementById('paymentMethodsList');
    if (!el) return;
    const methods = await FOS.payment.listAllMethods();
    const active = methods.filter((m) => m.active !== false);
    if (!active.length) {
      el.innerHTML = `<div class="shop-list-empty">${FOS.i18n.t('決済方法なし', '暂无结账方式')}</div>`;
      return;
    }
    el.innerHTML = active.map((m) => `
      <div class="payment-method-row">
        <span>${FOS.fmt.escapeHtml(m.name)}</span>
        <button type="button" class="btn btn--del btn--sm" data-del-pm="${m.id}">${FOS.i18n.t('削除', '删除')}</button>
      </div>`).join('');
    el.querySelectorAll('[data-del-pm]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('.payment-method-row');
        const ok = await confirmDangerAction({
          title: FOS.i18n.t('確認削除', '确认删除'),
          message: FOS.i18n.t('确定删除该结账方式吗？', '确定删除该结账方式吗？'),
          confirmLabel: FOS.i18n.t('削除', '删除'),
          inlineHost: row,
        });
        if (!ok) return;
        try {
          await FOS.payment.deleteMethod(btn.dataset.delPm);
          FOS.ui.toast(FOS.i18n.t('削除しました', '已删除'), 'success');
          await paintPaymentMethodsList();
        } catch (e) {
          FOS.ui.toast(e.message, 'error');
        }
      });
    });
  }

  function confirmDangerAction({ title, message, confirmLabel, inlineHost } = {}) {
    if (inlineHost) {
      return new Promise((resolve) => {
        document.querySelectorAll('.inline-danger-confirm').forEach((el) => el.remove());
        const box = document.createElement('div');
        box.className = 'inline-danger-confirm';
        box.innerHTML = `
          <div class="inline-danger-confirm__title">${FOS.fmt.escapeHtml(title || FOS.i18n.t('確認削除', '确认删除'))}</div>
          <div class="inline-danger-confirm__msg">${FOS.fmt.escapeHtml(message || FOS.i18n.t('确定执行此操作吗？', '确定执行此操作吗？'))}</div>
          <div class="inline-danger-confirm__actions">
            <button type="button" class="btn btn--ghost btn--sm" data-cancel>${FOS.i18n.t('キャンセル', '取消')}</button>
            <button type="button" class="btn btn--del btn--sm" data-ok>${FOS.fmt.escapeHtml(confirmLabel || FOS.i18n.t('削除', '删除'))}</button>
          </div>`;
        inlineHost.insertAdjacentElement('afterend', box);
        box.querySelector('[data-cancel]')?.addEventListener('click', () => {
          box.remove();
          resolve(false);
        });
        box.querySelector('[data-ok]')?.addEventListener('click', () => {
          box.remove();
          resolve(true);
        });
      });
    }
    return new Promise((resolve) => {
      const id = `confirmDanger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      FOS.ui.openModal({
        title: '',
        size: 'sm',
        bodyHtml: `
          <div class="danger-confirm" id="${id}">
            <div class="danger-confirm__title">${FOS.fmt.escapeHtml(title || FOS.i18n.t('確認削除', '确认删除'))}</div>
            <div class="danger-confirm__msg">${FOS.fmt.escapeHtml(message || FOS.i18n.t('确定执行此操作吗？', '确定执行此操作吗？'))}</div>
            <div class="danger-confirm__actions">
              <button type="button" class="btn btn--ghost btn--lg" data-cancel>${FOS.i18n.t('キャンセル', '取消')}</button>
              <button type="button" class="btn btn--del btn--lg" data-ok>${FOS.fmt.escapeHtml(confirmLabel || FOS.i18n.t('削除', '删除'))}</button>
            </div>
          </div>`,
      });
      const wrap = document.getElementById(id);
      wrap?.querySelector('[data-cancel]')?.addEventListener('click', () => {
        FOS.ui.closeModal();
        resolve(false);
      });
      wrap?.querySelector('[data-ok]')?.addEventListener('click', () => {
        FOS.ui.closeModal();
        resolve(true);
      });
    });
  }

  function shopOptionalFields(contact, phone) {
    const contactVal = (contact || '').trim();
    const phoneVal = (phone || '').trim();
    return {
      contact_name: contactVal || null,
      phone: phoneVal || null,
    };
  }

  function isUserColumnError(error) {
    const msg = `${error?.message || ''} ${error?.code || ''}`;
    return /contact_name|phone|settlement_type|zip_code|column|schema cache|42703|PGRST204/i.test(msg);
  }

  /** 按 DB 实际列逐步降级更新 users，避免缺列时报错 */
  async function updateShopUser(id, payload) {
    const base = {
      name: payload.name,
      password_hash: payload.password_hash,
      address: payload.address ?? '',
      zip_code: payload.zip_code ?? '',
    };
    const attempts = [
      payload,
      { ...base, settlement_type: payload.settlement_type, ...shopOptionalFields(payload._contact, payload._phone) },
      { ...base, settlement_type: payload.settlement_type },
      { ...base, ...shopOptionalFields(payload._contact, payload._phone) },
      base,
    ];
    const seen = new Set();
    let lastError = null;
    for (const row of attempts) {
      const clean = { ...row };
      delete clean._contact;
      delete clean._phone;
      const key = JSON.stringify(clean);
      if (seen.has(key)) continue;
      seen.add(key);
      const { error } = await FOS.merchants.scopeFilter(
        FOS.db.sb.from('users').update(clean).eq('id', id)
      );
      if (!error) {
        return {
          ok: true,
          saved: clean,
          settlementInDb: Object.prototype.hasOwnProperty.call(clean, 'settlement_type'),
          contactInDb: Object.prototype.hasOwnProperty.call(clean, 'contact_name'),
        };
      }
      lastError = error;
      if (!isUserColumnError(error)) break;
    }
    return { ok: false, error: lastError };
  }

  async function upsertShopUser(payload) {
    const attempts = [
      payload,
      (() => { const p = { ...payload }; delete p.contact_name; delete p.phone; return p; })(),
      (() => { const p = { ...payload }; delete p.settlement_type; delete p.contact_name; delete p.phone; return p; })(),
    ];
    const seen = new Set();
    let lastError = null;
    for (const row of attempts) {
      const key = JSON.stringify(row);
      if (seen.has(key)) continue;
      seen.add(key);
      const { error } = await FOS.db.sb.from('users').upsert(row);
      if (!error) {
        return {
          ok: true,
          settlementInDb: Object.prototype.hasOwnProperty.call(row, 'settlement_type'),
        };
      }
      lastError = error;
      if (!isUserColumnError(error)) break;
    }
    return { ok: false, error: lastError };
  }

  async function loadShops() {
    let { data, error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('users').select(SHOP_USER_FIELDS)
        .eq('role', 'order').eq('active', true)
    );
    if (error && /contact_name|phone|settlement_type|column/i.test(error.message || '')) {
      ({ data } = await FOS.merchants.scopeFilter(
        FOS.db.sb.from('users').select('id, name, password_hash, address')
          .eq('role', 'order').eq('active', true)
      ));
    }
    shops = (data || [])
      .filter((s) => !FOS.publicOrder?.isVirtualShopId(s.id))
      .map((s) => ({
      ...s,
      settlement_type: FOS.payment.resolveShopSettlement(s),
    }));
  }

  function settingsPanelHtml(id, icon, title, bodyHtml, { open = false, asLink = false } = {}) {
    if (asLink) {
      return `<button type="button" class="settings-panel settings-panel--link" data-open-settings-panel="${id}">
        <span class="settings-panel__head">
          <span class="settings-panel__icon">${icon}</span>
          <span class="settings-panel__title">${title}</span>
          <span class="settings-panel__chevron" aria-hidden="true">›</span>
        </span>
      </button>`;
    }
    const openAttr = open ? ' open' : '';
    return `<details class="settings-panel" data-settings-panel="${id}"${openAttr}>
      <summary class="settings-panel__head">
        <span class="settings-panel__icon">${icon}</span>
        <span class="settings-panel__title">${title}</span>
        <span class="settings-panel__chevron" aria-hidden="true">›</span>
      </summary>
      <div class="settings-panel__body">${bodyHtml}</div>
    </details>`;
  }

  async function renderSettings() {
    FOS.shell.setPageTitle(FOS.i18n.t('設定', '设置'));
    await FOS.cutoff.load();
    await FOS.orderSettings.load();
    await FOS.printerSettings.load();
    await FOS.appUrls.loadPublicBase();
    const invoiceProfile = await FOS.invoiceSettings.load();
    await loadShops();
    const schemaReady = await FOS.payment.isSchemaReady();
    const usage = await FOS.merchants.getUsage(FOS.merchants.scopeId());
    const main = document.getElementById('appMain');

    main.innerHTML = `
      <div class="settings-page">
        ${adminPageHeadHtml(FOS.i18n.t('設定', '设置'))}
        ${schemaReady ? '' : FOS.payment.schemaBannerHtml()}
        <div class="settings-usage">
          ${FOS.i18n.t('プラン上限', '套餐上限')}：
          ${FOS.i18n.t('ユーザー', '用户')} ${usage.users}/${usage.limits.max_users} ·
          ${FOS.i18n.t('商品', '商品')} ${usage.products}/${usage.limits.max_products}
        </div>
        <div class="settings-panels">
          ${settingsPanelHtml('payment', '💳', FOS.i18n.t('都度払い方法', '现结结账方式'), `
            <div id="paymentMethodsList"></div>
            <div class="payment-method-add">
              <input class="field__input" id="newPaymentMethodName" placeholder="${FOS.i18n.t('例：現金、振込', '例：现金、转账')}">
              <button type="button" class="btn btn--primary btn--sm" id="addPaymentMethodBtn">＋ ${FOS.i18n.t('追加', '添加')}</button>
            </div>`, { asLink: true })}
          ${settingsPanelHtml('cutoff', '⏰', FOS.i18n.t('締め切り時間', '截单时间'), `
            <label class="field">
              <span class="field__label">${FOS.i18n.t('毎日の締め切り', '每日截单')}</span>
              <input type="time" class="field__input" id="cutoffSetting" value="${FOS.cutoff.time}">
            </label>
            <button type="button" class="btn btn--primary btn--sm" id="saveCutoffBtn">${FOS.i18n.t('保存', '保存')}</button>`, { asLink: true })}
          ${settingsPanelHtml('display', '📱', FOS.i18n.t('通知栏', '通知栏'), `
            <label class="field">
              <span class="field__label">${FOS.i18n.t('商家名称', '商家名称')}</span>
              <input type="text" class="field__input" id="orderDisplayName" value="${FOS.fmt.escapeHtml(FOS.orderSettings.displayName)}" placeholder="${FOS.i18n.t('接单端顶部显示', '接单端顶部显示')}">
            </label>
            <label class="field">
              <span class="field__label">${FOS.i18n.t('通知栏', '通知栏')}</span>
              <textarea class="field__input" id="orderNotice" rows="2" placeholder="${FOS.i18n.t('例：本日は15時まで受付', '例：今天15点前可下单')}">${FOS.fmt.escapeHtml(FOS.orderSettings.notice)}</textarea>
            </label>
            <button type="button" class="btn btn--primary btn--sm" id="saveOrderDisplayBtn">${FOS.i18n.t('保存', '保存')}</button>`, { asLink: true })}
          ${settingsPanelHtml('invoice', '📄', FOS.i18n.t('請求書設定', '账单设置'), `
            <div class="form-grid form-grid--2">
              <label class="field">
                <span class="field__label">${FOS.i18n.t('会社名', '公司名称')}</span>
                <input class="field__input" id="invCompanyName" value="${FOS.fmt.escapeHtml(invoiceProfile.companyName)}">
              </label>
              <label class="field">
                <span class="field__label">${FOS.i18n.t('郵便番号', '邮编')}</span>
                <input class="field__input" id="invZip" value="${FOS.fmt.escapeHtml(invoiceProfile.zip)}" placeholder="150-0042">
              </label>
            </div>
            <label class="field">
              <span class="field__label">${FOS.i18n.t('住所', '地址')}</span>
              <input class="field__input" id="invAddress" value="${FOS.fmt.escapeHtml(invoiceProfile.address)}">
            </label>
            <div class="form-grid form-grid--2">
              <label class="field">
                <span class="field__label">TEL</span>
                <input class="field__input" id="invTel" value="${FOS.fmt.escapeHtml(invoiceProfile.tel)}">
              </label>
              <label class="field">
                <span class="field__label">FAX</span>
                <input class="field__input" id="invFax" value="${FOS.fmt.escapeHtml(invoiceProfile.fax)}">
              </label>
            </div>
            <label class="field">
              <span class="field__label">${FOS.i18n.t('登録番号', '登记号')}</span>
              <input class="field__input" id="invRegistrationNo" value="${FOS.fmt.escapeHtml(invoiceProfile.registrationNo)}" placeholder="T+13桁">
            </label>
            <label class="field">
              <span class="field__label">${FOS.i18n.t('お振り込み先', '汇款账户')}</span>
              <textarea class="field__input" id="invBankInfo" rows="2" placeholder="${FOS.i18n.t('例：三井住友銀行 上野支店 普通8695450', '例：三井住友银行 上野支行 普通账户')}">${FOS.fmt.escapeHtml(invoiceProfile.bankInfo)}</textarea>
            </label>
            <button type="button" class="btn btn--primary btn--sm" id="saveInvoiceSettingsBtn">${FOS.i18n.t('保存', '保存')}</button>`, { asLink: true })}
          ${settingsPanelHtml('channels', '📲', FOS.i18n.t('顧客注文チャンネル', '顾客下单渠道'), `
            <div class="settings-panel__toolbar">
              <button type="button" class="btn btn--primary btn--sm" id="openAddChannelBtn">＋ ${FOS.i18n.t('チャンネル追加', '添加渠道')}</button>
            </div>
            <div id="channelList" class="settings-list"></div>`, { asLink: true })}
          ${settingsPanelHtml('shops', '🏪', FOS.i18n.t('店舗管理', '店铺管理'), `
            <div class="settings-panel__toolbar">
              <button type="button" class="btn btn--primary btn--sm" id="openAddShopBtn">＋ ${FOS.i18n.t('店舗追加', '添加店铺')}</button>
            </div>
            <div id="shopList" class="settings-list"></div>`, { asLink: true })}
          ${settingsPanelHtml('printer', '🖨', FOS.i18n.t('プリンター設定', '打印机设置'), '', { asLink: true })}
        </div>
      </div>
    `;

    const subPageShell = (title, innerHtml, footHtml = '') => `
      <div class="settings-subpage">
        <div class="settings-subpage__head">
          <button type="button" class="btn btn--ghost btn--sm" id="settingsSubBack">← ${FOS.i18n.t('戻る', '返回')}</button>
          <div class="settings-subpage__title">${FOS.fmt.escapeHtml(title)}</div>
          <span></span>
        </div>
        <div class="settings-subpage__scroll">${innerHtml}</div>
        ${footHtml ? `<div class="settings-subpage__foot">${footHtml}</div>` : ''}
      </div>`;

    const openSettingsPanelPage = async (panelId) => {
      if (panelId === 'payment') {
        FOS.ui.openModal({
          title: '',
          size: 'full',
          bodyHtml: subPageShell(FOS.i18n.t('都度払い方法', '现结结账方式'), `
            <div id="paymentMethodsList"></div>
            <div class="payment-method-add">
              <input class="field__input" id="newPaymentMethodName" placeholder="${FOS.i18n.t('例：現金、振込', '例：现金、转账')}">
              <button type="button" class="btn btn--primary btn--sm" id="addPaymentMethodBtn">＋ ${FOS.i18n.t('追加', '添加')}</button>
            </div>`),
        });
        document.getElementById('settingsSubBack')?.addEventListener('click', () => FOS.ui.closeModal());
        await paintPaymentMethodsList();
        document.getElementById('addPaymentMethodBtn')?.addEventListener('click', async () => {
          const name = document.getElementById('newPaymentMethodName')?.value;
          try {
            await FOS.payment.addMethod(name);
            document.getElementById('newPaymentMethodName').value = '';
            FOS.ui.toast(FOS.i18n.t('追加しました', '已添加'), 'success');
            await paintPaymentMethodsList();
          } catch (e) {
            FOS.ui.toast(e.message, 'error');
          }
        });
        return;
      }
      if (panelId === 'cutoff') {
        FOS.ui.openModal({
          title: '',
          size: 'full',
          bodyHtml: subPageShell(FOS.i18n.t('締め切り時間', '截单时间'), `
            <label class="field">
              <span class="field__label">${FOS.i18n.t('毎日の締め切り', '每日截单')}</span>
              <input type="time" class="field__input" id="cutoffSetting" value="${FOS.cutoff.time}">
            </label>
            <button type="button" class="btn btn--primary btn--block btn--lg settings-subpage__save" id="saveCutoffBtn">${FOS.i18n.t('保存', '保存')}</button>`),
        });
        document.getElementById('settingsSubBack')?.addEventListener('click', () => FOS.ui.closeModal());
        document.getElementById('saveCutoffBtn')?.addEventListener('click', async () => {
          const v = document.getElementById('cutoffSetting')?.value;
          FOS.ui.showLoading();
          try {
            await FOS.cutoff.save(v);
            FOS.ui.toast(FOS.i18n.t('保存しました', '已保存'), 'success');
          } catch (e) {
            FOS.ui.toast(e.message, 'error');
          } finally {
            FOS.ui.hideLoading();
          }
        });
        return;
      }
      if (panelId === 'display') {
        FOS.ui.openModal({
          title: '',
          size: 'full',
          bodyHtml: subPageShell(FOS.i18n.t('通知栏', '通知栏'), `
            <div class="settings-notice-card">
              <label class="field">
                <span class="field__label">${FOS.i18n.t('通知内容', '通知内容')}</span>
                <textarea class="field__input" id="orderNotice" rows="5" placeholder="${FOS.i18n.t('例：本日は15時まで受付', '例：今天15点前可下单')}">${FOS.fmt.escapeHtml(FOS.orderSettings.notice)}</textarea>
              </label>
            </div>
            <button type="button" class="btn btn--primary btn--block btn--lg" id="saveOrderDisplayBtn">${FOS.i18n.t('保存', '保存')}</button>`),
        });
        document.getElementById('settingsSubBack')?.addEventListener('click', () => FOS.ui.closeModal());
        document.getElementById('saveOrderDisplayBtn')?.addEventListener('click', async () => {
          const notice = document.getElementById('orderNotice')?.value;
          FOS.ui.showLoading();
          try {
            await FOS.orderSettings.saveNotice(notice);
            FOS.ui.toast(FOS.i18n.t('保存しました', '已保存'), 'success');
          } catch (e) {
            FOS.ui.toast(e.message, 'error');
          } finally {
            FOS.ui.hideLoading();
          }
        });
        return;
      }
      if (panelId === 'printer') {
        const ps = FOS.printerSettings._cache || FOS.printerSettings.defaults();
        FOS.ui.openModal({
          title: '',
          size: 'full',
          bodyHtml: subPageShell(
            FOS.i18n.t('プリンター設定', '打印机设置'),
            `
            <label class="settings-printer-enable-card settings-check">
              <input type="checkbox" id="printerEnabled" ${ps.enabled ? 'checked' : ''}>
              <span class="settings-printer-enable-card__label">${FOS.i18n.t('出庫印刷を有効化', '启用出库打印')}</span>
            </label>
            <div class="settings-printer-card">
              <div class="settings-printer-types">
                <div class="field__label">${FOS.i18n.t('プリンター種別', '打印机类型')}</div>
                <label class="settings-radio"><input type="radio" name="printerType" value="lan" ${ps.type === 'lan' ? 'checked' : ''}> ${FOS.i18n.t('ネットワーク', '网络打印机')}</label>
                <label class="settings-radio settings-radio--disabled"><input type="radio" name="printerType" value="usb" disabled> ${FOS.i18n.t('USB', 'USB打印机')} <span class="field__hint">${FOS.i18n.t('準備中', '即将支持')}</span></label>
                <label class="settings-radio settings-radio--disabled"><input type="radio" name="printerType" value="bluetooth" disabled> ${FOS.i18n.t('Bluetooth', '蓝牙打印机')} <span class="field__hint">${FOS.i18n.t('準備中', '即将支持')}</span></label>
              </div>
              <div class="form-grid form-grid--2" id="printerLanFields">
                <label class="field">
                  <span class="field__label">IP</span>
                  <input class="field__input" id="printerIp" value="${FOS.fmt.escapeHtml(ps.ip)}" placeholder="192.168.1.100">
                </label>
                <label class="field">
                  <span class="field__label">${FOS.i18n.t('ポート', '端口')}</span>
                  <input class="field__input" id="printerPort" type="number" min="1" max="65535" value="${ps.port || 9100}">
                </label>
              </div>
              <label class="field">
                <span class="field__label">${FOS.i18n.t('印刷部数', '打印份数')}</span>
                <select class="field__input" id="printerCopies">
                  <option value="1" ${ps.copies === 1 ? 'selected' : ''}>1</option>
                  <option value="2" ${ps.copies === 2 ? 'selected' : ''}>2</option>
                  <option value="3" ${ps.copies === 3 ? 'selected' : ''}>3</option>
                </select>
              </label>
            </div>`,
            `<button type="button" class="btn btn--secondary btn--block btn--lg" id="testPrinterSettingsBtn">${FOS.i18n.t('印刷テスト', '测试打印')}</button>
            <button type="button" class="btn btn--primary btn--block btn--lg" id="savePrinterSettingsBtn">${FOS.i18n.t('保存', '保存')}</button>`
          ),
        });
        document.getElementById('settingsSubBack')?.addEventListener('click', () => FOS.ui.closeModal());
        document.getElementById('testPrinterSettingsBtn')?.addEventListener('click', async () => {
          const enabled = !!document.getElementById('printerEnabled')?.checked;
          const type = document.querySelector('input[name="printerType"]:checked')?.value || 'lan';
          const ip = document.getElementById('printerIp')?.value;
          const port = document.getElementById('printerPort')?.value;
          const copies = document.getElementById('printerCopies')?.value;
          const draft = FOS.printerSettings.normalize({ enabled, type, ip, port, copies });
          FOS.ui.showLoading();
          try {
            await FOS.outboundPrint.testPrint(draft);
            FOS.ui.toast(FOS.i18n.t('印刷テスト送信済', '测试打印已发送'), 'success');
          } catch (e) {
            FOS.ui.toast(e.message, 'error');
          } finally {
            FOS.ui.hideLoading();
          }
        });
        document.getElementById('savePrinterSettingsBtn')?.addEventListener('click', async () => {
          const enabled = !!document.getElementById('printerEnabled')?.checked;
          const type = document.querySelector('input[name="printerType"]:checked')?.value || 'lan';
          const ip = document.getElementById('printerIp')?.value;
          const port = document.getElementById('printerPort')?.value;
          const copies = document.getElementById('printerCopies')?.value;
          FOS.ui.showLoading();
          try {
            await FOS.printerSettings.save({ enabled, type, ip, port, copies });
            FOS.ui.toast(FOS.i18n.t('保存しました', '已保存'), 'success');
          } catch (e) {
            FOS.ui.toast(e.message, 'error');
          } finally {
            FOS.ui.hideLoading();
          }
        });
        return;
      }
      if (panelId === 'invoice') {
        FOS.ui.openModal({
          title: '',
          size: 'full',
          bodyHtml: subPageShell(FOS.i18n.t('請求書設定', '账单设置'), `
            <div class="form-grid form-grid--2">
              <label class="field">
                <span class="field__label">${FOS.i18n.t('会社名', '公司名称')}</span>
                <input class="field__input" id="invCompanyName" value="${FOS.fmt.escapeHtml(invoiceProfile.companyName)}">
              </label>
              <label class="field">
                <span class="field__label">${FOS.i18n.t('郵便番号', '邮编')}</span>
                <input class="field__input" id="invZip" value="${FOS.fmt.escapeHtml(invoiceProfile.zip)}" placeholder="150-0042">
              </label>
            </div>
            <label class="field">
              <span class="field__label">${FOS.i18n.t('住所', '地址')}</span>
              <input class="field__input" id="invAddress" value="${FOS.fmt.escapeHtml(invoiceProfile.address)}">
            </label>
            <div class="form-grid form-grid--2">
              <label class="field">
                <span class="field__label">TEL</span>
                <input class="field__input" id="invTel" value="${FOS.fmt.escapeHtml(invoiceProfile.tel)}">
              </label>
              <label class="field">
                <span class="field__label">FAX</span>
                <input class="field__input" id="invFax" value="${FOS.fmt.escapeHtml(invoiceProfile.fax)}">
              </label>
            </div>
            <label class="field">
              <span class="field__label">${FOS.i18n.t('登録番号', '登记号')}</span>
              <input class="field__input" id="invRegistrationNo" value="${FOS.fmt.escapeHtml(invoiceProfile.registrationNo)}" placeholder="T+13桁">
            </label>
            <label class="field">
              <span class="field__label">${FOS.i18n.t('お振り込み先', '汇款账户')}</span>
              <textarea class="field__input" id="invBankInfo" rows="2" placeholder="${FOS.i18n.t('例：三井住友銀行 上野支店 普通8695450', '例：三井住友银行 上野支行 普通账户')}">${FOS.fmt.escapeHtml(invoiceProfile.bankInfo)}</textarea>
            </label>
            <button type="button" class="btn btn--primary btn--block btn--lg" id="saveInvoiceSettingsBtn">${FOS.i18n.t('保存', '保存')}</button>`),
        });
        document.getElementById('settingsSubBack')?.addEventListener('click', () => FOS.ui.closeModal());
        document.getElementById('saveInvoiceSettingsBtn')?.addEventListener('click', async () => {
          FOS.ui.showLoading();
          try {
            await FOS.invoiceSettings.save({
              companyName: document.getElementById('invCompanyName')?.value,
              zip: document.getElementById('invZip')?.value,
              address: document.getElementById('invAddress')?.value,
              tel: document.getElementById('invTel')?.value,
              fax: document.getElementById('invFax')?.value,
              registrationNo: document.getElementById('invRegistrationNo')?.value,
              bankInfo: document.getElementById('invBankInfo')?.value,
            });
            FOS.ui.toast(FOS.i18n.t('保存しました', '已保存'), 'success');
          } catch (e) {
            FOS.ui.toast(e.message, 'error');
          } finally {
            FOS.ui.hideLoading();
          }
        });
        return;
      }
      if (panelId === 'channels') {
        FOS.ui.openModal({
          title: '',
          size: 'full',
          bodyHtml: subPageShell(FOS.i18n.t('顧客注文チャンネル', '顾客下单渠道'), `
            <div class="settings-panel__toolbar">
              <button type="button" class="btn btn--primary btn--sm" id="openAddChannelBtn">＋ ${FOS.i18n.t('チャンネル追加', '添加渠道')}</button>
            </div>
            <div id="channelList" class="settings-list"></div>`),
        });
        document.getElementById('settingsSubBack')?.addEventListener('click', () => FOS.ui.closeModal());
        await loadChannels();
        paintChannelList();
        document.getElementById('openAddChannelBtn')?.addEventListener('click', openAddChannelModal);
        return;
      }
      if (panelId === 'shops') {
        FOS.ui.openModal({
          title: '',
          size: 'full',
          bodyHtml: subPageShell(FOS.i18n.t('店舗管理', '店铺管理'), `
            <div class="settings-panel__toolbar">
              <button type="button" class="btn btn--primary btn--sm" id="openAddShopBtn">＋ ${FOS.i18n.t('店舗追加', '添加店铺')}</button>
            </div>
            <div id="shopList" class="settings-list"></div>`),
        });
        document.getElementById('settingsSubBack')?.addEventListener('click', () => FOS.ui.closeModal());
        paintShopList();
        document.getElementById('openAddShopBtn')?.addEventListener('click', openAddShopModal);
      }
    };
    main.querySelectorAll('[data-open-settings-panel]').forEach((btn) => {
      btn.addEventListener('click', () => openSettingsPanelPage(btn.dataset.openSettingsPanel));
    });

  }

  async function loadChannels() {
    const { data, error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('order_channels').select('*').order('sort_order').order('created_at')
    );
    if (error && /order_channels|does not exist|schema cache/i.test(error.message || '')) {
      channels = [];
      return;
    }
    channels = data || [];
  }

  function channelTypeLabel(type) {
    const map = {
      wechat_group: ['微信群', '微信群'],
      public_qr: ['公開QR', '公开二维码'],
      store_poster: ['店頭ポスター', '门店海报'],
    };
    const pair = map[type] || [type, type];
    return FOS.i18n.t(pair[0], pair[1]);
  }

  function paintChannelList() {
    const el = document.getElementById('channelList');
    if (!el) return;
    if (!channels.length) {
      el.innerHTML = `<div class="shop-list-empty">${FOS.i18n.t('チャンネルなし', '暂无渠道')}</div>`;
      return;
    }
    el.innerHTML = channels.map((ch) => `
      <details class="settings-list-item">
        <summary class="settings-list-item__head">
          <span class="settings-list-item__main">
            <span class="settings-list-item__name">${FOS.fmt.escapeHtml(ch.name)}</span>
            <span class="badge badge--${ch.active ? 'green' : 'gray'}">${ch.active ? FOS.i18n.t('有効', '启用') : FOS.i18n.t('停止', '停用')}</span>
          </span>
          <span class="settings-panel__chevron" aria-hidden="true">›</span>
        </summary>
        <div class="settings-list-item__body">
          <div class="settings-list-item__meta">${FOS.fmt.escapeHtml(ch.id)} · ${channelTypeLabel(ch.channel_type)}</div>
          <div class="settings-list-item__actions">
            <button type="button" class="btn btn--primary btn--sm" data-channel-qr="${FOS.fmt.escapeHtml(ch.id)}">QR</button>
            <button type="button" class="btn btn--secondary btn--sm" data-channel-toggle="${FOS.fmt.escapeHtml(ch.id)}" data-active="${ch.active ? '1' : '0'}">${ch.active ? FOS.i18n.t('停止', '停用') : FOS.i18n.t('有効化', '启用')}</button>
            <button type="button" class="btn btn--del btn--sm" data-channel-del="${FOS.fmt.escapeHtml(ch.id)}" data-channel-name="${FOS.fmt.escapeHtml(ch.name)}">${FOS.i18n.t('削除', '删除')}</button>
          </div>
        </div>
      </details>`).join('');
    el.querySelectorAll('[data-channel-qr]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openChannelQrModal(btn.dataset.channelQr);
      });
    });
    el.querySelectorAll('[data-channel-toggle]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleChannel(btn.dataset.channelToggle, btn.dataset.active !== '1');
      });
    });
    el.querySelectorAll('[data-channel-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteChannel(
          btn.dataset.channelDel,
          btn.dataset.channelName || btn.dataset.channelDel,
          btn.closest('.settings-list-item__body'),
        );
      });
    });
  }

  function openAddChannelModal() {
    FOS.ui.openModal({
      title: FOS.i18n.t('顧客注文チャンネル追加', '添加顾客下单渠道'),
      bodyHtml: `
        <form id="addChannelForm" class="product-editor">
          <label class="field">
            <span class="field__label product-editor__label--req">${FOS.i18n.t('表示名', '显示名称')}</span>
            <input class="field__input" id="newChannelName" placeholder="${FOS.i18n.t('例：微信群1', '例：微信群1')}" autocomplete="off">
          </label>
          <button type="button" class="btn btn--primary btn--block" id="saveNewChannelBtn">${FOS.i18n.t('追加してQR表示', '添加并显示二维码')}</button>
        </form>`,
    });
    document.getElementById('saveNewChannelBtn')?.addEventListener('click', saveNewChannel);
  }

  async function saveNewChannel() {
    const name = document.getElementById('newChannelName')?.value?.trim();
    const channelType = 'public_qr';
    const shopId = null;
    if (!name) {
      FOS.ui.toast(FOS.i18n.t('表示名を入力してください', '请输入显示名称'), 'error');
      return;
    }
    FOS.ui.showLoading();
    let id = FOS.publicOrder.newChannelId();
    for (let i = 0; i < 5; i++) {
      const { error } = await FOS.merchants.scopeFilter(
        FOS.db.sb.from('order_channels').insert({
          id,
          merchant_id: FOS.merchants.scopeId(),
          name,
          channel_type: channelType,
          shop_id: shopId || null,
          active: true,
          sort_order: channels.length,
          updated_at: new Date().toISOString(),
        })
      );
      if (!error) {
        FOS.ui.hideLoading();
        FOS.ui.closeModal();
        FOS.ui.toast(FOS.i18n.t('追加しました', '已添加'), 'success');
        await loadChannels();
        paintChannelList();
        openChannelQrModal(id);
        return;
      }
      if (!/duplicate|unique/i.test(error.message || '')) {
        FOS.ui.hideLoading();
        FOS.ui.toast(error.message, 'error');
        return;
      }
      id = FOS.publicOrder.newChannelId();
    }
    FOS.ui.hideLoading();
    FOS.ui.toast(FOS.i18n.t('追加に失敗しました', '添加失败'), 'error');
  }

  async function toggleChannel(channelId, active) {
    const { error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('order_channels').update({ active, updated_at: new Date().toISOString() }).eq('id', channelId)
    );
    if (error) {
      FOS.ui.toast(error.message, 'error');
      return;
    }
    await loadChannels();
    paintChannelList();
  }

  async function deleteChannel(channelId, name, inlineHost = null) {
    const label = name || channelId;
    const ok = await confirmDangerAction({
      title: FOS.i18n.t('確認削除', '确认删除'),
      message: FOS.i18n.t(`确定删除「${label}」吗？`, `确定删除「${label}」吗？`),
      confirmLabel: FOS.i18n.t('削除', '删除'),
      inlineHost,
    });
    if (!ok) return;
    const { error } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('order_channels').delete().eq('id', channelId)
    );
    if (error) {
      FOS.ui.toast(error.message, 'error');
      return;
    }
    FOS.ui.toast(FOS.i18n.t('削除しました', '已删除'), 'success');
    await loadChannels();
    paintChannelList();
  }

  function getDefaultChannelId() {
    const active = channels.find((c) => c.active);
    return active?.id || channels[0]?.id || '';
  }

  function bindQrModalActions({ copyBtnId, downloadBtnId, url, downloadName }) {
    document.getElementById(copyBtnId)?.addEventListener('click', async () => {
      const ok = await FOS.shopQr.copyLink(url);
      if (ok) {
        FOS.ui.toast(FOS.i18n.t('コピーしました', '已复制'), 'success');
      } else {
        FOS.ui.toast(FOS.i18n.t('コピーに失敗しました', '复制失败'), 'error');
      }
    });
    document.getElementById(downloadBtnId)?.addEventListener('click', async () => {
      try {
        await FOS.shopQr.downloadPng(url, downloadName);
        FOS.ui.toast(FOS.i18n.t('保存しました', '已保存'), 'success');
      } catch (e) {
        FOS.ui.toast(e?.message || FOS.i18n.t('保存に失敗しました', '保存失败'), 'error');
      }
    });
  }

  async function openChannelQrModal(channelId) {
    const ch = channels.find((c) => String(c.id) === String(channelId));
    if (!ch) return;
    await FOS.appUrls.loadPublicBase();
    if (!FOS.config?.publicAppBaseUrl?.() && !FOS.appUrls.publicBase()) {
      FOS.appUrls.requirePublicBase();
      return;
    }
    const merchantId = FOS.merchants.scopeId();
    const url = FOS.publicOrder.buildGuestChannelUrl({ merchantId, channelId: ch.id });
    FOS.ui.openModal({
      title: FOS.i18n.t('散客注文QR（都度払い）', '散客下单二维码（现结）'),
      size: 'lg',
      bodyHtml: `
        <div class="shop-qr-modal">
          <p class="shop-qr-modal__shop"><strong>${FOS.fmt.escapeHtml(ch.name)}</strong>
            <span class="shop-qr-modal__id">${FOS.fmt.escapeHtml(ch.id)}</span></p>
          <div class="shop-qr-modal__canvas-wrap">
            <canvas id="channelQrCanvas" width="240" height="240" aria-label="QR"></canvas>
          </div>
          <input type="hidden" id="channelQrUrl" value="${FOS.fmt.escapeHtml(url)}">
          <div class="shop-qr-modal__actions">
            <button type="button" class="btn btn--secondary" id="copyChannelQrUrl">${FOS.i18n.t('リンクをコピー', '复制链接')}</button>
            <button type="button" class="btn btn--primary" id="downloadChannelQrBtn">${FOS.i18n.t('QRを保存', '保存二维码')}</button>
          </div>
        </div>`,
    });
    const canvas = document.getElementById('channelQrCanvas');
    await FOS.shopQr.paintQr(canvas, url);
    bindQrModalActions({
      copyBtnId: 'copyChannelQrUrl',
      downloadBtnId: 'downloadChannelQrBtn',
      url,
      downloadName: `guest-qr_${ch.id}.png`,
    });
  }

  async function openShopMonthlyOrderQrModal(shopId) {
    const shop = shops.find((s) => String(s.id) === String(shopId));
    if (!shop) return;
    await FOS.appUrls.loadPublicBase();
    if (!FOS.config?.publicAppBaseUrl?.() && !FOS.appUrls.publicBase()) {
      FOS.appUrls.requirePublicBase();
      return;
    }
    const channelId = getDefaultChannelId();
    if (!channelId) {
      FOS.ui.toast(FOS.i18n.t('先に顧客注文チャンネルを追加してください', '请先在「顾客下单渠道」中添加渠道'), 'error');
      return;
    }
    const merchantId = FOS.merchants.scopeId();
    const url = FOS.publicOrder.buildMonthlyShopOrderUrl({ merchantId, channelId, shopId: shop.id });
    FOS.ui.openModal({
      title: FOS.i18n.t('月払い店舗・注文QR', '月结店铺·扫码下单'),
      size: 'lg',
      bodyHtml: `
        <div class="shop-qr-modal">
          <p class="shop-qr-modal__shop"><strong>${FOS.fmt.escapeHtml(shop.name)}</strong>
            <span class="shop-qr-modal__id">${FOS.fmt.escapeHtml(shop.id)}</span></p>
          <div class="shop-qr-modal__canvas-wrap">
            <canvas id="shopMonthlyQrCanvas" width="240" height="240" aria-label="QR"></canvas>
          </div>
          <input type="hidden" id="shopMonthlyQrUrl" value="${FOS.fmt.escapeHtml(url)}">
          <div class="shop-qr-modal__actions">
            <button type="button" class="btn btn--secondary" id="copyShopMonthlyQrUrl">${FOS.i18n.t('リンクをコピー', '复制链接')}</button>
            <button type="button" class="btn btn--primary" id="downloadShopMonthlyQrBtn">${FOS.i18n.t('QRを保存', '保存二维码')}</button>
          </div>
        </div>`,
    });
    await FOS.shopQr.paintQr(document.getElementById('shopMonthlyQrCanvas'), url);
    bindQrModalActions({
      copyBtnId: 'copyShopMonthlyQrUrl',
      downloadBtnId: 'downloadShopMonthlyQrBtn',
      url,
      downloadName: `monthly-order-qr_${shop.id}.png`,
    });
  }

  function shopFormHtml() {
    return `
      <form id="addShopForm" class="product-editor shop-editor">
        <div class="product-editor__body">
          <div class="product-editor__section">
            <label class="field">
              <span class="product-editor__label product-editor__label--req">ID</span>
              <input class="field__input" id="newShopId" placeholder="shop04" autocomplete="off">
            </label>
          </div>
          <div class="product-editor__section">
            <label class="field">
              <span class="product-editor__label product-editor__label--req">${FOS.i18n.t('店舗名', '店名')}</span>
              <input class="field__input" id="newShopName" autocomplete="off">
            </label>
          </div>
          <div class="product-editor__section">
            <label class="field">
              <span class="product-editor__label product-editor__label--req">${FOS.i18n.t('パスワード', '密码')}</span>
              <input class="field__input" id="newShopPass" autocomplete="new-password">
            </label>
          </div>
          <div class="product-editor__section">
            <label class="field">
              <span class="product-editor__label">${FOS.i18n.t('担当者', '联系人')} <span class="field__opt">${FOS.i18n.t('任意', '选填')}</span></span>
              <input class="field__input" id="newShopContact" autocomplete="off">
            </label>
          </div>
          <div class="product-editor__section">
            <label class="field">
              <span class="product-editor__label">${FOS.i18n.t('電話番号', '电话号码')} <span class="field__opt">${FOS.i18n.t('任意', '选填')}</span></span>
              <input class="field__input" id="newShopPhone" type="tel" autocomplete="tel">
            </label>
          </div>
          <div class="product-editor__section">
            <label class="field">
              <span class="product-editor__label">${FOS.i18n.t('郵便番号', '邮编')} <span class="field__opt">${FOS.i18n.t('任意', '选填')}</span></span>
              <input class="field__input" id="newShopZip" autocomplete="off" placeholder="150-0042">
            </label>
          </div>
          <div class="product-editor__section">
            <label class="field">
              <span class="product-editor__label">${FOS.i18n.t('住所', '地址')} <span class="field__opt">${FOS.i18n.t('任意', '选填')}</span></span>
              <input class="field__input" id="newShopAddr" autocomplete="off">
            </label>
          </div>
          ${settlementTypeFieldHtml('newShop', FOS.payment.SETTLEMENT.MONTHLY)}
        </div>
        <div class="product-editor__footer product-editor__footer--single">
          <button type="submit" class="btn btn--primary product-editor__btn-save">${FOS.i18n.t('保存', '保存')}</button>
        </div>
      </form>`;
  }

  function openAddShopModal() {
    FOS.ui.openModal({
      title: FOS.i18n.t('店舗追加', '添加店铺'),
      size: 'full',
      bodyHtml: shopFormHtml(),
    });
    document.getElementById('addShopForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = await addShop();
      if (ok) FOS.ui.closeModal();
    });
    setTimeout(() => document.getElementById('newShopId')?.focus(), 80);
  }

  function paintShopList() {
    const el = document.getElementById('shopList');
    if (!el) return;
    if (!shops.length) {
      el.innerHTML = `<div class="shop-list-empty">${FOS.i18n.t('店舗なし', '暂无店铺')}</div>`;
      return;
    }
    el.innerHTML = shops.map((u) => {
      const isMonthly = (u.settlement_type || 'monthly') === 'monthly';
      return `
      <details class="settings-list-item shop-list-item" data-shop-card="${u.id}">
        <summary class="settings-list-item__head">
          <span class="settings-list-item__main">
            <span class="settings-list-item__name">${FOS.fmt.escapeHtml(u.name)}</span>
            <span class="badge badge--${u.settlement_type === 'cash' ? 'orange' : 'blue'}">${FOS.payment.settlementLabel(u.settlement_type || 'monthly')}</span>
          </span>
          <span class="settings-panel__chevron" aria-hidden="true">›</span>
        </summary>
        <div class="settings-list-item__body">
          <div class="settings-list-item__meta">${FOS.i18n.t('ログインID', '登录账号')}: <strong>${FOS.fmt.escapeHtml(u.id)}</strong></div>
          <div class="settings-list-item__meta">${FOS.i18n.t('店舗名', '店名')}: ${FOS.fmt.escapeHtml(u.name)}</div>
          ${u.contact_name || u.phone ? `
          <div class="settings-list-item__meta">
            ${u.contact_name ? `${FOS.i18n.t('担当', '联系')}: ${FOS.fmt.escapeHtml(u.contact_name)}` : ''}
            ${u.phone ? `${u.contact_name ? ' · ' : ''}${FOS.i18n.t('TEL', '电话')}: ${FOS.fmt.escapeHtml(u.phone)}` : ''}
          </div>` : ''}
          <div class="settings-list-item__actions">
            ${isMonthly ? `<button type="button" class="btn btn--primary btn--sm" data-shop-order-qr="${u.id}">${FOS.i18n.t('注文QR', '下单QR')}</button>` : `<button type="button" class="btn btn--primary btn--sm" data-shop-qr="${u.id}">${FOS.i18n.t('接单端QR', '接单端QR')}</button>`}
            <button type="button" class="btn btn--secondary btn--sm" data-shop-edit="${u.id}">${FOS.i18n.t('編集', '编辑')}</button>
            <button type="button" class="btn btn--del btn--sm" data-shop-del="${u.id}" data-shop-name="${FOS.fmt.escapeHtml(u.name)}">${FOS.i18n.t('削除', '删除')}</button>
          </div>
          ${isMonthly ? `<button type="button" class="btn btn--ghost btn--sm shop-list-item__subqr" data-shop-qr="${u.id}">${FOS.i18n.t('接单端ログインQR', '接单端登录QR')}</button>` : ''}
          <div id="shopEdit_${u.id}" class="shop-card__edit" hidden>
            <div class="form-grid form-grid--2">
              <label class="field"><span class="field__label">${FOS.i18n.t('店舗名', '店名')}</span>
                <input class="field__input" id="editShopName_${u.id}" value="${FOS.fmt.escapeHtml(u.name)}"></label>
              <label class="field"><span class="field__label">${FOS.i18n.t('パスワード', '密码')}</span>
                <input class="field__input" id="editShopPass_${u.id}" value="${FOS.fmt.escapeHtml(u.password_hash)}"></label>
            </div>
            <div class="form-grid form-grid--2">
              <label class="field"><span class="field__label">${FOS.i18n.t('担当者', '联系人')} <span class="field__opt">${FOS.i18n.t('任意', '选填')}</span></span>
                <input class="field__input" id="editShopContact_${u.id}" value="${FOS.fmt.escapeHtml(u.contact_name || '')}"></label>
              <label class="field"><span class="field__label">${FOS.i18n.t('電話番号', '电话号码')} <span class="field__opt">${FOS.i18n.t('任意', '选填')}</span></span>
                <input class="field__input" id="editShopPhone_${u.id}" type="tel" value="${FOS.fmt.escapeHtml(u.phone || '')}"></label>
            </div>
            <div class="form-grid form-grid--2">
              <label class="field"><span class="field__label">${FOS.i18n.t('郵便番号', '邮编')} <span class="field__opt">${FOS.i18n.t('任意', '选填')}</span></span>
                <input class="field__input" id="editShopZip_${u.id}" value="${FOS.fmt.escapeHtml(u.zip_code || '')}" placeholder="150-0042"></label>
              <label class="field"><span class="field__label">${FOS.i18n.t('住所', '地址')} <span class="field__opt">${FOS.i18n.t('任意', '选填')}</span></span>
                <input class="field__input" id="editShopAddr_${u.id}" value="${FOS.fmt.escapeHtml(u.address || '')}"></label>
            </div>
            ${settlementTypeFieldHtml('editShop_' + u.id, u.settlement_type || 'monthly')}
            <button type="button" class="btn btn--primary btn--sm" data-shop-save="${u.id}">${FOS.i18n.t('保存', '保存')}</button>
          </div>
        </div>
      </details>`;
    }).join('');

    el.querySelectorAll('[data-shop-qr]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openShopQrModal(btn.dataset.shopQr);
      });
    });
    el.querySelectorAll('[data-shop-order-qr]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openShopMonthlyOrderQrModal(btn.dataset.shopOrderQr);
      });
    });
    el.querySelectorAll('[data-shop-edit]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = document.getElementById('shopEdit_' + btn.dataset.shopEdit);
        const card = btn.closest('.shop-list-item');
        if (!panel) return;
        const open = panel.hidden;
        el.querySelectorAll('.shop-card__edit').forEach((p) => { p.hidden = true; });
        el.querySelectorAll('.shop-list-item').forEach((c) => c.classList.remove('shop-card--editing'));
        if (open) {
          panel.hidden = false;
          card?.classList.add('shop-card--editing');
        }
      });
    });
    el.querySelectorAll('[data-shop-save]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveShopEdit(btn.dataset.shopSave);
      });
    });
    el.querySelectorAll('[data-shop-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteShop(btn.dataset.shopDel, btn.dataset.shopName, btn.closest('.settings-list-item__body'));
      });
    });
  }

  async function openShopQrModal(shopId) {
    const shop = shops.find((s) => String(s.id) === String(shopId));
    if (!shop) return;
    await FOS.appUrls.loadPublicBase();
    if (!FOS.config?.publicAppBaseUrl?.() && !FOS.appUrls.publicBase()) {
      FOS.appUrls.requirePublicBase();
      return;
    }
    const merchantId = FOS.merchants.scopeId();
    const url = FOS.shopQr.buildOrderLoginUrl({ shopId: shop.id, merchantId });
    FOS.ui.openModal({
      title: FOS.i18n.t('接单端ログインQR', '接单端登录二维码'),
      size: 'lg',
      bodyHtml: `
        <div class="shop-qr-modal">
          <p class="shop-qr-modal__shop"><strong>${FOS.fmt.escapeHtml(shop.name)}</strong>
            <span class="shop-qr-modal__id">${FOS.fmt.escapeHtml(shop.id)}</span></p>
          <div class="shop-qr-modal__canvas-wrap">
            <canvas id="shopQrCanvas" width="240" height="240" aria-label="QR"></canvas>
          </div>
          <input type="hidden" id="shopQrUrl" value="${FOS.fmt.escapeHtml(url)}">
          <div class="shop-qr-modal__actions">
            <button type="button" class="btn btn--secondary" id="copyShopQrUrl">${FOS.i18n.t('リンクをコピー', '复制链接')}</button>
            <button type="button" class="btn btn--primary" id="downloadShopQrBtn">${FOS.i18n.t('QRを保存', '保存二维码')}</button>
          </div>
        </div>`,
    });
    const canvas = document.getElementById('shopQrCanvas');
    await FOS.shopQr.paintQr(canvas, url);
    bindQrModalActions({
      copyBtnId: 'copyShopQrUrl',
      downloadBtnId: 'downloadShopQrBtn',
      url,
      downloadName: `order-qr_${shop.id}.png`,
    });
  }

  async function saveShopEdit(id) {
    const name = document.getElementById('editShopName_' + id)?.value.trim();
    const pass = document.getElementById('editShopPass_' + id)?.value.trim();
    const addr = document.getElementById('editShopAddr_' + id)?.value || '';
    const zip = document.getElementById('editShopZip_' + id)?.value || '';
    const contact = document.getElementById('editShopContact_' + id)?.value;
    const phone = document.getElementById('editShopPhone_' + id)?.value;
    const settlementType = readSettlementType('editShop_' + id);
    if (!name || !pass) { FOS.ui.toast(FOS.i18n.t('入力してください', '请填写完整'), 'error'); return; }
    const result = await updateShopUser(id, {
      name,
      password_hash: pass,
      address: addr,
      zip_code: zip,
      settlement_type: settlementType,
      _contact: contact,
      _phone: phone,
      ...shopOptionalFields(contact, phone),
    });
    if (!result.ok) {
      FOS.ui.toast(result.error?.message || FOS.i18n.t('保存に失敗しました', '保存失败'), 'error');
      return;
    }
    if (result.settlementInDb) {
      FOS.payment.clearShopSettlementOverride(id);
      FOS.ui.toast(FOS.i18n.t('保存しました', '已保存'), 'success');
    } else {
      FOS.payment.setShopSettlement(id, settlementType);
      FOS.ui.toast(FOS.i18n.t(
        '基本情報を保存しました。決済区分は端末に保存済み — Supabase で schema-payment.sql を実行してください',
        '基本信息已保存。结账方式已暂存本机 — 请在 Supabase 执行 schema-payment.sql'
      ), 'success');
    }
    await renderSettings();
  }

  async function deleteShop(id, name, inlineHost = null) {
    const ok = await confirmDangerAction({
      title: FOS.i18n.t('確認削除', '确认删除'),
      message: FOS.i18n.t(`确定删除「${name}」吗？`, `确定删除「${name}」吗？`),
      confirmLabel: FOS.i18n.t('削除', '删除'),
      inlineHost,
    });
    if (!ok) return;
    await FOS.merchants.scopeFilter(
      FOS.db.sb.from('users').update({ active: false }).eq('id', id)
    );
    FOS.ui.toast(FOS.i18n.t('削除しました', '已删除'), 'success');
    await loadShops();
    paintShopList();
  }

  async function addShop() {
    const id = document.getElementById('newShopId')?.value.trim();
    const name = document.getElementById('newShopName')?.value.trim();
    const pass = document.getElementById('newShopPass')?.value.trim();
    const addr = document.getElementById('newShopAddr')?.value.trim() || '';
    const zip = document.getElementById('newShopZip')?.value.trim() || '';
    const contact = document.getElementById('newShopContact')?.value;
    const phone = document.getElementById('newShopPhone')?.value;
    if (!id || !name || !pass) {
      FOS.ui.toast(FOS.i18n.t('すべて入力してください', '请填写所有字段'), 'error');
      return false;
    }
    FOS.ui.showLoading();
    try {
      const { data: exists } = await FOS.db.sb.from('users').select('id, active').eq('id', id).maybeSingle();
      if (!exists?.active) await FOS.merchants.assertCanAddUser();
      const settlementType = readSettlementType('newShop');
      const result = await upsertShopUser({
        id,
        name,
        role: 'order',
        password_hash: pass,
        address: addr,
        zip_code: zip,
        active: true,
        merchant_id: FOS.merchants.scopeId(),
        settlement_type: settlementType,
        ...shopOptionalFields(contact, phone),
      });
      if (!result.ok) throw result.error;
      if (result.settlementInDb) FOS.payment.clearShopSettlementOverride(id);
      else FOS.payment.setShopSettlement(id, settlementType);
      FOS.ui.toast(FOS.i18n.t('追加しました', '已添加'), 'success');
      await renderSettings();
      return true;
    } catch (err) {
      FOS.ui.toast(err.message, 'error');
      return false;
    } finally {
      FOS.ui.hideLoading();
    }
  }

  boot();
})();
