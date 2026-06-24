/**
 * factory-system-v2 全局配置
 * 与旧版共用同一 Supabase 项目，localStorage 使用独立前缀避免冲突
 */
window.FOS = window.FOS || {};

FOS.CONFIG = {
  SUPABASE_URL: 'https://gbfdnbigkhoifofdiacz.supabase.co',
  SUPABASE_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZmRuYmlna2hvaWZvZmRpYWN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNjUwMjgsImV4cCI6MjA5MDk0MTAyOH0.nN2m8C3nGO43nh71p9I0lgkMyyW7Ko3_BcHr_EyuQgo',
  STORAGE_PREFIX: 'fos_v2_',
  DEFAULT_CUTOFF: '17:00',

  /** SaaS 默认商家 ID（历史数据迁移目标） */
  DEFAULT_MERCHANT_ID: 'default',

  /** 角色定义 */
  ROLES: {
    SUPER_ADMIN: 'super_admin',
    FACTORY: 'factory',
    ORDER: 'order',
    DELIVERY: 'delivery',
  },

  /** 各 App 对应的商家端权限字段 */
  APP_TYPES: {
    admin: 'allow_admin_app',
    order: 'allow_order_app',
    production: 'allow_production_app',
    'super-admin': 'allow_admin_app',
  },

  /** 套餐默认限制（可被 merchants 表字段覆盖） */
  PLAN_LIMITS: {
    trial: { max_users: 3, max_products: 50 },
    standard: { max_users: 10, max_products: 300 },
    pro: { max_users: 30, max_products: 1000 },
    enterprise: { max_users: 999, max_products: 9999 },
  },

  /** 销售额统计：排除的订单状态 */
  SALES_EXCLUDED_STATUSES: ['cancelled'],

  /**
   * 顾客下单 H5 公网基址（无尾斜杠）。
   * 部署时由开发者在 config.js 配置，商家无需在设置中填写。
   */
  PUBLIC_APP_BASE_URL: 'https://shop.njfregi.jp',
};

/** @deprecated 旧字段名，与 PUBLIC_APP_BASE_URL 同值 */
Object.defineProperty(FOS.CONFIG, 'public_h5_base_url', {
  get() { return FOS.CONFIG.PUBLIC_APP_BASE_URL; },
  set(v) {
    FOS.CONFIG.PUBLIC_APP_BASE_URL = String(v || '').trim().replace(/\/+$/, '');
  },
  enumerable: true,
  configurable: true,
});

/** 全局别名，兼容旧脚本 */
window.FOS_CONFIG = FOS.CONFIG;

/**
 * 读取顾客端公网基址（统一入口，兼容 public_h5_base_url / PUBLIC_APP_BASE_URL）
 */
FOS.config = {
  publicAppBaseUrl(loc = typeof location !== 'undefined' ? location : null) {
    const cfg = FOS.CONFIG || window.FOS_CONFIG || {};
    const fromCfg = String(cfg.PUBLIC_APP_BASE_URL || cfg.public_h5_base_url || '')
      .trim()
      .replace(/\/+$/, '');
    if (fromCfg && !/localhost|127\.0\.0\.1/i.test(fromCfg)) return fromCfg;
    const origin = String(loc?.origin || '');
    if (origin && !/localhost|127\.0\.0\.1/i.test(origin)) {
      const path = loc.pathname || '';
      const idx = path.indexOf('/apps/');
      const root = idx >= 0 ? path.slice(0, idx) : '';
      return `${origin}${root}`.replace(/\/+$/, '');
    }
    return fromCfg;
  },
};
