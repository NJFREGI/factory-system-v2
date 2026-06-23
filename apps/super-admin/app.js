/**
 * 总后台 Super Admin · Phase 2–4
 * 商家列表 / 新增编辑 / 启停 / 套餐限制 / 销售统计
 */
(function () {
  FOS.APP_ID = 'super-admin';
  FOS.auth.expectedRoles = [FOS.CONFIG.ROLES.SUPER_ADMIN];

  let merchants = [];
  let listSearch = '';
  let listStatus = '';
  let editingId = null;
  let salesRangeFrom = '';
  let salesRangeTo = '';
  const merchantCustomRanges = {};

  FOS.onLogout = () => { FOS.auth.logout(); boot(); };
  FOS.onLangChange = () => {
    if (!FOS.auth.user) return;
    const active = document.querySelector('.fos-nav-item.active')?.dataset?.nav;
    if (active === 'sales') renderSalesPage();
    else renderMerchantsPage();
  };

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
      title: FOS.i18n.t('総合管理', '总后台'),
      heroTitle: FOS.i18n.t('SaaS プラットフォーム管理', 'SaaS 平台管理'),
      heroDesc: FOS.i18n.t('全商家の管理・制限・状態を一元制御', '统一管理所有商家、限制与状态'),
      hint: FOS.i18n.t('スーパー管理者でログイン', '使用超级管理员登录'),
      rolesLabel: 'super_admin',
      onSubmit: async (id, pass) => {
        await FOS.auth.login(id, pass);
        await startApp();
      },
    });
  }

  async function startApp() {
    FOS.shell.mount({
      appId: 'super-admin',
      brand: {
        icon: 'shield',
        title: FOS.i18n.t('総合管理', '总后台'),
        subtitle: 'Super Admin',
      },
      nav: [
        { id: 'merchants', icon: 'merchants', label: FOS.i18n.t('商家', '商家') },
        { id: 'sales', icon: 'sales', label: FOS.i18n.t('売上', '销售') },
      ],
      pageTitle: FOS.i18n.t('商家管理', '商家管理'),
      onNavigate: (id) => {
        if (id === 'sales') renderSalesPage();
        else renderMerchantsPage();
      },
    });
    await renderMerchantsPage();
  }

  async function loadMerchants() {
    merchants = await FOS.merchants.listAll({ search: listSearch, status: listStatus });
  }

  function merchantFormHtml(merchant, { isCreate, admin, delivery }) {
    const m = merchant || {};
    const plan = m.plan_type || 'standard';
    const limits = FOS.merchants.planDefaults(plan);
    const hasAdmin = !!admin?.id;
    const adminId = admin?.id || (isCreate && m.id ? `${m.id}_factory` : '');
    const adminIdReadonly = !isCreate && hasAdmin;
    const adminPassRequired = isCreate || !hasAdmin;
    const adminPassHint = adminPassRequired
      ? FOS.i18n.t('管理后台ログイン用', '用于登录管理后台')
      : FOS.i18n.t('空欄のままなら変更しません', '留空则不修改密码');

    const hasDelivery = !!delivery?.id;
    const deliveryId = delivery?.id || (!isCreate && m.id ? `${m.id}_driver` : '');
    const deliveryIdReadonly = !isCreate && hasDelivery;
    const deliveryPassHint = hasDelivery
      ? FOS.i18n.t('空欄のままなら変更しません', '留空则不修改密码')
      : FOS.i18n.t('配送端ログイン用（任意）', '用于登录配送端（可选）');

    return `
      <form id="merchantForm" class="merchant-form">
        <div class="form-grid form-grid--2">
          <label class="field">
            <span class="field__label">${FOS.i18n.t('商家 ID', '商家 ID')}</span>
            <input class="field__input" id="mfId" value="${FOS.fmt.escapeHtml(m.id || '')}"
              placeholder="m001" ${isCreate ? '' : 'readonly'} required>
          </label>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('商家名称', '商家名称')}</span>
            <input class="field__input" id="mfName" value="${FOS.fmt.escapeHtml(m.name || '')}" required>
          </label>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('担当者', '联系人')}</span>
            <input class="field__input" id="mfContact" value="${FOS.fmt.escapeHtml(m.contact_name || '')}">
          </label>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('電話', '电话')}</span>
            <input class="field__input" id="mfPhone" value="${FOS.fmt.escapeHtml(m.phone || '')}">
          </label>
        </div>
        <label class="field">
          <span class="field__label">${FOS.i18n.t('住所', '地址')}</span>
          <input class="field__input" id="mfAddress" value="${FOS.fmt.escapeHtml(m.address || '')}">
        </label>
        <div class="form-grid form-grid--2">
          <label class="field">
            <span class="field__label">${FOS.i18n.t('状態', '状态')}</span>
            <select class="field__input" id="mfStatus">
              <option value="active" ${m.status !== 'suspended' ? 'selected' : ''}>${FOS.i18n.t('有効', '启用')}</option>
              <option value="suspended" ${m.status === 'suspended' ? 'selected' : ''}>${FOS.i18n.t('停止', '停用')}</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('プラン', '套餐')}</span>
            <select class="field__input" id="mfPlan">
              ${['trial', 'standard', 'pro', 'enterprise']
                .map(
                  (p) =>
                    `<option value="${p}" ${plan === p ? 'selected' : ''}>${FOS.merchants.planLabel(p)}</option>`
                )
                .join('')}
            </select>
          </label>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('最大ユーザー数', '最大用户数')}</span>
            <input class="field__input" type="number" id="mfMaxUsers" min="1"
              value="${m.max_users ?? limits.max_users}">
          </label>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('最大商品数', '最大商品数')}</span>
            <input class="field__input" type="number" id="mfMaxProducts" min="1"
              value="${m.max_products ?? limits.max_products}">
          </label>
        </div>

        <div class="merchant-form-section">
          <div class="merchant-form-section__title">${FOS.i18n.t('管理后台アカウント', '管理后台账号')}</div>
          <div class="form-grid form-grid--2">
            <label class="field">
              <span class="field__label">${FOS.i18n.t('管理アカウント ID', '管理账号 ID')}</span>
              <input class="field__input" id="mfAdminId" value="${FOS.fmt.escapeHtml(adminId)}"
                placeholder="m001_factory" ${adminIdReadonly ? 'readonly' : ''} ${isCreate || !hasAdmin ? 'required' : ''}>
            </label>
            <label class="field">
              <span class="field__label">${FOS.i18n.t('管理パスワード', '管理密码')}</span>
              <input class="field__input" type="password" id="mfAdminPass" autocomplete="new-password"
                placeholder="${FOS.fmt.escapeHtml(adminPassHint)}" ${adminPassRequired ? 'required' : ''}>
            </label>
          </div>
          <p style="font-size:13px;color:var(--text-secondary);margin:0">
            ${FOS.i18n.t('このアカウントで /apps/admin/ にログインします', '此账号用于登录 /apps/admin/ 管理后台')}
          </p>
        </div>

        <div class="merchant-form-section">
          <div class="merchant-form-section__title">${FOS.i18n.t('配送アカウント', '配送账号')}</div>
          <div class="form-grid form-grid--2">
            <label class="field">
              <span class="field__label">${FOS.i18n.t('配送アカウント ID', '配送账号 ID')}</span>
              <input class="field__input" id="mfDeliveryId" value="${FOS.fmt.escapeHtml(deliveryId)}"
                placeholder="m001_driver" ${deliveryIdReadonly ? 'readonly' : ''}>
            </label>
            <label class="field">
              <span class="field__label">${FOS.i18n.t('配送パスワード', '配送密码')}</span>
              <input class="field__input" type="password" id="mfDeliveryPass" autocomplete="new-password"
                placeholder="${FOS.fmt.escapeHtml(deliveryPassHint)}">
            </label>
          </div>
          <p style="font-size:13px;color:var(--text-secondary);margin:0">
            ${FOS.i18n.t('このアカウントで /apps/production/ の配送画面にログインします（任意）', '此账号用于登录 /apps/production/ 配送端（可选）')}
          </p>
        </div>

        <div class="merchant-form-section">
          <div class="merchant-form-section__title">${FOS.i18n.t('利用制限', '使用限制')}</div>
          <div class="form-grid form-grid--2">
            <label class="check-field">
              <input type="checkbox" id="mfAllowOrder" ${m.allow_order !== false ? 'checked' : ''}>
              <span>${FOS.i18n.t('注文を許可', '允许下单')}</span>
            </label>
            <label class="check-field">
              <input type="checkbox" id="mfAllowOrderApp" ${m.allow_order_app !== false ? 'checked' : ''}>
              <span>${FOS.i18n.t('接单端', '接单端')}</span>
            </label>
            <label class="check-field">
              <input type="checkbox" id="mfAllowAdminApp" ${m.allow_admin_app !== false ? 'checked' : ''}>
              <span>${FOS.i18n.t('管理后台', '管理后台')}</span>
            </label>
            <label class="check-field">
              <input type="checkbox" id="mfAllowProductionApp" ${m.allow_production_app !== false ? 'checked' : ''}>
              <span>${FOS.i18n.t('生产端', '生产端')}</span>
            </label>
          </div>
        </div>

        <label class="field">
          <span class="field__label">${FOS.i18n.t('備考', '备注')}</span>
          <textarea class="field__input" id="mfNotes" rows="3">${FOS.fmt.escapeHtml(m.notes || '')}</textarea>
        </label>

        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <button type="submit" class="btn btn--primary">${FOS.i18n.t('保存', '保存')}</button>
          <button type="button" class="btn btn--secondary" data-modal-close>${FOS.i18n.t('キャンセル', '取消')}</button>
        </div>
      </form>`;
  }

  function readMerchantForm() {
    return {
      id: document.getElementById('mfId')?.value,
      name: document.getElementById('mfName')?.value,
      contact_name: document.getElementById('mfContact')?.value,
      phone: document.getElementById('mfPhone')?.value,
      address: document.getElementById('mfAddress')?.value,
      status: document.getElementById('mfStatus')?.value,
      plan_type: document.getElementById('mfPlan')?.value,
      max_users: document.getElementById('mfMaxUsers')?.value,
      max_products: document.getElementById('mfMaxProducts')?.value,
      allow_order: document.getElementById('mfAllowOrder')?.checked,
      allow_order_app: document.getElementById('mfAllowOrderApp')?.checked,
      allow_admin_app: document.getElementById('mfAllowAdminApp')?.checked,
      allow_production_app: document.getElementById('mfAllowProductionApp')?.checked,
      notes: document.getElementById('mfNotes')?.value,
      admin_id: document.getElementById('mfAdminId')?.value,
      admin_password: document.getElementById('mfAdminPass')?.value,
      delivery_id: document.getElementById('mfDeliveryId')?.value,
      delivery_password: document.getElementById('mfDeliveryPass')?.value,
    };
  }

  function bindAccountIdAutoFill(modal) {
    const idEl = modal.querySelector('#mfId');
    const adminEl = modal.querySelector('#mfAdminId');
    if (!idEl || !adminEl) return;

    idEl.addEventListener('input', () => {
      if (adminEl.dataset.manual === '1') return;
      const base = idEl.value.trim();
      adminEl.value = base ? `${base}_factory` : '';
    });

    adminEl.addEventListener('input', () => {
      adminEl.dataset.manual = '1';
    });
  }

  function bindPlanAutoFill(modal) {
    modal.querySelector('#mfPlan')?.addEventListener('change', (e) => {
      const limits = FOS.merchants.planDefaults(e.target.value);
      const usersEl = modal.querySelector('#mfMaxUsers');
      const productsEl = modal.querySelector('#mfMaxProducts');
      if (usersEl) usersEl.value = limits.max_users;
      if (productsEl) productsEl.value = limits.max_products;
    });
  }

  function openCreateModal() {
    editingId = null;
    const modal = FOS.ui.openModal({
      title: FOS.i18n.t('商家を追加', '新增商家'),
      bodyHtml: merchantFormHtml(null, { isCreate: true }),
    });
    bindPlanAutoFill(modal);
    bindAccountIdAutoFill(modal);
    modal.querySelector('#merchantForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveMerchant(true);
    });
  }

  async function openEditModal(merchant) {
    editingId = merchant.id;
    const [admin, delivery] = await Promise.all([
      FOS.merchants.getFactoryAdmin(merchant.id),
      FOS.merchants.getDeliveryAdmin(merchant.id),
    ]);
    const modal = FOS.ui.openModal({
      title: FOS.i18n.t('商家を編集', '编辑商家') + ` — ${merchant.name}`,
      bodyHtml: merchantFormHtml(merchant, { isCreate: false, admin, delivery }),
      size: 'lg',
    });
    bindPlanAutoFill(modal);
    modal.querySelector('#merchantForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await saveMerchant(false);
    });
  }

  async function saveDeliveryAccount(merchantId, input) {
    const deliveryId = (input.delivery_id || '').trim();
    const deliveryPass = (input.delivery_password || '').trim();
    if (!deliveryId && !deliveryPass) return;

    if (!deliveryId && deliveryPass) {
      throw new Error(FOS.i18n.t('配送アカウントIDを入力してください', '请填写配送账号 ID'));
    }

    const existing = await FOS.merchants.getDeliveryAdmin(merchantId);
    if (deliveryId && !deliveryPass) {
      if (!existing) {
        throw new Error(FOS.i18n.t('配送パスワードを設定してください', '请设置配送密码'));
      }
      return;
    }

    await FOS.merchants.saveDeliveryAdmin({
      merchantId,
      userId: deliveryId,
      password: deliveryPass,
      displayName: input.name,
      isCreate: !existing,
    });
  }

  async function saveMerchant(isCreate) {
    const input = readMerchantForm();
    FOS.ui.showLoading();
    try {
      if (isCreate) {
        await FOS.merchants.create(input);
        await FOS.merchants.saveFactoryAdmin({
          merchantId: input.id.trim(),
          userId: input.admin_id,
          password: input.admin_password,
          displayName: input.name,
          isCreate: true,
        });
        await saveDeliveryAccount(input.id.trim(), input);
      } else {
        await FOS.merchants.update(editingId, input);
        const admin = await FOS.merchants.getFactoryAdmin(editingId);
        if (!admin || (input.admin_password || '').trim()) {
          await FOS.merchants.saveFactoryAdmin({
            merchantId: editingId,
            userId: input.admin_id,
            password: input.admin_password,
            displayName: input.name,
            isCreate: !admin,
          });
        }
        await saveDeliveryAccount(editingId, input);
      }
      FOS.ui.closeModal();
      FOS.ui.toast(FOS.i18n.t('保存しました', '已保存'), 'success');
      await renderMerchantsPage();
    } catch (e) {
      FOS.ui.toast(e.message, 'error');
    } finally {
      FOS.ui.hideLoading();
    }
  }

  async function toggleMerchantStatus(merchant) {
    const next = merchant.status === 'suspended' ? 'active' : 'suspended';
    const msg =
      next === 'suspended'
        ? FOS.i18n.t(`「${merchant.name}」を停止しますか？`, `确定停用「${merchant.name}」？`)
        : FOS.i18n.t(`「${merchant.name}」を有効にしますか？`, `确定启用「${merchant.name}」？`);
    if (!FOS.ui.confirm(msg)) return;

    FOS.ui.showLoading();
    try {
      await FOS.merchants.setStatus(merchant.id, next);
      FOS.ui.toast(
        next === 'suspended' ? FOS.i18n.t('停止しました', '已停用') : FOS.i18n.t('有効にしました', '已启用'),
        'success'
      );
      await renderMerchantsPage();
    } catch (e) {
      FOS.ui.toast(e.message, 'error');
    } finally {
      FOS.ui.hideLoading();
    }
  }

  function ensureSalesRangeDefaults() {
    const month = FOS.merchantStats.currentMonthRange();
    if (!salesRangeFrom) salesRangeFrom = month.from;
    if (!salesRangeTo) salesRangeTo = month.to;
  }

  function ensureMerchantRange(merchantId) {
    if (!merchantCustomRanges[merchantId]) {
      const month = FOS.merchantStats.currentMonthRange();
      merchantCustomRanges[merchantId] = { from: month.from, to: month.to };
    }
    return merchantCustomRanges[merchantId];
  }

  function merchantNameById(id) {
    const m = merchants.find((x) => x.id === id);
    return m?.name || id;
  }

  function salesCardsHtml(stats, { compact } = {}) {
    const gridClass = compact ? 'sales-stats-grid' : 'stat-grid';
    return `
      <div class="${gridClass}">
        <div class="stat-card">
          <div class="stat-card__label">${FOS.i18n.t('売上', '销售额')}</div>
          <div class="stat-card__value">${FOS.fmt.money(stats.salesTotal)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">${FOS.i18n.t('注文数', '订单数')}</div>
          <div class="stat-card__value">${stats.orderCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">${FOS.i18n.t('客単価', '客单价')}</div>
          <div class="stat-card__value">${FOS.fmt.money(stats.aov)}</div>
        </div>
      </div>`;
  }

  function productRankingHtml(ranking) {
    if (!ranking?.length) {
      return FOS.ui.empty('📦', FOS.i18n.t('該当期間の商品データなし', '该时段暂无商品数据'));
    }
    return `
      <div class="sales-ranking">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>${FOS.i18n.t('商品', '商品')}</th>
              <th class="num">${FOS.i18n.t('数量', '数量')}</th>
              <th class="num">${FOS.i18n.t('金額', '金额')}</th>
            </tr>
          </thead>
          <tbody>
            ${ranking
              .map(
                (row, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${FOS.fmt.escapeHtml(FOS.fmt.displayName(row.product_name))}</td>
                <td class="num">${row.qty}</td>
                <td class="num">${FOS.fmt.money(row.amount)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>`;
  }

  async function loadMerchantSalesBlock(merchantId) {
    const range = ensureMerchantRange(merchantId);
    const [today, month, custom, ranking] = await Promise.all([
      FOS.merchantStats.getSummary({ merchantId, ...FOS.merchantStats.todayRange() }),
      FOS.merchantStats.getSummary({ merchantId, ...FOS.merchantStats.currentMonthRange() }),
      FOS.merchantStats.getSummary({ merchantId, from: range.from, to: range.to }),
      FOS.merchantStats.getProductRanking({
        merchantId,
        from: range.from,
        to: range.to,
        limit: 10,
      }),
    ]);
    return { today, month, custom, ranking, range };
  }

  function merchantSalesHtml({ today, month, custom, ranking, range }, merchantId) {
    return `
      <div class="sales-stats-section" data-merchant-sales="${merchantId}">
        <div class="sales-stats-section__title">${FOS.i18n.t('売上統計', '销售统计')}</div>
        <p style="font-size:13px;color:var(--text-tertiary);margin:0 0 10px">
          ${FOS.i18n.t('キャンセル注文を除く', '已排除 cancelled 订单')}
        </p>
        <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">
          ${FOS.i18n.t('本日', '今日')}
        </div>
        ${salesCardsHtml(today, { compact: true })}
        <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin:14px 0 8px">
          ${FOS.i18n.t('今月', '本月')}
        </div>
        ${salesCardsHtml(month, { compact: true })}
        <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin:14px 0 8px">
          ${FOS.i18n.t('期間指定', '自定义区间')}
        </div>
        <div class="sales-toolbar">
          <label class="field">
            <span class="field__label">${FOS.i18n.t('開始日', '开始')}</span>
            <input class="field__input" type="date" data-sales-from="${merchantId}" value="${range.from}">
          </label>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('終了日', '结束')}</span>
            <input class="field__input" type="date" data-sales-to="${merchantId}" value="${range.to}">
          </label>
          <button type="button" class="btn btn--secondary btn--sm" data-sales-query="${merchantId}">
            ${FOS.i18n.t('照会', '查询')}
          </button>
        </div>
        <div data-sales-custom="${merchantId}">
          ${salesCardsHtml(custom, { compact: true })}
          ${productRankingHtml(ranking)}
        </div>
      </div>`;
  }

  async function refreshMerchantSalesBlock(merchantId) {
    const wrap = document.querySelector(`[data-merchant-sales="${merchantId}"]`);
    if (!wrap) return;
    const customEl = wrap.querySelector(`[data-sales-custom="${merchantId}"]`);
    if (customEl) {
      customEl.innerHTML = `<div class="empty-state" style="padding:16px">${FOS.i18n.t('読み込み中...', '加载中...')}</div>`;
    }
    try {
      const range = ensureMerchantRange(merchantId);
      const [custom, ranking] = await Promise.all([
        FOS.merchantStats.getSummary({ merchantId, from: range.from, to: range.to }),
        FOS.merchantStats.getProductRanking({
          merchantId,
          from: range.from,
          to: range.to,
          limit: 10,
        }),
      ]);
      if (customEl) {
        customEl.innerHTML = `${salesCardsHtml(custom, { compact: true })}${productRankingHtml(ranking)}`;
      }
    } catch (e) {
      if (customEl) customEl.innerHTML = `<div class="alert alert--warn">${FOS.fmt.escapeHtml(e.message)}</div>`;
      else FOS.ui.toast(e.message, 'error');
    }
  }

  function bindMerchantSalesEvents(root) {
    root?.querySelectorAll('[data-sales-query]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const merchantId = btn.dataset.salesQuery;
        const from = root.querySelector(`[data-sales-from="${merchantId}"]`)?.value;
        const to = root.querySelector(`[data-sales-to="${merchantId}"]`)?.value;
        try {
          FOS.merchantStats.normalizeRange(from, to);
          merchantCustomRanges[merchantId] = { from, to };
          await refreshMerchantSalesBlock(merchantId);
        } catch (e) {
          FOS.ui.toast(e.message, 'error');
        }
      });
    });
  }

  function permsHtml(m) {
    const items = [
      { key: 'allow_order', label: FOS.i18n.t('注文', '下单') },
      { key: 'allow_order_app', label: FOS.i18n.t('接单端', '接单端') },
      { key: 'allow_admin_app', label: FOS.i18n.t('管理后台', '管理后台') },
      { key: 'allow_production_app', label: FOS.i18n.t('生产端', '生产端') },
    ];
    return `<div class="merchant-perms">${items
      .map(
        (it) =>
          `<span class="merchant-perm ${m[it.key] !== false ? 'merchant-perm--on' : ''}">${it.label}</span>`
      )
      .join('')}</div>`;
  }

  async function merchantDetailHtml(merchant) {
    const [usage, admin, delivery, sales] = await Promise.all([
      FOS.merchants.getUsage(merchant.id),
      FOS.merchants.getFactoryAdmin(merchant.id),
      FOS.merchants.getDeliveryAdmin(merchant.id),
      loadMerchantSalesBlock(merchant.id),
    ]);
    const adminLine = admin
      ? `<div style="font-size:14px;margin-bottom:8px;color:var(--text-secondary)">
          ${FOS.i18n.t('管理アカウント', '管理账号')}：
          <code style="font-family:var(--font-mono)">${FOS.fmt.escapeHtml(admin.id)}</code>
        </div>`
      : `<div class="alert alert--warn" style="margin-bottom:8px">${FOS.i18n.t('管理アカウント未設定', '尚未设置管理账号')}</div>`;
    const deliveryLine = delivery
      ? `<div style="font-size:14px;margin-bottom:12px;color:var(--text-secondary)">
          ${FOS.i18n.t('配送アカウント', '配送账号')}：
          <code style="font-family:var(--font-mono)">${FOS.fmt.escapeHtml(delivery.id)}</code>
        </div>`
      : `<div style="font-size:14px;margin-bottom:12px;color:var(--text-tertiary)">${FOS.i18n.t('配送アカウント未設定', '尚未设置配送账号')}</div>`;
    return `
      ${adminLine}
      ${deliveryLine}
      <div class="merchant-detail-grid">
        <div class="stat-card">
          <div class="stat-card__label">${FOS.i18n.t('ユーザー数', '用户数')}</div>
          <div class="stat-card__value">${usage.users}<span style="font-size:14px;color:var(--text-tertiary)"> / ${usage.limits.max_users}</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">${FOS.i18n.t('商品数', '商品数')}</div>
          <div class="stat-card__value">${usage.products}<span style="font-size:14px;color:var(--text-tertiary)"> / ${usage.limits.max_products}</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">${FOS.i18n.t('プラン', '套餐')}</div>
          <div class="stat-card__value" style="font-size:18px">${FOS.merchants.planLabel(merchant.plan_type)}</div>
        </div>
      </div>
      ${permsHtml(merchant)}
      ${merchantSalesHtml(sales, merchant.id)}
      ${merchant.notes ? `<p style="margin-top:12px;font-size:14px;color:var(--text-secondary)">${FOS.fmt.escapeHtml(merchant.notes)}</p>` : ''}
    `;
  }

  async function paintMerchantList() {
    const el = document.getElementById('merchantList');
    if (!el) return;

    if (!merchants.length) {
      el.innerHTML = FOS.ui.empty('🏢', FOS.i18n.t('商家がありません', '暂无商家'));
      return;
    }

    el.innerHTML = merchants
      .map((m) => {
        const active = m.status !== 'suspended';
        const statusBadge = active
          ? `<span class="badge badge--green">${FOS.merchants.statusLabel(m.status)}</span>`
          : `<span class="badge badge--red">${FOS.merchants.statusLabel(m.status)}</span>`;
        return `
        <div class="merchant-card ${active ? 'merchant-card--active' : 'merchant-card--suspended'}" data-merchant="${m.id}">
          <div class="merchant-card__head" data-toggle-detail="${m.id}">
            <div>
              <span class="merchant-card__id">${FOS.fmt.escapeHtml(m.id)}</span>
              <div class="merchant-card__title">${FOS.fmt.escapeHtml(m.name)}</div>
              <div class="merchant-card__meta">
                ${m.contact_name ? FOS.fmt.escapeHtml(m.contact_name) : '—'}
                ${m.phone ? ` · ${FOS.fmt.escapeHtml(m.phone)}` : ''}
                <br>${FOS.merchants.planLabel(m.plan_type)} · ${statusBadge}
              </div>
            </div>
            <div class="merchant-card__actions">
              <button type="button" class="btn btn--secondary btn--sm" data-edit="${m.id}">✏️</button>
              <button type="button" class="btn btn--${active ? 'danger' : 'primary'} btn--sm" data-toggle-status="${m.id}">
                ${active ? FOS.i18n.t('停止', '停用') : FOS.i18n.t('有効化', '启用')}
              </button>
            </div>
          </div>
          <div class="merchant-card__body" id="detail_${m.id}"></div>
        </div>`;
      })
      .join('');

    el.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = merchants.find((x) => x.id === btn.dataset.edit);
        if (m) openEditModal(m);
      });
    });

    el.querySelectorAll('[data-toggle-status]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = merchants.find((x) => x.id === btn.dataset.toggleStatus);
        if (m) toggleMerchantStatus(m);
      });
    });

    el.querySelectorAll('[data-toggle-detail]').forEach((head) => {
      head.addEventListener('click', async (e) => {
        if (e.target.closest('[data-edit]') || e.target.closest('[data-toggle-status]')) return;
        const id = head.dataset.toggleDetail;
        const body = document.getElementById('detail_' + id);
        if (!body) return;
        const open = body.classList.toggle('open');
        if (open) {
          body.innerHTML = `<div class="empty-state" style="padding:20px">${FOS.i18n.t('読み込み中...', '加载中...')}</div>`;
          const m = merchants.find((x) => x.id === id);
          if (m) {
            body.innerHTML = await merchantDetailHtml(m);
            bindMerchantSalesEvents(body);
          }
        }
      });
    });
  }

  async function renderSalesPage() {
    FOS.shell.setPageTitle(FOS.i18n.t('売上統計', '销售统计'));
    ensureSalesRangeDefaults();
    FOS.ui.showLoading();
    await loadMerchants();
    let snapshots;
    let breakdown = [];
    try {
      snapshots = await FOS.merchantStats.getGlobalSnapshots();
      breakdown = await FOS.merchantStats.getMerchantBreakdown({
        from: salesRangeFrom,
        to: salesRangeTo,
      });
    } catch (e) {
      FOS.ui.hideLoading();
      FOS.ui.toast(e.message, 'error');
      return;
    }
    FOS.ui.hideLoading();

    const main = document.getElementById('appMain');
    const monthLabel = snapshots.monthRange.from.slice(0, 7);

    main.innerHTML = `
      ${FOS.ui.pageHeader(
        FOS.i18n.t('全商家売上', '全商家销售'),
        FOS.i18n.t('キャンセル注文を除く集計', '已排除 cancelled 订单的汇总')
      )}
      <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:8px">
        ${FOS.i18n.t('本日', '今日')}
      </div>
      ${salesCardsHtml(snapshots.today)}
      <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin:18px 0 8px">
        ${FOS.i18n.t('今月', '本月')}（${monthLabel}）
      </div>
      ${salesCardsHtml(snapshots.month)}
      <div class="sales-stats-section" style="border-top:none;padding-top:0;margin-top:20px">
        <div class="sales-stats-section__title">${FOS.i18n.t('期間別・商家別', '按区间 · 按商家')}</div>
        <div class="sales-toolbar">
          <label class="field">
            <span class="field__label">${FOS.i18n.t('開始日', '开始')}</span>
            <input class="field__input" type="date" id="globalSalesFrom" value="${salesRangeFrom}">
          </label>
          <label class="field">
            <span class="field__label">${FOS.i18n.t('終了日', '结束')}</span>
            <input class="field__input" type="date" id="globalSalesTo" value="${salesRangeTo}">
          </label>
          <button type="button" class="btn btn--secondary btn--sm" id="globalSalesQuery">
            ${FOS.i18n.t('照会', '查询')}
          </button>
        </div>
        <div id="globalSalesBreakdown">
          ${breakdown.length ? breakdown.map((row) => `
            <div class="merchant-sales-row">
              <div>
                <div class="merchant-sales-row__name">${FOS.fmt.escapeHtml(merchantNameById(row.merchantId))}</div>
                <div class="merchant-sales-row__meta">
                  ${FOS.fmt.escapeHtml(row.merchantId)} · ${row.orderCount} ${FOS.i18n.t('件', '单')}
                </div>
              </div>
              <div class="merchant-sales-row__value">${FOS.fmt.money(row.salesTotal)}</div>
            </div>`).join('') : FOS.ui.empty('📊', FOS.i18n.t('該当期間のデータなし', '该时段暂无数据'))}
        </div>
      </div>
    `;

    document.getElementById('globalSalesQuery')?.addEventListener('click', async () => {
      const from = document.getElementById('globalSalesFrom')?.value;
      const to = document.getElementById('globalSalesTo')?.value;
      try {
        FOS.merchantStats.normalizeRange(from, to);
        salesRangeFrom = from;
        salesRangeTo = to;
        const el = document.getElementById('globalSalesBreakdown');
        if (el) el.innerHTML = `<div class="empty-state" style="padding:20px">${FOS.i18n.t('読み込み中...', '加载中...')}</div>`;
        const rows = await FOS.merchantStats.getMerchantBreakdown({ from, to });
        if (!rows.length) {
          el.innerHTML = FOS.ui.empty('📊', FOS.i18n.t('該当期間のデータなし', '该时段暂无数据'));
          return;
        }
        el.innerHTML = rows.map((row) => `
          <div class="merchant-sales-row">
            <div>
              <div class="merchant-sales-row__name">${FOS.fmt.escapeHtml(merchantNameById(row.merchantId))}</div>
              <div class="merchant-sales-row__meta">
                ${FOS.fmt.escapeHtml(row.merchantId)} · ${row.orderCount} ${FOS.i18n.t('件', '单')}
              </div>
            </div>
            <div class="merchant-sales-row__value">${FOS.fmt.money(row.salesTotal)}</div>
          </div>`).join('');
      } catch (e) {
        FOS.ui.toast(e.message, 'error');
      }
    });
  }

  async function renderMerchantsPage() {
    FOS.shell.setPageTitle(FOS.i18n.t('商家管理', '商家管理'));
    FOS.ui.showLoading();
    await loadMerchants();
    let snapshots = null;
    try {
      snapshots = await FOS.merchantStats.getGlobalSnapshots();
    } catch (e) {
      console.warn('[super-admin] sales snapshot:', e.message);
    }
    FOS.ui.hideLoading();

    const activeCount = merchants.filter((m) => m.status !== 'suspended').length;
    const main = document.getElementById('appMain');

    main.innerHTML = `
      ${FOS.ui.pageHeader(
        FOS.i18n.t('商家一覧', '商家列表'),
        FOS.i18n.t('全テナントの状態・制限を管理', '管理所有租户的状态与限制')
      )}
      ${snapshots ? `
      <div class="sales-stats-section" style="border-top:none;padding-top:0;margin-bottom:16px">
        <div class="sales-stats-section__title">${FOS.i18n.t('全平台売上', '全平台销售')}</div>
        <div class="sales-stats-grid">
          <div class="stat-card">
            <div class="stat-card__label">${FOS.i18n.t('本日売上', '今日销售额')}</div>
            <div class="stat-card__value">${FOS.fmt.money(snapshots.today.salesTotal)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__label">${FOS.i18n.t('本日注文', '今日订单')}</div>
            <div class="stat-card__value">${snapshots.today.orderCount}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__label">${FOS.i18n.t('今月売上', '本月销售额')}</div>
            <div class="stat-card__value">${FOS.fmt.money(snapshots.month.salesTotal)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card__label">${FOS.i18n.t('今月注文', '本月订单')}</div>
            <div class="stat-card__value">${snapshots.month.orderCount}</div>
          </div>
        </div>
      </div>` : ''}
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card__label">${FOS.i18n.t('合計', '合计')}</div>
          <div class="stat-card__value">${merchants.length}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">${FOS.i18n.t('有効', '启用中')}</div>
          <div class="stat-card__value" style="color:var(--success)">${activeCount}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card__label">${FOS.i18n.t('停止中', '已停用')}</div>
          <div class="stat-card__value" style="color:var(--danger)">${merchants.length - activeCount}</div>
        </div>
      </div>
      <div class="toolbar">
        <input type="search" class="field__input" id="merchantSearch" placeholder="${FOS.i18n.t('検索...', '搜索...')}"
          value="${FOS.fmt.escapeHtml(listSearch)}" style="min-width:180px;flex:1;max-width:280px">
        <select class="filter-select" id="merchantStatusFilter">
          <option value="">${FOS.i18n.t('全状態', '全部状态')}</option>
          <option value="active" ${listStatus === 'active' ? 'selected' : ''}>${FOS.i18n.t('有効', '启用')}</option>
          <option value="suspended" ${listStatus === 'suspended' ? 'selected' : ''}>${FOS.i18n.t('停止', '停用')}</option>
        </select>
        <button type="button" class="btn btn--primary btn--sm" id="addMerchantBtn">＋ ${FOS.i18n.t('商家追加', '新增商家')}</button>
        <button type="button" class="btn btn--secondary btn--sm" id="refreshMerchantsBtn">↻</button>
      </div>
      <div id="merchantList"></div>
    `;

    document.getElementById('merchantSearch')?.addEventListener('input', async (e) => {
      listSearch = e.target.value;
      await loadMerchants();
      await paintMerchantList();
    });

    document.getElementById('merchantStatusFilter')?.addEventListener('change', async (e) => {
      listStatus = e.target.value;
      FOS.ui.showLoading();
      await loadMerchants();
      FOS.ui.hideLoading();
      paintMerchantList();
    });

    document.getElementById('addMerchantBtn')?.addEventListener('click', openCreateModal);
    document.getElementById('refreshMerchantsBtn')?.addEventListener('click', renderMerchantsPage);

    await paintMerchantList();
  }

  boot();
})();
