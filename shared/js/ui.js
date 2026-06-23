window.FOS = window.FOS || {};

FOS.ui = {
  showLoading(msg) {
    const el = document.getElementById('loadingOverlay');
    const text = document.getElementById('loadingText');
    if (text) text.textContent = msg || FOS.i18n.t('読み込み中...', '加载中...');
    if (el) el.hidden = false;
  },

  hideLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.hidden = true;
  },

  toast(msg, type = 'info') {
    let box = document.getElementById('fosToast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'fosToast';
      box.className = 'fos-toast';
      document.body.appendChild(box);
    }
    box.className = 'fos-toast fos-toast--' + type + ' show';
    box.textContent = msg;
    clearTimeout(FOS.ui._toastTimer);
    FOS.ui._toastTimer = setTimeout(() => box.classList.remove('show'), 3200);
  },

  showOrderSuccess({ orderNo, total, merged = false, onConfirm }) {
    FOS.ui.closeOrderSuccess?.();
    const overlay = document.createElement('div');
    overlay.id = 'orderSuccessOverlay';
    overlay.className = 'order-success-overlay';
    const title = merged
      ? FOS.i18n.t('ご注文を更新しました', '订单已更新')
      : FOS.i18n.t('ご注文ありがとうございます', '感谢您的订单');
    const amount = FOS.fmt.money(total);
    overlay.innerHTML = `
      <div class="order-success-dialog" role="dialog" aria-modal="true">
        <div class="order-success-dialog__icon" aria-hidden="true">✓</div>
        <h2 class="order-success-dialog__title">${title}</h2>
        <p class="order-success-dialog__line">
          ${FOS.i18n.t('注文番号', '订单号')} <strong>#${FOS.fmt.escapeHtml(String(orderNo))}</strong>
        </p>
        <p class="order-success-dialog__amount">
          ${FOS.i18n.t('金額', '金额')} <strong>${amount}</strong>
          <span class="order-success-dialog__tax">${FOS.i18n.t('（税込）', '（税込）')}</span>
        </p>
        <button type="button" class="btn btn--primary btn--block btn--lg order-success-dialog__btn" data-order-success-close>
          ${FOS.i18n.t('OK', '确定')}
        </button>
      </div>`;
    document.body.appendChild(overlay);
    let confirmed = false;
    const finish = async () => {
      if (confirmed) return;
      confirmed = true;
      clearTimeout(FOS.ui._orderSuccessTimer);
      overlay.remove();
      if (typeof onConfirm === 'function') {
        try {
          await onConfirm();
        } catch (err) {
          FOS.ui.toast(
            err?.message || FOS.i18n.t('送信の確定に失敗しました', '订单确认失败，请重试'),
            'error'
          );
        }
      }
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-order-success-close]')) finish();
    });
    FOS.ui._orderSuccessTimer = setTimeout(() => finish(), 8000);
  },

  closeOrderSuccess() {
    clearTimeout(FOS.ui._orderSuccessTimer);
    document.getElementById('orderSuccessOverlay')?.remove();
  },

  confirm(msg) {
    return window.confirm(msg);
  },

  showBottomNav() {
    document.documentElement.classList.remove('fos-keyboard-open');
  },

  hideBottomNav() {
    if (FOS.ui.pinBottomNav()) return;
    document.documentElement.classList.add('fos-keyboard-open');
  },

  /** 管理端 / 配送端：底部导航始终固定，不因键盘或输入框焦点隐藏 */
  pinBottomNav() {
    const app = document.body.getAttribute('data-app');
    const role = document.body.getAttribute('data-role');
    return app === 'admin' || (app === 'production' && role === 'delivery');
  },

  bindKeyboardNavHide() {
    FOS.ui.showBottomNav();
    if (FOS.ui._keyboardNavBound) return FOS.ui._keyboardNavCleanup || (() => {});
    FOS.ui._keyboardNavBound = true;

    const vv = window.visualViewport;
    const appMain = () => document.getElementById('appMain');
    let showTimer = null;
    let pollTimer = null;
    const KEYBOARD_SHRINK_PX = 40;

    const resetVvMax = () => {
      FOS.ui._vvMax = vv?.height || window.innerHeight;
    };
    resetVvMax();

    const isMobile = () => window.innerWidth <= 1023;
    const isNativeApp = () => FOS.native?.isApp?.() === true;
    const isFormControl = (el) => el?.matches?.('input, textarea, select');

    const viewportKeyboardOpen = () => {
      if (!vv) return false;
      const h = vv.height;
      const shrink = (FOS.ui._vvMax || h) - h;
      if (shrink <= KEYBOARD_SHRINK_PX) {
        FOS.ui._vvMax = Math.max(FOS.ui._vvMax || h, h);
        return false;
      }
      return true;
    };

    const sync = () => {
      if (FOS.ui.pinBottomNav()) {
        FOS.ui.showBottomNav();
        return;
      }
      if (!isMobile()) {
        FOS.ui.showBottomNav();
        return;
      }
      if (isNativeApp()) {
        const active = document.activeElement;
        if (isFormControl(active) && appMain()?.contains(active)) FOS.ui.hideBottomNav();
        else FOS.ui.showBottomNav();
        return;
      }
      if (viewportKeyboardOpen()) {
        FOS.ui.hideBottomNav();
        return;
      }
      FOS.ui.showBottomNav();
    };

    const scheduleSync = (delay = 120) => {
      clearTimeout(showTimer);
      showTimer = setTimeout(sync, delay);
    };

    const onFocusIn = (e) => {
      if (FOS.ui.pinBottomNav()) return;
      if (!isMobile() || !isFormControl(e.target) || !appMain()?.contains(e.target)) return;
      FOS.ui.hideBottomNav();
      scheduleSync(350);
    };

    const onFocusOut = () => scheduleSync(80);

    const onPointerDown = (e) => {
      if (!isMobile()) return;
      if (isFormControl(e.target)) return;
      scheduleSync(100);
    };

    const onOrientation = () => {
      setTimeout(() => {
        resetVvMax();
        sync();
      }, 320);
    };

    const startPollWhileHidden = () => {
      clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        if (!document.documentElement.classList.contains('fos-keyboard-open')) {
          clearInterval(pollTimer);
          pollTimer = null;
          return;
        }
        sync();
      }, 400);
    };

    const onFocusInPoll = (e) => {
      onFocusIn(e);
      startPollWhileHidden();
    };

    document.addEventListener('focusin', onFocusInPoll, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    if (vv) {
      vv.addEventListener('resize', sync);
      if (!isNativeApp()) vv.addEventListener('scroll', sync);
    }
    const onResize = () => {
      resetVvMax();
      sync();
    };

    window.addEventListener('orientationchange', onOrientation);
    window.addEventListener('resize', onResize);

    const cleanup = () => {
      FOS.ui._keyboardNavBound = false;
      clearTimeout(showTimer);
      clearInterval(pollTimer);
      document.removeEventListener('focusin', onFocusInPoll, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      if (vv) {
        vv.removeEventListener('resize', sync);
        if (!isNativeApp()) vv.removeEventListener('scroll', sync);
      }
      window.removeEventListener('orientationchange', onOrientation);
      window.removeEventListener('resize', onResize);
      FOS.ui.showBottomNav();
    };
    FOS.ui._keyboardNavCleanup = cleanup;
    sync();
    return cleanup;
  },

  ensureModal() {
    if (document.getElementById('fosModal')) return;
    const el = document.createElement('div');
    el.id = 'fosModal';
    el.className = 'fos-modal';
    el.hidden = true;
    el.innerHTML = `
      <div class="fos-modal__backdrop" data-modal-close></div>
      <div class="fos-modal__panel" role="dialog" aria-modal="true">
        <div class="fos-modal__head">
          <h2 class="fos-modal__title" id="fosModalTitle"></h2>
          <button type="button" class="btn btn--ghost btn--sm" data-modal-close aria-label="Close">✕</button>
        </div>
        <div class="fos-modal__body" id="fosModalBody"></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-modal-close]')) FOS.ui.closeModal();
    });
  },

  openModal({ title, bodyHtml, size }) {
    FOS.ui.ensureModal();
    const modal = document.getElementById('fosModal');
    const panel = modal.querySelector('.fos-modal__panel');
    document.getElementById('fosModalTitle').textContent = title || '';
    document.getElementById('fosModalBody').innerHTML = bodyHtml || '';
    panel.classList.toggle('fos-modal__panel--lg', size === 'lg');
    panel.classList.toggle('fos-modal__panel--full', size === 'full');
    panel.classList.toggle('fos-modal__panel--sheet', size === 'sheet');
    modal.classList.toggle('fos-modal--full', size === 'full');
    modal.classList.toggle('fos-modal--sheet', size === 'sheet');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    return modal;
  },

  closeModal() {
    FOS.barcodeScanner?._stop?.();
    FOS.ui.unlockEditorModal?.();
    const modal = document.getElementById('fosModal');
    if (!modal) return;
    modal.hidden = true;
    modal.classList.remove('fos-modal--full', 'fos-modal--sheet');
    const panel = modal.querySelector('.fos-modal__panel');
    if (panel) {
      panel.classList.remove('fos-modal__panel--lg', 'fos-modal__panel--full', 'fos-modal__panel--sheet');
    }
    document.body.style.overflow = '';
    document.getElementById('fosModalBody').innerHTML = '';
    document.querySelector('.product-editor__head-actions')?.remove();
    FOS.ui.showBottomNav();
  },

  pageHeader(title, desc) {
    return `
      <div class="page-header">
        <h1 class="page-header__title">${title}</h1>
        ${desc ? `<p class="page-header__desc">${desc}</p>` : ''}
      </div>`;
  },

  empty(icon, text) {
    return `<div class="empty-state"><div class="empty-state__icon">${icon}</div><div>${text}</div></div>`;
  },

  formatDateLabel(dateStr, emptyLabel) {
    if (!dateStr) return emptyLabel || FOS.i18n.t('全日付', '全部日期');
    return dateStr.replace(/-/g, '/');
  },

  dateTriggerHtml({ triggerId, labelId, value, emptyLabel, extraClass = '' }) {
    const cls = ['adm-date-trigger', extraClass].filter(Boolean).join(' ');
    const label = FOS.ui.formatDateLabel(value, emptyLabel);
    return `<button type="button" class="${cls}" id="${triggerId}" aria-label="${FOS.i18n.t('日付を選択', '选择日期')}">
      <span id="${labelId}">${label}</span>
      <span class="adm-date-trigger__icon" aria-hidden="true">▾</span>
    </button>`;
  },

  openActiveDateCalendar({ activeDates = [], selected, allowClear = false, onSelect } = {}) {
    FOS.calendar.open({
      activeDates,
      selected,
      onlyActiveDates: true,
      allowClear,
      onSelect,
    });
  },

  syncDateTriggerLabel(labelId, value, emptyLabel) {
    const el = document.getElementById(labelId);
    if (el) el.textContent = FOS.ui.formatDateLabel(value, emptyLabel);
  },

  /** @deprecated use FOS.shell.mount */
  mountShell(opts) {
    FOS.shell.mount({
      appId: FOS.APP_ID || 'app',
      brand: { icon: '🏭', title: opts.title, subtitle: opts.subtitle },
      nav: (opts.navItems || []).map((n) => ({
        id: n.id,
        label: n.label.replace(/<[^>]+>/g, ''),
        icon: '•',
      })),
      pageTitle: opts.title,
      onNavigate: opts.onNav,
    });
  },

  renderLogin({ title, hint, rolesLabel, heroTitle, heroDesc, heroBadge, onSubmit, prefillUser, prefillReadonly, prefillBanner, onShopIdInput }) {
    document.body.removeAttribute('data-app');
    const root = document.getElementById('app');
    const userVal = FOS.fmt.escapeHtml(prefillUser || '');
    const readonlyAttr = prefillReadonly && prefillUser ? 'readonly' : '';
    const badgeText = FOS.fmt.escapeHtml(heroBadge || rolesLabel || '');
    const hintHtml = hint
      ? `<p class="hint">${hint}</p>`
      : '';
    root.innerHTML = `
      <div class="fos-login">
        <div class="fos-login__hero">
          <h1>${heroTitle || title}</h1>
          <p class="fos-login__hero-desc">${heroDesc || ''}</p>
          ${badgeText ? `<p class="fos-login__shop-name" id="loginHeroBadge">${badgeText}</p>` : '<p class="fos-login__shop-name" id="loginHeroBadge" hidden></p>'}
        </div>
        <div class="fos-login__form-wrap">
          <div class="fos-login__card">
            <h2>${FOS.i18n.t('ログイン', '登录')}</h2>
            ${hintHtml}
            ${prefillBanner ? `<div class="alert alert--info login-prefill-banner">${prefillBanner}</div>` : ''}
            <form id="loginForm" class="fos-login__form">
              <label class="field">
                <span class="field__label">ID</span>
                <input class="field__input" id="loginUser" autocomplete="username" required value="${userVal}" ${readonlyAttr}>
              </label>
              <label class="field">
                <span class="field__label">${FOS.i18n.t('パスワード', '密码')}</span>
                <input class="field__input" id="loginPass" type="password" autocomplete="current-password" required>
              </label>
              <button type="submit" class="btn btn--primary btn--block btn--lg fos-login__submit" id="loginBtn">
                ${FOS.i18n.t('ログイン', '登录')}
              </button>
            </form>
            <div class="fos-login__footer">
              <button type="button" class="btn btn--ghost btn--sm fos-lang-btn" id="loginLangBtn">${FOS.i18n.langLabel()}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('loginLangBtn')?.addEventListener('click', () => FOS.i18n.toggle());
    if (typeof onShopIdInput === 'function') {
      const input = document.getElementById('loginUser');
      const badge = document.getElementById('loginHeroBadge');
      let shopTimer;
      const syncBadge = () => {
        clearTimeout(shopTimer);
        shopTimer = setTimeout(async () => {
          const name = await onShopIdInput(input?.value?.trim() || '');
          if (!badge) return;
          if (name) {
            badge.textContent = name;
            badge.hidden = false;
          } else {
            badge.textContent = '';
            badge.hidden = true;
          }
        }, 280);
      };
      input?.addEventListener('input', syncBadge);
      if (prefillUser) syncBadge();
    } else if (badgeText) {
      document.getElementById('loginHeroBadge')?.removeAttribute('hidden');
    }
    if (prefillUser) {
      setTimeout(() => document.getElementById('loginPass')?.focus(), 60);
    }
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      btn.disabled = true;
      try {
        await onSubmit(
          document.getElementById('loginUser').value,
          document.getElementById('loginPass').value
        );
      } catch (err) {
        FOS.ui.toast(err.message || String(err), 'error');
      } finally {
        btn.disabled = false;
      }
    });
  },
};
