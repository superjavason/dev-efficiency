# Plan 2 — Web 仪表盘设计

- 状态：已通过设计评审，待编写实现计划
- 日期：2026-05-29
- 父 spec：[2026-05-25-dev-efficiency-tracker-design.md](./2026-05-25-dev-efficiency-tracker-design.md)（系统总设计）

## 1. 背景与范围

Plan 1（服务端核心）已合并到 master，提供：数据模型 + Bearer 鉴权的 `POST /api/v1/usage`、`GET /api/v1/me` + admin seed + Docker 部署。

本 spec 设计 **Plan 2：Web 仪表盘**——基于 Plan 1 的数据模型，给研发与管理员一个可登录的图形界面。期间会对 Plan 1 做一次清理（删除已无意义的审批/邀请码逻辑）。

### 相对系统 spec 的范围调整（与父 spec 的差异）

- **审批彻底取消**：注册（无论邮箱密码还是 GitHub OAuth）直接创建 `approved` 用户。`pending` 状态保留枚举值但不再写入。
- **`InviteCode` 模型与相关逻辑全部移除**（注册不再依赖邀请码；团队邀请是另一回事，由 Plan 3 引入独立的 `TeamInvite` 模型）。
- **新增 GitHub OAuth 登录**（与邮箱密码并存）。
- **新增 `avatarUrl` 字段**：GitHub 用户自动写入；密码用户为 null，前端用首字母 fallback。
- **Plan 2 不做 Teams**——团队功能拆到 Plan 3。

### 不在 Plan 2 范围（明确延后）

- **Teams（团队 / 邀请 / 共享）→ Plan 3**
- 客户端 skill 采集器 → Plan 4
- 限流 / TLS（交反向代理）
- 成本估算（v1 不做，沿用父 spec 的非目标）

## 2. Plan 1 清理（Plan 2 的第一组任务）

- 删除 Prisma 模型 `InviteCode` + 迁移（drop table）。
- `registerUser(input)`：移除 `inviteCode` 字段；不再有 `BAD_INVITE` 错误码；新用户固定 `status="approved"`，固定签发 token。
- 删除 `approveUser` service（无 pending 用户可审批）。
- `/api/auth/register` 响应简化为 `{ token, message }`（永远返回 token，不再有 pending 分支）。
- 删除/更新对应的测试。
- 注意：bearer 解析仍然检查 `status === "approved"`（用于「禁用用户」语义），无需修改。

## 3. 总体架构

- **页面 = Next.js server components**：直接经 Prisma 读数据，**不**绕 HTTP `/api/v1/*`。类型链路直通，少一跳。
- **变更 = server actions**：复用 Plan 1 现成 service（`authenticate`、改造后的 `registerUser`），新功能也走 service 层。
- **`/api/v1/*` 不动**：仍是 Bearer 鉴权，供 Plan 4 的 skill 上传；与仪表盘的 session 鉴权两条独立通道。
- **中间件**：`src/middleware.ts` 拦截 `/dashboard/*` 与 `/admin/*`。未登录 → 重定向 `/login?returnTo=...`；非 admin 访问 `/admin/*` → 重定向 `/dashboard`。
- **服务端授权强制**：每个 metrics service 调用必须传入 `viewer`（role + userId），member 自动收敛到自己的数据，admin 才能查全量。前端隐藏菜单不算授权。

## 4. 数据模型变化（Prisma 迁移）

- **删表**：`InviteCode`。
- **`User` 表新增列**：
  - `avatarUrl String?` —— GitHub 登录后填 `https://avatars.githubusercontent.com/u/<githubId>?v=4`；密码注册用户为 null。
  - `githubId String? @unique` —— 稳定 GitHub 身份标识（email 可变 / 可私有，用 ID 才靠谱）。
- `email` 仍是登录主键且非空（GitHub OAuth 要 `user:email` scope 强制拿到 primary email）。

## 5. 路由结构

| 路由 | 谁能访问 | 说明 |
|------|----------|------|
| `/` | 任何人 | 已登录 → `/dashboard`，否则 → `/login` |
| `/login` | 未登录 | 邮箱密码表单 + 「Sign in with GitHub」按钮（env 未配置时隐藏） |
| `/register` | 未登录 | 邮箱密码注册（不再有邀请码字段）；提交后弹一次性 token 对话框 |
| `/dashboard` | 已登录 | 个人视图：每日 token 趋势 + 工具/模型分布 + 自己的 token 列表（创建/吊销） |
| `/admin` | admin | 平台总览：每日总 token 趋势 + 按人排行 + 按工具占比 + 按模型占比 |
| `/admin/users` | admin | 用户列表：禁用/启用、为其代签发或吊销 token |
| `/api/auth/github` | 任何人 | GET → 跳 github.com 授权页 |
| `/api/auth/github/callback` | 任何人 | OAuth 回调 |
| `/api/auth/logout` | 已登录 | 已有，沿用 |

侧边栏顶部固定 "Personal Dashboard"，admin 额外可见 "Platform Overview / Users"。

> Plan 3 在此基础上加 `/teams`、`/teams/<slug>`、`/teams/<slug>/settings`、`/invite/<code>` 与对应侧边栏区块。

## 6. 新增 service（薄薄一层 Prisma 包装，page 与 server action 共用）

- `src/lib/services/users.ts`
  - `listUsers(viewer, { status? })`
  - `updateUserStatus(viewer, userId, status)` —— admin only；改 `disabled` 即「禁用」（bearer 自然拒绝）。**禁止 admin 禁用自己**（避免最后一个 admin 把自己锁死）；同样禁止把自己的 role 从 admin 改成 member（同样原因）——一并由该 service 内的守卫实现。
- `src/lib/services/tokens.ts`
  - `listTokensFor(viewer, userId)` —— 自己或 admin。
  - `createTokenFor(viewer, userId, name)` —— 自己给自己签 / admin 给他人签。返回 `{ token }` 仅本次明文。
  - `revokeToken(viewer, tokenId)` —— 自己的或 admin 任意。
- `src/lib/services/metrics.ts` —— **所有图表的统一入口，viewer-scoped**
  - `dailyTotals(viewer, range, { userId? })`
  - `userRanking(viewer, range)` —— admin 看平台排行；member 自动返单行
  - `toolBreakdown(viewer, range, { userId? })`
  - `modelBreakdown(viewer, range, { userId? })`

> 隐私不变量延伸：service 拒绝裸 prisma 调用；所有读路径都过权限收敛。

## 7. GitHub OAuth

### 选型与依赖

- 用 [`arctic`](https://arctic.js.org/) v3：轻量、只管 OAuth 协议；不强制 NextAuth 的整套约定，与 Plan 1 的 iron-session 干净共存。

### 流程

1. `GET /api/auth/github`：用 arctic 生成 authorize URL，把 `state`（CSRF）写入短期 httpOnly cookie，302 跳转 github.com。
2. `GET /api/auth/github/callback?code=&state=`：
   - 校验 state 与 cookie 一致（防 CSRF）。
   - arctic 用 code 换 `access_token`。
   - 调 GitHub `/user`（拿 id / login / name / avatar_url）和 `/user/emails`（拿 primary 验证邮箱）。
3. 用户落地（按顺序匹配）：
   1. 按 `githubId` 命中 → 直接登录该用户（同步更新 `avatarUrl`、`name` 取最新）。
   2. 按 `email` 命中已有密码用户 → **链接**：在该 user 上写 `githubId`、`avatarUrl`，登录。
   3. 都未命中 → 创建新用户：`status="approved"`、`role="member"`、`passwordHash=""`（空串标记不可密码登录——argon2 verify 对非法 hash 抛错被 catch 兜成 false，密码登录天然永远拒绝）、写 `githubId / email / name / avatarUrl`，登录。`name` 优先取 GitHub `name` 字段；为空时 fallback 到 `login`。
4. 写 iron-session，跳 `returnTo`（默认 `/dashboard`）。

### scope 与环境变量

- OAuth scope：`read:user user:email`（仅读基本信息和邮箱；**不要** repo 权限）。
- `.env.example` 新增：
  ```
  GITHUB_CLIENT_ID=
  GITHUB_CLIENT_SECRET=
  GITHUB_REDIRECT_URI=http://localhost:3000/api/auth/github/callback
  ```
- 未配置任一变量时：登录/注册页**不显示** GitHub 按钮（self-host 可选启用）。

## 8. UI 与样式

- **Tailwind v4** + **shadcn/ui**（CLI 复制原语到 `src/components/ui/`：`button / card / input / label / form / table / select / dialog / dropdown-menu / toast / tabs / badge / avatar / calendar / popover`）。
- 自有组件 `src/components/`：
  - `AppShell` —— 侧边栏（role-aware）+ 顶栏（含用户菜单与登出）。
  - `UserAvatar` —— 优先 `avatarUrl`，否则取 `name` 首字符的彩色圆形 fallback（无外部依赖、隐私友好）。
  - `DateRangePicker` —— 预设（7d / 30d / 90d / 本月 / 上月）+ 自定义 from/to，结果序列化进 URL 的 `?from=&to=`。
  - `TokenList` / `TokenCreateDialog` / `OneTimeTokenDialog`。
  - `UserRow`。
- 图表（client components，Recharts）：`DailyTrendChart`、`ToolBreakdownChart`、`ModelBreakdownChart`、`UserRankingTable`。所有图表只接收**已聚合**的 props——不在前端做业务计算。

## 9. token 明文一次性展示

触发场景：
1. 邮箱密码注册成功 → 弹 `OneTimeTokenDialog`。
2. GitHub 首次登录 → 落到 `/dashboard`，**不**自动签发 token（GitHub 用户的首个 token 在 `/dashboard` 主动「Create token」时签发，与 admin 代签发走同一对话框）。
3. 用户在 `/dashboard` 主动创建 → 弹对话框。
4. admin 在 `/admin/users/<id>` 为他人签发 → 弹对话框；admin 自己看一次，需私下转给本人。

UI：所有场景共用同一个 `OneTimeTokenDialog`，包含明文 + 复制按钮 + 「关闭后不再展示」醒目提示。

## 10. 测试策略

- **service 层集成测试**（沿用 Plan 1 的真 Postgres 测试方式）：
  - `users.test.ts`：viewer-scoping（member 调写入 → 拒绝；admin 改任意 status → ok）。
  - `tokens.test.ts`：self 操作自己的 token ok；member 操作他人 → 拒绝；admin 操作任意 → ok；revoke 后 `resolveBearerUser` 拒绝（端到端贯穿）。
  - `metrics.test.ts`：viewer scoping——同一调用，member 只见自己、admin 见全量。
  - `auth.test.ts` 更新：`registerUser` 不再接受 `inviteCode`，永远返回 token。
- **GitHub OAuth account-matching 测试**（不打真 GitHub，把 GitHub API 客户端抽到接口注入 fake 数据）：
  - 按 githubId 命中 → 登录。
  - 按 email 命中密码用户 → 链接 githubId、写 avatarUrl。
  - 都不命中 → 创建 approved 新用户、avatarUrl 已填。
- **OAuth HTTP 流（state cookie / token 交换）不单测**，依赖 arctic 自身的测试 + 手动浏览器走一遍。
- **server action 测试**：直接 import action、构造 fake session 注入；不构造 `NextRequest` / Form。
- **route 跳转**：少量 middleware 单测（认证 / 角色重定向）。
- **UI 视觉与交互**：`pnpm dev` 浏览器人工走一遍主要流程（密码登录 → 创建 token → 看到图表 → admin 禁用某用户 → GitHub 登录）。**v1 不做 Playwright/E2E**。

## 11. 文件结构（新增 / 修改）

```
src/
  middleware.ts                          # 路由保护
  components/
    AppShell.tsx
    UserAvatar.tsx
    DateRangePicker.tsx                  # client，URL 同步
    TokenList.tsx / TokenCreateDialog.tsx / OneTimeTokenDialog.tsx
    UserRow.tsx
    charts/                              # client，Recharts
      DailyTrendChart.tsx / ToolBreakdownChart.tsx /
      ModelBreakdownChart.tsx / UserRankingTable.tsx
    ui/                                  # shadcn 复制进来的原语
  lib/
    services/{users,tokens,metrics}.ts
    actions/{auth,users,tokens}.ts       # server actions
    auth/github.ts                       # arctic provider + 落用户逻辑
    range.ts                             # 时间范围解析（URL ↔ Date）
  app/
    page.tsx                             # 已存在，改为重定向逻辑
    (auth)/login/page.tsx
    (auth)/register/page.tsx
    (app)/layout.tsx                     # AppShell 包裹
    (app)/dashboard/page.tsx
    (app)/admin/page.tsx
    (app)/admin/users/page.tsx
    api/auth/github/route.ts             # OAuth 入口
    api/auth/github/callback/route.ts    # OAuth 回调
prisma/
  schema.prisma                          # 删 InviteCode；User 加 avatarUrl/githubId
  migrations/<timestamp>_dashboard/      # drop InviteCode + alter User
```

## 12. 建议构建顺序

1. **Plan 1 清理**：删 `InviteCode` 模型 / 移除 `inviteCode` 注册流 / 删 `approveUser` / 简化 register 路由 / 更新测试 + 迁移。
2. **Tailwind v4 + shadcn 初始化** + AppShell + middleware（跑通登录跳转）。
3. **登录 / 注册 / 一次性 token 弹窗**（复用 Plan 1 现成 service，UI 化）。
4. **GitHub OAuth**：schema 迁移加 `avatarUrl/githubId` → arctic 集成 → 路由 + 回调 + 落用户 service + 测试。
5. **tokens / users service + 单测**。
6. **`/dashboard`**：metrics service for 单人 + 图表 + 自助 token 管理。
7. **`/admin`**：metrics 全量 + 图表。
8. **`/admin/users`**：禁用/启用、代签发 / 吊销 token。

每步可独立跑 `pnpm dev` 验证 + 跑测试。

## 13. 完成标准

- `pnpm test` 全绿（含新增 OAuth 账号匹配测试、metrics scoping 测试、tokens 授权测试）。
- 浏览器走通：密码注册 → 弹一次性 token → 登录登出；GitHub 登录创建新用户 + 自动头像；个人仪表盘看到图表；admin 禁用某用户后该用户的 token 立即失效；admin 代签 token 弹窗可复制。
- 隐私不变量：服务端没有「member 能看到他人数据」的代码路径（所有 metrics service 强制 viewer scoping）。
