window.FOS = window.FOS || {};

FOS.i18n = {
  lang: 'ja',

  init() {
    FOS.i18n.lang = FOS.storage.getLang();
    document.documentElement.lang = FOS.i18n.lang === 'zh' ? 'zh-CN' : 'ja';
    document.body.classList.toggle('lang-zh', FOS.i18n.lang === 'zh');
    document.body.classList.toggle('lang-ja', FOS.i18n.lang === 'ja');
  },

  toggle() {
    FOS.i18n.lang = FOS.i18n.lang === 'ja' ? 'zh' : 'ja';
    FOS.storage.setLang(FOS.i18n.lang);
    FOS.i18n.init();
    FOS.i18n.refreshLangButtons();
    FOS.i18n.refreshLoginTexts();
    if (typeof FOS.onLangChange === 'function') FOS.onLangChange();
  },

  langLabel() {
    return FOS.i18n.lang === 'zh' ? '日本語' : '中文';
  },

  refreshLangButtons() {
    const label = FOS.i18n.langLabel();
    document.querySelectorAll('#langToggle, #loginLangBtn').forEach((btn) => {
      btn.textContent = label;
    });
  },

  refreshLoginTexts() {
    if (!document.getElementById('loginForm')) return;
    const h2 = document.querySelector('.fos-login__card h2');
    if (h2) h2.textContent = FOS.i18n.t('ログイン', '登录');
    const passLabel = document.querySelector('#loginForm .field__label');
    const passField = document.querySelector('#loginPass')?.closest('.field')?.querySelector('.field__label');
    if (passField) passField.textContent = FOS.i18n.t('パスワード', '密码');
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.textContent = FOS.i18n.t('ログイン', '登录');
    const heroH1 = document.querySelector('.fos-login__hero h1');
    if (heroH1 && typeof FOS.ui._loginHeroTitle === 'function') {
      heroH1.textContent = FOS.ui._loginHeroTitle();
    }
    const heroDesc = document.querySelector('.fos-login__hero-desc');
    if (heroDesc && typeof FOS.ui._loginHeroDesc === 'function') {
      heroDesc.textContent = FOS.ui._loginHeroDesc();
    }
  },

  t(ja, zh) {
    return FOS.i18n.lang === 'zh' ? zh : ja;
  },
};
