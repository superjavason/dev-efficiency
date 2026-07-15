# 用户个人 Profile 页面（/users/[id]）设计

日期：2026-07-13
状态：已确认

## 背景与目标

团队页的"团队内排行"列表（`UserRankingTable`）目前用户名是纯文本。目标：点击用户名跳转到该用户的个人 profile 页面，内容与该用户本人登录后看到的 dashboard 一致（去掉 API Token 管理块）。

现状约束：`src/lib/services/metrics.ts` 的 `effectiveScope` 有明确隐私设计——team scope 故意忽略 `userId`（"no per-user drill-down within team in v1"）。本功能正式放开该限制，但通过**新增 scope 变体**实现，不改动现有 self/team 语义。

## 决策记录

| 决策点 | 结论 |
| --- | --- |
| 查看权限 | 本人、平台 admin、或与目标用户**同属至少一个团队**的成员 |
| 页面内容 | 与 dashboard 相同，但排除 TokenList / TokenCreateDialog |
| 路由 | 全局路由 `/users/[id]`（而非团队下嵌套路由），便于多入口复用 |
| 服务层方案 | 新增 `MetricsScope` 变体 `{ type: "user", userId }`（方案 A） |

## 服务层（核心改动）

### `src/lib/services/teams.ts`

新增导出：

```ts
sharesTeam(prisma: PrismaClient, userIdA: string, userIdB: string): Promise<boolean>
```

判断两个用户是否同属至少一个团队（`teamMember` 交集查询，一次查询即可，例如查 A 的 teamId 列表与 B 的 teamId 列表求交，或 `findFirst` 嵌套条件）。

### `src/lib/services/metrics.ts`

`MetricsScope` 增加变体：

```ts
type MetricsScope =
  | { type: "self" }
  | { type: "team"; teamId: string }
  | { type: "user"; userId: string };
```

`effectiveScope` 对 `type: "user"` 的规则：

1. `scope.userId === viewer.id` → 放行，返回 `[scope.userId]`。
2. viewer 为平台 admin → 放行。
3. 否则调用 `sharesTeam(prisma, viewer.id, scope.userId)`，为 true 放行，否则抛 `MetricsAuthError("forbidden: no shared team with target user")`。

不变式保持：

- self scope 的 member 静默 clamp 行为不变。
- team scope 继续忽略 `opts.userId`、继续做成员校验。
- `userRanking` 的 admin 限制不变。

`profileActivity`、`dailyTotals`、`toolBreakdown`、`modelBreakdown` 均经由 `effectiveScope`，自动获得 user scope 支持，无需逐个改动（如有函数绕过 `effectiveScope` 需补齐）。

## 页面 `/users/[id]`

新文件 `src/app/(app)/users/[id]/page.tsx`，结构复制 `dashboard/page.tsx`：

- 按 `params.id` 查目标用户基本信息（name、avatarUrl 等）。用户不存在 → `notFound()`。
- 取数（`Promise.all`），全部使用 `scope: { type: "user", userId: params.id }`：
  - `profileActivity` → `ProfileSummary`（头像、统计卡、全历史热力图）
  - `dailyTotals` → `DailyTrendChart`
  - `toolBreakdown` → `ToolBreakdownChart`
  - `modelBreakdown` → `ModelBreakdownChart`
- 捕获 `MetricsAuthError` → 展示 403 无权限提示（不泄露目标用户数据）。
- 保留 `DateRangePicker`，URL 参数 `preset/from/to` 复用 `parseRange`。
- **不渲染** TokenList / TokenCreateDialog。
- 页头展示目标用户名字与头像（`ProfileSummary` 已含，不重复）。

### 中间件

`src/middleware.ts` 将 `/users` 加入需登录的路径前缀（未登录跳 `/login`）。

## 排行榜入口

`src/components/charts/UserRankingTable.tsx`：用户单元格（头像 + 名字 + 邮箱区域）包 `<Link href={`/users/${row.userId}`}>`，加 hover 下划线/变色样式。`RankingRow` 已含 `userId`，数据层无需改动。点击自己同样进入 `/users/[自己id]`。

## 测试

`tests/integration/` 中针对 user scope 的集成测试（真实 Postgres）：

1. 本人查看自己 → 放行，仅返回本人数据。
2. 同团队成员查看 → 放行，仅返回目标用户数据（不混入他人）。
3. 非同团队用户查看 → 抛 `MetricsAuthError`。
4. 平台 admin 查看任意用户 → 放行。
5. 现有 self clamp、team scope 测试全部保持通过（不变式回归）。

## 不做的事（YAGNI）

- 不在 admin 用户列表等其他入口加链接（路由已具备复用性，后续需要时再加）。
- 不做团队维度的下钻 URL（`/teams/[slug]/members/...`）。
- 不展示目标用户的 token 列表或任何凭证元数据。
