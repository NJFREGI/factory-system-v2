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
   * 管理端 APK 生成二维码时必须配置；也可在「设置 → 顾客下单渠道」中填写。
   * 例：https://example.com/factory-system-v2
   */
  PUBLIC_APP_BASE_URL: '',
};
