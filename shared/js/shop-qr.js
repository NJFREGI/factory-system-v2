/**
 * Phase 6 · 接单端二维码登录预填
 * 二维码仅携带 shop / merchant，不绕过密码登录
 */
window.FOS = window.FOS || {};

FOS.shopQr = {
  HINT_KEY: 'login_merchant_hint',

  appBaseUrl() {
    const base = FOS.appUrls?.publicBase?.();
    if (base) return base;
    const path = location.pathname || '';
    const idx = path.indexOf('/apps/');
    const root = idx >= 0 ? path.slice(0, idx) : '';
    return `${location.origin}${root}`;
  },

  buildOrderLoginUrl({ shopId, merchantId } = {}) {
    const url = new URL(`${FOS.shopQr.appBaseUrl()}/apps/order/`);
    if (shopId) url.searchParams.set('shop', String(shopId).trim());
    if (merchantId) url.searchParams.set('merchant', String(merchantId).trim());
    return url.toString();
  },

  parseFromLocation(loc = window.location) {
    const params = new URLSearchParams(loc.search || '');
    return {
      shopId: (params.get('shop') || params.get('shop_id') || '').trim(),
      merchantId: (params.get('merchant') || params.get('merchant_id') || '').trim(),
    };
  },

  saveMerchantHint(merchantId) {
    if (merchantId) FOS.storage.set(FOS.shopQr.HINT_KEY, merchantId);
    else FOS.storage.set(FOS.shopQr.HINT_KEY, null);
  },

  consumeMerchantHint() {
    const hint = FOS.storage.get(FOS.shopQr.HINT_KEY);
    FOS.storage.set(FOS.shopQr.HINT_KEY, null);
    return hint || '';
  },

  peekMerchantHint() {
    return FOS.storage.get(FOS.shopQr.HINT_KEY) || '';
  },

  cleanUrl(loc = window.location) {
    const { shopId, merchantId } = FOS.shopQr.parseFromLocation(loc);
    if (!shopId && !merchantId) return;
    const url = new URL(loc.href);
    ['shop', 'shop_id', 'merchant', 'merchant_id'].forEach((k) => url.searchParams.delete(k));
    const next = url.pathname + url.search + url.hash;
    window.history.replaceState({}, '', next);
  },

  async renderToCanvas(canvas, text) {
    if (!canvas || !text) return false;
    if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
      await QRCode.toCanvas(canvas, text, {
        width: 240,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
      });
      return true;
    }
    return false;
  },

  fallbackImageUrl(text, size = 240) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
  },

  async paintQr(target, text) {
    if (!target || !text) return;
    if (target.tagName === 'CANVAS') {
      const ok = await FOS.shopQr.renderToCanvas(target, text);
      if (ok) return;
      const img = document.createElement('img');
      img.className = 'shop-qr-modal__img';
      img.alt = 'QR';
      img.src = FOS.shopQr.fallbackImageUrl(text);
      img.width = 240;
      img.height = 240;
      target.replaceWith(img);
      return;
    }
    if (target.tagName === 'IMG') {
      target.src = FOS.shopQr.fallbackImageUrl(text);
    }
  },

  async downloadPng(text, filename) {
    const canvas = document.createElement('canvas');
    const ok = await FOS.shopQr.renderToCanvas(canvas, text);
    const finish = (blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'shop-qr.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    };
    if (ok) {
      return new Promise((resolve) => {
        canvas.toBlob((blob) => {
          if (blob) finish(blob);
          resolve();
        }, 'image/png');
      });
    }
    const res = await fetch(FOS.shopQr.fallbackImageUrl(text, 320));
    finish(await res.blob());
  },
};
