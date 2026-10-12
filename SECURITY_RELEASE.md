# 登录与商家隔离安全改造（2026-10-12）

## 状态

代码、数据库脚本和本地测试已完成。**尚未在线上 Supabase 执行，网页和 APK 也尚未发布。**
本地测试使用真实 PostgreSQL 16 加 Supabase 模拟环境（auth / storage / anon / authenticated 角色），
不是真正的 Supabase。上线前请先在测试项目上走一遍（见“上线步骤”第 0 步）。

## 修复了什么

| 问题 | 改造前 | 改造后 |
|---|---|---|
| 登录 | 前端用公开 anon key 查 `users` 表 `password_hash = 明文` | Supabase Auth（bcrypt），浏览器只保存 Supabase 会话 |
| 密码存储 | 明文，任何人可用 anon key 读出全部账号密码 | `users.password_hash` 只留标记 `!AUTH`，密码只在 Auth 中以 bcrypt 保存 |
| 会话恢复 | localStorage 里只存账号 ID，改 ID 即可冒充他人 | 依赖 Supabase 签名的 JWT，数据库用 `auth.uid()` 识别身份 |
| 商家隔离 | 前端拼 `merchant_id` 过滤，数据库不检查 | 数据库 RLS：每个表按商家隔离，门店只能看自己的订单 |
| 账号管理 | 前端直接 `upsert users`（全局 ID，可覆盖别家账号） | `fos_save_account` 等 RPC：校验权限、商家归属、套餐人数、密码强度 |
| 商家停用 | 只在前端提示 | 数据库端立即拒绝该商家所有数据访问 |
| 工厂改商家资料 | 整行更新 `merchants`（可把自己的套餐、人数上限改大） | 只能通过 RPC 改显示名称和请求书信息 |
| 订单接口 | 每次请求都带明文密码 | 由 JWT 识别操作者；配送员只能推进到“已发货/已送达” |
| 门店扫码月结（H5） | 浏览器 localStorage 保存门店明文密码 | 服务器签发 30 天会话令牌（只存 SHA-256），可登出吊销 |
| 顾客历史订单 | 只凭手机号即可查询他人订单 | 必须先登录，凭会话令牌查询 |
| 顾客密码 | 明文 | bcrypt（登录时自动升级，第 2 步全部转换） |
| 暴力破解 | 无限制 | 门店/顾客登录、订单号查询：15 分钟内失败 8～10 次锁定 15 分钟 |
| 商品图片 | anon 可上传、覆盖、删除任意图片 | 只有工厂管理者可写本商家目录 `商家ID/...`，公开读取不变 |
| 全局设置 | 截单时间、公告全局共用，任何商家可改 | 每个商家独立（`cutoff_time_商家ID`），旧全局值作为默认 |
| 统计视图 | 视图以所有者身份运行，可绕过隔离、甚至经视图改单 | 所有视图改为 `security_invoker`，不可经视图写入 |
| 改密码 / 停用账号 | 已登录设备继续可用 | 吊销该账号所有登录会话 |

## 文件

数据库（Supabase SQL Editor 执行）：

- `security-01-prepare.sql`：第 1 步，准备。不影响旧客户端，可重复执行。
- `security-02-enforce.sql`：第 2 步，强制启用。执行后旧网页、旧 APK、旧版系统不能再用。
- `security-rollback-02.sql`：回滚第 2 步。
- `security-03-cleanup.sql`：第 3 步，稳定后清除旧密码备份（可选）。
- `security-verify.sql`：只读检查，随时可执行。

前端（`git diff` 可看具体修改）：

- `shared/js/auth.js`：改为 Supabase Auth 登录
- `shared/js/supabase.js`：各端会话分开保存
- `shared/js/config.js`：新增 `LOGIN_EMAIL_DOMAIN`
- `shared/js/merchants.js`：账号管理改走 RPC
- `shared/js/orders.js`：不再发送密码
- `shared/js/public-order.js`：H5 会话令牌
- `shared/js/cutoff.js`、`shared/js/order-settings.js`：每商家设置
- `shared/js/invoice-settings.js`：工厂改请求书信息走 RPC
- `shared/js/media.js`：图片上传到商家目录
- `apps/admin/app.js`：门店账号新增、编辑、删除
- `apps/order/app.js`：登录页店名查询，登录后读本商家截单时间
- `apps/customer-order/app.js`：门店和顾客 H5 登录

测试：

- `tests/auth.test.cjs`：前端登录和会话（8 项）
- `tests/security/security.test.mjs`：数据库安全集成测试（26 组，130 余个断言）
- 可选：`tests/security/supabase-mock.sql`、`legacy-base.sql`、`build-db.sh`

## 上线步骤

0. **先在测试环境演练（强烈建议）。** 新建一个 Supabase 测试项目并恢复生产备份，或使用 Supabase Branching。依次执行第 1 步，部署新网页到测试地址，执行第 2 步，再用各端实际登录、下单一遍。
   本次没有接触真实 Supabase。最可能出问题的是 Auth 账号写入：本脚本直接写 `auth.users` / `auth.identities`，这是 Supabase 常见做法，但不同 Auth 版本的表结构可能不同。
1. **备份生产数据库**（Dashboard → Database → Backups，或 `pg_dump`）。
2. **关闭 Auth 公开注册**：Dashboard → Authentication → Sign In / Providers，关闭 “Allow new users to sign up”，Email provider 保持启用。
   否则有人可以抢先用推算出的登录邮箱注册，导致该 ID 无法创建账号（脚本会拒绝，报 `auth_email_conflict`）。
3. 执行 `security-01-prepare.sql`，然后执行 `security-verify.sql`：
   - 第 2 项 `not_migrated` 必须为 0。
   - 查看第 3 项弱密码清单。
4. 发布新版网页到服务器（历史目录 `/var/www/shop/factory-system-v2`，请以实际为准），并清除缓存。
5. 在 `mobile` 仓库重新同步 Web 资源，`npx cap sync`，签名构建，给所有设备安装新 APK。
6. 用新客户端测试：工厂、门店、配送、总后台登录；下单、改单、出库、收款、确认收货；新增、编辑、删除门店；顾客扫码下单和历史订单。
7. **修改管理类账号密码。** 旧密码以前任何人都能读到，必须视为已泄露。第 2 步会检查这一点，没改完不会执行。
   - 总后台：在 SQL Editor 执行 `SELECT fos_admin_reset_password('superadmin', '新的强密码');`
   - 工厂账号：总后台“商家编辑”里填新的管理密码，或使用同一条 SQL。
   - 新密码至少 6 位，不能是 `pass`、`123456` 等常见密码。
8. **确认旧版系统 `-factoryorder-system-main` 已停用。** 它和本系统共用同一个 Supabase 项目，第 2 步后将无法读写。
9. 选在非营业时间执行 `security-02-enforce.sql`。所有设备需要重新登录一次。
10. 再次执行 `security-verify.sql`：
    - 第 5 项业务表 `rls = true`、`anon_select = false`。
    - 第 6 项 anon 只能执行顾客 H5 和登录辅助函数。
11. 门店、配送账号的旧密码同样视为已泄露，建议分批让工厂在“店铺管理”里重设（第 9 项有清单）。
12. 稳定运行约 2 周后，可执行 `security-03-cleanup.sql`。

### 回滚

- 第 2 步之后出现严重问题：执行 `security-rollback-02.sql`。数据恢复对 anon 开放，未改过密码的账号恢复旧明文，旧客户端可临时使用。新客户端在回滚后仍可登录。修复后再执行第 2 步。
- 第 1 步本身不影响旧客户端。新增的函数和表可以保留。

## 注意事项与已知限制

- **不要再执行旧脚本**：`schema-order-reliability.sql`、`schema-channel-shop-order.sql`、`schema-order-no-daily.sql`、`schema-public-order*.sql`、`schema-order-item-admin-edit.sql`。它们会覆盖安全包装函数。第 2 步会检查，发现被覆盖会拒绝执行；`security-verify.sql` 第 4 项也能看到。
- 账号 ID 不变。Supabase Auth 后台“Users”列表中显示的是 `u<哈希>@login.njfregi.jp` 这样的内部邮箱，不收发邮件。
- 新设置的密码至少 6 位。原有 4～5 位的旧密码在改密码前仍可登录。
- 登录失败锁定按账号计算：恶意多次输错可以让某个门店 15 分钟内无法从 H5 登录。目前没有按 IP 限流（需要 Edge Function）。
- 本次没有改动 `mobile` 仓库，但必须重新构建 APK 才能生效。
- 未包含：独立门店表和“一店多员工”、集团 → 工厂 → 门店层级、协议价。这些是后续的数据模型改造。

## 测试结果（本地）

- `node --test orders.test.cjs auth.test.cjs categories.test.cjs`：21 项全部通过
- `node order-transaction.test.mjs`：通过（原有订单事务测试）
- `PGHOST=/tmp PGPORT=54329 node security/security.test.mjs`：26 组全部通过。
  覆盖：两步迁移、旧客户端过渡期兼容、anon 全面拒绝、跨商家读写拒绝、门店和配送权限、视图、Storage、商家停用、账号停用、改密码吊销会话、H5 令牌、限流、回滚、重复执行。
  运行需要本机 PostgreSQL（含 pgcrypto）。测试依赖用 `pnpm install` 安装。
- 另有独立代码审查，发现的视图绕过、配送员越权改单、Auth 邮箱抢注、`infinity` 封禁值、改密码不吊销会话等问题均已修复，并加了对应测试。
