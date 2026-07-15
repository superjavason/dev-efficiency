# 用户个人 Profile 页面（/users/[id]）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 团队排行榜可点击用户名跳转 `/users/[id]`，展示该用户的 dashboard 视图（不含 Token 管理），授权规则为本人 / 平台 admin / 同团队成员。

**Architecture:** 在 `MetricsScope` 新增 `{ type: "user", userId }` 变体，授权集中在 `effectiveScope`（依赖 `teams.ts` 新增的 `sharesTeam` 帮助函数）。新页面 `src/app/(app)/users/[id]/page.tsx` 复制 dashboard 结构但用 user scope 取数。middleware 把 `/users` 加入登录保护。排行组件用户单元格包 `<Link>`。

**Tech Stack:** Next.js App Router (Next 15, params/searchParams 为 Promise)、Prisma、Vitest 集成测试（真实 Postgres）。

**Spec:** `docs/superpowers/specs/2026-07-13-user-profile-page-design.md`

## Global Constraints

- 只用 `pnpm`，禁止 `npm`。
- 集成测试需要本地 Postgres：先 `docker compose up -d db`；测试命令为 `pnpm exec vitest run <file>`。
- **隐私不变式不得改动**：self scope 的 member 静默 clamp（`metrics.ts:32-34` 注释）；team scope 忽略 `opts.userId` 并校验成员身份。新增 user scope 是独立分支，不碰这两条。
- 服务层函数第一个参数是 `prisma: PrismaClient`，授权逻辑放 services 层，不放页面。
- 页面**不得**渲染 TokenList / TokenCreateDialog / `listTokensFor`（凭证信息不外泄）。

---

### Task 1: `sharesTeam` 帮助函数（teams.ts）

**Files:**
- Modify: `src/lib/services/teams.ts`（在 `membershipOf` 之后追加导出函数）
- Test: `tests/integration/shares-team.test.ts`（新建）

**Interfaces:**
- Consumes: Prisma 模型 `teamMember`（复合主键 `[teamId, userId]`，关联 `team.members`）。
- Produces: `export async function sharesTeam(prisma: PrismaClient, userIdA: string, userIdB: string): Promise<boolean>` — Task 2 的 `effectiveScope` 调用它。

- [ ] **Step 1: 写失败测试**

新建 `tests/integration/shares-team.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { sharesTeam } from "@/lib/services/teams";

async function makeUser() {
  return prisma.user.create({
    data: {
      email: `${Math.random().toString(36).slice(2)}@x.com`,
      name: "U",
      passwordHash: "x",
      status: "approved",
      role: "member",
    },
  });
}

async function makeTeamWith(userIds: string[]) {
  const team = await prisma.team.create({
    data: {
      name: "T",
      slug: `t-${Math.random().toString(36).slice(2, 8)}`,
      createdById: userIds[0],
    },
  });
  for (let i = 0; i < userIds.length; i++) {
    await prisma.teamMember.create({
      data: { teamId: team.id, userId: userIds[i], role: i === 0 ? "owner" : "member" },
    });
  }
  return team;
}

describe("sharesTeam", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("true when both users are members of the same team", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeTeamWith([a.id, b.id]);
    expect(await sharesTeam(prisma, a.id, b.id)).toBe(true);
    expect(await sharesTeam(prisma, b.id, a.id)).toBe(true);
  });

  it("false when users are in different teams", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeTeamWith([a.id]);
    await makeTeamWith([b.id]);
    expect(await sharesTeam(prisma, a.id, b.id)).toBe(false);
  });

  it("false when one user has no team at all", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeTeamWith([a.id]);
    expect(await sharesTeam(prisma, a.id, b.id)).toBe(false);
  });

  it("true for a user checked against themselves when they belong to a team", async () => {
    const a = await makeUser();
    await makeTeamWith([a.id]);
    expect(await sharesTeam(prisma, a.id, a.id)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run tests/integration/shares-team.test.ts`
Expected: FAIL —— `sharesTeam` 未从 `@/lib/services/teams` 导出（import 报错或 undefined）。

- [ ] **Step 3: 最小实现**

在 `src/lib/services/teams.ts` 的 `membershipOf` 函数之后追加：

```ts
/**
 * True when the two users are both members of at least one common team.
 * Used by metrics user-scope authorization (see services/metrics.ts).
 */
export async function sharesTeam(
  prisma: PrismaClient,
  userIdA: string,
  userIdB: string,
): Promise<boolean> {
  const m = await prisma.teamMember.findFirst({
    where: {
      userId: userIdA,
      team: { members: { some: { userId: userIdB } } },
    },
    select: { teamId: true },
  });
  return m !== null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run tests/integration/shares-team.test.ts`
Expected: 4 passed。

- [ ] **Step 5: 提交**

```bash
git add src/lib/services/teams.ts tests/integration/shares-team.test.ts
git commit -m "feat(teams): add sharesTeam helper for cross-user authorization"
```

---

### Task 2: MetricsScope 新增 user 变体（metrics.ts）

**Files:**
- Modify: `src/lib/services/metrics.ts`（`MetricsScope` 类型 + `effectiveScope` 函数 + 顶部 import）
- Test: `tests/integration/metrics.test.ts`（追加一个 describe 块）

**Interfaces:**
- Consumes: Task 1 的 `sharesTeam(prisma, userIdA, userIdB): Promise<boolean>`。
- Produces: `MetricsScope` 联合类型新增 `{ type: "user"; userId: string }`；`dailyTotals` / `toolBreakdown` / `modelBreakdown` / `profileActivity` 均自动支持（它们都经由 `effectiveScope`）。Task 4 的页面以 `scope: { type: "user", userId }` 调用。

- [ ] **Step 1: 写失败测试**

在 `tests/integration/metrics.test.ts` 末尾（`metrics token breakdown` describe 之后）追加：

```ts
describe("metrics service user scope (per-user drill-down)", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  async function makeTeamWith(userIds: string[]) {
    const team = await prisma.team.create({
      data: {
        name: "T",
        slug: `t-${Math.random().toString(36).slice(2, 8)}`,
        createdById: userIds[0],
      },
    });
    for (let i = 0; i < userIds.length; i++) {
      await prisma.teamMember.create({
        data: { teamId: team.id, userId: userIds[i], role: i === 0 ? "owner" : "member" },
      });
    }
    return team;
  }

  it("a user can view their own data via user scope", async () => {
    const me = await makeUser();
    await record(me.id, { total: 10n });
    const scope: MetricsScope = { type: "user", userId: me.id };
    const out = await dailyTotals(prisma, me, range, { scope });
    expect(out.reduce((s, p) => s + Number(p.total), 0)).toBe(10);
  });

  it("a teammate can view the target's data, and only the target's", async () => {
    const viewer = await makeUser();
    const target = await makeUser();
    await makeTeamWith([viewer.id, target.id]);
    await record(viewer.id, { total: 10n });
    await record(target.id, { total: 77n });
    const scope: MetricsScope = { type: "user", userId: target.id };
    const out = await dailyTotals(prisma, viewer, range, { scope });
    expect(out.reduce((s, p) => s + Number(p.total), 0)).toBe(77);
  });

  it("a non-teammate is rejected with MetricsAuthError", async () => {
    const viewer = await makeUser();
    const target = await makeUser();
    await makeTeamWith([viewer.id]);
    await makeTeamWith([target.id]);
    await record(target.id, { total: 77n });
    const scope: MetricsScope = { type: "user", userId: target.id };
    await expect(dailyTotals(prisma, viewer, range, { scope })).rejects.toBeInstanceOf(
      MetricsAuthError,
    );
  });

  it("a platform admin can view any user via user scope", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser();
    await record(target.id, { total: 42n });
    const scope: MetricsScope = { type: "user", userId: target.id };
    const out = await dailyTotals(prisma, admin, range, { scope });
    expect(out.reduce((s, p) => s + Number(p.total), 0)).toBe(42);
  });

  it("profileActivity works with user scope for a teammate", async () => {
    const viewer = await makeUser();
    const target = await makeUser();
    await makeTeamWith([viewer.id, target.id]);
    await record(target.id, { date: "2026-05-25", total: 300n });
    const scope: MetricsScope = { type: "user", userId: target.id };
    const out = await profileActivity(prisma, viewer, { scope, today: "2026-05-26" });
    expect(out.stats.cumulativeTotal).toBe(300);
  });
});
```

同时把文件顶部的 import 补上 `profileActivity`：

```ts
import {
  dailyTotals,
  userRanking,
  toolBreakdown,
  modelBreakdown,
  profileActivity,
  MetricsAuthError,
} from "@/lib/services/metrics";
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run tests/integration/metrics.test.ts`
Expected: 新增 describe 的用例 FAIL（TypeScript 报 `{ type: "user" }` 不属于 `MetricsScope`，vitest 直接编译失败也算预期失败）；原有用例不动。

- [ ] **Step 3: 实现 user scope**

`src/lib/services/metrics.ts` 三处修改：

(a) 顶部 import（第 2 行附近）加：

```ts
import { sharesTeam } from "@/lib/services/teams";
```

(b) `MetricsScope` 类型与文档注释改为：

```ts
/**
 * Query scope for metrics calls.
 * - `self`: existing behavior — member clamped to viewer.id; admin honors opts.userId or returns all users.
 * - `team`: aggregates across all current members of the team. Viewer must be a team member or platform admin.
 *   `opts.userId` is intentionally ignored for team scope (no per-user drill-down within team scope).
 * - `user`: single-user drill-down (profile page). Allowed when the target is the viewer
 *   themselves, the viewer is a platform admin, or the two share at least one team.
 */
export type MetricsScope =
  | { type: "self" }
  | { type: "team"; teamId: string }
  | { type: "user"; userId: string };
```

(c) `effectiveScope` 里，在 `if (scope.type === "team") {...}` 块**之后**、`if (viewer.role === "admin")` 之前插入：

```ts
  if (scope.type === "user") {
    if (scope.userId !== viewer.id && viewer.role !== "admin") {
      const shared = await sharesTeam(prisma, viewer.id, scope.userId);
      if (!shared) {
        throw new MetricsAuthError("forbidden: no shared team with target user");
      }
    }
    return [scope.userId];
  }
```

不改动 self clamp（`return [viewer.id];`）、team 分支和 `userRanking` 的 admin 校验。

- [ ] **Step 4: 运行确认通过（含回归）**

Run: `pnpm exec vitest run tests/integration/metrics.test.ts tests/integration/profile-activity.test.ts tests/integration/shares-team.test.ts`
Expected: 全部 PASS（原 self/team 不变式测试 + 新增 user scope 测试）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/services/metrics.ts tests/integration/metrics.test.ts
git commit -m "feat(metrics): add user scope for per-user drill-down with shared-team authorization"
```

---

### Task 3: middleware 保护 /users 路由

**Files:**
- Modify: `src/middleware.ts`（`isApp` 判断 + `config.matcher`）
- Test: `tests/integration/middleware.test.ts`（追加两个用例）

**Interfaces:**
- Consumes: 现有 `middleware(req: NextRequest)` 与 iron-session cookie 机制。
- Produces: 未登录访问 `/users/*` → 307 跳 `/login?returnTo=...`；已登录放行。Task 4 的页面依赖此保护。

- [ ] **Step 1: 写失败测试**

在 `tests/integration/middleware.test.ts` 的 describe 内追加：

```ts
  it("redirects unauthenticated /users/some-id → /login", async () => {
    const req = await withSession("http://t/users/some-id");
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/login");
    expect(loc).toContain("returnTo=%2Fusers%2Fsome-id");
  });

  it("allows authenticated member → /users/some-id", async () => {
    const req = await withSession("http://t/users/some-id", { userId: "u1", role: "member" });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run tests/integration/middleware.test.ts`
Expected: 第一个新用例 FAIL（当前 `/users` 不在 `isApp` 内，直接放行返回 200 而非 307）。

- [ ] **Step 3: 实现**

`src/middleware.ts` 两处修改：

```ts
  const isApp =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/teams") ||
    pathname.startsWith("/users") ||
    pathname.startsWith("/invite");
```

```ts
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/teams/:path*",
    "/users/:path*",
    "/invite/:path*",
  ],
};
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run tests/integration/middleware.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/middleware.ts tests/integration/middleware.test.ts
git commit -m "feat(middleware): require login for /users routes"
```

---

### Task 4: /users/[id] 页面

**Files:**
- Create: `src/app/(app)/users/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 2 的 `scope: { type: "user", userId }`；`MetricsAuthError`（`@/lib/services/metrics`）；现有组件 `ProfileSummary` / `DailyTrendChart` / `ToolBreakdownChart` / `ModelBreakdownChart` / `DateRangePicker`；`parseRange`（`@/lib/range`）。
- Produces: 路由 `/users/[id]`，Task 5 的排行榜链接指向它。

- [ ] **Step 1: 创建页面**

新建 `src/app/(app)/users/[id]/page.tsx`（复制 dashboard 结构，去掉 Token 卡片，scope 换成 user）：

```tsx
import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { parseRange } from "@/lib/range";
import {
  dailyTotals,
  toolBreakdown,
  modelBreakdown,
  profileActivity,
  MetricsAuthError,
  type MetricsScope,
} from "@/lib/services/metrics";
import { ProfileSummary } from "@/components/ProfileSummary";
import { DailyTrendChart } from "@/components/charts/DailyTrendChart";
import { ToolBreakdownChart } from "@/components/charts/ToolBreakdownChart";
import { ModelBreakdownChart } from "@/components/charts/ModelBreakdownChart";
import { DateRangePicker } from "@/components/DateRangePicker";

interface SearchParams {
  preset?: string;
  from?: string;
  to?: string;
}

export default async function UserProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const viewer = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!viewer) redirect("/login");

  const { id } = await params;
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, avatarUrl: true },
  });
  if (!target) notFound();

  const sp = await searchParams;
  const range = parseRange(sp);
  const scope: MetricsScope = { type: "user", userId: target.id };

  let data;
  try {
    data = await Promise.all([
      dailyTotals(prisma, viewer, range, { scope }),
      toolBreakdown(prisma, viewer, range, { scope }),
      modelBreakdown(prisma, viewer, range, { scope }),
      profileActivity(prisma, viewer, { scope }),
    ]);
  } catch (e) {
    if (e instanceof MetricsAuthError) {
      return (
        <div className="py-16 text-center text-muted-foreground">
          无权查看该用户的数据（需与对方同属一个团队）
        </div>
      );
    }
    throw e;
  }
  const [trend, tools, models, activity] = data;

  return (
    <div className="space-y-6">
      <ProfileSummary name={target.name} avatarUrl={target.avatarUrl} activity={activity} />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{target.name} 的用量</h1>
        <DateRangePicker />
      </div>

      <Card>
        <CardHeader><CardTitle>每日 Token 趋势</CardTitle></CardHeader>
        <CardContent>
          <DailyTrendChart
            data={trend.map((p) => ({
              date: p.date,
              input: Number(p.inputTokens),
              output: Number(p.outputTokens),
              cache: Number(p.cacheTokens),
              total: Number(p.total),
            }))}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>按工具</CardTitle></CardHeader>
          <CardContent>
            <ToolBreakdownChart
              data={tools.map((t) => ({
                tool: t.tool,
                input: Number(t.inputTokens),
                output: Number(t.outputTokens),
                cache: Number(t.cacheTokens),
                total: Number(t.total),
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>按模型</CardTitle></CardHeader>
          <CardContent>
            <ModelBreakdownChart
              data={models.map((m) => ({
                model: m.model,
                input: Number(m.inputTokens),
                output: Number(m.outputTokens),
                cache: Number(m.cacheTokens),
                total: Number(m.total),
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

注意：**不要** import `listTokensFor` / `TokenList` / `TokenCreateDialog`（全局约束）。

- [ ] **Step 2: 构建与 lint 验证**

Run: `pnpm lint && pnpm build`
Expected: lint 无 error；build 成功，输出的路由清单里出现 `/users/[id]`。

- [ ] **Step 3: 提交**

```bash
git add "src/app/(app)/users/[id]/page.tsx"
git commit -m "feat(ui): add /users/[id] profile page with per-user metrics"
```

---

### Task 5: 排行榜用户名加链接

**Files:**
- Modify: `src/components/charts/UserRankingTable.tsx`

**Interfaces:**
- Consumes: `RankingRow.userId`（已存在）；Task 4 的 `/users/[id]` 路由。
- Produces: 排行榜用户单元格可点击。

- [ ] **Step 1: 实现链接**

`src/components/charts/UserRankingTable.tsx` 两处修改：

(a) 顶部加 import：

```tsx
import Link from "next/link";
```

(b) 用户单元格（原 `<div className="flex items-center gap-2">...</div>`）替换为：

```tsx
            <TableCell>
              <Link
                href={`/users/${row.userId}`}
                className="group flex items-center gap-2"
              >
                <UserAvatar name={row.name} avatarUrl={row.avatarUrl} size={24} />
                <div className="flex flex-col">
                  <span className="group-hover:underline">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{row.email}</span>
                </div>
              </Link>
            </TableCell>
```

- [ ] **Step 2: 验证**

Run: `pnpm lint && pnpm build`
Expected: 无 error，build 成功。

- [ ] **Step 3: 提交**

```bash
git add src/components/charts/UserRankingTable.tsx
git commit -m "feat(ui): link ranking table user names to /users/[id] profile"
```

---

### Task 6: 全量回归

**Files:** 无新改动。

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS（含原有 self clamp / team scope 不变式测试）。

- [ ] **Step 2: skill 包测试（确认未受影响）**

Run: `pnpm --filter @dev-efficiency/skill test`
Expected: 全部 PASS。

- [ ] **Step 3: 如有遗留未提交内容则提交**

```bash
git status --short   # 应为空；若计划文件未提交则一并提交
```
