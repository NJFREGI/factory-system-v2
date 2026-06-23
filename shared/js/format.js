window.FOS = window.FOS || {};

FOS.fmt = {
  money(n) {
    return '¥' + Math.round(n || 0).toLocaleString();
  },

  today() {
    return new Date().toISOString().slice(0, 10);
  },

  displayName(name, lang) {
    if (!name) return '';
    const l = lang || FOS.i18n?.lang || 'ja';
    const parts = name.split(' / ');
    if (parts.length === 2) return l === 'zh' ? parts[1] : parts[0];
    return name;
  },

  status(status, lang) {
    const l = lang || FOS.i18n?.lang || 'ja';
    const map = {
      pending: { ja: '受付中', zh: '待处理', color: 'blue' },
      preparing: { ja: '準備中', zh: '准备中', color: 'orange' },
      shipped: { ja: '出荷完了', zh: '发货完成', color: 'blue' },
      delivered: { ja: '配達完了', zh: '已送达', color: 'green' },
      confirmed: { ja: '受取確認済', zh: '已确认', color: 'gray' },
    };
    const info = map[status] || { ja: status, zh: status, color: 'gray' };
    return { label: l === 'zh' ? info.zh : info.ja, color: info.color };
  },

  escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};
