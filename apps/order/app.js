/**
 * 接单端 · UI Redesign
 * Airレジ 风格触控 + Notion 清晰排版
 */
(function () {
  FOS.APP_ID = 'order';
  FOS.auth.expectedRoles = ['order'];
  let allProducts = [];
  let searchTerm = '';
  let catFilter = '';
  let catTabsWasPinned = false;
  let historyMonth = null;
  let receiptChecked = {};
  let currentView = 'shop';
  let productRefreshTimer = null;
  let cartOverlayBound = false;
  let pageScrollY = 0;
  let cartSheetOpen = false;
  let favoriteRank = new Map();

  FOS.onLogout = () => { FOS.realtime.stopProducts(); FOS.realtime.stopShopOrders(); FOS.auth.logout(); boot(); };
  FOS.onLangChange = () => {
    if (!FOS.auth.user) return;
    FOS.shell.refreshLabels(orderNav());
    if (currentView === 'history') renderHistory();
    else if (currentView === 'favorites') renderFavorites();
    else renderShop();
  };

  function orderNav() {
    return [
      { id: 'favorites', icon: 'favorites', label: FOS.i18n.t('よく注文', '常用') },
      { id: 'shop', icon: 'shop', label: FOS.i18n.t('注文', '订货') },
      { id: 'history', icon: 'history', label: FOS.i18n.t('注文履歴', '订单') },
    ];
  }

  async function boot() {
    FOS.i18n.init();
    FOS.theme.init();
    try {
      await FOS.db.init();
      await FOS.cutoff.load();
      await FOS.orderSettings.load();
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
    const qr = FOS.shopQr.parseFromLocation();
    if (qr.merchantId) FOS.shopQr.saveMerchantHint(qr.merchantId);
    FOS.shopQr.cleanUrl();
    const prefillBanner = qr.shopId
      ? FOS.i18n.t('QRコードから店舗IDを読み込みました。パスワードを入力してください', '已从二维码预填店铺 ID，请输入密码登录')
      : '';
    FOS.ui._loginHeroTitle = () => FOS.i18n.t('NJF店舗注文システム', 'NJF门店订货系统');
    FOS.ui._loginHeroDesc = () => FOS.i18n.t('タップで注文。シンプルで速い。', '点选即下单，简单高效。');
    FOS.ui.renderLogin({
      title: FOS.i18n.t('NJF店舗注文システム', 'NJF门店订货系统'),
      heroTitle: FOS.ui._loginHeroTitle(),
      heroDesc: FOS.ui._loginHeroDesc(),
      prefillUser: qr.shopId,
      prefillReadonly: !!qr.shopId,
      prefillBanner,
      onShopIdInput: resolveShopDisplayName,
      onSubmit: async (id, pass) => { await FOS.auth.login(id, pass); await startApp(); },
    });
  }

  async function resolveShopDisplayName(shopId) {
    if (!shopId) return '';
    const { data } = await FOS.db.sb
      .from('users')
      .select('name')
      .eq('id', shopId)
      .eq('role', 'order')
      .eq('active', true)
      .maybeSingle();
    if (data?.name) return FOS.fmt.displayName(data.name);
    return shopId;
  }

  function shopTopbarTitle() {
    return FOS.orderSettings.displayName || FOS.i18n.t('注文', '订货');
  }

  async function startApp() {
    await FOS.orderSettings.load();
    const displayName = shopTopbarTitle();
    FOS.shell.mount({
      appId: 'order',
      brand: {
        icon: 'shop',
        title: displayName,
        subtitle: 'Order · v2',
      },
      nav: orderNav(),
      pageTitle: displayName,
      onNavigate: (id) => {
        closeCartSheet();
        currentView = id;
        if (id === 'history') renderHistory();
        else {
          FOS.realtime.stopShopOrders();
          if (id === 'favorites') renderFavorites();
          else {
            FOS.shell.setPageTitle(shopTopbarTitle());
            renderShop();
          }
        }
      },
    });
    bindOrderActions();
    FOS.realtime.startProducts({ onChange: onProductRealtime });
    currentView = 'shop';
    FOS.shell.navigate('shop');
  }

  function bindOrderActions() {
    if (bindOrderActions.done) return;
    bindOrderActions.done = true;
    document.addEventListener('click', (e) => {
      if (e.target.closest('#submitOrderBtn')) submitOrder();
    });
  }

  const cartKey = () => 'cart_' + FOS.auth.user.id;
  const getCart = () => FOS.storage.get(cartKey()) || [];
  const setCart = (items) => FOS.storage.set(cartKey(), items);
  const cartTotalQty = (cart) => (cart || []).reduce((sum, item) => sum + (item.qty || 0), 0);

  async function fetchProducts() {
    const { data } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('products').select('*').order('sort_order').order('created_at')
    );
    allProducts = data || [];
    FOS.categories.getTree(allProducts);
  }

  async function loadProducts() {
    FOS.ui.showLoading(FOS.i18n.t('読み込み中...', '加载中...'));
    await fetchProducts();
    FOS.ui.hideLoading();
  }

  function syncCartWithProducts() {
    const productMap = Object.fromEntries(allProducts.map((p) => [String(p.id), p]));
    const cart = getCart();
    let changed = false;
    const next = [];
    cart.forEach((item) => {
      const p = productMap[String(item.product_id)];
      if (!p || !p.active || p.stock <= 0) {
        changed = true;
        return;
      }
      const updated = { ...item };
      if (updated.unit_price !== p.price || updated.tax_rate !== p.tax_rate) {
        updated.unit_price = p.price;
        updated.tax_rate = p.tax_rate;
        changed = true;
      }
      if (updated.product_name !== p.name || updated.product_spec !== p.spec || updated.product_emoji !== (p.emoji || '📦')) {
        updated.product_name = p.name;
        updated.product_spec = p.spec;
        updated.product_emoji = p.emoji || '📦';
        changed = true;
      }
      if (updated.qty > p.stock) {
        updated.qty = p.stock;
        changed = true;
      }
      next.push(updated);
    });
    if (changed) {
      setCart(next);
      FOS.ui.toast(FOS.i18n.t('商品情報が更新されました', '商品信息已更新'), 'info');
      FOS.shell.updateNavBadge('shop', String(cartTotalQty(next)));
      updateFabBadge();
    }
    return changed;
  }

  function applyProductRealtime(payload) {
    if (!payload) return false;
    const id = payload.new?.id ?? payload.old?.id;
    if (!id) return false;
    const idx = allProducts.findIndex((p) => String(p.id) === String(id));
    if (payload.eventType === 'DELETE') {
      if (idx >= 0) allProducts.splice(idx, 1);
    } else if (payload.new) {
      if (idx >= 0) allProducts[idx] = { ...allProducts[idx], ...payload.new };
      else allProducts.push(payload.new);
    } else {
      return false;
    }
    FOS.categories.getTree(allProducts);
    return true;
  }

  function repaintProductViews() {
    if (catFilter && !FOS.categories.get(allProducts).includes(catFilter)) {
      catFilter = '';
    }
    syncCartWithProducts();
    if (currentView === 'shop' && document.getElementById('productGrid')) {
      paintCatTabs();
      paintProducts();
      paintAllCarts();
    } else if (currentView === 'favorites' && document.getElementById('productGrid')) {
      paintFavoriteProducts();
      paintAllCarts();
    }
  }

  async function loadFavoriteRank() {
    const { data: orders } = await FOS.merchants.scopeFilter(
      FOS.db.sb
        .from('orders')
        .select('id, order_items(product_id, qty)')
        .eq('shop_id', FOS.auth.user.id)
    );
    const rank = new Map();
    (orders || []).forEach((order) => {
      (order.order_items || []).forEach((item) => {
        const pid = item.product_id;
        if (!pid) return;
        const key = String(pid);
        const prev = rank.get(key) || { orderCount: 0, totalQty: 0 };
        prev.orderCount += 1;
        prev.totalQty += item.qty || 0;
        rank.set(key, prev);
      });
    });
    favoriteRank = rank;
    return rank;
  }

  function favoriteProductsList() {
    const q = searchTerm.toLowerCase();
    return allProducts
      .filter((p) => {
        if (!p.active || !favoriteRank.has(String(p.id))) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q)
          || (p.name_zh || '').includes(q)
          || (p.spec || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ra = favoriteRank.get(String(a.id));
        const rb = favoriteRank.get(String(b.id));
        if (rb.orderCount !== ra.orderCount) return rb.orderCount - ra.orderCount;
        return rb.totalQty - ra.totalQty;
      });
  }

  async function renderFavorites() {
    FOS.shell.setPageTitle(FOS.i18n.t('よく注文', '常用商品'));
    FOS.ui.showLoading(FOS.i18n.t('読み込み中...', '加载中...'));
    await loadProducts();
    await loadFavoriteRank();
    FOS.ui.hideLoading();

    const main = document.getElementById('appMain');
    const cart = getCart();
    main.innerHTML = `
      <div class="order-favorites-head">
        <h1 class="page-header__title">${FOS.i18n.t('よく注文する商品', '常用商品')}</h1>
        <p class="page-header__desc">${FOS.i18n.t('注文回数の多い順に表示', '按订购次数从多到少排列')}</p>
      </div>
      <div class="toolbar">
        <div class="search-bar">
          <input type="search" id="productSearch" placeholder="${FOS.i18n.t('商品を検索', '搜索商品')}" value="${FOS.fmt.escapeHtml(searchTerm)}">
        </div>
      </div>
      <div class="order-layout order-layout--favorites">
        <div class="product-grid" id="productGrid"></div>
      </div>
      <button type="button" class="cart-fab" id="cartFab" aria-label="Cart">
        🛒
        ${cartTotalQty(cart) ? `<span class="cart-fab__badge">${cartTotalQty(cart)}</span>` : ''}
      </button>
    `;

    document.getElementById('productSearch').addEventListener('input', (e) => {
      searchTerm = e.target.value;
      paintFavoriteProducts();
    });
    document.getElementById('cartFab')?.addEventListener('click', openCartSheet);
    mountCartOverlay();
    initCartFoot('cartSheetFoot', getCart());
    paintFavoriteProducts();
    paintAllCarts();
  }

  function productTileHtml(p, cart, { showFreq = false } = {}) {
    const inCart = cart.find((c) => String(c.product_id) === String(p.id));
    const qty = inCart ? inCart.qty : 0;
    const soldOut = p.stock <= 0;
    const priceExcl = p.price;
    const media = p.image_url
      ? `<img class="product-tile__img" src="${FOS.fmt.escapeHtml(p.image_url)}" alt="">`
      : `<div class="product-tile__emoji">${p.emoji || '📦'}</div>`;
    const soldOutBadge = soldOut
      ? `<div class="product-tile__soldout" aria-label="${FOS.i18n.t('在庫不足', '售罄')}">${FOS.i18n.t('在庫不足', '售罄')}</div>`
      : '';
    const rank = favoriteRank.get(String(p.id));
    const freqBadge = showFreq && rank
      ? `<div class="product-tile__freq">${FOS.i18n.t(`${rank.orderCount}回`, `订过${rank.orderCount}次`)}</div>`
      : '';
    return `
      <div class="product-tile ${qty && !soldOut ? 'product-tile--active' : ''} ${soldOut ? 'product-tile--soldout product-tile--disabled' : ''}" data-pid="${p.id}" ${soldOut ? 'data-soldout="1"' : ''}>
        ${qty && !soldOut ? `<span class="product-tile__qty">${qty}</span>` : ''}
        ${freqBadge}
        <div class="product-tile__media">${media}${soldOutBadge}</div>
        <div class="product-tile__name">${FOS.fmt.escapeHtml(p.name)}</div>
        ${p.spec ? `<div class="product-tile__spec">${FOS.fmt.escapeHtml(p.spec)}</div>` : ''}
        <div class="product-tile__price">${FOS.fmt.money(priceExcl)}<span class="product-tile__tax">（税抜）</span></div>
      </div>`;
  }

  function paintProductGrid(grid, list, { showFreq = false, emptyMsg } = {}) {
    if (!grid) return;
    const cart = getCart();
    if (!list.length) {
      grid.innerHTML = FOS.ui.empty('📦', emptyMsg || FOS.i18n.t('商品がありません', '暂无商品'));
      return;
    }
    grid.innerHTML = list.map((p) => productTileHtml(p, cart, { showFreq })).join('');
    grid.querySelectorAll('[data-pid]:not([data-soldout])').forEach((el) => {
      el.addEventListener('click', () => addToCart(el.dataset.pid, el));
    });
  }

  function paintFavoriteProducts() {
    const list = favoriteProductsList();
    paintProductGrid(
      document.getElementById('productGrid'),
      list,
      {
        showFreq: true,
        emptyMsg: FOS.i18n.t('まだ注文履歴がありません', '暂无订购记录'),
      }
    );
  }

  async function refreshProductsLive() {
    await fetchProducts();
    repaintProductViews();
  }

  function onProductRealtime(payload) {
    if (applyProductRealtime(payload)) repaintProductViews();
    clearTimeout(productRefreshTimer);
    productRefreshTimer = setTimeout(() => refreshProductsLive(), 400);
  }

  async function checkReceiptRequired() {
    const { data } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('orders').select('id, order_no')
        .eq('shop_id', FOS.auth.user.id).eq('status', 'delivered').eq('receipt_confirmed', false).limit(1)
    );
    const el = document.getElementById('orderAlerts');
    if (!el) return;
    if (data?.length) {
      const o = data[0];
      el.innerHTML = `<div class="alert alert--warn" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        ⚠️ <strong>${FOS.i18n.t(`前回 #${o.order_no} の受取確認が必要`, `订单 #${o.order_no} 待确认收货`)}</strong>
        <button type="button" class="btn btn--primary btn--sm" style="margin-left:auto" data-receipt="${o.id}">
          📦 ${FOS.i18n.t('受取確認', '确认收货')}
        </button>
      </div>`;
      el.querySelector('[data-receipt]')?.addEventListener('click', () => openReceiptConfirm(o.id));
    } else el.innerHTML = '';
  }

  async function renderShop() {
    FOS.shell.setPageTitle(shopTopbarTitle());
    await loadProducts();
    const main = document.getElementById('appMain');
    const passed = FOS.cutoff.isPassed();
    const cart = getCart();

    main.innerHTML = `
      <div class="order-shop-head">
        <div class="order-notice-bar${FOS.orderSettings.notice ? '' : ' order-notice-bar--empty'}">
          ${FOS.orderSettings.notice
            ? `<span class="order-notice-bar__text">${FOS.fmt.escapeHtml(FOS.orderSettings.notice)}</span>`
            : `<span class="order-notice-bar__placeholder">${FOS.i18n.t('お知らせはありません', '暂无通知')}</span>`}
        </div>
        <div class="cutoff-strip">
          <div>
            <div style="font-size:12px;color:var(--text-secondary)">${FOS.i18n.t('締め切り時間', '截单时间')}</div>
            <div class="cutoff-strip__time">${FOS.cutoff.time}</div>
          </div>
          <span class="badge ${passed ? 'badge--orange' : 'badge--green'}">
            ${passed ? FOS.i18n.t('明日分', '明日') : FOS.i18n.t('受注中', '接单中')}
          </span>
        </div>
      </div>
      <div id="orderAlerts"></div>
      <div class="order-shop-body">
        <div class="cat-tabs-sticky" id="catTabsSticky">
          <div class="cat-tabs" id="catTabs"></div>
        </div>
        <div class="toolbar">
          <div class="search-bar">
            <input type="search" id="productSearch" placeholder="${FOS.i18n.t('商品を検索', '搜索商品')}" value="${FOS.fmt.escapeHtml(searchTerm)}">
          </div>
          <div class="ext-slot" id="orderToolbarSlot">${FOS.plugins.renderSlot('orderToolbar')}</div>
        </div>
        <div class="order-layout">
          <div class="product-grid" id="productGrid"></div>
          <div class="cart-sticky cart-desktop">
            <div class="card">${cartPanelInner()}</div>
          </div>
        </div>
      </div>
      <button type="button" class="cart-fab" id="cartFab" aria-label="Cart">
        🛒
        ${cartTotalQty(cart) ? `<span class="cart-fab__badge">${cartTotalQty(cart)}</span>` : ''}
      </button>
    `;

    paintCatTabs();
    if (!main.dataset.scrollPinBound) {
      main.dataset.scrollPinBound = '1';
      window.addEventListener('scroll', syncCatTabsPinnedState, { passive: true });
    }
    checkReceiptRequired();
    document.getElementById('productSearch').addEventListener('input', (e) => {
      searchTerm = e.target.value;
      paintProducts();
    });
    document.getElementById('cartFab')?.addEventListener('click', openCartSheet);
    mountCartOverlay();
    initCartFoot('cartFoot', getCart());
    initCartFoot('cartSheetFoot', getCart());
    paintProducts();
    paintAllCarts();
  }

  function cartPanelInner() {
    return `
      <div class="card__head">
        <span class="card__title">🛒 ${FOS.i18n.t('カート', '购物车')}</span>
        <span class="badge badge--blue" id="cartBadge">0</span>
      </div>
      <div class="card__body" id="cartBody"></div>
      <div class="card__body" style="border-top:1px solid var(--border)" id="cartFoot"></div>
    `;
  }

  function taxLabel(rate) {
    const r = Number(rate);
    if (!r) return FOS.i18n.t('非課税', '免税');
    return FOS.i18n.t(`${r}%税額`, `${r}%税额`);
  }

  function cartTaxBreakdown(cart) {
    const byRate = {};
    (cart || []).forEach((item) => {
      const r = Number(item.tax_rate) || 0;
      const lp = item.unit_price * item.qty;
      byRate[r] = (byRate[r] || 0) + Math.round(lp * r / 100);
    });
    const rates = Object.keys(byRate).map(Number).sort((a, b) => a - b);
    if (!rates.length) return [{ rate: 8, amount: 0 }];
    return rates.map((rate) => ({ rate, amount: byRate[rate] }));
  }

  function cartTaxRowsHtml(cart) {
    return cartTaxBreakdown(cart).map(({ rate, amount }) => `
      <div class="totals-row" data-tax-rate="${rate}">
        <span>${taxLabel(rate)}</span>
        <span class="cart-tax-amt">${FOS.fmt.money(amount)}</span>
      </div>`).join('');
  }

  function cartFootHtml(cart, compact) {
    const c = cart || getCart();
    const noteRows = compact ? 1 : 2;
    const noteMargin = compact ? 8 : 12;
    const btnMargin = compact ? 8 : 12;
    return `
      <div class="totals-row"><span>${FOS.i18n.t('小計（税抜）', '小计（不含税）')}</span><span class="cart-sub">¥0</span></div>
      <div class="cart-tax-rows">${cartTaxRowsHtml(c)}</div>
      <div class="totals-row totals-row--grand"><span>${FOS.i18n.t('合計（税込）', '合计（含税）')}</span><span class="cart-total">¥0</span></div>
      <label class="field" style="margin-top:${noteMargin}px">
        <span class="field__label">${FOS.i18n.t('備考', '备注')}</span>
        <textarea class="field__input" id="${compact ? 'orderNoteSheet' : 'orderNote'}" rows="${noteRows}"></textarea>
      </label>
      <button type="button" class="btn btn--primary btn--block btn--lg" style="margin-top:${btnMargin}px" id="submitOrderBtn">
        ${FOS.i18n.t('注文する', '下单')}
      </button>
    `;
  }

  function initCartFoot(footId, cart) {
    const foot = document.getElementById(footId);
    if (foot) foot.innerHTML = cartFootHtml(cart, footId === 'cartSheetFoot');
  }

  function syncTaxRows(cart) {
    document.querySelectorAll('.cart-tax-rows').forEach((el) => {
      el.innerHTML = cartTaxRowsHtml(cart);
    });
  }

  function calcCartTotals(cart) {
    let sub = 0;
    let tax = 0;
    (cart || []).forEach((item) => {
      const lp = item.unit_price * item.qty;
      sub += lp;
      tax += Math.round(lp * (item.tax_rate || 0) / 100);
    });
    return { sub, tax, total: sub + tax };
  }

  function syncCartTotals(cart) {
    const { sub, tax, total } = calcCartTotals(cart);
    document.querySelectorAll('.cart-sub').forEach((el) => { el.textContent = FOS.fmt.money(sub); });
    document.querySelectorAll('.cart-total').forEach((el) => { el.textContent = FOS.fmt.money(total); });
    syncTaxRows(cart);
  }

  function mountCartOverlay() {
    let sheet = document.getElementById('cartSheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'cart-sheet';
      sheet.id = 'cartSheet';
      sheet.innerHTML = `
        <div class="cart-sheet__backdrop" id="cartSheetBackdrop"></div>
        <div class="cart-sheet__panel">
          <div class="cart-sheet__head">
            <strong>🛒 ${FOS.i18n.t('カート', '购物车')}</strong>
            <button type="button" class="btn btn--ghost btn--sm" id="closeCartSheet">✕</button>
          </div>
          <div class="cart-sheet__body" id="cartSheetBody"></div>
          <div class="cart-sheet__foot" id="cartSheetFoot"></div>
        </div>`;
      document.body.appendChild(sheet);
    } else if (sheet.parentElement !== document.body) {
      document.body.appendChild(sheet);
    }
    if (!cartOverlayBound) {
      cartOverlayBound = true;
      sheet.querySelector('#closeCartSheet')?.addEventListener('click', closeCartSheet);
      sheet.querySelector('#cartSheetBackdrop')?.addEventListener('click', closeCartSheet);
      sheet.addEventListener('touchmove', (e) => {
        if (!e.target.closest('.cart-sheet__body')) e.preventDefault();
      }, { passive: false });
    }
  }

  function lockPageScroll() {
    if (cartSheetOpen) return;
    cartSheetOpen = true;
    pageScrollY = window.scrollY;
    document.documentElement.classList.add('fos-scroll-lock');
    document.body.classList.add('fos-scroll-lock');
    document.body.style.top = `-${pageScrollY}px`;
  }

  function unlockPageScroll() {
    if (!cartSheetOpen) return;
    cartSheetOpen = false;
    document.documentElement.classList.remove('fos-scroll-lock');
    document.body.classList.remove('fos-scroll-lock');
    document.body.style.top = '';
    window.scrollTo(0, pageScrollY);
  }

  function openCartSheet() {
    mountCartOverlay();
    document.getElementById('cartSheet')?.classList.add('open');
    lockPageScroll();
    paintAllCarts();
  }

  function closeCartSheet() {
    document.getElementById('cartSheet')?.classList.remove('open');
    unlockPageScroll();
  }

  function getCatTabsPinY() {
    const wrap = document.getElementById('catTabsSticky');
    if (!wrap) return 0;
    const topbar = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'), 10) || 56;
    let y = 0;
    let el = wrap;
    while (el) {
      y += el.offsetTop;
      el = el.offsetParent;
    }
    return Math.max(0, y - topbar);
  }

  function syncCatTabsPinnedState() {
    const wrap = document.getElementById('catTabsSticky');
    if (!wrap) return;
    const topbar = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'), 10) || 56;
    catTabsWasPinned = wrap.getBoundingClientRect().top <= topbar + 2;
  }

  function ensureCatTabsPinned(smooth) {
    const pinY = getCatTabsPinY();
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const shouldPin = catTabsWasPinned || window.scrollY >= pinY - 2;
    const target = Math.min(pinY, maxScroll);

    if (!shouldPin) {
      if (window.scrollY < pinY - 2) {
        window.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
      }
      return;
    }

    if (Math.abs(window.scrollY - target) > 1) {
      window.scrollTo({ top: target, behavior: 'auto' });
    }
    catTabsWasPinned = true;
  }

  function scrollActiveCatTab(smooth) {
    const el = document.getElementById('catTabs');
    const active = el?.querySelector('.cat-tab--active');
    if (!el || !active) return;
    const targetLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    el.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: smooth === false ? 'auto' : 'smooth',
    });
  }

  function paintCatTabs(scrollCenter) {
    const cats = FOS.categories.get(allProducts);
    const el = document.getElementById('catTabs');
    if (!el) return;
    el.innerHTML = [
      `<button type="button" class="cat-tab ${!catFilter ? 'cat-tab--active' : ''}" data-cat="">${FOS.i18n.t('全て', '全部')}</button>`,
      ...cats.map((c) => `<button type="button" class="cat-tab ${catFilter === c ? 'cat-tab--active' : ''}" data-cat="${FOS.fmt.escapeHtml(c)}">${FOS.fmt.escapeHtml(c)}</button>`),
    ].join('');
    el.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        syncCatTabsPinnedState();
        const pinIntent = catTabsWasPinned || window.scrollY >= getCatTabsPinY() - 4;
        catFilter = btn.dataset.cat || '';
        paintCatTabs(true);
        paintProducts();
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (pinIntent) catTabsWasPinned = true;
            ensureCatTabsPinned(false);
            scrollActiveCatTab(true);
          });
        });
      });
    });
    if (scrollCenter) {
      requestAnimationFrame(() => scrollActiveCatTab(true));
    }
  }

  function paintProducts() {
    const q = searchTerm.toLowerCase();
    const list = allProducts.filter((p) => {
      const m = p.name.toLowerCase().includes(q) || (p.name_zh || '').includes(q) || (p.spec || '').toLowerCase().includes(q);
      const catOk = !catFilter || FOS.categories.matches(p.category, catFilter, '');
      return m && catOk && p.active;
    });
    paintProductGrid(document.getElementById('productGrid'), list);
  }

  function getCartFlyTarget() {
    if (window.innerWidth <= 1023) return document.getElementById('cartFab');
    return document.querySelector('.cart-sticky .card__title') || document.getElementById('cartBadge');
  }

  function pulseCartTarget() {
    const mobile = window.innerWidth <= 1023;
    const el = mobile ? document.getElementById('cartFab') : document.querySelector('.cart-sticky');
    if (!el) return;
    el.classList.remove(mobile ? 'cart-fab--pulse' : 'cart-sticky--pulse');
    void el.offsetWidth;
    el.classList.add(mobile ? 'cart-fab--pulse' : 'cart-sticky--pulse');
    setTimeout(() => el.classList.remove(mobile ? 'cart-fab--pulse' : 'cart-sticky--pulse'), 400);
  }

  function flyToCart(tileEl, p) {
    const media = tileEl?.querySelector('.product-tile__media');
    const target = getCartFlyTarget();
    if (!media || !target) return;
    const from = media.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const startSize = Math.min(from.width, from.height, 112);
    const endScale = 0.16;
    const fly = document.createElement('div');
    fly.className = 'cart-fly';
    const imgSrc = media.querySelector('.product-tile__img')?.src || p.image_url || '';
    if (imgSrc) {
      const imgEl = document.createElement('img');
      imgEl.src = imgSrc;
      imgEl.alt = '';
      fly.appendChild(imgEl);
    } else {
      const emoji = document.createElement('span');
      emoji.className = 'cart-fly__emoji';
      emoji.textContent = p.emoji || '📦';
      fly.appendChild(emoji);
    }
    const startX = from.left + from.width / 2 - startSize / 2;
    const startY = from.top + from.height / 2 - startSize / 2;
    const endX = to.left + to.width / 2;
    const endY = to.top + to.height / 2;
    fly.style.width = `${startSize}px`;
    fly.style.height = `${startSize}px`;
    fly.style.left = `${startX}px`;
    fly.style.top = `${startY}px`;
    document.body.appendChild(fly);
    const dx = endX - (startX + startSize / 2);
    const dy = endY - (startY + startSize / 2);
    const anim = fly.animate([
      { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.42}px, ${dy * 0.22}px) scale(0.72) rotate(200deg)`, opacity: 0.95, offset: 0.38 },
      { transform: `translate(${dx * 0.78}px, ${dy * 0.62}px) scale(0.42) rotate(420deg)`, opacity: 0.75, offset: 0.72 },
      { transform: `translate(${dx}px, ${dy}px) scale(${endScale}) rotate(720deg)`, opacity: 0 },
    ], { duration: 920, easing: 'cubic-bezier(0.18, 0.72, 0.12, 1)', fill: 'forwards' });
    anim.onfinish = () => {
      fly.remove();
      pulseCartTarget();
    };
  }

  function addToCart(pid, tileEl) {
    const p = allProducts.find((x) => String(x.id) === String(pid));
    if (!p || p.stock <= 0) {
      FOS.ui.toast(FOS.i18n.t('在庫不足', '售罄'), 'error');
      return;
    }
    let cart = getCart();
    const idx = cart.findIndex((c) => String(c.product_id) === String(pid));
    const item = {
      product_id: p.id, qty: 1,
      product_name: p.name, product_name_zh: p.name_zh || '',
      product_spec: p.spec, product_emoji: p.emoji || '📦',
      unit_price: p.price, tax_rate: p.tax_rate,
    };
    if (idx >= 0) {
      if (cart[idx].qty >= p.stock) { FOS.ui.toast(FOS.i18n.t('在庫不足', '库存不足'), 'error'); return; }
      cart[idx].qty += 1;
    } else cart.push(item);
    if (tileEl) flyToCart(tileEl, p);
    setCart(cart);
    repaintProductViews();
    const qtyEl = document.querySelector(`.product-tile[data-pid="${pid}"] .product-tile__qty`);
    qtyEl?.classList.add('product-tile__qty--pop');
    paintAllCarts();
    FOS.shell.updateNavBadge('shop', String(cartTotalQty(cart)));
    updateFabBadge();
  }

  function updateFabBadge() {
    const cart = getCart();
    const total = cartTotalQty(cart);
    const fab = document.getElementById('cartFab');
    if (!fab) return;
    let b = fab.querySelector('.cart-fab__badge');
    if (!total) { b?.remove(); return; }
    if (!b) { b = document.createElement('span'); b.className = 'cart-fab__badge'; fab.appendChild(b); }
    b.textContent = total;
  }

  function paintAllCarts() {
    const cart = getCart();
    initCartFoot('cartFoot', cart);
    initCartFoot('cartSheetFoot', cart);
    paintCartInto('cartBody', 'cartBadge');
    paintCartInto('cartSheetBody', null);
    syncCartTotals(cart);
  }

  function paintCartInto(bodyId, badgeId) {
    const cart = getCart();
    const body = document.getElementById(bodyId);
    if (!body) return;
    if (!cart.length) {
      body.innerHTML = FOS.ui.empty('🛒', FOS.i18n.t('カートは空', '购物车为空'));
      if (badgeId) { const b = document.getElementById(badgeId); if (b) b.textContent = '0'; }
      return;
    }
    body.innerHTML = cart.map((item) => {
      const lp = item.unit_price * item.qty;
      return `
        <div class="cart-line">
          <div class="cart-line__info">
            <div class="cart-line__name">${FOS.fmt.escapeHtml(item.product_name)}</div>
            <div class="cart-line__sub">${FOS.fmt.escapeHtml(item.product_spec)}</div>
          </div>
          <div class="qty-stepper">
            <button type="button" data-act="dec" data-pid="${item.product_id}">−</button>
            <button type="button" class="qty-stepper__value" data-qty-pid="${item.product_id}" aria-label="${FOS.i18n.t('数量入力', '输入数量')}">${item.qty}</button>
            <button type="button" data-act="inc" data-pid="${item.product_id}">＋</button>
          </div>
          <div class="cart-line__price">${FOS.fmt.money(lp)}</div>
        </div>`;
    }).join('');
    if (badgeId) { const b = document.getElementById(badgeId); if (b) b.textContent = String(cartTotalQty(cart)); }
    body.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => changeQty(btn.dataset.pid, btn.dataset.act));
    });
    body.querySelectorAll('[data-qty-pid]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openQtyKeypad(btn.dataset.qtyPid);
      });
    });
  }

  function refreshCartUI() {
    const c = getCart();
    repaintProductViews();
    paintAllCarts();
    updateFabBadge();
    FOS.shell.updateNavBadge('shop', cartTotalQty(c) ? String(cartTotalQty(c)) : '');
  }

  function setCartItemQty(pid, qty) {
    const c = getCart();
    const i = c.findIndex((x) => String(x.product_id) === String(pid));
    if (i < 0) return false;
    const p = allProducts.find((x) => String(x.id) === String(pid));
    if (qty <= 0) {
      c.splice(i, 1);
    } else {
      if (p && qty > p.stock) {
        FOS.ui.toast(FOS.i18n.t('在庫不足', '库存不足'), 'error');
        return false;
      }
      c[i].qty = qty;
    }
    setCart(c);
    refreshCartUI();
    return true;
  }

  function changeQty(pid, act) {
    const c = getCart();
    const i = c.findIndex((x) => String(x.product_id) === String(pid));
    if (i < 0) return;
    const p = allProducts.find((x) => String(x.id) === String(pid));
    if (act === 'inc') {
      if (p && c[i].qty >= p.stock) { FOS.ui.toast(FOS.i18n.t('在庫不足', '库存不足'), 'error'); return; }
      setCartItemQty(pid, c[i].qty + 1);
    } else {
      setCartItemQty(pid, c[i].qty - 1);
    }
  }

  function openQtyKeypad(pid) {
    const c = getCart();
    const i = c.findIndex((x) => String(x.product_id) === String(pid));
    if (i < 0) return;
    const item = c[i];
    const p = allProducts.find((x) => String(x.id) === String(pid));
    const maxStock = p?.stock ?? 9999;
    let input = String(item.qty);

    FOS.ui.openModal({
      title: item.product_name,
      bodyHtml: `
        <div class="qty-keypad">
          <div class="qty-keypad__hint">${FOS.i18n.t('在庫', '库存')} <strong>${maxStock}</strong></div>
          <div class="qty-keypad__display" id="qtyKeypadDisplay">${item.qty}</div>
          <div class="qty-keypad__grid">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" class="qty-keypad__key" data-key="${n}">${n}</button>`).join('')}
            <button type="button" class="qty-keypad__key qty-keypad__key--fn" data-key="clear">${FOS.i18n.t('クリア', '清空')}</button>
            <button type="button" class="qty-keypad__key" data-key="0">0</button>
            <button type="button" class="qty-keypad__key qty-keypad__key--fn" data-key="back">⌫</button>
          </div>
          <div class="qty-keypad__actions">
            <button type="button" class="btn btn--secondary btn--block" data-modal-close>${FOS.i18n.t('取消', '取消')}</button>
            <button type="button" class="btn btn--primary btn--block" id="qtyKeypadConfirm">${FOS.i18n.t('確定', '确定')}</button>
          </div>
        </div>`,
    });

    const modal = document.getElementById('fosModal');
    const display = document.getElementById('qtyKeypadDisplay');
    const updateDisplay = () => { if (display) display.textContent = input || '0'; };

    modal?.querySelectorAll('.qty-keypad__key').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (key === 'clear') {
          input = '';
        } else if (key === 'back') {
          input = input.slice(0, -1);
        } else {
          const next = (input === '0' ? '' : input) + key;
          if (next.length > 4) return;
          const num = parseInt(next, 10);
          input = String(Math.min(num, maxStock));
        }
        updateDisplay();
      });
    });

    document.getElementById('qtyKeypadConfirm')?.addEventListener('click', () => {
      const qty = parseInt(input, 10) || 0;
      if (setCartItemQty(pid, qty)) FOS.ui.closeModal();
    });
  }

  async function submitOrder() {
    const c = getCart();
    if (!c.length) { FOS.ui.toast(FOS.i18n.t('カートが空', '购物车为空'), 'error'); return; }
    try {
      await FOS.merchants.assertCanOrder();
    } catch (err) {
      FOS.ui.toast(err.message, 'error');
      return;
    }
    const { data: unconf } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('orders').select('id').eq('shop_id', FOS.auth.user.id)
        .eq('status', 'delivered').eq('receipt_confirmed', false).limit(1)
    );
    if (unconf?.length) { FOS.ui.toast(FOS.i18n.t('受取確認が必要', '请先确认收货'), 'error'); return; }

    FOS.ui.showLoading(FOS.i18n.t('送信中...', '提交中...'));
    const oDate = FOS.cutoff.getOrderDate();
    const sheetOpen = document.getElementById('cartSheet')?.classList.contains('open');
    const note = (sheetOpen ? document.getElementById('orderNoteSheet') : document.getElementById('orderNote'))?.value?.trim() || '';

    try {
      const existing = await FOS.orders.findOpenOrder(FOS.auth.user.id, oDate);

      const confirmOrder = (orderId) => async () => {
        await FOS.orders.confirmShopSubmission(orderId);
      };

      if (existing) {
        const orderId = existing.id;
        await FOS.orders.markShopUnconfirmed(orderId);
        if (note) {
          const { data: ex } = await FOS.merchants.scopeFilter(
            FOS.db.sb.from('orders').select('note').eq('id', orderId)
          ).single();
          await FOS.merchants.scopeFilter(
            FOS.db.sb.from('orders').update({ note: [ex?.note, note].filter(Boolean).join('\n'), updated_at: new Date().toISOString() }).eq('id', orderId)
          );
        }
        await FOS.orders.appendItems(orderId, c);
        await FOS.orders.deductStock(c, allProducts);
        const t = await FOS.orders.recalc(orderId);
        FOS.ui.showOrderSuccess({ orderNo: existing.order_no, total: t.total, merged: true, onConfirm: confirmOrder(orderId) });
      } else {
        const { data: newOrder, error } = await FOS.db.sb.from('orders')
          .insert({
            shop_id: FOS.auth.user.id,
            shop_name: FOS.auth.user.name,
            order_date: oDate,
            note,
            merchant_id: FOS.merchants.scopeId(),
          }).select().single();
        if (error) throw error;
        await FOS.db.sb.from('order_items').insert(c.map((item) => ({ order_id: newOrder.id, ...FOS.orders.itemPayload(item) })));
        await FOS.orders.deductStock(c, allProducts);
        const t = await FOS.orders.recalc(newOrder.id);
        FOS.ui.showOrderSuccess({ orderNo: newOrder.order_no, total: t.total, onConfirm: confirmOrder(newOrder.id) });
      }
      setCart([]);
      closeCartSheet();
      await renderShop();
    } catch (e) {
      FOS.ui.toast(e.message, 'error');
    } finally {
      FOS.ui.hideLoading();
    }
  }

  async function renderHistory() {
    FOS.shell.setPageTitle(FOS.i18n.t('注文履歴', '订单'));
    FOS.ui.showLoading();
    const { data: orders } = await FOS.merchants.scopeFilter(
      FOS.db.sb.from('orders').select('*, order_items(*)')
        .eq('shop_id', FOS.auth.user.id).order('created_at', { ascending: false })
    );
    FOS.ui.hideLoading();

    const main = document.getElementById('appMain');
    const months = [...new Set((orders || []).map((o) => o.order_date.slice(0, 7)))].sort().reverse();
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (historyMonth === null) {
      historyMonth = months.includes(currentMonth) ? currentMonth : (months[0] || currentMonth);
    }
    const filtered = historyMonth
      ? (orders || []).filter((o) => o.order_date.startsWith(historyMonth))
      : (orders || []);

    let summaryHtml = '';
    if (historyMonth && filtered.length) {
      const grouped = FOS.orders.mergeByDate(filtered);
      const total = filtered.reduce((a, o) => a + (o.total || 0), 0);
      const confirmed = filtered.filter((o) => o.receipt_confirmed).reduce((a, o) => a + (o.total || 0), 0);
      summaryHtml = `<div class="stat-grid stat-grid--history-inline">
        <div class="stat-card"><div class="stat-card__label">${FOS.i18n.t('件数', '笔数')}</div><div class="stat-card__value">${grouped.length}</div></div>
        <div class="stat-card"><div class="stat-card__label">${FOS.i18n.t('合計', '合计')}</div><div class="stat-card__value">${FOS.fmt.money(total)}</div></div>
        <div class="stat-card"><div class="stat-card__label">${FOS.i18n.t('確認済', '已确认')}</div><div class="stat-card__value" style="color:var(--success)">${FOS.fmt.money(confirmed)}</div></div>
      </div>`;
    }

    main.innerHTML = `
      <div class="history-page-head">
        <div class="history-page-head__row">
          <h1 class="page-header__title">${FOS.i18n.t('注文履歴', '订单')}</h1>
          <select class="filter-select history-month-select" id="historyMonthFilter">
            <option value="">${FOS.i18n.t('全期間', '全部')}</option>
            ${months.map((m) => `<option value="${m}" ${historyMonth === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <p class="page-header__desc">${FOS.i18n.t('過去の注文を確認', '查看历史订单')}</p>
      </div>
      ${summaryHtml}
      <div id="historyList"></div>
    `;

    document.getElementById('historyMonthFilter').addEventListener('change', (e) => {
      historyMonth = e.target.value;
      renderHistory();
    });
    paintHistoryList(filtered);

    FOS.realtime.watchShopOrders(FOS.auth.user.id, () => {
      if (currentView !== 'history') return;
      FOS.realtime.scheduleShopOrdersRefresh(async () => {
        if (currentView !== 'history') return;
        const { data: freshOrders } = await FOS.merchants.scopeFilter(
          FOS.db.sb.from('orders').select('*, order_items(*)')
            .eq('shop_id', FOS.auth.user.id).order('created_at', { ascending: false })
        );
        const freshFiltered = historyMonth
          ? (freshOrders || []).filter((o) => o.order_date.startsWith(historyMonth))
          : (freshOrders || []);
        paintHistoryList(freshFiltered);
      });
    });
  }

  function groupHistoryMetaHtml(group) {
    const orders = group.orders || [];
    const needReceipt = orders.filter((o) => o.status === 'delivered' && !o.receipt_confirmed);
    if (needReceipt.length) {
      return `<button type="button" class="btn btn--primary btn--sm" data-receipt="${needReceipt[0].id}">${FOS.i18n.t('受取確認', '确认收货')}</button>`;
    }
    if (orders.length && orders.every((o) => o.receipt_confirmed)) {
      return `<span class="badge badge--green">✓ ${FOS.i18n.t('受取済', '已收货')}</span>`;
    }
    const status = group.primaryOrder?.status || orders[0]?.status;
    if (!status) return '';
    const st = FOS.fmt.status(status);
    return `<span class="badge badge--${st.color}">${st.label}</span>`;
  }

  function paintHistoryList(list) {
    const el = document.getElementById('historyList');
    if (!list.length) {
      el.innerHTML = FOS.ui.empty('📋', FOS.i18n.t('注文なし', '暂无订单'));
      return;
    }
    const groups = FOS.orders.mergeByDate(list);
    el.innerHTML = groups.map((group, idx) => {
      const panelId = `oh_${idx}`;
      const primaryNo = group.primaryOrder?.order_no || group.orders[0]?.order_no;
      const metaHtml = groupHistoryMetaHtml(group);
      const notes = [...new Set(group.orders.map((o) => o.note).filter(Boolean))];
      const notesHtml = notes.length
        ? notes.map((n) => `<div class="alert alert--info">${FOS.fmt.escapeHtml(n)}</div>`).join('')
        : '';
      return `
        <div class="order-card">
          <div class="order-card__head" data-toggle="${panelId}">
            <strong>#${primaryNo}</strong>
            <span class="order-card__date">${group.order_date}</span>
            <span class="order-card__statuses">${metaHtml}</span>
            <span class="order-card__amount">${FOS.fmt.money(group.total)}</span>
          </div>
          <div class="order-card__body" id="${panelId}">
            ${notesHtml}
            ${FOS.orders.itemsTableHtml(group.items, { hideEmoji: true })}
            <div class="order-card__totals">
              ${FOS.i18n.t('小計', '小计')} ${FOS.fmt.money(group.subtotal)} + ${FOS.i18n.t('税', '税')} ${FOS.fmt.money(group.tax_total)}
              = <strong>${FOS.fmt.money(group.total)}</strong>
            </div>
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('[data-toggle]').forEach((h) => {
      h.addEventListener('click', (e) => {
        if (e.target.closest('[data-receipt]')) return;
        document.getElementById(h.dataset.toggle)?.classList.toggle('open');
      });
    });
    el.querySelectorAll('[data-receipt]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openReceiptConfirm(btn.dataset.receipt);
      });
    });
    el.querySelectorAll('[data-hist-check]').forEach((box) => {
      box.addEventListener('click', (e) => {
        e.stopPropagation();
        box.classList.toggle('check-box--on');
        box.textContent = box.classList.contains('check-box--on') ? '✓' : '';
        const row = box.closest('.order-detail-row');
        if (row) row.style.opacity = box.classList.contains('check-box--on') ? '0.55' : '1';
      });
    });
  }

  function syncReceiptItemUI(id, checked) {
    receiptChecked[id] = !!checked;
    const row = document.querySelector(`[data-rc-item="${id}"]`);
    const box = document.querySelector(`[data-rc-box="${id}"]`);
    if (row) row.classList.toggle('receipt-item--checked', !!checked);
    if (box) {
      box.classList.toggle('check-box--on', !!checked);
      box.textContent = checked ? '✓' : '';
    }
  }

  function updateReceiptSelectAllBtn(items) {
    const btn = document.getElementById('receiptSelectAllBtn');
    if (!btn || !items.length) return;
    const allChecked = items.every((i) => receiptChecked[i.id]);
    btn.textContent = allChecked
      ? FOS.i18n.t('全解除', '取消全选')
      : FOS.i18n.t('すべて選択', '全选');
  }

  async function openReceiptConfirm(orderId) {
    const order = await FOS.orders.fetchOne(orderId);
    if (!order) return;
    receiptChecked = {};

    const itemsHtml = (order.order_items || []).map((item) => {
      const specInline = item.product_spec
        ? `<span class="receipt-item__spec">(${FOS.fmt.escapeHtml(item.product_spec)})</span>`
        : '';
      const adminCls = FOS.orders.adminEditRowClass(item);
      const shortageCls = FOS.orders.shortageRowClass(item);
      const delivered = FOS.orders.deliveredQty(item);
      const qtyHint = FOS.orders.shortageQty(item) > 0 && delivered < item.qty
        ? `<span class="receipt-item__delivered">${FOS.i18n.t('実発', '实发')}${delivered}</span>`
        : '';
      return `
      <div class="receipt-item${adminCls ? ` ${adminCls}` : ''}${shortageCls ? ` ${shortageCls}` : ''}" data-rc-item="${item.id}">
        <div class="check-box" data-rc-box="${item.id}"></div>
        <div class="receipt-item__info">
          <span class="receipt-item__name">${FOS.fmt.escapeHtml(item.product_name)}</span>${specInline}
          ${FOS.orders.adminEditBadge(item)}${FOS.orders.shortageBadge(item)}
        </div>
        <strong>×${item.qty}</strong>${qtyHint}
      </div>`;
    }).join('');

    FOS.ui.openModal({
      title: `📦 ${FOS.i18n.t('受取確認', '确认收货')} #${order.order_no}`,
      bodyHtml: `
        <div class="receipt-toolbar">
          <div class="alert alert--info receipt-toolbar__hint">${FOS.i18n.t('商品を一つずつ確認してください', '请逐一核对商品')}</div>
          <button type="button" class="btn btn--secondary btn--sm" id="receiptSelectAllBtn">${FOS.i18n.t('すべて選択', '全选')}</button>
        </div>
        <div class="receipt-list">${itemsHtml}</div>
        <div class="field">
          <span class="field__label">🖊️ ${FOS.i18n.t('サイン', '签名')}</span>
          <canvas class="sig-canvas" id="sigCanvas" width="460" height="120"></canvas>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button type="button" class="btn btn--secondary" data-modal-close>${FOS.i18n.t('取消', '取消')}</button>
          <button type="button" class="btn btn--success btn--lg" id="completeReceiptBtn">✅ ${FOS.i18n.t('受取完了', '确认收货')}</button>
        </div>`,
    });

    const items = order.order_items || [];

    document.querySelectorAll('[data-rc-item]').forEach((row) => {
      row.addEventListener('click', () => {
        const id = row.dataset.rcItem;
        syncReceiptItemUI(id, !receiptChecked[id]);
        updateReceiptSelectAllBtn(items);
      });
    });

    document.getElementById('receiptSelectAllBtn')?.addEventListener('click', () => {
      const allChecked = items.every((i) => receiptChecked[i.id]);
      const next = !allChecked;
      items.forEach((i) => syncReceiptItemUI(i.id, next));
      updateReceiptSelectAllBtn(items);
    });

    initSigCanvas();
    document.getElementById('completeReceiptBtn')?.addEventListener('click', async () => {
      const allChecked = items.every((i) => receiptChecked[i.id]);
      if (!allChecked) {
        FOS.ui.toast(FOS.i18n.t('全商品を確認してください', '请确认全部商品'), 'error');
        return;
      }
      FOS.ui.showLoading();
      try {
        await FOS.orders.confirmReceipt(orderId);
        FOS.ui.closeModal();
        FOS.ui.toast(FOS.i18n.t('受取確認完了', '收货确认完成'), 'success');
        if (currentView === 'history') renderHistory();
        else { await renderShop(); checkReceiptRequired(); }
      } catch (e) {
        FOS.ui.toast(e.message, 'error');
      } finally {
        FOS.ui.hideLoading();
      }
    });
  }

  let sigCtx, sigDrawing;
  function initSigCanvas() {
    const canvas = document.getElementById('sigCanvas');
    if (!canvas) return;
    sigCtx = canvas.getContext('2d');
    sigCtx.strokeStyle = '#1a1a1a';
    sigCtx.lineWidth = 2;
    sigCtx.lineCap = 'round';
    const getPos = (e) => {
      const r = canvas.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      return { x: (src.clientX - r.left) * (canvas.width / r.width), y: (src.clientY - r.top) * (canvas.height / r.height) };
    };
    const down = (e) => { sigDrawing = true; const p = getPos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); };
    const move = (e) => { if (!sigDrawing) return; const p = getPos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); };
    const up = () => { sigDrawing = false; };
    canvas.onmousedown = down;
    canvas.onmousemove = move;
    canvas.onmouseup = up;
    canvas.ontouchstart = (e) => { e.preventDefault(); down(e); };
    canvas.ontouchmove = (e) => { e.preventDefault(); move(e); };
    canvas.ontouchend = up;
  }

  boot();
})();
