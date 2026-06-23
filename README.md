# Factory System v2

现代 UI 三端订货系统。旧项目 `-factoryorder-system-main/` **未修改**。

## 设计参考

| 参考 | 应用点 |
|------|--------|
| **Shopify Admin** | 左侧导航、顶栏、数据表格、统计卡片 |
| **Notion** | 浅色/深色主题、留白、柔和边框、清晰排版 |
| **Airレジ** | 接单端大触控按钮、商品磁贴、底部购物车 |

## 三端应用

| App | 路径 | 主色 | 角色 |
|-----|------|------|------|
| 管理后台 | `/apps/admin/` | 绿色 | `factory` |
| 接单端 | `/apps/order/` | 橙色 | `order` |
| 工厂生产 | `/apps/production/` | 蓝色 | `factory` / `delivery` |

## 本地运行

```powershell
cd C:\Users\user\Desktop\factoryorder-system-main
npx --yes serve factory-system-v2 -p 3456
```

- 管理后台：http://localhost:3456/apps/admin/
- 接单端：http://localhost:3456/apps/order/
- 工厂生产：http://localhost:3456/apps/production/

## 目录结构

```
factory-system-v2/
├── shared/
│   ├── css/
│   │   ├── tokens.css      # 设计令牌 + 深色模式 + 三端主题色
│   │   ├── base.css
│   │   ├── layout.css      # 侧栏壳层 + 响应式 + 登录页
│   │   └── components.css  # 按钮、表格、商品磁贴、购物车等
│   └── js/
│       ├── config.js
│       ├── storage.js
│       ├── supabase.js
│       ├── auth.js
│       ├── format.js
│       ├── i18n.js
│       ├── theme.js        # 深色模式
│       ├── plugins.js      # 扩展插件注册（打印/扫码/看板等）
│       ├── shell.js        # 应用壳层（侧栏+顶栏+底栏）
│       ├── ui.js
│       ├── cutoff.js
│       └── orders.js
└── apps/
    ├── admin/
    ├── order/
    └── production/
```

## 响应式

| 断点 | 布局 |
|------|------|
| ≥1024px | 固定侧栏 + 主内容区 |
| <1024px | 汉堡菜单侧栏 + 底部 Tab 导航 |
| 接单端手机 | 浮动购物车 FAB + 底部抽屉 |

## 深色模式

顶栏 🌙 按钮切换，偏好保存在 `localStorage`（`fos_v2_theme`）。

## 扩展能力（plugins.js）

已预留插件注册与 UI 插槽，后续可挂载：

| 插件 ID | 说明 | 状态 |
|---------|------|------|
| `labelPrint` | 标签打印 | planned |
| `bluetoothPrint` | 蓝牙打印 | planned |
| `barcodeScanner` | 扫码枪 | planned |
| `barcode` | 条码生成/识别 | planned |
| `factoryBoard` | 工厂看板 | planned |
| `selfOrder` | 自助下单 | planned |

插槽位置：`topbar`、`sidebar`、`orderToolbar`、`productionToolbar`

```javascript
// 示例：后续注册打印插件
FOS.plugins.register('labelPrint', {
  onRegister() {
    FOS.plugins.addSlot('productionToolbar',
      '<button class="btn btn--secondary btn--sm">🏷️ 打印</button>');
  },
});
```

## 当前功能

### Phase 1
- **admin**：商品列表、统计、新增、上下架
- **order**：商品磁贴、购物车、截单、下单
- **production**：订单看板、状态推进、配送完成

### Phase 2
- **order**：分类筛选、历史订单、收货确认
- **admin**：商品编辑/删除、分类、截单、店铺 CRUD
- **production**：订单编辑、缺货标记

### Phase 3（已完成）
- **admin 订单**：受注列表 + 实时新订单通知（声音/弹窗）
- **admin 日统计**：按日合并同商品数量（截单后备货汇总）
- **admin 账单**：每店铺月度请求书 PDF（已确认收货订单）
- **admin 商品图片**：上传至 Supabase Storage `products` 桶
- **admin 出入库**：手机扫码入库/出库、月度入出库统计
- **order**：商品磁贴显示实拍图

#### 数据库扩展（可选）

在 Supabase SQL Editor 执行 `schema.sql`，启用条码、加工标记、出入库云端记录：

```
factory-system-v2/schema.sql
```

未执行时出入库数据保存在浏览器 localStorage。

### Phase 4（SaaS 销售统计）
- **super-admin**：全平台今日/本月销售、按商家区间汇总、单商家销售详情与商品排行
- 可选 SQL：`schema-saas-stats.sql`（统计视图）

### Phase 5（批量导入商品）
- **admin**：Excel 模板下载、上传预览、图片批量匹配、同名确认覆盖、导入报告
- **admin**：新增商品时摄像头扫条码，全平台公用商品库按条码自动填入

### Phase 6（接单端二维码预填）
- **admin 设定 · 店铺管理**：每个店铺可生成「接单端登录二维码」
- 二维码链接格式：`/apps/order/?shop=shop01&merchant=m001`
- **order**：扫码打开后自动预填店铺 ID，**仍需输入密码**（不绕过登录）
- 若 URL 含 `merchant`，登录时校验店铺是否属于该商家

### Phase 7（结账方式）
- **admin 店铺**：每个客户设置 **月结** 或 **现结**
- **admin 设置**：管理现结结账方式（现金、转账等，可自定义添加）
- **配送端**：现结客户配送完成时必须选择结账方式并记账；月结客户直接完成配送
- **admin / 配送端**：「结账」页含 **明细** 与 **汇总**（按结账方式汇总金额）
- 可选 SQL：`schema-payment.sql`

## 路线图

（Phase 1–7 已完成）
