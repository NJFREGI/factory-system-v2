window.FOS = window.FOS || {};

FOS.storage = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(FOS.CONFIG.STORAGE_PREFIX + key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    if (value === null || value === undefined) {
      localStorage.removeItem(FOS.CONFIG.STORAGE_PREFIX + key);
      return;
    }
    localStorage.setItem(FOS.CONFIG.STORAGE_PREFIX + key, JSON.stringify(value));
  },
  getLang() {
    return localStorage.getItem(FOS.CONFIG.STORAGE_PREFIX + 'lang') || 'ja';
  },
  setLang(lang) {
    localStorage.setItem(FOS.CONFIG.STORAGE_PREFIX + 'lang', lang);
  },
};
