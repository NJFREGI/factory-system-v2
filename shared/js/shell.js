window.FOS = window.FOS || {};

FOS.shell = {
  _onNav: null,
  _navItems: [],

  mount({ appId, brand, nav, pageTitle, onNavigate }) {
    document.body.setAttribute('data-app', appId);
    FOS.shell._onNav = onNavigate;
    FOS.shell._navItems = nav;

    const app = document.getElementById('app');
    const user = FOS.auth.user;

    app.innerHTML = `
      <div class="fos-sidebar-backdrop" id="sidebarBackdrop"></div>
      <div class="fos-app">
        <aside class="fos-sidebar" id="fosSidebar">
          <div class="fos-sidebar__brand">
            <div class="fos-sidebar__icon">${FOS.shell._renderNavIcon(brand.icon || 'gear')}</div>
            <div>
              <div class="fos-sidebar__title">${brand.title}</div>
              <div class="fos-sidebar__sub">${brand.subtitle || ''}</div>
            </div>
          </div>
          <nav class="fos-sidebar__nav" id="fosSidebarNav"></nav>
          <div class="fos-sidebar__footer">
            <div class="fos-sidebar__ext" id="sidebarExtSlot">${FOS.plugins.renderSlot('sidebar')}</div>
            <div style="font-size:12px;color:var(--text-tertiary);padding:4px 8px">
              ${user ? FOS.fmt.escapeHtml(user.name) : ''}
            </div>
          </div>
        </aside>
        <div class="fos-main">
          <header class="fos-topbar">
            <button type="button" class="fos-topbar__menu" id="menuToggle" aria-label="Menu">☰</button>
            <div class="fos-topbar__title" id="topbarTitle">${pageTitle || ''}</div>
            <div class="fos-topbar__actions">
              <div class="ext-slot" id="topbarExtSlot">${FOS.plugins.renderSlot('topbar')}</div>
              <button type="button" class="btn btn--ghost btn--sm fos-lang-btn" id="langToggle">${FOS.i18n.langLabel()}</button>
              <button type="button" class="btn btn--ghost btn--sm" id="logoutBtn">${FOS.i18n.t('ログアウト', '退出')}</button>
            </div>
          </header>
          <main class="fos-content" id="appMain"></main>
        </div>
        <nav class="fos-bottom-nav" id="fosBottomNav"></nav>
      </div>
    `;

    FOS.shell._paintNav(nav);
    FOS.theme.apply();
    FOS.ui._keyboardNavCleanup?.();
    FOS.ui.bindKeyboardNavHide();

    document.getElementById('menuToggle')?.addEventListener('click', FOS.shell._toggleSidebar);
    document.getElementById('sidebarBackdrop')?.addEventListener('click', FOS.shell._closeSidebar);
    document.getElementById('langToggle')?.addEventListener('click', () => FOS.i18n.toggle());
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      if (typeof FOS.onLogout === 'function') FOS.onLogout();
    });
  },

  _renderNavIcon(icon) {
    return FOS.navIcons?.render?.(icon) || `<span class="fos-nav-icon fos-nav-icon--emoji">${icon || '•'}</span>`;
  },

  _paintNav(nav) {
    const sidebarNav = document.getElementById('fosSidebarNav');
    const bottomNav = document.getElementById('fosBottomNav');
    if (!sidebarNav) return;

    const html = nav
      .map(
        (item, i) => `
        <button type="button" class="fos-nav-item${i === 0 ? ' active' : ''}" data-nav="${item.id}">
          ${FOS.shell._renderNavIcon(item.icon)}
          <span class="fos-nav-item__label">${item.label}</span>
          ${item.badge ? `<span class="fos-nav-item__badge">${item.badge}</span>` : ''}
        </button>`
      )
      .join('');

    sidebarNav.innerHTML = html;
    if (bottomNav) {
      bottomNav.innerHTML = nav
        .map(
          (item, i) => `
          <button type="button" class="fos-bottom-nav__item${i === 0 ? ' active' : ''}" data-nav="${item.id}">
            ${FOS.shell._renderNavIcon(item.icon)}
            <span class="fos-bottom-nav__label">${item.label}</span>
          </button>`
        )
        .join('');
    }

    const bind = (root) => {
      root?.querySelectorAll('[data-nav]').forEach((btn) => {
        btn.addEventListener('click', () => {
          FOS.shell.navigate(btn.dataset.nav);
          FOS.shell._closeSidebar();
        });
      });
    };
    bind(sidebarNav);
    bind(bottomNav);
  },

  navigate(id) {
    document.querySelectorAll('.fos-nav-item, .fos-bottom-nav__item').forEach((el) => {
      el.classList.toggle('active', el.dataset.nav === id);
    });
    const item = FOS.shell._navItems.find((n) => n.id === id);
    const titleEl = document.getElementById('topbarTitle');
    if (titleEl && item) titleEl.textContent = item.label;
    if (FOS.ui.pinBottomNav?.()) {
      const active = document.activeElement;
      if (active?.matches?.('input, textarea, select') && document.getElementById('appMain')?.contains(active)) {
        active.blur();
      }
      FOS.ui.showBottomNav();
    }
    if (FOS.shell._onNav) FOS.shell._onNav(id);
  },

  setPageTitle(title) {
    const el = document.getElementById('topbarTitle');
    if (el) el.textContent = title;
  },

  refreshLabels(nav) {
    const active =
      document.querySelector('.fos-bottom-nav__item.active')?.dataset.nav ||
      document.querySelector('.fos-nav-item.active')?.dataset.nav ||
      nav[0]?.id;
    FOS.shell._navItems = nav;
    FOS.shell._paintNav(nav);
    document.querySelectorAll('.fos-nav-item, .fos-bottom-nav__item').forEach((el) => {
      el.classList.toggle('active', el.dataset.nav === active);
    });
    const logout = document.getElementById('logoutBtn');
    if (logout) logout.textContent = FOS.i18n.t('ログアウト', '退出');
    FOS.i18n.refreshLangButtons();
  },

  updateNavBadge(id, badge) {
    const btn = document.querySelector(`.fos-nav-item[data-nav="${id}"]`);
    if (!btn) return;
    let b = btn.querySelector('.fos-nav-item__badge');
    if (!badge) {
      b?.remove();
      return;
    }
    if (!b) {
      b = document.createElement('span');
      b.className = 'fos-nav-item__badge';
      btn.appendChild(b);
    }
    b.textContent = badge;
  },

  _toggleSidebar() {
    document.getElementById('fosSidebar')?.classList.toggle('open');
    document.getElementById('sidebarBackdrop')?.classList.toggle('show');
  },

  _closeSidebar() {
    document.getElementById('fosSidebar')?.classList.remove('open');
    document.getElementById('sidebarBackdrop')?.classList.remove('show');
  },
};
