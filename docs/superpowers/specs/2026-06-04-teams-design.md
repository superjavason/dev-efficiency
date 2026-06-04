# Plan 3 — Teams 设计

- 状态：已通过设计评审，待编写实现计划
- 日期：2026-06-04
- 父 spec：[2026-05-25-dev-efficiency-tracker-design.md](./2026-05-25-dev-efficiency-tracker-design.md)（系统总设计）
- 前置 plan：[2026-05-29-dashboard-design.md](./2026-05-29-dashboard-design.md)（Plan 2 Web 仪表盘已合并）

## 1. 背景与范围

Plan 1（服务端核心）和 Plan 2（Web 仪表盘）已合并到 master。系统目前有：完整的认证（邮箱密码 + GitHub OAuth）、个人仪表盘、admin 平台总览 + 用户管理、Bearer 鉴权的 `/api/v1/usage` 上传 API。

本 spec 设计 **Plan 3：Teams**——用户可创建团队、生成邀请链接、邀请他人加入；团队内成员共享彼此的 token 使用数据（团队仪表盘看团队趋势 + 内部排行 + 工具/模型分布）。

### 与系统 spec 的一致性

- 引入团队 = 隐私边界从「单个用户」扩展为「单个用户 或 该用户所在团队」。**「member 只见自己 + 自己所在团队」是新的隐私不变量**。
- 全局 admin 仍能看一切（保持 Plan 1/2 既有语义）。
- 业务对象 `UsageRecord` **不增加 teamId 字段**——加入团队是 join-time 共享而非数据所有权转移；查询时通过 `TeamMember` join 出来。

### 不在 Plan 3 范围

- 跨团队的复杂权限模型（如 sub-team / 嵌套团队）—— YAGNI。
- 邀请的「使用次数上限」/「单次有效期」—— 邀请链接是多次可用 + 永久有效直到 owner 主动吊销。
- 团队聊天 / 看板 / 任何非 token-usage 的协作能力。
- 数据导出（CSV/API for team data）—— 留给后续。
- 客户端 skill 采集器仍是 Plan 4。

## 2. 数据模型（Prisma 迁移）

### 新增 enum

```prisma
enum TeamRole {
  owner
  member
}
```

### 新增 model `Team`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string (cuid) | 主键 |
| name | string | 团队显示名，必填 |
| slug | string unique | URL 标识，仅 `[a-z0-9-]`；自动从 name 生成，碰撞加 `-2`/`-3`...；中文 name 时**用户必须手动输入**（前端校验，见第 5 节） |
| createdById | string | 创建者 user.id；关系名 `"TeamCreatedBy"` |
| createdAt | datetime | |

### 新增 model `TeamMember`

| 字段 | 类型 | 说明 |
|------|------|------|
| teamId | string | onDelete Cascade |
| userId | string | onDelete Cascade |
| role | TeamRole | 默认 `member` |
| joinedAt | datetime | 默认 now() |

- **复合主键** `@@id([teamId, userId])` —— 同一用户在同一团队最多一行。
- `@@index([userId])` —— 「我加入的团队」反查。

### 新增 model `TeamInvite`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| teamId | string | onDelete Cascade |
| code | string unique | 32 字节 base64url，URL 安全 |
| createdById | string | 关系名 `"TeamInviteCreatedBy"` |
| createdAt | datetime | |
| revokedAt | datetime? | owner 可吊销重生；revoked 的 invite 不能再被 accept |

> 邀请链接是**多次可用 + 永久有效**：accept 不消耗 `code`、不写任何 used 标志，仅在 `TeamMember` 表里上插入一行（已是成员则 no-op）。owner 可随时吊销当前 code 并生成新 code。

## 3. 路由结构

| 路由 | 谁能访问 | 内容 |
|------|----------|------|
| `/teams` | 已登录 | 我加入的团队列表 + 「创建团队」入口 |
| `/teams/new` | 已登录 | 创建团队表单 |
| `/teams/<slug>` | 团队成员或全局 admin | 团队仪表盘：每日团队总趋势 + 团队内成员排行 + 工具/模型分布 |
| `/teams/<slug>/settings` | team owner 或全局 admin | 成员列表 + 角色调整 + 移除成员 + 「转让 owner」+ 邀请链接（创建/吊销）+ 「离开团队」+ 「删除团队」 |
| `/invite/<code>` | 已登录 | 预览：团队名 + 当前成员数 + 「加入团队」按钮；未登录跳 `/login?returnTo=/invite/<code>` |
| `/admin/teams` | 全局 admin | 平台所有团队列表：名 / slug / 创建者 / 成员数 / 创建时间；可点入 settings 做管理 |

侧边栏更新（`AppShell`）：

- 个人仪表盘
- **我的团队**（折叠组件，列出该用户所有团队，点击 → `/teams/<slug>`）
- **创建团队**（独立链接到 `/teams/new`）
- admin 额外：平台总览 / 用户管理 / **平台团队**

## 4. 服务层

### 新增 `src/lib/services/teams.ts`

所有函数都是 viewer-scoped；非授权调用 → `throw new TeamsAuthError(...)`。

```typescript
listMyTeams(prisma, viewer): Promise<TeamSummary[]>           // 任意已登录用户
listAllTeams(prisma, viewer): Promise<TeamSummary[]>          // admin only
getTeam(prisma, viewer, slug): Promise<TeamDetail>            // 成员 或 admin
createTeam(prisma, viewer, { name, slug? }): Promise<Team>    // 创建者自动 owner；slug 缺省时自动生成
leaveTeam(prisma, viewer, teamId): Promise<void>              // 唯一 owner 拒绝（必须先 transfer）
removeMember(prisma, viewer, teamId, userId): Promise<void>   // owner only；禁止移除自己（用 leave）
changeRole(prisma, viewer, teamId, userId, role): Promise<void>  // owner only；禁止把最后一个 owner 降级
deleteTeam(prisma, viewer, teamId): Promise<void>             // team owner 或 admin
createInvite(prisma, viewer, teamId): Promise<TeamInviteDTO>  // owner only；返回完整 invite（含 code 明文）
revokeInvite(prisma, viewer, inviteId): Promise<void>         // owner only
acceptInvite(prisma, viewer, code): Promise<{teamId, slug}>   // 任何已登录用户；revoked code 拒绝；已是成员则 no-op
```

返回类型不暴露内部敏感字段（如 hashed 字段、`createdById` 仅在 detail 视图里），用 `Omit` 投影。

### 扩展 `src/lib/services/metrics.ts`

所有四个函数新增 `scope` 参数：

```typescript
type MetricsScope =
  | { type: "self" }                  // 既有：member 收敛到 viewer.id；admin 走 opts.userId 或全员
  | { type: "team"; teamId: string }  // 新：viewer 必须是该团队成员或 admin；userId 展开为「该团队所有成员 id」

dailyTotals(prisma, viewer, range, { scope, userId? }): Promise<DailyPoint[]>
userRanking(prisma, viewer, range, { scope }): Promise<UserRankingRow[]>
toolBreakdown(prisma, viewer, range, { scope, userId? }): Promise<ToolPoint[]>
modelBreakdown(prisma, viewer, range, { scope, userId? }): Promise<ModelPoint[]>
```

`userRanking` 行为变化：
- 旧调用（无 scope 或 `scope: {type: "self"}`）保持 admin-only。
- `scope: {type: "team", teamId}` 时**任何团队成员可调**（团队透明性是核心价值）。

新隐私不变量在 service 内强制：team scope 调用必须先验证 `viewer` 属于该 team（或是全局 admin），否则 throw。在 `effectiveUserId` 之外，新增 `effectiveScope(viewer, scope) → string[] | null`，统一收敛——返回的 userId 列表代入查询，null 表示「全员」（admin self scope 无 userId）。

## 5. Slug 生成策略（`src/lib/slug.ts`）

```typescript
slugify(name: string): string | null
```

- 把 name 转 ASCII kebab-case：转小写、空格→连字符、非 `[a-z0-9-]` 字符删除、合并连续连字符、剪掉首尾连字符、截断到 60 字符。
- 处理后**为空字符串则返回 null**（典型情况：name 全是中文/emoji）。

```typescript
ensureUniqueSlug(prisma, base: string): Promise<string>
```

- 接 `slugify` 输出；若 `base` 已存在团队，返回 `${base}-2`，再冲突 `-3`，依此类推（直到找到空位）。

`createTeam(prisma, viewer, { name, slug? })`：
- 若调用者传了 `slug`：校验格式（`^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$` 或单字符 `[a-z0-9]`），传入 `ensureUniqueSlug` 处理冲突。
- 若未传：调 `slugify(name)`；为 null（中文 name 无法 ascii 化）→ throw `SlugRequiredError`，前端要求用户输入 slug。
- 非 null → 走 `ensureUniqueSlug`。

前端表单（`/teams/new`）：name 输入旁实时调一个 `useTransition` 包的本地 `slugify` 预览；中文 name 时预览栏显红字提示「中文团队名需手动输入 slug」+ slug 输入框设 required。

## 6. 全局 admin 在 Teams 中的特权

- `/admin/teams` 列出平台全部团队（名/slug/创建者/成员数/创建时间）。
- 全局 admin 可访问任意 `/teams/<slug>` 和 `/teams/<slug>/settings`（视同 owner 权限）。
- 全局 admin **不自动出现**在团队成员列表里（保持 `TeamMember` 表的「真正参与者」语义）。
- 全局 admin 通过 settings 页面可以删除任意团队。
- metrics（团队仪表盘的数据）对全局 admin 默认 visible（与 Plan 1/2 既有「admin 看一切」一致）。

## 7. 共享语义

- 加入团队 = 你账号下**全部历史 + 未来** token 数据对**该团队其他成员**可见（成员排行、团队趋势均包含你的数据）。
- 离开团队 = 不再对该团队共享（你的 usage 数据本身仍属你自己；其他团队若你也在内，照常共享）。
- 删除团队 = 所有 `TeamMember` / `TeamInvite` 通过 onDelete Cascade 删除；每个人的 `UsageRecord` 完整保留。
- 用户被全局 admin 禁用（`status = "disabled"`） = bearer 拒绝、登录拒绝、metrics 服务仍可返回他们历史数据（毕竟「禁用」≠「数据擦除」）。

## 8. 隐私不变量（更新）

Plan 1：API 仅接受聚合计数。
Plan 2：`effectiveUserId` 把 member 强制收敛到自己 id。
Plan 3 新增：
- `effectiveScope(viewer, scope)` 是新的查询前置——team scope 必须验证成员身份，self scope 沿用既有 `effectiveUserId`。
- 任何 `metrics` 调用必须经 scope 检查；不允许直接绕过传 userId list。
- `TeamRanking`/`teams` service 函数内部不允许 `prisma.usageRecord.findMany` 等裸调用——必须走 `metrics` 入口。

## 9. UI 组件

- `TeamSwitcher.tsx`（client） —— AppShell 侧栏「我的团队」折叠：显示该用户所有团队，hover/click 进入。
- `TeamList.tsx` —— `/teams` 主页面（卡片或表格）。
- `CreateTeamForm.tsx`（client） —— `/teams/new`，含 name + slug 实时预览。
- `TeamSettings.tsx` —— 成员表 + 角色下拉 + 移除按钮 + 转让 owner + 邀请链接区。
- `InviteAcceptCard.tsx`（client） —— `/invite/<code>` 预览页，「加入」按钮调 server action。
- `DeleteTeamDialog.tsx`（client） —— 仿 GitHub 风格，输入团队名确认。

所有图表组件复用 Plan 2：`DailyTrendChart` / `ToolBreakdownChart` / `ModelBreakdownChart` / `UserRankingTable`。

## 10. 测试策略

- **teams.test.ts**：creator 自动成 owner；非 owner 调 createInvite/removeMember/changeRole/delete 全部 reject；唯一 owner leave 拒绝；唯一 owner 被降级 reject；多 owner 互降 ok；admin 跨团队管理 ok；acceptInvite 幂等（已成员调返 no-op）；revoked invite accept 失败；slug 唯一性 + 中文 name 走手动 slug 路径。
- **metrics.test.ts** 新增 team scope 用例：team 成员可看团队 ranking；非成员被拒；admin 例外；userId in team scope 必须收敛到团队成员集合（forged userId 校验）。
- **slug.test.ts**：基础 slugify（去标点/合并连字符/截断）；纯中文返回 null；ensureUniqueSlug 接 `-2`/`-3` 增量。
- **server action 测试**：直接 import action + fake session，验证授权拒绝 + revalidatePath 调用。

## 11. 文件结构（新增 / 修改）

```
src/
  lib/
    services/teams.ts                    # 新
    services/metrics.ts                  # 改：所有函数加 scope 参数；新增 effectiveScope helper
    actions/teams.ts                     # 新
    slug.ts                              # 新
  components/
    TeamSwitcher.tsx                     # 新
    TeamList.tsx                         # 新
    CreateTeamForm.tsx                   # 新
    TeamSettings.tsx                     # 新
    InviteAcceptCard.tsx                 # 新
    DeleteTeamDialog.tsx                 # 新
    AppShell.tsx                         # 改：加「我的团队」折叠 + 「创建团队」+ admin 「平台团队」
  app/(app)/
    teams/page.tsx                       # /teams 列表
    teams/new/page.tsx                   # /teams/new
    teams/[slug]/page.tsx                # 团队仪表盘
    teams/[slug]/settings/page.tsx       # 团队设置
    invite/[code]/page.tsx               # 邀请接受
    admin/teams/page.tsx                 # /admin/teams
  middleware.ts                          # 改：加 /teams/:path* + /invite/:path* 到 matcher（/admin/teams 已被既有 /admin/:path* 覆盖）
prisma/
  schema.prisma                          # 加 Team/TeamMember/TeamInvite/TeamRole；User 加反向关系
  migrations/<ts>_teams/                 # 新迁移
tests/
  integration/teams.test.ts
  integration/metrics.test.ts            # 现有文件加 team scope 用例
  unit/slug.test.ts
```

## 12. 建议构建顺序

1. **数据模型 + slug 工具**（schema 迁移 + `lib/slug.ts` + slug 单测）
2. **teams service**（含所有授权守卫、唯一 owner 守卫、acceptInvite 幂等）+ 集成测试
3. **metrics service 扩 scope**（team 路径的 viewer 校验 + `effectiveScope` + 新增 team-scope 测试）
4. **teams server actions**（createTeam/leaveTeam/removeMember/changeRole/deleteTeam/createInvite/revokeInvite/acceptInvite + revalidatePath）；「转让 owner」由 UI 调 changeRole(target, "owner") + 后续 changeRole(self, "member") 或 leaveTeam 组合实现，无独立 action
5. **`/teams`、`/teams/new`、`/invite/<code>` 页面**（基本流程跑通）
6. **`/teams/<slug>` 团队仪表盘**（复用 Plan 2 的 4 个 chart，scope=team）
7. **`/teams/<slug>/settings`**（成员表 + 邀请 + 删除）
8. **AppShell 改造**（加「我的团队」折叠 + 「创建团队」+ admin「平台团队」+ middleware matcher 更新）
9. **`/admin/teams`**（admin 平台团队列表）

每步独立可跑 `pnpm dev` 验证 + 跑测试。

## 13. 完成标准

- `pnpm test` 全绿（新增 ~20 个 teams + slug + metrics-team-scope 用例）。
- 浏览器走通完整流程：A 创建团队 → 复制邀请链接 → 用户 B 接邀加入 → A 团队仪表盘看到 A+B 合并数据 → B 离队 → A 团队仪表盘只剩 A → A 删团队。
- 隐私不变量：服务端无 member 看到非团队成员数据的路径；team scope 调用强制走 effectiveScope。
- middleware 把 `/teams/*` + `/invite/*` + `/admin/teams` 纳入认证保护。
