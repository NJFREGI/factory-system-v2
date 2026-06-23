window.FOS = window.FOS || {};

FOS.theme = {
  mode: 'light',

  init() {
    FOS.theme.mode = 'light';
    localStorage.setItem(FOS.CONFIG.STORAGE_PREFIX + 'theme', 'light');
    FOS.theme.apply();
  },

  apply() {
    FOS.theme.mode = 'light';
    document.documentElement.setAttribute('data-theme', 'light');
  },

  toggle() {
    /* 夜间模式已停用 */
  },

  isDark() {
    return FOS.theme.mode === 'dark';
  },
};
