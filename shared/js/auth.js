window.FOS = window.FOS || {};

/**
 * 员工登录（工厂 / 门店 / 配送 / 总后台）
 * 使用 Supabase Auth：密码只在 Supabase 端以 bcrypt 校验，浏览器只保存 Supabase 的会话令牌。
 * 账号 ID 通过 fos_login_email() 映射为内部邮箱（与数据库函数 public.fos_login_email 一致）。
 */
FOS.auth = {
  user: null,
  expectedRoles: [],
  lastBlockReason: null,
  _signingOut: null,

  async loginEmail(userId) {
    const id = String(userId || '');
    const domain = FOS.CONFIG.LOGIN_EMAIL_DOMAIN || 'login.njfregi.jp';
    if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return `u${hex.slice(0, 40)}@${domain}`;
    }
    // 非安全上下文（http 局域网调试）没有 crypto.subtle：改由数据库计算
    const { data, error } = await FOS.db.sb.rpc('fos_login_email', { p_user_id: id });
    if (error || !data) throw new Error(FOS.i18n.t('ログインできません', '无法登录，请稍后再试'));
    return data;
  },

  async _loadProfile() {
    const { data, error } = await FOS.db.sb.rpc('fos_me');
    if (error) throw new Error(error.message);
    return data || null;
  },

  async _validateMerchantAccess(user) {
    if (!FOS.merchants?.assertAccess) return;
    await FOS.merchants.assertAccess(user, FOS.APP_ID);
  },

  _rememberUser(user) {
    FOS.auth.user = user;
    // 仅用于界面显示，不含任何凭据
    FOS.storage.set('session', {
      id: user.id,
      name: user.name,
      role: user.role,
      merchant_id: FOS.merchants?.resolveMerchantId?.(user) ?? user.merchant_id ?? null,
    });
  },

  async _reject(message) {
    FOS.auth.user = null;
    FOS.storage.set('session', null);
    FOS.merchants?.clearCache?.();
    try { await FOS.db.sb.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
    throw new Error(message);
  },

  async restoreSession() {
    if (FOS.auth._signingOut) await FOS.auth._signingOut;
    const { data } = await FOS.db.sb.auth.getSession();
    if (!data?.session) {
      FOS.storage.set('session', null);
      return null;
    }
    let profile = null;
    try {
      profile = await FOS.auth._loadProfile();
    } catch {
      return null; // 网络异常：保留会话，下次再试
    }
    if (!profile) {
      try { await FOS.auth._reject(''); } catch { /* signed out */ }
      return null;
    }
    FOS.merchants?.clearCache?.(); // 丢弃登录前（无权限时）缓存的商家信息
    if (FOS.auth.expectedRoles.length && !FOS.auth.expectedRoles.includes(profile.role)) {
      // 其他端的账号：不登出（各端会话独立保存），只是不在本端恢复
      return null;
    }
    try {
      await FOS.auth._validateMerchantAccess(profile);
    } catch (e) {
      FOS.auth.lastBlockReason = e.message;
      try { await FOS.auth._reject(e.message); } catch { /* signed out */ }
      return null;
    }
    FOS.auth._rememberUser(profile);
    return profile;
  },

  async login(userId, password) {
    const uid = (userId || '').trim();
    const pass = (password || '').trim();
    const invalid = FOS.i18n.t('IDまたはパスワードが違います', 'ID或密码错误');
    if (!uid || !pass) throw new Error(invalid);
    if (FOS.auth._signingOut) await FOS.auth._signingOut;

    const email = await FOS.auth.loginEmail(uid);
    const { error } = await FOS.db.sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
      if (/rate limit|too many/i.test(error.message || '')) {
        throw new Error(FOS.i18n.t('試行回数が多すぎます。しばらくしてから再試行してください', '尝试次数过多，请稍后再试'));
      }
      throw new Error(invalid);
    }

    const profile = await FOS.auth._loadProfile().catch(() => null);
    if (!profile) await FOS.auth._reject(invalid);
    FOS.merchants?.clearCache?.(); // 丢弃登录前（无权限时）缓存的商家信息

    if (FOS.auth.expectedRoles.length && !FOS.auth.expectedRoles.includes(profile.role)) {
      await FOS.auth._reject(FOS.i18n.t('端末タイプが一致しません', '账号类型不匹配'));
    }

    try {
      await FOS.auth._validateMerchantAccess(profile);
    } catch (e) {
      await FOS.auth._reject(e.message);
    }

    const merchantHint = FOS.shopQr?.peekMerchantHint?.() || FOS.storage.get('login_merchant_hint');
    if (merchantHint) {
      const userMerchant = profile.merchant_id || FOS.CONFIG.DEFAULT_MERCHANT_ID;
      if (userMerchant !== merchantHint) {
        await FOS.auth._reject(FOS.i18n.t(
          'この店舗は指定の商家に属していません',
          '该店铺不属于此商家，请重新扫码'
        ));
      }
    }
    FOS.shopQr?.consumeMerchantHint?.();
    FOS.storage.set('login_merchant_hint', null);

    FOS.auth._rememberUser(profile);
    return profile;
  },

  /** 修改自己的密码 */
  async changeOwnPassword(newPassword) {
    if (!FOS.auth.user?.id) throw new Error(FOS.i18n.t('再ログインしてください', '请重新登录'));
    const { error } = await FOS.db.sb.rpc('fos_set_password', {
      p_user_id: FOS.auth.user.id,
      p_password: newPassword || '',
    });
    if (error) throw new Error(FOS.auth.errorMessage(error));
  },

  logout() {
    FOS.auth.user = null;
    FOS.auth.lastBlockReason = null;
    FOS.storage.set('session', null);
    FOS.merchants?.clearCache?.();
    const p = Promise.resolve(FOS.db.sb?.auth?.signOut({ scope: 'local' })).catch(() => {});
    FOS.auth._signingOut = p.finally(() => { FOS.auth._signingOut = null; });
    return FOS.auth._signingOut;
  },

  consumeBlockReason() {
    const msg = FOS.auth.lastBlockReason;
    FOS.auth.lastBlockReason = null;
    return msg;
  },

  /** 账号相关 RPC 错误 → 用户可读文字 */
  errorMessage(error) {
    const msg = `${error?.message || error || ''}`;
    const t = FOS.i18n.t;
    const quota = msg.match(/quota_(users|drivers|products):(\d+)/);
    if (quota) {
      const n = quota[2];
      if (quota[1] === 'users') return t(`現在のプランでは最大${n}ユーザーまで追加できます`, `当前套餐最多允许添加 ${n} 个用户`);
      if (quota[1] === 'drivers') return t(`現在のプランでは最大${n}名の配送員まで追加できます`, `当前套餐最多允许添加 ${n} 名配送员`);
      return t(`現在のプランでは最大${n}商品まで追加できます`, `当前套餐最多允许添加 ${n} 个商品`);
    }
    const map = {
      password_too_short: ['パスワードは6文字以上にしてください', '密码至少 6 位'],
      password_too_long: ['パスワードが長すぎます', '密码过长'],
      password_too_weak: ['推測されやすいパスワードは使えません', '密码过于简单，请换一个'],
      password_required: ['パスワードを設定してください', '请设置密码'],
      id_taken_other_merchant: ['このIDは他の商家で使用中です', '该 ID 已被其他商家占用'],
      id_taken_other_role: ['このIDは別の種類のアカウントです', '该 ID 已被其他类型账号占用'],
      id_taken: ['このIDは既に使用されています', '该账号 ID 已被占用'],
      invalid_id: ['IDにスペースは使えません（64文字以内）', '账号 ID 不能含空格，且不超过 64 位'],
      id_required: ['IDを入力してください', '请填写账号 ID'],
      forbidden_role: ['この種類のアカウントは作成できません', '无权创建该类型账号'],
      forbidden: ['権限がありません', '没有权限'],
      merchant_required: ['商家を指定してください', '请指定商家'],
      merchant_not_found: ['商家が存在しません', '商家不存在'],
      user_not_found: ['アカウントが存在しません', '账号不存在'],
    };
    for (const [code, [ja, zh]] of Object.entries(map)) {
      if (msg.includes(code)) return t(ja, zh);
    }
    return msg || t('保存に失敗しました', '保存失败');
  },
};
