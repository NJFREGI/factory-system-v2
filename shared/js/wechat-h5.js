/**
 * 微信内置浏览器 / iOS H5 适配（顾客下单页）
 */
window.FOS = window.FOS || {};

FOS.wechatH5 = {
  isWeChat() {
    return /MicroMessenger/i.test(navigator.userAgent || '');
  },

  isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
  },

  init() {
    const body = document.body;
    if (!body) return;
    if (FOS.wechatH5.isWeChat()) body.classList.add('wechat-h5');
    if (FOS.wechatH5.isIOS()) body.classList.add('ios-h5');

    const setVh = () => {
      document.documentElement.style.setProperty('--co-vh', `${window.innerHeight * 0.01}px`);
    };
    setVh();
    window.addEventListener('resize', setVh);
    window.addEventListener('orientationchange', () => setTimeout(setVh, 120));

    if (FOS.wechatH5.isIOS()) {
      document.addEventListener('focusin', (e) => {
        if (!e.target.closest('.fos-modal')) return;
        setTimeout(() => {
          e.target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        }, 300);
      });
    }
  },
};
