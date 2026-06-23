/**
 * factory-system-v2 · 导航图标（灰色线性 SVG，全端一致）
 */
window.FOS = window.FOS || {};

FOS.navIcons = {
  _svg(inner) {
    return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  },

  icons: {
    orders:
      '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    summary:
      '<path d="M4 19V5M4 19h16"/><path d="M8 17V11M12 17V7M16 17v-4"/>',
    'public-stats':
      '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    products:
      '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    inventory:
      '<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/>',
    invoices:
      '<path d="M14 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M10 13h4M10 17h4"/>',
    payments:
      '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10h4.5a2 2 0 1 1 0 4H9"/>',
    settings:
      '<circle cx="12" cy="8" r="3.5"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>',
    delivery:
      '<path d="M3 6h11v9H3z"/><path d="M14 9h4l3 4v2h-7V9z"/><circle cx="7" cy="17" r="2"/><circle cx="18" cy="17" r="2"/>',
    factory:
      '<path d="M3 21V9l5-3v6l4-2v11"/><path d="M3 21h18"/><path d="M9 9V6l3-2 3 2v3"/>',
    favorites:
      '<path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.8 7.2 18l.9-5.4L4.2 8.7l5.4-.8z"/>',
    shop:
      '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M3 4h2l2.5 12h11L21 8H6"/>',
    history:
      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    merchants:
      '<path d="M4 21V9l8-5 8 5v12"/><path d="M9 21v-7h6v7"/>',
    sales:
      '<path d="M4 19V5M4 19h16"/><path d="M7 15l3-4 3 3 4-6"/>',
    shield:
      '<path d="M12 2l8 4v6c0 5-3.5 9.2-8 10-4.5-.8-8-5-8-10V6z"/>',
    gear:
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  },

  render(key) {
    const inner = this.icons[key];
    if (inner) return `<span class="fos-nav-icon">${this._svg(inner)}</span>`;
    if (typeof key === 'string' && key.includes('<svg')) {
      return `<span class="fos-nav-icon">${key}</span>`;
    }
    return `<span class="fos-nav-icon fos-nav-icon--emoji">${key || '•'}</span>`;
  },
};
