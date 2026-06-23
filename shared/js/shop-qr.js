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
    if (!FOS.appUrls?.isLocalOrigin?.(location.origin)) {
      const path = location.pathname || '';
      const idx = path.indexOf('/apps/');
      const root = idx >= 0 ? path.slice(0, idx) : '';
      return `${location.origin}${root}`;
    }
    return FOS.appUrls?.normalizeBase?.(FOS.CONFIG.PUBLIC_APP_BASE_URL || '') || '';
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

  async copyLink(text) {
    const value = String(text || '').trim();
    if (!value) return false;

    try {
      const { Clipboard } = window.Capacitor?.Plugins || {};
      if (Clipboard?.write) {
        await Clipboard.write({ string: value });
        return true;
      }
    } catch {
      /* try next */
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch {
      /* try next */
    }

    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  },

  async downloadPng(text, filename) {
    const canvas = document.createElement('canvas');
    const ok = await FOS.shopQr.renderToCanvas(canvas, text);
    let blob = null;
    if (ok) {
      blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
    }
    if (!blob) {
      const res = await fetch(FOS.shopQr.fallbackImageUrl(text, 320));
      blob = await res.blob();
    }
    if (!blob) throw new Error('QR image failed');

    const safeName = (filename || 'shop-qr.png').replace(/[^\w.\-]/g, '_');
    if (!safeName.toLowerCase().endsWith('.png')) {
      return FOS.shopQr.downloadPng(text, `${safeName}.png`);
    }

    if (FOS.native?.downloadImageBlob) {
      const saved = await FOS.native.downloadImageBlob(blob, safeName);
      if (saved) return;
    }

    if (navigator.share) {
      try {
        const file = new File([blob], safeName, { type: 'image/png' });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: safeName });
          return;
        }
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  },
};
