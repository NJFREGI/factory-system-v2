/**
 * factory-system-v2 · 商家（SaaS 租户）共享模块
 * Phase 1：读取、状态检查、端权限、用量统计
 */
window.FOS = window.FOS || {};

FOS.merchants = {
  _cache: {},
  _schemaReady: null,

  isSuperAdmin(user) {
    return user?.role === FOS.CONFIG.ROLES.SUPER_ADMIN;
  },

  resolveMerchantId(user) {
    if (FOS.merchants.isSuperAdmin(user)) return null;
    return user?.merchant_id || FOS.CONFIG.DEFAULT_MERCHANT_ID;
  },

  scopeId(user) {
    return FOS.merchants.resolveMerchantId(user || FOS.auth?.user);
  },

  scopeFilter(query, merchantId) {
    const mid = merchantId ?? FOS.merchants.scopeId();
    if (!mid) return query;
    return query.eq('merchant_id', mid);
  },

  _isSchemaError(error) {
    const msg = `${error?.message || ''} ${error?.code || ''} ${error?.details || ''}`;
    return /merchants|does not exist|42703|PGRST205|schema cache/i.test(msg);
  },

  async isSchemaReady() {
    if (FOS.merchants._schemaReady !== null) return FOS.merchants._schemaReady;
    try {
      const { error } = await FOS.db.sb.from('merchants').select('id').limit(1);
      if (error && FOS.merchants._isSchemaError(error)) {
        FOS.merchants._schemaReady = false;
      } else {
        FOS.merchants._schemaReady = !error;
      }
    } catch {
      FOS.merchants._schemaReady = false;
    }
    return FOS.merchants._schemaReady;
  },

  fallbackMerchant(id) {
    const merchantId = id || FOS.CONFIG.DEFAULT_MERCHANT_ID;
    const plan = 'enterprise';
    const planLimits = FOS.CONFIG.PLAN_LIMITS[plan];
    return {
      id: merchantId,
      name: FOS.i18n.t('デフォルト商家', '默认商家'),
      contact_name: null,
      phone: null,
      address: null,
      status: 'active',
      plan_type: plan,
      max_users: planLimits.max_users,
      max_products: planLimits.max_products,
      allow_order: true,
      allow_order_app: true,
      allow_admin_app: true,
      allow_production_app: true,
      notes: null,
    };
  },

  clearCache() {
    FOS.merchants._cache = {};
  },

  async getById(merchantId) {
    const id = merchantId || FOS.CONFIG.DEFAULT_MERCHANT_ID;
    if (FOS.merchants._cache[id]) return FOS.merchants._cache[id];

    if (!(await FOS.merchants.isSchemaReady())) {
      const fallback = FOS.merchants.fallbackMerchant(id);
      FOS.merchants._cache[id] = fallback;
      return fallback;
    }

    const { data, error } = await FOS.db.sb.from('merchants').select('*').eq('id', id).maybeSingle();
    if (error && !FOS.merchants._isSchemaError(error)) {
      console.warn('[FOS.merchants] getById error:', error.message);
    }

    const merchant = data || FOS.merchants.fallbackMerchant(id);
    FOS.merchants._cache[id] = merchant;
    return merchant;
  },

  async getCurrent() {
    const user = FOS.auth?.user;
    if (!user || FOS.merchants.isSuperAdmin(user)) return null;
    const merchantId = FOS.merchants.resolveMerchantId(user);
    return FOS.merchants.getById(merchantId);
  },

  getLimits(merchant) {
    const m = merchant || {};
    const plan = m.plan_type || 'standard';
    const planDefaults = FOS.CONFIG.PLAN_LIMITS[plan] || FOS.CONFIG.PLAN_LIMITS.standard;
    return {
      plan_type: plan,
      max_users: m.max_users ?? planDefaults.max_users,
      max_products: m.max_products ?? planDefaults.max_products,
      allow_order: m.allow_order !== false,
      allow_admin_app: m.allow_admin_app !== false,
      allow_order_app: m.allow_order_app !== false,
      allow_production_app: m.allow_production_app !== false,
    };
  },

  appPermissionKey(appId) {
    const app = appId || FOS.APP_ID;
    return FOS.CONFIG.APP_TYPES[app] || null;
  },

  async checkStatus(merchant) {
    const m = merchant || (await FOS.merchants.getCurrent());
    if (!m) return { ok: true };

    if (m.status === 'suspended') {
      return {
        ok: false,
        reason: 'suspended',
        message: FOS.i18n.t(
          'この商家は停止中です。管理者にお問い合わせください',
          '该商家已停用，请联系管理员'
        ),
      };
    }

    return { ok: true };
  },

  async checkAppAccess(merchant, appId) {
    const m = merchant || (await FOS.merchants.getCurrent());
    if (!m) return { ok: true };

    const permissionKey = FOS.merchants.appPermissionKey(appId);
    if (!permissionKey) return { ok: true };

    if (!m[permissionKey]) {
      const labelMap = {
        allow_admin_app: FOS.i18n.t('管理后台', '管理后台'),
        allow_order_app: FOS.i18n.t('接单端', '接单端'),
        allow_production_app: FOS.i18n.t('生产端', '生产端'),
      };
      const label = labelMap[permissionKey] || '';
      return {
        ok: false,
        reason: 'app_disabled',
        message: FOS.i18n.t(
          `この商家は${label}の利用が許可されていません`,
          `该商家未开通${label}`
        ),
      };
    }

    return { ok: true };
  },

  async countUsers(merchantId) {
    const mid = merchantId || FOS.merchants.resolveMerchantId(FOS.auth?.user);
    if (!mid) return 0;
    if (!(await FOS.merchants.isSchemaReady())) return 0;

    const { count, error } = await FOS.db.sb
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', mid)
      .eq('active', true)
      .neq('role', FOS.CONFIG.ROLES.SUPER_ADMIN);

    if (error) {
      console.warn('[FOS.merchants] countUsers error:', error.message);
      return 0;
    }
    return count || 0;
  },

  async countProducts(merchantId) {
    const mid = merchantId || FOS.merchants.resolveMerchantId(FOS.auth?.user);
    if (!mid) return 0;
    if (!(await FOS.merchants.isSchemaReady())) return 0;

    const { count, error } = await FOS.db.sb
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', mid);

    if (error) {
      console.warn('[FOS.merchants] countProducts error:', error.message);
      return 0;
    }
    return count || 0;
  },

  async assertAccess(user, appId) {
    if (!user) return;
    if (FOS.merchants.isSuperAdmin(user)) return;

    const merchantId = FOS.merchants.resolveMerchantId(user);
    const merchant = await FOS.merchants.getById(merchantId);

    const statusResult = await FOS.merchants.checkStatus(merchant);
    if (!statusResult.ok) {
      throw new Error(statusResult.message);
    }

    const appResult = await FOS.merchants.checkAppAccess(merchant, appId);
    if (!appResult.ok) {
      throw new Error(appResult.message);
    }
  },

  async assertCanAddUserForMerchant(merchantId) {
    const merchant = await FOS.merchants.getById(merchantId);
    const limits = FOS.merchants.getLimits(merchant);
    const count = await FOS.merchants.countUsers(merchantId);
    if (count >= limits.max_users) {
      throw new Error(
        FOS.i18n.t(
          `現在のプランでは最大${limits.max_users}ユーザーまで追加できます`,
          `当前套餐最多允许添加 ${limits.max_users} 个用户`
        )
      );
    }
  },

  async assertCanAddUser() {
    const merchant = await FOS.merchants.getCurrent();
    if (!merchant) return;
    await FOS.merchants.assertCanAddUserForMerchant(merchant.id);
  },

  async getRoleUser(merchantId, role) {
    const { data, error } = await FOS.db.sb
      .from('users')
      .select('id, name, password_hash, active')
      .eq('merchant_id', merchantId)
      .eq('role', role)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async getFactoryAdmin(merchantId) {
    return FOS.merchants.getRoleUser(merchantId, FOS.CONFIG.ROLES.FACTORY);
  },

  async getDeliveryAdmin(merchantId) {
    return FOS.merchants.getRoleUser(merchantId, FOS.CONFIG.ROLES.DELIVERY);
  },

  async saveRoleUser({ merchantId, userId, password, displayName, role, isCreate, optional, idRequiredMsg, passRequiredMsg }) {
    const uid = (userId || '').trim();
    if (!uid) {
      if (optional) return;
      throw new Error(idRequiredMsg);
    }
    if (isCreate && !(password || '').trim()) {
      throw new Error(passRequiredMsg);
    }

    const existing = await FOS.merchants.getRoleUser(merchantId, role);

    if (!existing) {
      const { data: byId, error: byIdErr } = await FOS.db.sb
        .from('users')
        .select('id, name, role, merchant_id, active')
        .eq('id', uid)
        .maybeSingle();
      if (byIdErr) throw new Error(byIdErr.message);

      if (byId) {
        if (byId.role !== role) {
          throw new Error(
            FOS.i18n.t('このIDは別の種類のアカウントです', '该 ID 已被其他类型账号占用')
          );
        }
        if (byId.merchant_id && byId.merchant_id !== merchantId) {
          throw new Error(
            FOS.i18n.t('このIDは他の商家で使用中です', '该 ID 已被其他商家占用')
          );
        }
        if (byId.active) {
          throw new Error(FOS.i18n.t('このIDは既に使用されています', '该账号 ID 已被占用'));
        }
        const { error: reviveErr } = await FOS.db.sb
          .from('users')
          .update({
            name: displayName || byId.name || merchantId,
            role,
            password_hash: password.trim(),
            merchant_id: merchantId,
            active: true,
          })
          .eq('id', uid);
        if (reviveErr) throw new Error(reviveErr.message);
        return;
      }

      await FOS.merchants.assertCanAddUserForMerchant(merchantId);
      const { error } = await FOS.db.sb.from('users').insert({
        id: uid,
        name: displayName || merchantId,
        role,
        password_hash: password.trim(),
        merchant_id: merchantId,
        active: true,
      });
      if (error) {
        if (/duplicate|unique|23505/i.test(`${error.message} ${error.code || ''}`)) {
          throw new Error(FOS.i18n.t('このIDは既に使用されています', '该账号 ID 已被占用'));
        }
        throw new Error(error.message);
      }
      return;
    }

    const update = {
      name: displayName || existing.name,
      merchant_id: merchantId,
      active: true,
    };
    if ((password || '').trim()) update.password_hash = password.trim();

    const { error } = await FOS.db.sb.from('users').update(update).eq('id', existing.id);
    if (error) throw new Error(error.message);
  },

  async saveFactoryAdmin({ merchantId, userId, password, displayName, isCreate }) {
    return FOS.merchants.saveRoleUser({
      merchantId,
      userId,
      password,
      displayName,
      role: FOS.CONFIG.ROLES.FACTORY,
      isCreate,
      optional: false,
      idRequiredMsg: FOS.i18n.t('管理アカウントIDは必須です', '请填写管理账号 ID'),
      passRequiredMsg: FOS.i18n.t('管理パスワードを設定してください', '请设置管理密码'),
    });
  },

  async saveDeliveryAdmin({ merchantId, userId, password, displayName, isCreate }) {
    return FOS.merchants.saveRoleUser({
      merchantId,
      userId,
      password,
      displayName,
      role: FOS.CONFIG.ROLES.DELIVERY,
      isCreate,
      optional: true,
      idRequiredMsg: FOS.i18n.t('配送アカウントIDは必須です', '请填写配送账号 ID'),
      passRequiredMsg: FOS.i18n.t('配送パスワードを設定してください', '请设置配送密码'),
    });
  },

  async assertCanAddProduct(addCount = 1) {
    const merchant = await FOS.merchants.getCurrent();
    if (!merchant) return;
    const limits = FOS.merchants.getLimits(merchant);
    const count = await FOS.merchants.countProducts(merchant.id);
    if (count + addCount > limits.max_products) {
      throw new Error(
        FOS.i18n.t(
          `現在のプランでは最大${limits.max_products}商品まで追加できます`,
          `当前套餐最多允许添加 ${limits.max_products} 个商品`
        )
      );
    }
  },

  async assertCanOrder() {
    const merchant = await FOS.merchants.getCurrent();
    if (!merchant) return;
    const limits = FOS.merchants.getLimits(merchant);
    if (!limits.allow_order) {
      throw new Error(
        FOS.i18n.t('この商家は現在注文を受け付けていません', '该商家当前不允许下单')
      );
    }
    const statusResult = await FOS.merchants.checkStatus(merchant);
    if (!statusResult.ok) throw new Error(statusResult.message);
  },

  planDefaults(planType) {
    return FOS.CONFIG.PLAN_LIMITS[planType] || FOS.CONFIG.PLAN_LIMITS.standard;
  },

  planLabel(planType) {
    const labels = {
      trial: FOS.i18n.t('トライアル', '试用'),
      standard: FOS.i18n.t('スタンダード', '标准'),
      pro: FOS.i18n.t('プロ', '专业'),
      enterprise: FOS.i18n.t('エンタープライズ', '企业'),
    };
    return labels[planType] || planType;
  },

  statusLabel(status) {
    return status === 'suspended'
      ? FOS.i18n.t('停止中', '已停用')
      : FOS.i18n.t('有効', '启用中');
  },

  normalizePayload(input) {
    const plan = input.plan_type || 'standard';
    const defaults = FOS.merchants.planDefaults(plan);
    return {
      id: (input.id || '').trim(),
      name: (input.name || '').trim(),
      contact_name: (input.contact_name || '').trim() || null,
      phone: (input.phone || '').trim() || null,
      address: (input.address || '').trim() || null,
      status: input.status === 'suspended' ? 'suspended' : 'active',
      plan_type: plan,
      max_users: Number.isFinite(Number(input.max_users))
        ? Number(input.max_users)
        : defaults.max_users,
      max_products: Number.isFinite(Number(input.max_products))
        ? Number(input.max_products)
        : defaults.max_products,
      allow_order: !!input.allow_order,
      allow_order_app: !!input.allow_order_app,
      allow_admin_app: !!input.allow_admin_app,
      allow_production_app: !!input.allow_production_app,
      notes: (input.notes || '').trim() || null,
      invoice_company_name: (input.invoice_company_name || '').trim() || null,
      invoice_zip: (input.invoice_zip || '').trim() || null,
      invoice_address: (input.invoice_address || '').trim() || null,
      invoice_tel: (input.invoice_tel || '').trim() || null,
      invoice_fax: (input.invoice_fax || '').trim() || null,
      invoice_registration_no: (input.invoice_registration_no || '').trim() || null,
      invoice_bank_info: (input.invoice_bank_info || '').trim() || null,
      updated_at: new Date().toISOString(),
    };
  },

  async listAll({ search = '', status = '' } = {}) {
    if (!(await FOS.merchants.isSchemaReady())) return [];

    const { data, error } = await FOS.db.sb
      .from('merchants')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    let rows = data || [];
    if (status) rows = rows.filter((m) => m.status === status);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          (m.name || '').toLowerCase().includes(q) ||
          (m.contact_name || '').toLowerCase().includes(q) ||
          (m.phone || '').includes(q)
      );
    }
    return rows;
  },

  async create(input) {
    const payload = FOS.merchants.normalizePayload(input);
    if (!payload.id || !payload.name) {
      throw new Error(FOS.i18n.t('IDと名称は必須です', 'ID 和名称为必填'));
    }
    payload.created_at = new Date().toISOString();

    const { data, error } = await FOS.db.sb.from('merchants').insert(payload).select().single();
    if (error) throw new Error(error.message);

    FOS.merchants.clearCache();
    return data;
  },

  async update(id, input) {
    const payload = FOS.merchants.normalizePayload({ ...input, id });
    const merchantId = payload.id;
    delete payload.id;

    const { data, error } = await FOS.db.sb
      .from('merchants')
      .update(payload)
      .eq('id', merchantId)
      .select()
      .single();

    if (error) throw new Error(error.message);

    delete FOS.merchants._cache[merchantId];
    return data;
  },

  async setStatus(id, status) {
    const { data, error } = await FOS.db.sb
      .from('merchants')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    delete FOS.merchants._cache[id];
    return data;
  },

  async getUsage(merchantId) {
    const [users, products] = await Promise.all([
      FOS.merchants.countUsers(merchantId),
      FOS.merchants.countProducts(merchantId),
    ]);
    const merchant = await FOS.merchants.getById(merchantId);
    const limits = FOS.merchants.getLimits(merchant);
    return { users, products, limits };
  },
};
