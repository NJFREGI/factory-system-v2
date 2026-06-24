/**
 * 统一扫码订货 H5（散客 + 店铺月结）
 */
(function () {
  FOS.APP_ID = 'customer-order';

  let ctx = null;
  let allProducts = [];
  let catFilter = '';
  let searchTerm = '';
  let cart = [];
  let lastOrderCode = '';
  let deliveryDateMode = 'today';
  let deliveryCustomDate = '';
  let deliverySlot = 'unspecified';
  let orderMode = null;
  let shopSession = null;
  let customerSession = null;
  let entrySettlement = null;
  let urlParams = null;
  let authTab = 'login';
  let shopView = 'catalog';

  const CART_KEY = () => {
    if (orderMode === 'shop' && shopSession?.id) {
      return `shop_cart_${ctx?.channel?.id || 'x'}_${shopSession.id}`;
    }
    if (orderMode === 'customer' && customerSession?.phone) {
      return `customer_cart_${ctx?.channel?.id || 'x'}_${customerSession.phone}`;
    }
    return `public_cart_${ctx?.channel?.id || 'x'}`;
  };

  function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function todayStr() { return FOS.fmt.today(); }
  function tomorrowStr() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return localDateStr(d);
  }
  function dayAfterStr() {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return localDateStr(d);
  }

  function resolvedDeliveryDate() {
    if (deliveryDateMode === 'today') return todayStr();
    if (deliveryDateMode === 'tomorrow') return tomorrowStr();
    if (deliveryDateMode === 'dayafter') return dayAfterStr();
    return deliveryCustomDate || null;
  }

  function setCustomerMerchantIdSafe(merchantId) {
    const id = String(merchantId || '').trim();
    if (!id || !FOS.payment) return;
    if (typeof FOS.payment.setCustomerMerchantId === 'function') {
      FOS.payment.setCustomerMerchantId(id);
    } else {
      FOS.payment._customerMerchantId = id;
    }
  }

  async function boot() {
    FOS.wechatH5?.init?.();
    FOS.i18n.init();
    FOS.theme.init();
    if (typeof supabase === 'undefined') {
      return renderError(FOS.i18n.t('ライブラリの読み込みに失敗しました。ページを再読み込みしてください', '页面组件加载失败，请刷新重试'));
    }
    const params = FOS.publicOrder.parseFromLocation();
    urlParams = params;
    entrySettlement = params.settlement || null;
    if (params.view === 'lookup') {
      try {
        await FOS.db.init();
        if (params.merchantId) {
          customerSession = FOS.publicOrder.loadCustomerSession(params.merchantId);
          if (customerSession?.phone && params.channelId) {
            ctx = await FOS.publicOrder.getContext(params.channelId);
            orderMode = 'customer';
            return renderCustomerOrders();
          }
        }
      } catch { /* fall through to manual lookup */ }
      return renderLookup();
    }
    if (params.view === 'success') {
      const code = new URLSearchParams(location.search).get('code') || '';
      try {
        await FOS.db.init();
        if (params.channelId) ctx = await FOS.publicOrder.getContext(params.channelId);
      } catch { /* optional context for continue shopping link */ }
      return renderSuccess(code);
    }
    if (!params.channelId) {
      return renderError(FOS.i18n.t(
        'QRコードが無効です。リンクに channel パラメータがあるか確認してください',
        '二维码无效，请确认链接包含 channel 参数后重新扫码'
      ));
    }
    try {
      await FOS.db.init();
      FOS.ui.showLoading();
      ctx = await FOS.publicOrder.getContext(params.channelId);
      allProducts = ctx.products || [];
      setCustomerMerchantIdSafe(ctx.merchant?.id || params.merchantId);
      if (!entrySettlement) entrySettlement = 'cash';

      shopSession = FOS.publicOrder.loadShopSession(ctx.merchant.id, ctx.channel.id);
      customerSession = FOS.publicOrder.loadCustomerSession(ctx.merchant.id);

      if (entrySettlement === 'cash') {
        FOS.publicOrder.clearShopSession(ctx.merchant.id, ctx.channel.id);
        shopSession = null;
        if (customerSession?.phone) {
          orderMode = 'customer';
          cart = FOS.storage.get(CART_KEY()) || [];
          FOS.ui.hideLoading();
          if (!allProducts.length) {
            renderShop();
            FOS.ui.toast(FOS.i18n.t('商品がありません', '暂无可购商品'), 'warn');
            return;
          }
          renderShop();
          return;
        }
        FOS.ui.hideLoading();
        renderCustomerAuth();
        return;
      }

      if (shopSession?.id && entrySettlement === 'monthly') {
        const sessionSettlement = FOS.payment.resolveShopSettlement(shopSession);
        if (sessionSettlement !== 'monthly') {
          FOS.publicOrder.clearShopSession(ctx.merchant.id, ctx.channel.id);
          shopSession = null;
        }
      }
      if (shopSession?.id) {
        orderMode = 'shop';
        cart = FOS.storage.get(CART_KEY()) || [];
        FOS.ui.hideLoading();
        if (!allProducts.length) {
          renderShop();
          FOS.ui.toast(FOS.i18n.t('商品がありません', '暂无可购商品'), 'warn');
          return;
        }
        renderShop();
        return;
      }
      FOS.ui.hideLoading();
      if (FOS.publicOrder.isShopLoginUrl(params)) {
        renderShopLogin({ settlement: 'monthly', forced: true, shopId: params.shopId });
        return;
      }
      renderCustomerAuth();
    } catch (e) {
      FOS.ui.hideLoading();
      renderError(FOS.publicOrder.mapRpcError(e));
    }
  }

  function renderShell(bodyHtml, { headerMode = 'merchant' } = {}) {
    const merchantName = ctx?.merchant?.name || '';
    const brandHtml = merchantName
      ? `<div class="customer-order__title customer-order__title--merchant">${FOS.fmt.escapeHtml(merchantName)}</div>`
      : `<div class="customer-order__title">${FOS.i18n.t('オンライン注文', '在线下单')}</div>`;
    document.getElementById('app').innerHTML = `
      <div class="customer-order">
        <header class="customer-order__header">
          <div class="customer-order__brand">${brandHtml}</div>
        </header>
        <main class="customer-order__main" id="appMain">${bodyHtml}</main>
      </div>`;
  }

  function renderError(msg) {
    let lookupHref = '#';
    let retryHref = location.pathname + location.search;
    try {
      const retryUrl = new URL(location.href);
      retryUrl.searchParams.delete('view');
      retryUrl.searchParams.delete('code');
      retryHref = retryUrl.pathname + retryUrl.search + retryUrl.hash;
    } catch { /* use location fallback */ }
    try {
      lookupHref = FOS.publicOrder.buildLookupUrl();
    } catch {
      const base = FOS.config?.publicAppBaseUrl?.()
        || FOS.publicOrder.resolvePublicH5Base?.()
        || String(FOS.CONFIG?.PUBLIC_APP_BASE_URL || FOS.CONFIG?.public_h5_base_url || '').replace(/\/+$/, '');
      if (base) lookupHref = `${base}/apps/customer-order/?view=lookup`;
    }
    document.getElementById('app').innerHTML = `
      <div class="customer-order customer-order--center">
        <div class="customer-order__error">
          <div style="font-size:40px">⚠️</div>
          <p>${FOS.fmt.escapeHtml(msg)}</p>
          <div class="customer-order__error-actions">
            <a class="btn btn--primary" href="${FOS.fmt.escapeHtml(retryHref)}">${FOS.i18n.t('注文ページへ', '进入下单')}</a>
            <a class="btn btn--secondary" href="${FOS.fmt.escapeHtml(lookupHref)}">${FOS.i18n.t('注文照会', '订单查询')}</a>
          </div>
        </div>
      </div>`;
  }

  function renderEntry() {
    renderShell(`
      <div class="customer-order__entry">
        <p class="customer-order__entry-hint">${FOS.i18n.t('注文方法を選択してください', '请选择下单方式')}</p>
        <button type="button" class="btn btn--primary btn--block btn--lg" id="entryGuestBtn">${FOS.i18n.t('散客で注文', '散客下单')}</button>
        <button type="button" class="btn btn--secondary btn--block btn--lg" id="entryShopBtn">${FOS.i18n.t('店舗ログインで注文', '店铺登录下单')}</button>
      </div>`);
    document.getElementById('entryGuestBtn')?.addEventListener('click', () => {
      orderMode = 'guest';
      cart = FOS.storage.get(CART_KEY()) || [];
      renderShop();
    });
    document.getElementById('entryShopBtn')?.addEventListener('click', () => renderShopLogin());
  }

  function renderCustomerAuth() {
    authTab = authTab || 'login';
    const isLogin = authTab === 'login';
    renderShell(`
      <div class="customer-order__shop-login customer-auth-panel">
        <p class="customer-auth-panel__hint">${FOS.i18n.t('電話番号とパスワードでログインまたは新規登録', '使用手机号和密码登录或注册')}</p>
        <div class="customer-auth-tabs">
          <button type="button" class="customer-auth-tabs__btn ${isLogin ? 'active' : ''}" data-auth-tab="login">${FOS.i18n.t('ログイン', '登录')}</button>
          <button type="button" class="customer-auth-tabs__btn ${!isLogin ? 'active' : ''}" data-auth-tab="register">${FOS.i18n.t('新規登録', '注册')}</button>
        </div>
        <div class="customer-auth-form">
          <label class="field"><span class="field__label">${FOS.i18n.t('電話番号', '手机号')}</span>
            <input class="field__input" id="custAuthPhone" type="tel" autocomplete="tel" placeholder="${FOS.i18n.t('例：09012345678', '例：09012345678')}"></label>
          <label class="field"><span class="field__label">${FOS.i18n.t('パスワード', '密码')}</span>
            <input class="field__input" id="custAuthPass" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}"></label>
          ${isLogin ? '' : `
          <label class="field"><span class="field__label">${FOS.i18n.t('パスワード（確認）', '确认密码')}</span>
            <input class="field__input" id="custAuthPass2" type="password" autocomplete="new-password"></label>
          <label class="field"><span class="field__label">${FOS.i18n.t('お名前', '姓名')} <span class="field__opt">${FOS.i18n.t('任意', '选填')}</span></span>
            <input class="field__input" id="custAuthName" autocomplete="name"></label>
          <label class="field"><span class="field__label field__label--req">${FOS.i18n.t('住所', '地址')}</span>
            <input class="field__input" id="custAuthAddress" autocomplete="street-address" required></label>`}
          <button type="button" class="btn btn--primary btn--block" id="custAuthSubmit">
            ${isLogin ? FOS.i18n.t('ログイン', '登录') : FOS.i18n.t('登録', '注册')}
          </button>
        </div>
      </div>`, { headerMode: 'merchant' });

    document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        authTab = btn.dataset.authTab;
        renderCustomerAuth();
      });
    });
    document.getElementById('custAuthSubmit')?.addEventListener('click', () => {
      if (authTab === 'register') submitCustomerRegister();
      else submitCustomerLogin();
    });
  }

  async function submitCustomerLogin() {
    const phone = document.getElementById('custAuthPhone')?.value?.trim();
    const pass = document.getElementById('custAuthPass')?.value?.trim();
    if (!phone || !pass) {
      FOS.ui.toast(FOS.i18n.t('電話番号とパスワードを入力してください', '请输入手机号和密码'), 'error');
      return;
    }
    FOS.ui.showLoading();
    try {
      const data = await FOS.publicOrder.loginCustomer({
        merchantId: ctx.merchant.id,
        phone,
        password: pass,
      });
      FOS.publicOrder.saveCustomerSession(ctx.merchant.id, data);
      customerSession = FOS.publicOrder.loadCustomerSession(ctx.merchant.id);
      orderMode = 'customer';
      cart = FOS.storage.get(CART_KEY()) || [];
      renderShop();
    } catch (e) {
      FOS.ui.toast(FOS.publicOrder.mapRpcError(e), 'error');
    } finally {
      FOS.ui.hideLoading();
    }
  }

  async function submitCustomerRegister() {
    const phone = document.getElementById('custAuthPhone')?.value?.trim();
    const pass = document.getElementById('custAuthPass')?.value?.trim();
    const pass2 = document.getElementById('custAuthPass2')?.value?.trim();
    const name = document.getElementById('custAuthName')?.value?.trim();
    const address = document.getElementById('custAuthAddress')?.value?.trim();
    if (!phone || !pass) {
      FOS.ui.toast(FOS.i18n.t('電話番号とパスワードを入力してください', '请输入手机号和密码'), 'error');
      return;
    }
    if (pass !== pass2) {
      FOS.ui.toast(FOS.i18n.t('パスワードが一致しません', '两次密码不一致'), 'error');
      return;
    }
    if (!address) {
      FOS.ui.toast(FOS.i18n.t('住所を入力してください', '请填写地址'), 'error');
      return;
    }
    FOS.ui.showLoading();
    try {
      const data = await FOS.publicOrder.registerCustomer({
        merchantId: ctx.merchant.id,
        phone,
        password: pass,
        name,
        address,
      });
      FOS.publicOrder.saveCustomerSession(ctx.merchant.id, data);
      customerSession = FOS.publicOrder.loadCustomerSession(ctx.merchant.id);
      orderMode = 'customer';
      cart = FOS.storage.get(CART_KEY()) || [];
      FOS.ui.toast(FOS.i18n.t('登録しました', '注册成功'), 'success');
      renderShop();
    } catch (e) {
      FOS.ui.toast(FOS.publicOrder.mapRpcError(e), 'error');
    } finally {
      FOS.ui.hideLoading();
    }
  }

  function customerDisplayLabel(session) {
    const name = String(session?.name || '').trim();
    if (name) return `${name} 様`;
    const phone = String(session?.phone || '').trim();
    return phone || '—';
  }

  function renderShopLogin({ settlement = 'monthly', forced = false, shopId = '' } = {}) {
    const hint = FOS.i18n.t('月払い店舗アカウントでログインしてください', '请使用月结店铺账号登录');
    const title = FOS.i18n.t('月払いログイン', '月结登录');
    const prefillShop = shopId || urlParams?.shopId || '';
    const qrHint = prefillShop
      ? FOS.i18n.t('QRから店舗を読み込みました。パスワードを入力してください', '已从二维码识别店铺，请输入密码')
      : FOS.i18n.t('管理画面の「ログインID」または店舗IDを入力してください', '请输入管理端显示的「登录账号」');
    renderShell(`
      <div class="customer-order__shop-login customer-auth-form">
        <h2>${title}</h2>
        <p class="field__hint">${hint}</p>
        ${prefillShop ? `<p class="field__hint">${FOS.fmt.escapeHtml(qrHint)}</p>` : `<p class="field__hint">${qrHint}</p>`}
        <label class="field"><span class="field__label">${FOS.i18n.t('店舗ID / 電話番号', '店铺账号 / 手机号')}</span>
          <input class="field__input" id="shopLoginId" autocomplete="username" value="${FOS.fmt.escapeHtml(prefillShop)}" placeholder="${FOS.i18n.t('例：26004 または 09012345678', '例：26004 或 09012345678')}"></label>
        <label class="field"><span class="field__label">${FOS.i18n.t('パスワード', '密码')}</span>
          <input class="field__input" id="shopLoginPass" type="password" autocomplete="current-password"></label>
        <button type="button" class="btn btn--primary btn--block" id="shopLoginSubmit">${FOS.i18n.t('ログイン', '登录')}</button>
        ${forced ? '' : `<button type="button" class="btn btn--ghost btn--block" id="shopLoginBack">${FOS.i18n.t('戻る', '返回')}</button>`}
      </div>`, { headerMode: 'merchant' });
    document.getElementById('shopLoginBack')?.addEventListener('click', () => renderCustomerAuth());
    document.getElementById('shopLoginSubmit')?.addEventListener('click', () => submitShopLogin('monthly'));
  }

  async function findShopUser(login, pass, shopId = '') {
    const merchantId = ctx.merchant.id;
    const base = FOS.db.sb.from('users').select('*')
      .eq('password_hash', pass)
      .eq('role', 'order')
      .eq('active', true)
      .eq('merchant_id', merchantId);
    if (shopId) {
      const { data: byQr } = await base.eq('id', shopId).maybeSingle();
      if (byQr) return byQr;
    }
    const { data: byId } = await base.eq('id', login).maybeSingle();
    if (byId) return byId;
    const phone = login.replace(/\s/g, '');
    if (phone) {
      const { data: byPhone } = await FOS.db.sb.from('users').select('*')
        .eq('password_hash', pass)
        .eq('role', 'order')
        .eq('active', true)
        .eq('merchant_id', merchantId)
        .eq('phone', phone)
        .maybeSingle();
      if (byPhone) return byPhone;
    }
    const { data: byName } = await FOS.db.sb.from('users').select('*')
      .eq('password_hash', pass)
      .eq('role', 'order')
      .eq('active', true)
      .eq('merchant_id', merchantId)
      .eq('name', login)
      .maybeSingle();
    return byName;
  }

  async function loginShopAccount(login, pass, shopId = '') {
    try {
      return await FOS.publicOrder.loginShopChannel({
        merchantId: ctx.merchant.id,
        loginId: login,
        password: pass,
        shopId: shopId || urlParams?.shopId || '',
      });
    } catch (e) {
      const msg = String(e?.message || e?.code || '');
      if (/PGRST202|42883|does not exist|schema cache/i.test(msg)) {
        FOS.ui.toast(FOS.i18n.t(
          '店舗ログイン機能が未設定です。管理者に schema-channel-shop-order.sql の実行を依頼してください',
          '店铺登录功能未配置，请联系管理员在 Supabase 执行 schema-channel-shop-order.sql'
        ), 'error');
        return null;
      }
      if (/shop_channel_login/i.test(msg)) {
        return findShopUser(login, pass, shopId || urlParams?.shopId || '');
      }
      throw e;
    }
  }

  async function submitShopLogin(expectedSettlement) {
    const id = document.getElementById('shopLoginId')?.value?.trim();
    const pass = document.getElementById('shopLoginPass')?.value?.trim();
    const qrShopId = urlParams?.shopId || '';
    if ((!id && !qrShopId) || !pass) {
      FOS.ui.toast(FOS.i18n.t('店舗IDとパスワードを入力してください', '请输入店铺账号和密码'), 'error');
      return;
    }
    FOS.ui.showLoading();
    try {
      const data = await loginShopAccount(id, pass, qrShopId);
      if (!data) {
        FOS.ui.toast(FOS.i18n.t('店舗IDまたはパスワードが違います', '店铺账号或密码错误'), 'error');
        return;
      }
      const settlement = FOS.payment.resolveShopSettlement(data);
      if (expectedSettlement === 'monthly' && settlement !== 'monthly') {
        FOS.ui.toast(FOS.i18n.t('このQRは月払い店舗専用です', '此二维码仅限月结店铺登录'), 'error');
        return;
      }
      FOS.publicOrder.saveShopSession(ctx.merchant.id, ctx.channel.id, { ...data, password: pass });
      shopSession = FOS.publicOrder.loadShopSession(ctx.merchant.id, ctx.channel.id);
      orderMode = 'shop';
      cart = FOS.storage.get(CART_KEY()) || [];
      renderShop();
    } catch (e) {
      FOS.ui.toast(FOS.publicOrder.mapRpcError(e), 'error');
    } finally {
      FOS.ui.hideLoading();
    }
  }

  function modeBarHtml() {
    if (orderMode === 'customer' && customerSession) {
      if (shopView === 'orders') {
        return `
          <div class="customer-order__mode-bar">
            <span>${FOS.fmt.escapeHtml(customerDisplayLabel(customerSession))}</span>
            <div class="customer-order__mode-actions">
              <button type="button" class="btn btn--ghost btn--sm" id="customerShopBtn">${FOS.i18n.t('買い物に戻る', '继续购物')}</button>
              <button type="button" class="btn btn--ghost btn--sm" id="customerLogoutBtn">${FOS.i18n.t('ログアウト', '退出')}</button>
            </div>
          </div>`;
      }
      return `
        <div class="customer-order__mode-bar">
          <span>${FOS.fmt.escapeHtml(customerDisplayLabel(customerSession))}</span>
          <div class="customer-order__mode-actions">
            <button type="button" class="btn btn--ghost btn--sm" id="customerOrdersBtn">${FOS.i18n.t('注文履歴', '我的订单')}</button>
            <button type="button" class="btn btn--ghost btn--sm" id="customerLogoutBtn">${FOS.i18n.t('ログアウト', '退出')}</button>
          </div>
        </div>`;
    }
    if (orderMode === 'shop' && shopSession) {
      return `
        <div class="customer-order__mode-bar">
          <span>🏪 ${FOS.fmt.escapeHtml(shopSession.name)}</span>
          <button type="button" class="btn btn--ghost btn--sm" id="shopLogoutBtn">${FOS.i18n.t('ログアウト', '退出')}</button>
        </div>`;
    }
    if (orderMode === 'guest') {
      return `<div class="customer-order__mode-bar"><span>👤 ${FOS.i18n.t('散客注文', '散客下单')}</span></div>`;
    }
    return '';
  }

  function bindModeBar() {
    document.getElementById('customerOrdersBtn')?.addEventListener('click', () => renderCustomerOrders());
    document.getElementById('customerShopBtn')?.addEventListener('click', () => renderShop());
    document.getElementById('customerLogoutBtn')?.addEventListener('click', () => {
      FOS.publicOrder.clearCustomerSession(ctx.merchant.id);
      customerSession = null;
      orderMode = null;
      cart = [];
      renderCustomerAuth();
    });
    document.getElementById('shopLogoutBtn')?.addEventListener('click', () => {
      FOS.publicOrder.clearShopSession(ctx.merchant.id, ctx.channel.id);
      shopSession = null;
      orderMode = null;
      cart = [];
      if (entrySettlement === 'monthly') {
        renderShopLogin({ settlement: 'monthly', forced: true, shopId: urlParams?.shopId });
      } else {
        renderCustomerAuth();
      }
    });
  }

  function renderShop() {
    shopView = 'catalog';
    renderShell('');
    const main = document.getElementById('appMain');
    main.innerHTML = `
      ${modeBarHtml()}
      <div class="cat-tabs-sticky"><div class="cat-tabs" id="catTabs"></div></div>
      <div class="toolbar">
        <div class="search-bar">
          <input type="search" id="productSearch" placeholder="${FOS.i18n.t('商品を検索', '搜索商品')}" value="${FOS.fmt.escapeHtml(searchTerm)}">
        </div>
      </div>
      <div class="product-grid" id="productGrid"></div>
      <button type="button" class="cart-fab" id="cartFab" aria-label="Cart">🛒
        ${cartTotalQty() ? `<span class="cart-fab__badge">${cartTotalQty()}</span>` : ''}
      </button>`;

    paintCatTabs();
    paintProducts();
    bindModeBar();
    document.getElementById('productSearch').addEventListener('input', (e) => {
      searchTerm = e.target.value;
      paintProducts();
    });
    document.getElementById('cartFab')?.addEventListener('click', openCheckoutSheet);
  }

  function cartTotalQty() {
    return cart.reduce((s, i) => s + (i.qty || 0), 0);
  }

  function setCart(items) {
    cart = items;
    FOS.storage.set(CART_KEY(), cart);
  }

  function scrollActiveCatTab(smooth = true) {
    const el = document.getElementById('catTabs');
    const active = el?.querySelector('.cat-tab--active');
    if (!el || !active) return;
    const targetLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
    el.scrollTo({
      left: Math.max(0, targetLeft),
      behavior: smooth ? 'smooth' : 'auto',
    });
  }

  function paintCatTabs(scrollCenter = false) {
    const el = document.getElementById('catTabs');
    if (!el) return;
    const cats = FOS.categories.get(allProducts);
    el.innerHTML = [
      `<button type="button" class="cat-tab ${catFilter === '' ? 'cat-tab--active' : ''}" data-cat="">${FOS.i18n.t('全て', '全部')}</button>`,
      ...cats.map((c) => `<button type="button" class="cat-tab ${catFilter === c ? 'cat-tab--active' : ''}" data-cat="${FOS.fmt.escapeHtml(c)}">${FOS.fmt.escapeHtml(c)}</button>`),
    ].join('');
    el.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        catFilter = btn.dataset.cat || '';
        paintCatTabs(true);
        paintProducts();
      });
    });
    if (scrollCenter) {
      requestAnimationFrame(() => scrollActiveCatTab(true));
    }
  }

  function filteredProducts() {
    const q = searchTerm.toLowerCase();
    return allProducts.filter((p) => {
      if (!p.active || p.stock <= 0) return false;
      if (catFilter && !FOS.categories.matches(p.category, catFilter, '')) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.name_zh || '').includes(q) || (p.spec || '').toLowerCase().includes(q);
    });
  }

  function paintProducts() {
    const grid = document.getElementById('productGrid');
    if (!grid) return;
    const list = filteredProducts();
    if (!list.length) {
      grid.innerHTML = FOS.ui.empty('📦', FOS.i18n.t('商品がありません', '暂无商品'));
      return;
    }
    grid.innerHTML = list.map((p) => {
      const inCart = cart.find((c) => String(c.product_id) === String(p.id));
      const qty = inCart?.qty || 0;
      const soldOut = p.stock <= 0;
      const media = p.image_url
        ? `<img class="product-tile__img" src="${FOS.fmt.escapeHtml(p.image_url)}" alt="">`
        : `<div class="product-tile__emoji">${p.emoji || '📦'}</div>`;
      return `
        <div class="product-tile ${qty ? 'product-tile--active' : ''} ${soldOut ? 'product-tile--soldout product-tile--disabled' : ''}" data-pid="${p.id}" ${soldOut ? 'data-soldout="1"' : ''}>
          ${qty ? `<span class="product-tile__qty">${qty}</span>` : ''}
          <div class="product-tile__media">${media}</div>
          <div class="product-tile__name">${FOS.fmt.escapeHtml(p.name)}</div>
          ${p.spec ? `<div class="product-tile__spec">${FOS.fmt.escapeHtml(p.spec)}</div>` : ''}
          <div class="product-tile__price">${FOS.fmt.money(productSellPrice(p))}</div>
        </div>`;
    }).join('');
    grid.querySelectorAll('[data-pid]:not([data-soldout])').forEach((el) => {
      el.addEventListener('click', () => addToCart(el.dataset.pid, el));
    });
    updateFab();
  }

  function getCartFlyTarget() {
    return document.getElementById('cartFab');
  }

  function pulseCartTarget() {
    const fab = document.getElementById('cartFab');
    if (!fab) return;
    fab.classList.remove('cart-fab--pulse');
    void fab.offsetWidth;
    fab.classList.add('cart-fab--pulse');
    setTimeout(() => fab.classList.remove('cart-fab--pulse'), 400);
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

  function updateFab() {
    const fab = document.getElementById('cartFab');
    if (!fab) return;
    const q = cartTotalQty();
    let badge = fab.querySelector('.cart-fab__badge');
    if (q) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'cart-fab__badge';
        fab.appendChild(badge);
      }
      badge.textContent = String(q);
    } else if (badge) badge.remove();
  }

  function productSellPrice(p) {
    if (!p) return 0;
    if (p.public_price != null && p.public_price !== '') return Number(p.public_price) || 0;
    return Number(p.price) || 0;
  }

  function addToCart(pid, tileEl) {
    const p = allProducts.find((x) => String(x.id) === String(pid));
    if (!p || p.stock <= 0) return;
    const c = [...cart];
    const i = c.findIndex((x) => String(x.product_id) === String(pid));
    if (i >= 0) {
      if (c[i].qty >= p.stock) {
        FOS.ui.toast(FOS.i18n.t('在庫不足', '库存不足'), 'error');
        return;
      }
      c[i].qty += 1;
    } else {
      c.push({
        product_id: p.id,
        product_name: p.name,
        product_spec: p.spec || '',
        product_emoji: p.emoji || '📦',
        unit_price: productSellPrice(p),
        tax_rate: p.tax_rate || 0,
        qty: 1,
      });
    }
    if (tileEl) flyToCart(tileEl, p);
    setCart(c);
    paintProducts();
    const qtyEl = document.querySelector(`.product-tile[data-pid="${pid}"] .product-tile__qty`);
    qtyEl?.classList.add('product-tile__qty--pop');
    setTimeout(() => qtyEl?.classList.remove('product-tile__qty--pop'), 400);
  }

  function changeQty(pid, delta) {
    const p = allProducts.find((x) => String(x.id) === String(pid));
    const c = [...cart];
    const i = c.findIndex((x) => String(x.product_id) === String(pid));
    if (i < 0) return;
    const next = c[i].qty + delta;
    if (next <= 0) c.splice(i, 1);
    else {
      if (p && next > p.stock) {
        FOS.ui.toast(FOS.i18n.t('在庫不足', '库存不足'), 'error');
        return;
      }
      c[i].qty = next;
    }
    setCart(c);
    paintCheckoutBody();
    paintProducts();
  }

  function cartTotals() {
    let sub = 0;
    let tax = 0;
    cart.forEach((item) => {
      const lp = item.unit_price * item.qty;
      sub += lp;
      tax += Math.round(lp * (item.tax_rate || 0) / 100);
    });
    return { sub, tax, total: sub + tax };
  }

  function openCheckoutSheet() {
    if (!cart.length) {
      FOS.ui.toast(FOS.i18n.t('カートは空です', '购物车为空'), 'warn');
      return;
    }
    const profile = orderMode === 'shop' && shopSession
      ? { name: shopSession.name, phone: shopSession.phone || '', address: shopSession.address || '' }
      : orderMode === 'customer' && customerSession
        ? { name: customerSession.name || '', phone: customerSession.phone || '', address: customerSession.address || '' }
        : FOS.publicOrder.loadProfile(ctx.merchant.id, ctx.channel.id);
    const totals = cartTotals();

    FOS.ui.openModal({
      title: FOS.i18n.t('ご注文内容', '确认订单'),
      size: 'lg',
      bodyHtml: orderMode === 'shop' ? shopCheckoutBodyHtml(totals) : checkoutBodyHtml(profile, totals),
    });
    setTimeout(() => {
      bindCheckoutForm(profile);
      paintCheckoutBody();
    }, 0);
  }

  function shopCheckoutBodyHtml(totals) {
    return `
      <div id="checkoutCartLines"></div>
      <div class="totals-row"><span>${FOS.i18n.t('合計（税込）', '合计（含税）')}</span><strong id="checkoutTotal">${FOS.fmt.money(totals.total)}</strong></div>
      <div class="public-checkout-form">
        <label class="field"><span class="field__label">${FOS.i18n.t('備考', '备注')}</span>
          <textarea class="field__input" id="custNote" rows="2"></textarea></label>
        <button type="button" class="btn btn--primary btn--block btn--lg" id="submitPublicOrderBtn">${FOS.i18n.t('注文を送信', '提交订单')}</button>
      </div>`;
  }

  function checkoutBodyHtml(profile, totals) {
    return `
      <div id="checkoutCartLines"></div>
      <div class="totals-row"><span>${FOS.i18n.t('合計（税込）', '合计（含税）')}</span><strong id="checkoutTotal">${FOS.fmt.money(totals.total)}</strong></div>
      <div class="public-checkout-form">
        <label class="field"><span class="field__label">${FOS.i18n.t('お名前', '姓名')} *</span>
          <input class="field__input" id="custName" value="${FOS.fmt.escapeHtml(profile.name || '')}"></label>
        <label class="field"><span class="field__label">${FOS.i18n.t('電話番号', '电话')} *</span>
          <input class="field__input" id="custPhone" type="tel" value="${FOS.fmt.escapeHtml(profile.phone || '')}"></label>
        <label class="field"><span class="field__label">${FOS.i18n.t('配送先住所', '配送地址')} *</span>
          <textarea class="field__input" id="custAddress" rows="2">${FOS.fmt.escapeHtml(profile.address || '')}</textarea></label>
        <fieldset class="field">
          <span class="field__label">${FOS.i18n.t('配送希望日', '配送日期')}</span>
          <div class="public-date-picks">
            <label><input type="radio" name="delDate" value="today" ${deliveryDateMode === 'today' ? 'checked' : ''}> ${FOS.i18n.t('今日', '今天')}</label>
            <label><input type="radio" name="delDate" value="tomorrow" ${deliveryDateMode === 'tomorrow' ? 'checked' : ''}> ${FOS.i18n.t('明日', '明天')}</label>
            <label><input type="radio" name="delDate" value="dayafter" ${deliveryDateMode === 'dayafter' ? 'checked' : ''}> ${FOS.i18n.t('明後日', '后天')}</label>
            <label><input type="radio" name="delDate" value="custom" ${deliveryDateMode === 'custom' ? 'checked' : ''}> ${FOS.i18n.t('日付指定', '自选日期')}</label>
          </div>
          <input class="field__input" type="date" id="delCustomDate" value="${FOS.fmt.escapeHtml(deliveryCustomDate)}" style="margin-top:8px${deliveryDateMode === 'custom' ? '' : ';display:none'}">
        </fieldset>
        <label class="field"><span class="field__label">${FOS.i18n.t('配送時間帯', '配送时段')}</span>
          <select class="field__input" id="delSlot">
            ${FOS.publicOrder.DELIVERY_SLOTS.map((s) => `<option value="${s.id}" ${deliverySlot === s.id ? 'selected' : ''}>${FOS.i18n.t(s.labelJa, s.labelZh)}</option>`).join('')}
          </select></label>
        <label class="field"><span class="field__label">${FOS.i18n.t('備考', '备注')}</span>
          <textarea class="field__input" id="custNote" rows="2"></textarea></label>
        <button type="button" class="btn btn--primary btn--block btn--lg" id="submitPublicOrderBtn">${FOS.i18n.t('注文を送信', '提交订单')}</button>
      </div>`;
  }

  function bindCheckoutForm() {
    document.querySelectorAll('input[name="delDate"]').forEach((r) => {
      r.addEventListener('change', () => {
        deliveryDateMode = r.value;
        const custom = document.getElementById('delCustomDate');
        if (custom) custom.style.display = deliveryDateMode === 'custom' ? '' : 'none';
      });
    });
    document.getElementById('delCustomDate')?.addEventListener('change', (e) => {
      deliveryCustomDate = e.target.value;
    });
    document.getElementById('delSlot')?.addEventListener('change', (e) => {
      deliverySlot = e.target.value;
    });
    document.getElementById('submitPublicOrderBtn')?.addEventListener('click', submitOrder);
  }

  function paintCheckoutBody() {
    const el = document.getElementById('checkoutCartLines');
    if (!el) return;
    el.innerHTML = cart.map((item) => `
      <div class="public-cart-line">
        <div class="public-cart-line__name">${FOS.fmt.escapeHtml(item.product_name)}</div>
        <div class="public-cart-line__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-qty-d="-1" data-pid="${item.product_id}">−</button>
          <span>${item.qty}</span>
          <button type="button" class="btn btn--ghost btn--sm" data-qty-d="1" data-pid="${item.product_id}">+</button>
        </div>
      </div>`).join('');
    el.querySelectorAll('[data-qty-d]').forEach((btn) => {
      btn.addEventListener('click', () => changeQty(btn.dataset.pid, parseInt(btn.dataset.qtyD, 10)));
    });
    const t = document.getElementById('checkoutTotal');
    if (t) t.textContent = FOS.fmt.money(cartTotals().total);
  }

  let submitting = false;

  async function submitOrder() {
    if (submitting) return;
    if (orderMode === 'shop' && shopSession) return submitShopOrder();

    const name = document.getElementById('custName')?.value?.trim();
    const phone = document.getElementById('custPhone')?.value?.trim();
    const address = document.getElementById('custAddress')?.value?.trim();
    const note = document.getElementById('custNote')?.value?.trim();
    const payMethod = 'cash';

    if (!name || !phone || !address) {
      FOS.ui.toast(FOS.i18n.t('氏名・電話・住所を入力してください', '请填写姓名、电话和地址'), 'error');
      return;
    }
    if (deliveryDateMode === 'custom' && !deliveryCustomDate) {
      FOS.ui.toast(FOS.i18n.t('日付を選択してください', '请选择日期'), 'error');
      return;
    }

    const payload = {
      channel_id: ctx.channel.id,
      customer_name: name,
      customer_phone: phone,
      customer_address: address,
      note: note || null,
      delivery_preferred_date: resolvedDeliveryDate(),
      delivery_preferred_slot: deliverySlot,
      delivery_time_note: null,
      customer_payment_method: payMethod,
      items: cart.map((item) => ({ product_id: item.product_id, qty: item.qty })),
    };

    FOS.ui.showLoading(FOS.i18n.t('送信中...', '提交中...'));
    submitting = true;
    const submitBtn = document.getElementById('submitPublicOrderBtn');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const result = await FOS.publicOrder.createOrder(payload);
      FOS.publicOrder.saveProfile(ctx.merchant.id, ctx.channel.id, { name, phone, address });
      if (orderMode === 'customer' && customerSession) {
        FOS.publicOrder.saveCustomerSession(ctx.merchant.id, {
          ...customerSession,
          name,
          phone,
          address,
        });
        customerSession = FOS.publicOrder.loadCustomerSession(ctx.merchant.id);
      }
      setCart([]);
      FOS.ui.closeModal();
      lastOrderCode = result.public_order_code;
      const url = new URL(location.href);
      url.searchParams.set('view', 'success');
      url.searchParams.set('code', result.public_order_code);
      history.replaceState({}, '', url.toString());
      renderSuccess(result.public_order_code, result.total);
    } catch (e) {
      FOS.ui.toast(FOS.publicOrder.mapRpcError(e), 'error');
    } finally {
      submitting = false;
      const btn = document.getElementById('submitPublicOrderBtn');
      if (btn) btn.disabled = false;
      FOS.ui.hideLoading();
    }
  }

  async function submitShopOrder() {
    if (submitting || !shopSession) return;
    const note = document.getElementById('custNote')?.value?.trim();
    const payload = {
      channel_id: ctx.channel.id,
      shop_login_id: shopSession.id,
      shop_password: shopSession.password,
      note: note || null,
      items: cart.map((item) => ({ product_id: item.product_id, qty: item.qty })),
    };

    FOS.ui.showLoading(FOS.i18n.t('送信中...', '提交中...'));
    submitting = true;
    const submitBtn = document.getElementById('submitPublicOrderBtn');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const result = await FOS.publicOrder.createShopOrder(payload);
      setCart([]);
      FOS.ui.closeModal();
      renderShopSuccess(result);
    } catch (e) {
      FOS.ui.toast(FOS.publicOrder.mapRpcError(e), 'error');
    } finally {
      submitting = false;
      if (submitBtn) submitBtn.disabled = false;
      FOS.ui.hideLoading();
    }
  }

  function renderShopSuccess(result) {
    renderShell(`
      <div class="customer-order__success">
        <div class="customer-order__success-icon">✓</div>
        <h1>${FOS.i18n.t('ご注文ありがとうございます', '下单成功')}</h1>
        <p>${FOS.i18n.t('注文番号', '订单号')} #${FOS.fmt.escapeHtml(String(result.order_no || ''))}</p>
        <p class="customer-order__total">${FOS.i18n.t('合計', '合计')}：${FOS.fmt.money(result.total)}</p>
        <div class="customer-order__success-actions">
          <button type="button" class="btn btn--primary btn--block" id="shopContinueBtn">${FOS.i18n.t('買い物を続ける', '继续购物')}</button>
        </div>
      </div>`, { headerMode: 'merchant' });
    document.getElementById('shopContinueBtn')?.addEventListener('click', () => renderShop());
  }

  function orderStatusMeta(status) {
    const map = {
      new: { cls: 'pending', ja: '受付待ち', zh: '待接单' },
      accepted: { cls: 'accepted', ja: '受付済', zh: '已接单' },
      delivering: { cls: 'delivering', ja: '配送中', zh: '配送中' },
      delivered: { cls: 'done', ja: '配達完了', zh: '已完成' },
      cancelled: { cls: 'cancelled', ja: 'キャンセル', zh: '已取消' },
    };
    const m = map[status] || { cls: 'pending', ja: status || '—', zh: status || '—' };
    return { className: m.cls, label: FOS.publicOrder.deliveryStatusLabel(status) || FOS.i18n.t(m.ja, m.zh) };
  }

  function formatOrderDateTime(iso) {
    return String(iso || '').slice(0, 16).replace('T', ' ');
  }

  function resolveItemImage(item) {
    if (item?.image_url) return item.image_url;
    if (item?.product_id && allProducts.length) {
      const p = allProducts.find((x) => String(x.id) === String(item.product_id));
      if (p?.image_url) return p.image_url;
    }
    return '';
  }

  function orderGoodsThumbHtml(item) {
    const url = resolveItemImage(item);
    if (url) {
      return `<img class="tb-order-goods__thumb" src="${FOS.fmt.escapeHtml(url)}" alt="" loading="lazy">`;
    }
    const em = item.product_emoji || '📦';
    return `<span class="tb-order-goods__thumb tb-order-goods__thumb--emoji">${em}</span>`;
  }

  function orderGoodsRowsHtml(items) {
    return (items || []).map((i) => {
      const unitPrice = Number(i.unit_price) || 0;
      return `
        <div class="tb-order-goods__row">
          ${orderGoodsThumbHtml(i)}
          <div class="tb-order-goods__info">
            <div class="tb-order-goods__title">${FOS.fmt.escapeHtml(i.product_name || '')}</div>
            ${i.product_spec ? `<div class="tb-order-goods__spec">${FOS.fmt.escapeHtml(i.product_spec)}</div>` : ''}
          </div>
          <div class="tb-order-goods__price-col">
            <div class="tb-order-goods__price">${FOS.fmt.money(unitPrice)}</div>
            <div class="tb-order-goods__qty">×${i.qty || 0}</div>
          </div>
        </div>`;
    }).join('');
  }

  function orderInfoPanelHtml(data) {
    return `
      <div class="tb-order-card__info-title">${FOS.i18n.t('注文情報', '订单信息')}</div>
      <div class="tb-order-card__info-rows">
        <div class="tb-order-card__info-row">
          <span>${FOS.i18n.t('注文番号', '订单号')}</span>
          <span>${FOS.fmt.escapeHtml(data.public_order_code || '')}</span>
        </div>
        <div class="tb-order-card__info-row">
          <span>${FOS.i18n.t('注文日', '下单时间')}</span>
          <span>${FOS.fmt.escapeHtml(formatOrderDateTime(data.created_at))}</span>
        </div>
        <div class="tb-order-card__info-row">
          <span>${FOS.i18n.t('支払方法', '支付方式')}</span>
          <span>${FOS.publicOrder.paymentLabel(data.customer_payment_method)}</span>
        </div>
        <div class="tb-order-card__info-row">
          <span>${FOS.i18n.t('配送希望', '配送希望')}</span>
          <span>${FOS.fmt.escapeHtml(FOS.publicOrder.formatDeliveryWish(data))}</span>
        </div>
      </div>`;
  }

  function orderCardHtml(data) {
    const status = orderStatusMeta(data.delivery_status);
    const itemCount = Number(data.item_count) || (data.items_preview || []).length || 0;
    const previewItems = data.items_preview || [];
    const hasMore = itemCount > previewItems.length;
    const goodsHtml = previewItems.length
      ? orderGoodsRowsHtml(previewItems)
      : `<div class="tb-order-goods__empty">${FOS.i18n.t('注文情報を開いて商品を表示', '展开订单信息查看商品')}</div>`;
    const moreRow = hasMore
      ? `<div class="tb-order-goods__more">${FOS.i18n.t('他 %n 点', '还有 %n 件').replace('%n', String(itemCount - previewItems.length))}</div>`
      : '';
    return `
      <article class="tb-order-card"
        data-order-code="${FOS.fmt.escapeHtml(data.public_order_code)}"
        data-item-count="${itemCount}"
        data-preview-count="${previewItems.length}">
        <header class="tb-order-card__head">
          <time class="tb-order-card__time">${FOS.fmt.escapeHtml(formatOrderDateTime(data.created_at))}</time>
          <span class="tb-order-card__status tb-order-card__status--${status.className}">${FOS.fmt.escapeHtml(status.label)}</span>
        </header>
        <div class="tb-order-card__goods" data-order-goods>${goodsHtml}${moreRow}</div>
        <div class="tb-order-card__payline">
          <span>${FOS.i18n.t('全 %n 点', '共 %n 件').replace('%n', String(itemCount || '—'))}</span>
          <span class="tb-order-card__paid">${FOS.i18n.t('実支払', '实付款')} <strong>${FOS.fmt.money(data.total)}</strong></span>
        </div>
        <footer class="tb-order-card__foot">
          <button type="button" class="tb-order-card__info-btn" data-order-toggle aria-expanded="false">
            <span class="tb-order-card__toggle-text">${FOS.i18n.t('注文情報', '订单信息')}</span>
            <span class="tb-order-card__chevron" aria-hidden="true"></span>
          </button>
        </footer>
        <div class="tb-order-card__info" hidden data-order-info></div>
      </article>`;
  }

  function setOrderCardOpen(card, open) {
    if (!card) return;
    card.classList.toggle('tb-order-card--open', open);
    const btn = card.querySelector('[data-order-toggle]');
    const infoEl = card.querySelector('[data-order-info]');
    const toggleText = card.querySelector('.tb-order-card__toggle-text');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (infoEl) infoEl.hidden = !open;
    if (toggleText) {
      toggleText.textContent = open
        ? FOS.i18n.t('閉じる', '收起')
        : FOS.i18n.t('注文情報', '订单信息');
    }
  }

  async function toggleOrderCard(card) {
    const code = card?.dataset.orderCode;
    const infoEl = card?.querySelector('[data-order-info]');
    const goodsEl = card?.querySelector('[data-order-goods]');
    if (!code || !infoEl) return;
    const isOpen = card.classList.contains('tb-order-card--open');
    if (isOpen) {
      setOrderCardOpen(card, false);
      return;
    }
    const itemCount = Number(card.dataset.itemCount) || 0;
    const previewCount = Number(card.dataset.previewCount) || 0;
    const needFetch = infoEl.dataset.loaded !== '1'
      || (itemCount > previewCount && goodsEl?.dataset.full !== '1');
    if (needFetch) {
      card.classList.add('tb-order-card--loading');
      try {
        const data = await FOS.publicOrder.queryOrder(customerSession.phone, code);
        if (!data) {
          FOS.ui.toast(FOS.i18n.t('注文が見つかりません', '未找到订单'), 'warn');
          return;
        }
        if (goodsEl && data.items?.length) {
          goodsEl.innerHTML = orderGoodsRowsHtml(data.items);
          goodsEl.dataset.full = '1';
          card.dataset.previewCount = String(data.items.length);
        }
        infoEl.innerHTML = orderInfoPanelHtml(data);
        infoEl.dataset.loaded = '1';
      } catch (e) {
        FOS.ui.toast(FOS.publicOrder.mapRpcError(e), 'error');
        return;
      } finally {
        card.classList.remove('tb-order-card--loading');
      }
    }
    setOrderCardOpen(card, true);
  }

  function bindOrderHistoryCards(root) {
    root.querySelectorAll('.tb-order-card').forEach((card) => {
      card.querySelector('[data-order-toggle]')?.addEventListener('click', () => toggleOrderCard(card));
    });
  }

  function renderCustomerOrders() {
    shopView = 'orders';
    renderShell(`
      ${modeBarHtml()}
      <div class="customer-order__orders-page">
        <div class="customer-order__orders-head">
          <h2 class="customer-order__orders-title">${FOS.i18n.t('注文履歴', '我的订单')}</h2>
        </div>
        <div id="customerOrdersList" class="customer-order__orders-list">${FOS.ui.empty('📋', FOS.i18n.t('読み込み中...', '加载中...'))}</div>
      </div>`);
    bindModeBar();
    loadCustomerOrdersList();
  }

  async function loadCustomerOrdersList() {
    const el = document.getElementById('customerOrdersList');
    if (!el || !customerSession?.phone || !ctx?.merchant?.id) return;
    FOS.ui.showLoading();
    try {
      const list = await FOS.publicOrder.listCustomerOrders({
        merchantId: ctx.merchant.id,
        phone: customerSession.phone,
      });
      if (!list.length) {
        el.innerHTML = FOS.ui.empty('📋', FOS.i18n.t('注文履歴がありません', '暂无订单'));
        return;
      }
      el.innerHTML = list.map((o) => orderCardHtml(o)).join('');
      bindOrderHistoryCards(el);
    } catch (e) {
      el.innerHTML = `<div class="alert alert--warn">${FOS.fmt.escapeHtml(FOS.publicOrder.mapRpcError(e))}</div>`;
    } finally {
      FOS.ui.hideLoading();
    }
  }

  function renderSuccess(code, total) {
    const params = FOS.publicOrder.parseFromLocation();
    const orderCode = code || params.code || lastOrderCode || '—';
    const session = ctx?.merchant?.id
      ? FOS.publicOrder.loadCustomerSession(ctx.merchant.id)
      : null;
    const ordersAction = session?.phone
      ? `<button type="button" class="btn btn--secondary btn--block" id="successOrdersBtn">${FOS.i18n.t('注文履歴', '我的订单')}</button>`
      : `<a class="btn btn--secondary btn--block" href="${FOS.publicOrder.buildLookupUrl()}">${FOS.i18n.t('注文照会', '查询订单')}</a>`;
    renderShell(`
      <div class="customer-order__success">
        <div class="customer-order__success-icon">✓</div>
        <h1>${FOS.i18n.t('ご注文ありがとうございます', '下单成功')}</h1>
        <p>${FOS.i18n.t('注文番号', '订单号')}</p>
        <div class="customer-order__code">${FOS.fmt.escapeHtml(orderCode)}</div>
        ${total != null ? `<p class="customer-order__total">${FOS.i18n.t('合計', '合计')}：${FOS.fmt.money(total)}</p>` : ''}
        <div class="customer-order__success-actions">
          <a class="btn btn--primary btn--block" href="${FOS.publicOrder.buildOrderUrl({
            merchantId: ctx?.merchant?.id || params.merchantId,
            channelId: ctx?.channel?.id || params.channelId,
          })}">${FOS.i18n.t('買い物を続ける', '继续购物')}</a>
          ${ordersAction}
        </div>
      </div>`, { headerMode: 'merchant' });
    if (session?.phone) {
      customerSession = session;
      orderMode = 'customer';
      document.getElementById('successOrdersBtn')?.addEventListener('click', () => renderCustomerOrders());
    }
  }

  function renderLookup() {
    renderShell(`
      <div class="customer-order__lookup">
        <h2>${FOS.i18n.t('注文照会', '订单查询')}</h2>
        <p class="field__hint">${FOS.i18n.t('電話番号と注文番号の両方を入力してください', '需同时输入手机号和订单号')}</p>
        <label class="field"><span class="field__label">${FOS.i18n.t('電話番号', '手机号')}</span>
          <input class="field__input" id="lookupPhone" type="tel"></label>
        <label class="field"><span class="field__label">${FOS.i18n.t('注文番号', '订单号')}</span>
          <input class="field__input" id="lookupCode" placeholder="P250606-XXXX"></label>
        <button type="button" class="btn btn--primary btn--block" id="lookupBtn">${FOS.i18n.t('照会する', '查询')}</button>
        <div id="lookupResult" style="margin-top:16px"></div>
      </div>`, { headerMode: 'merchant' });

    const params = FOS.publicOrder.parseFromLocation();
    const codeParam = params.code || new URLSearchParams(location.search).get('code');
    if (codeParam) document.getElementById('lookupCode').value = codeParam;
    if (params.merchantId && params.channelId) {
      const profile = FOS.publicOrder.loadProfile(params.merchantId, params.channelId);
      if (profile.phone) document.getElementById('lookupPhone').value = profile.phone;
    }
    document.getElementById('lookupBtn').addEventListener('click', runLookup);
  }

  async function runLookup() {
    const phone = document.getElementById('lookupPhone')?.value?.trim();
    const code = document.getElementById('lookupCode')?.value?.trim();
    const el = document.getElementById('lookupResult');
    if (!phone || !code) {
      FOS.ui.toast(FOS.i18n.t('電話番号と注文番号を入力してください', '请输入手机号和订单号'), 'error');
      return;
    }
    FOS.ui.showLoading();
    try {
      await FOS.db.init();
      const data = await FOS.publicOrder.queryOrder(phone, code);
      if (!data) {
        el.innerHTML = `<div class="alert alert--warn">${FOS.i18n.t('注文が見つかりません', '未找到订单，请检查手机号和订单号')}</div>`;
        return;
      }
      const items = (data.items || []).map((i, itemIdx) => FOS.orders.orderLineItemHtml(i, itemIdx)).join('');
      el.innerHTML = `
        <div class="card">
          <div class="card__head"><span class="card__title">${FOS.fmt.escapeHtml(data.public_order_code)}</span>
            <span class="badge badge--blue">${FOS.publicOrder.deliveryStatusLabel(data.delivery_status)}</span></div>
          <div class="card__body">
            <p>${FOS.i18n.t('注文日', '下单时间')}：${FOS.fmt.escapeHtml(String(data.created_at || '').slice(0, 16).replace('T', ' '))}</p>
            <p>${FOS.i18n.t('合計', '合计')}：${FOS.fmt.money(data.total)}</p>
            <p>${FOS.i18n.t('支払方法', '支付方式')}：${FOS.publicOrder.paymentLabel(data.customer_payment_method)}</p>
            <p>${FOS.i18n.t('配送希望', '配送希望')}：${FOS.fmt.escapeHtml(FOS.publicOrder.formatDeliveryWish(data))}</p>
            <ul class="order-line-items">${items}</ul>
          </div>
        </div>`;
    } catch (e) {
      FOS.ui.toast(FOS.publicOrder.mapRpcError(e), 'error');
    } finally {
      FOS.ui.hideLoading();
    }
  }

  boot();
})();
