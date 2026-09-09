/**
 * 汉印云打印 SDK（浏览器版）
 * API: https://openapi.hprtcloud.com
 */
window.FOS = window.FOS || {};

FOS.hprtCloud = {
  BASE_URL: 'https://openapi.hprtcloud.com',

  async sign(userSecret, userKey, timestamp) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(String(userSecret || '')),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(userKey || '') + String(timestamp)));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  },

  async request(path, { userKey, userSecret, params = {}, timeout = 15000 } = {}) {
    if (!userKey || !userSecret) {
      throw new Error(FOS.i18n.t('汉印云 userKey / userSecret 未配置', '汉印云 userKey / userSecret 未配置'));
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await FOS.hprtCloud.sign(userSecret, userKey, timestamp);
    const body = {
      user_key: userKey,
      timestamp,
      signature,
      ...params,
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(`${FOS.hprtCloud.BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw new Error(FOS.i18n.t('汉印云请求超时', '汉印云请求超时'));
      }
      throw new Error(
        FOS.i18n.t(
          '汉印云连接失败（网络或跨域限制）',
          '汉印云连接失败（请检查网络；浏览器若被跨域拦截，请用 APP 或配置服务端代理）'
        )
      );
    } finally {
      clearTimeout(timer);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(FOS.i18n.t('汉印云返回格式异常', '汉印云返回格式异常'));
    }

    const code = data?.code ?? data?.status;
    if (code !== 0 && code !== '0' && code !== 200 && code !== '200' && data?.success !== true) {
      const msg = data?.msg || data?.message || data?.error || JSON.stringify(data);
      throw new Error(String(msg));
    }
    return data;
  },

  sendPrintTask(cfg, { content, orderNo, printType = 'ESC' } = {}) {
    const sn = String(cfg.equipmentSn || cfg.equipment_sn || '').trim();
    if (!sn) throw new Error(FOS.i18n.t('打印机 SN 未配置', '打印机 SN 未配置'));
    if (!content) throw new Error(FOS.i18n.t('打印内容为空', '打印内容为空'));
    return FOS.hprtCloud.request('/api/v1/printTask', {
      userKey: cfg.userKey,
      userSecret: cfg.userSecret,
      params: {
        equipment_sn: sn,
        content,
        print_type: printType,
        order_no: orderNo ? String(orderNo).slice(0, 40) : undefined,
      },
    });
  },

  getPrinterStatus(cfg) {
    const sn = String(cfg.equipmentSn || '').trim();
    if (!sn) throw new Error(FOS.i18n.t('打印机 SN 未配置', '打印机 SN 未配置'));
    return FOS.hprtCloud.request('/api/v1/equipmentStatus', {
      userKey: cfg.userKey,
      userSecret: cfg.userSecret,
      params: { items: [sn] },
    });
  },

  bindPrinter(cfg, { name, equipmentSecret = '' } = {}) {
    const sn = String(cfg.equipmentSn || '').trim();
    if (!sn) throw new Error(FOS.i18n.t('打印机 SN 未配置', '打印机 SN 未配置'));
    return FOS.hprtCloud.request('/api/v1/bindEquipment', {
      userKey: cfg.userKey,
      userSecret: cfg.userSecret,
      params: {
        items: [{
          name: name || sn,
          equipment_sn: sn,
          equipment_secret: equipmentSecret || '',
        }],
      },
    });
  },
};
