window.FOS = window.FOS || {};

FOS.auth = {
  user: null,
  expectedRoles: [],
  lastBlockReason: null,

  _persistSession(user) {
    FOS.storage.set('session', {
      id: user.id,
      name: user.name,
      role: user.role,
      merchant_id: FOS.merchants?.resolveMerchantId?.(user) ?? user.merchant_id ?? null,
    });
  },

  async _validateMerchantAccess(user) {
    if (!FOS.merchants?.assertAccess) return;
    await FOS.merchants.assertAccess(user, FOS.APP_ID);
  },

  async restoreSession() {
    const saved = FOS.storage.get('session');
    if (!saved?.id) return null;

    const { data, error } = await FOS.db.sb
      .from('users')
      .select('*')
      .eq('id', saved.id)
      .eq('active', true)
      .single();

    if (error || !data) {
      FOS.storage.set('session', null);
      return null;
    }

    if (FOS.auth.expectedRoles.length && !FOS.auth.expectedRoles.includes(data.role)) {
      FOS.storage.set('session', null);
      return null;
    }

    try {
      await FOS.auth._validateMerchantAccess(data);
    } catch (e) {
      FOS.auth.lastBlockReason = e.message;
      FOS.storage.set('session', null);
      FOS.auth.user = null;
      FOS.merchants?.clearCache?.();
      return null;
    }

    FOS.auth.user = data;
    FOS.auth._persistSession(data);
    return data;
  },

  async login(userId, password) {
    const uid = (userId || '').trim();
    const pass = (password || '').trim();
    const { data, error } = await FOS.db.sb
      .from('users')
      .select('*')
      .eq('id', uid)
      .eq('password_hash', pass)
      .eq('active', true)
      .single();

    if (error || !data) {
      throw new Error(FOS.i18n.t('IDまたはパスワードが違います', 'ID或密码错误'));
    }

    if (FOS.auth.expectedRoles.length && !FOS.auth.expectedRoles.includes(data.role)) {
      throw new Error(FOS.i18n.t('端末タイプが一致しません', '账号类型不匹配'));
    }

    await FOS.auth._validateMerchantAccess(data);

    const merchantHint = FOS.shopQr?.peekMerchantHint?.() || FOS.storage.get('login_merchant_hint');
    if (merchantHint) {
      const userMerchant = data.merchant_id || FOS.CONFIG.DEFAULT_MERCHANT_ID;
      if (userMerchant !== merchantHint) {
        throw new Error(FOS.i18n.t(
          'この店舗は指定の商家に属していません',
          '该店铺不属于此商家，请重新扫码'
        ));
      }
    }
    FOS.shopQr?.consumeMerchantHint?.();
    FOS.storage.set('login_merchant_hint', null);

    FOS.auth.user = data;
    FOS.auth._persistSession(data);
    return data;
  },

  logout() {
    FOS.auth.user = null;
    FOS.auth.lastBlockReason = null;
    FOS.storage.set('session', null);
    FOS.merchants?.clearCache?.();
  },

  consumeBlockReason() {
    const msg = FOS.auth.lastBlockReason;
    FOS.auth.lastBlockReason = null;
    return msg;
  },
};
