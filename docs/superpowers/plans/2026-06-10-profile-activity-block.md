# Profile Activity Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personal profile block (avatar + name, five stat cards, GitHub-style 12-month daily-activity heatmap) to the top of `/dashboard`.

**Architecture:** Pure date/streak/grid math lives in a DB-free, unit-tested module (`src/lib/activity.ts`) plus a display formatter (`src/lib/format.ts`). A new `profileActivity()` service in `src/lib/services/metrics.ts` queries all-history daily token totals (reusing the existing `effectiveScope` privacy clamp), converts BigInt→number, and delegates to the pure module. A server component (`ProfileSummary`) renders avatar/name/cards and embeds a client `ActivityHeatmap` (CSS-grid squares, not Recharts). The dashboard page fetches `profileActivity` in its existing `Promise.all` and renders the block above the current charts.

**Tech Stack:** Next.js App Router (RSC), Prisma (BigInt token columns), Vitest (node env, `fileParallelism: false`, global `prisma migrate deploy`), Tailwind v4, shadcn/ui (`Card`, `Avatar`/`UserAvatar`).

**Prerequisite:** Postgres must be running for any test (`docker compose up -d db`) — the global setup runs `prisma migrate deploy` for the whole suite, including unit tests.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/activity.ts` (create) | Pure, DB-free: `DayTotal`/`HeatmapCell`/`Heatmap` types; `computeStreaks`, `computeThresholds`, `bucketLevel`, `buildHeatmap`, plus internal date helpers. |
| `src/lib/format.ts` (create) | Pure `formatCompactCN(n)` → `亿`/`万`/grouped number. |
| `src/lib/services/metrics.ts` (modify) | Add `ProfileActivity` interface + `profileActivity()` service. |
| `src/components/charts/ActivityHeatmap.tsx` (create) | Client component: CSS-grid heatmap, blue 5-level scale, native-`title` tooltip, 每日/每周/累计 toggle (only 每日 active). |
| `src/components/ProfileSummary.tsx` (create) | Server component: avatar + name + 5 `StatCard`s + heatmap card. |
| `src/app/(app)/dashboard/page.tsx` (modify) | Fetch `profileActivity`, render `<ProfileSummary>` above existing charts. |
| `tests/unit/activity.test.ts` (create) | Unit tests for the pure activity module. |
| `tests/unit/format.test.ts` (create) | Unit tests for `formatCompactCN`. |
| `tests/integration/profile-activity.test.ts` (create) | Integration test for `profileActivity()` against real Postgres. |

---

## Task 1: Pure module — types + date helpers + `computeStreaks`

**Files:**
- Create: `src/lib/activity.ts`
- Test: `tests/unit/activity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/activity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeStreaks, type DayTotal } from "@/lib/activity";

const d = (date: string, total: number): DayTotal => ({ date, total });

describe("computeStreaks", () => {
  it("returns zeros for empty history", () => {
    expect(computeStreaks([], "2026-06-10")).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      activeDays: 0,
    });
  });

  it("counts a single active day today", () => {
    expect(computeStreaks([d("2026-06-10", 5)], "2026-06-10")).toEqual({
      currentStreak: 1,
      longestStreak: 1,
      activeDays: 1,
    });
  });

  it("ignores days whose total is zero", () => {
    const r = computeStreaks([d("2026-06-09", 0), d("2026-06-10", 7)], "2026-06-10");
    expect(r.activeDays).toBe(1);
    expect(r.currentStreak).toBe(1);
  });

  it("current streak counts from yesterday when today is inactive", () => {
    const days = [d("2026-06-08", 1), d("2026-06-09", 1)];
    const r = computeStreaks(days, "2026-06-10");
    expect(r.currentStreak).toBe(2);
    expect(r.longestStreak).toBe(2);
  });

  it("current streak is 0 when neither today nor yesterday is active", () => {
    const days = [d("2026-06-01", 1), d("2026-06-02", 1)];
    const r = computeStreaks(days, "2026-06-10");
    expect(r.currentStreak).toBe(0);
    expect(r.longestStreak).toBe(2);
  });

  it("longest streak spans a month boundary and exceeds current", () => {
    const days = [
      d("2026-05-30", 1), d("2026-05-31", 1), d("2026-06-01", 1), d("2026-06-02", 1),
      d("2026-06-10", 1),
    ];
    const r = computeStreaks(days, "2026-06-10");
    expect(r.longestStreak).toBe(4);
    expect(r.currentStreak).toBe(1);
    expect(r.activeDays).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/activity.test.ts`
Expected: FAIL — cannot resolve `@/lib/activity` / `computeStreaks is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/activity.ts`:

```typescript
export interface DayTotal {
  date: string; // YYYY-MM-DD
  total: number;
}

export interface HeatmapCell {
  date: string; // YYYY-MM-DD
  total: number; // 0 if no activity
  level: 0 | 1 | 2 | 3 | 4;
}

export interface Heatmap {
  // column-major: weeks[col] is one week (length 7, Sunday..Saturday).
  // A cell is null for days after `today` in the trailing partial week.
  weeks: (HeatmapCell | null)[][];
  monthLabels: { label: string; weekIndex: number }[];
}

// --- internal date helpers (UTC midnights to avoid DST drift) ---

function parseDay(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(s: string, n: number): string {
  const d = parseDay(s);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDay(d);
}

function dayOfWeek(s: string): number {
  return parseDay(s).getUTCDay(); // 0 = Sunday
}

function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}

export function computeStreaks(
  days: DayTotal[],
  today: string,
): { currentStreak: number; longestStreak: number; activeDays: number } {
  const active = new Set(days.filter((x) => x.total > 0).map((x) => x.date));
  const activeDays = active.size;

  let longestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of [...active].sort()) {
    run = prev !== null && diffDays(prev, date) === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    prev = date;
  }

  let cursor: string;
  if (active.has(today)) cursor = today;
  else if (active.has(addDays(today, -1))) cursor = addDays(today, -1);
  else return { currentStreak: 0, longestStreak, activeDays };

  let currentStreak = 0;
  while (active.has(cursor)) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }
  return { currentStreak, longestStreak, activeDays };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/activity.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity.ts tests/unit/activity.test.ts
git commit -m "feat(activity): pure streak computation with date helpers"
```

---

## Task 2: Pure module — `computeThresholds` + `bucketLevel`

**Files:**
- Modify: `src/lib/activity.ts`
- Test: `tests/unit/activity.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/activity.test.ts`:

```typescript
import { computeThresholds, bucketLevel } from "@/lib/activity";

describe("computeThresholds + bucketLevel", () => {
  it("treats all-zero data as level 0", () => {
    const days = [d("2026-06-09", 0), d("2026-06-10", 0)];
    const th = computeThresholds(days);
    expect(bucketLevel(0, th)).toBe(0);
  });

  it("maps zero total to level 0 regardless of thresholds", () => {
    expect(bucketLevel(0, [10, 20, 30])).toBe(0);
    expect(bucketLevel(-5, [10, 20, 30])).toBe(0);
  });

  it("assigns ascending levels across quartile thresholds", () => {
    expect(bucketLevel(5, [10, 20, 30])).toBe(1); // below p25
    expect(bucketLevel(10, [10, 20, 30])).toBe(2); // >= p25
    expect(bucketLevel(25, [10, 20, 30])).toBe(3); // >= p50
    expect(bucketLevel(30, [10, 20, 30])).toBe(4); // >= p75
    expect(bucketLevel(999, [10, 20, 30])).toBe(4); // capped at 4
  });

  it("puts every active cell on the same level when all totals are equal", () => {
    const days = [d("2026-06-08", 50), d("2026-06-09", 50), d("2026-06-10", 50)];
    const th = computeThresholds(days);
    expect(bucketLevel(50, th)).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/activity.test.ts`
Expected: FAIL — `computeThresholds` / `bucketLevel` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/activity.ts`:

```typescript
// Three quartile cut points (p25, p50, p75) of active days' totals → 4 non-zero levels.
export function computeThresholds(days: DayTotal[]): number[] {
  const totals = days
    .filter((x) => x.total > 0)
    .map((x) => x.total)
    .sort((a, b) => a - b);
  if (totals.length === 0) return [1, 1, 1];
  const q = (p: number) => totals[Math.floor((totals.length - 1) * p)];
  return [q(0.25), q(0.5), q(0.75)];
}

export function bucketLevel(total: number, thresholds: number[]): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0) return 0;
  let level = 1;
  for (const t of thresholds) {
    if (total >= t) level += 1;
  }
  return Math.min(level, 4) as 1 | 2 | 3 | 4;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/activity.test.ts`
Expected: PASS (all activity tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity.ts tests/unit/activity.test.ts
git commit -m "feat(activity): quantile thresholds and level bucketing"
```

---

## Task 3: Pure module — `buildHeatmap`

**Files:**
- Modify: `src/lib/activity.ts`
- Test: `tests/unit/activity.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/activity.test.ts`:

```typescript
import { buildHeatmap } from "@/lib/activity";

describe("buildHeatmap", () => {
  const today = "2026-06-10"; // a Wednesday (UTC getUTCDay() === 3)

  it("produces 53 week-columns of 7 rows each", () => {
    const hm = buildHeatmap([], today);
    expect(hm.weeks.length).toBe(53);
    for (const col of hm.weeks) expect(col.length).toBe(7);
  });

  it("starts the grid on a Sunday and ends with today in the last column", () => {
    const hm = buildHeatmap([], today);
    expect(hm.weeks[0][0]?.date).toBe("2025-06-08"); // Sunday on/before today-364
    const last = hm.weeks[hm.weeks.length - 1];
    const dates = last.filter(Boolean).map((c) => c!.date);
    expect(dates).toContain(today);
  });

  it("renders days after today as null in the trailing week", () => {
    const hm = buildHeatmap([], today);
    const last = hm.weeks[hm.weeks.length - 1];
    // today is Wednesday (row 3); Thu/Fri/Sat (rows 4,5,6) are in the future
    expect(last[4]).toBeNull();
    expect(last[5]).toBeNull();
    expect(last[6]).toBeNull();
  });

  it("places a known active date in the correct cell with a non-zero level", () => {
    const hm = buildHeatmap([{ date: "2026-06-10", total: 100 }], today);
    const last = hm.weeks[hm.weeks.length - 1];
    expect(last[3]?.date).toBe("2026-06-10"); // Wednesday row
    expect(last[3]?.total).toBe(100);
    expect(last[3]?.level).toBeGreaterThan(0);
  });

  it("emits month labels in column order", () => {
    const hm = buildHeatmap([], today);
    expect(hm.monthLabels.length).toBeGreaterThan(0);
    expect(hm.monthLabels[0].label).toMatch(/月$/);
    const idxs = hm.monthLabels.map((m) => m.weekIndex);
    expect([...idxs].sort((a, b) => a - b)).toEqual(idxs);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/activity.test.ts`
Expected: FAIL — `buildHeatmap` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/activity.ts`:

```typescript
export function buildHeatmap(days: DayTotal[], today: string): Heatmap {
  const totalByDate = new Map(days.map((x) => [x.date, x.total]));

  // Window: today-364 .. today, with the start aligned back to its Sunday.
  const windowStart = addDays(today, -364);
  const start = addDays(windowStart, -dayOfWeek(windowStart));

  // Thresholds computed over the in-window day totals (the cells actually shown).
  const inWindow: DayTotal[] = [];
  for (let cur = start; diffDays(cur, today) >= 0; cur = addDays(cur, 1)) {
    inWindow.push({ date: cur, total: totalByDate.get(cur) ?? 0 });
  }
  const thresholds = computeThresholds(inWindow);

  const weeks: (HeatmapCell | null)[][] = [];
  const monthLabels: { label: string; weekIndex: number }[] = [];
  let seenMonth = "";
  let weekIndex = 0;

  for (let colStart = start; diffDays(colStart, today) >= 0; colStart = addDays(colStart, 7)) {
    const col: (HeatmapCell | null)[] = [];
    for (let row = 0; row < 7; row++) {
      const date = addDays(colStart, row);
      if (diffDays(date, today) < 0) {
        col.push(null); // future day in the trailing partial week
      } else {
        const total = totalByDate.get(date) ?? 0;
        col.push({ date, total, level: bucketLevel(total, thresholds) });
      }
    }
    const label = `${parseDay(colStart).getUTCMonth() + 1}月`;
    if (label !== seenMonth) {
      monthLabels.push({ label, weekIndex });
      seenMonth = label;
    }
    weeks.push(col);
    weekIndex += 1;
  }

  return { weeks, monthLabels };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/activity.test.ts`
Expected: PASS (all activity tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/activity.ts tests/unit/activity.test.ts
git commit -m "feat(activity): build 12-month column-major heatmap grid"
```

---

## Task 4: Display formatter `formatCompactCN`

**Files:**
- Create: `src/lib/format.ts`
- Test: `tests/unit/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/format.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatCompactCN } from "@/lib/format";

describe("formatCompactCN", () => {
  it("formats hundreds of millions with 亿", () => {
    expect(formatCompactCN(160_000_000)).toBe("1.6亿");
  });

  it("formats tens of thousands with 万", () => {
    expect(formatCompactCN(52_984_000)).toBe("5298.4万");
  });

  it("strips a trailing .0", () => {
    expect(formatCompactCN(30_000_000)).toBe("3000万");
    expect(formatCompactCN(200_000_000)).toBe("2亿");
  });

  it("uses grouped digits below 万", () => {
    expect(formatCompactCN(9999)).toBe("9,999");
    expect(formatCompactCN(0)).toBe("0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/format.test.ts`
Expected: FAIL — cannot resolve `@/lib/format`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/format.ts`:

```typescript
function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

export function formatCompactCN(n: number): string {
  if (n >= 1e8) return `${trim(n / 1e8)}亿`;
  if (n >= 1e4) return `${trim(n / 1e4)}万`;
  return n.toLocaleString("en-US");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts tests/unit/format.test.ts
git commit -m "feat(format): compact CN number formatter (万/亿)"
```

---

## Task 5: `profileActivity()` service

**Files:**
- Modify: `src/lib/services/metrics.ts`
- Test: `tests/integration/profile-activity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/profile-activity.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { profileActivity } from "@/lib/services/metrics";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function makeUser(over: { role?: "admin" | "member" } = {}) {
  return prisma.user.create({
    data: {
      email: `${Math.random().toString(36).slice(2)}@x.com`,
      name: "U",
      passwordHash: "x",
      status: "approved",
      role: over.role ?? "member",
    },
  });
}

async function record(userId: string, date: string, total: bigint) {
  return prisma.usageRecord.create({
    data: {
      userId,
      date: new Date(`${date}T00:00:00.000Z`),
      tool: "claude_code",
      model: "claude-opus-4-7",
      project: "",
      inputTokens: total,
      outputTokens: 0n,
      cacheCreationTokens: 0n,
      cacheReadTokens: 0n,
      totalTokens: total,
      sessionCount: 1,
      messageCount: 1,
      source: "auto",
    },
  });
}

const today = "2026-06-10";

describe("profileActivity", () => {
  it("returns zeroed stats and a full empty grid with no data", async () => {
    const me = await makeUser();
    const r = await profileActivity(prisma, me, { scope: { type: "self" }, today });
    expect(r.stats).toEqual({
      cumulativeTotal: 0,
      peakDay: 0,
      activeDays: 0,
      currentStreak: 0,
      longestStreak: 0,
    });
    expect(r.heatmap.weeks.length).toBe(53);
  });

  it("aggregates cumulative, peak, active days and streaks across history", async () => {
    const me = await makeUser();
    // two-day run, a gap, then today
    await record(me.id, "2026-06-01", 100n);
    await record(me.id, "2026-06-02", 300n);
    await record(me.id, "2026-06-10", 50n);
    // same day, two tools → summed into one daily total
    await prisma.usageRecord.create({
      data: {
        userId: me.id,
        date: new Date("2026-06-02T00:00:00.000Z"),
        tool: "codex",
        model: "gpt-x",
        project: "",
        inputTokens: 200n,
        outputTokens: 0n,
        cacheCreationTokens: 0n,
        cacheReadTokens: 0n,
        totalTokens: 200n,
        sessionCount: 1,
        messageCount: 1,
        source: "auto",
      },
    });

    const r = await profileActivity(prisma, me, { scope: { type: "self" }, today });
    expect(r.stats.cumulativeTotal).toBe(650); // 100 + (300+200) + 50
    expect(r.stats.peakDay).toBe(500); // 2026-06-02
    expect(r.stats.activeDays).toBe(3);
    expect(r.stats.longestStreak).toBe(2); // 06-01..06-02
    expect(r.stats.currentStreak).toBe(1); // 06-10 today
  });

  it("clamps a member to their own data even if a userId is forged", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await record(me.id, "2026-06-10", 10n);
    await record(other.id, "2026-06-10", 999n);

    const r = await profileActivity(prisma, me, {
      scope: { type: "self" },
      userId: other.id,
      today,
    });
    expect(r.stats.cumulativeTotal).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/integration/profile-activity.test.ts`
Expected: FAIL — `profileActivity` not exported from metrics.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/services/metrics.ts`, add the import for the pure module at the top (alongside the existing imports):

```typescript
import {
  computeStreaks,
  buildHeatmap,
  type DayTotal,
  type Heatmap,
} from "@/lib/activity";
```

Then append at the end of the file:

```typescript
export interface ProfileActivity {
  stats: {
    cumulativeTotal: number;
    peakDay: number;
    activeDays: number;
    currentStreak: number;
    longestStreak: number;
  };
  heatmap: Heatmap;
}

export async function profileActivity(
  prisma: PrismaClient,
  viewer: User,
  opts: { scope: MetricsScope; userId?: string | null; today?: string },
): Promise<ProfileActivity> {
  const userIds = await effectiveScope(prisma, viewer, opts.scope, opts.userId);
  const where: { userId?: { in: string[] } } = {};
  if (userIds) {
    where.userId = { in: userIds.length === 0 ? ["__no_match__"] : userIds };
  }

  const rows = await prisma.usageRecord.groupBy({
    by: ["date"],
    where,
    _sum: { totalTokens: true },
    orderBy: { date: "asc" },
  });

  const days: DayTotal[] = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    total: Number(r._sum.totalTokens ?? 0n),
  }));

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const cumulativeTotal = days.reduce((s, x) => s + x.total, 0);
  const peakDay = days.reduce((m, x) => Math.max(m, x.total), 0);
  const { currentStreak, longestStreak, activeDays } = computeStreaks(days, today);
  const heatmap = buildHeatmap(days, today);

  return {
    stats: { cumulativeTotal, peakDay, activeDays, currentStreak, longestStreak },
    heatmap,
  };
}
```

Note: `effectiveScope`, `MetricsScope`, `PrismaClient`, `User` are already in this file. `profileActivity` deliberately does **not** use `whereClauseFor` (which requires a `DateRange`) — it queries all history, with windowing done in pure code.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/integration/profile-activity.test.ts`
Expected: PASS (3 tests). Requires `docker compose up -d db`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/metrics.ts tests/integration/profile-activity.test.ts
git commit -m "feat(metrics): profileActivity service (all-history stats + heatmap)"
```

---

## Task 6: `ActivityHeatmap` client component

**Files:**
- Create: `src/components/charts/ActivityHeatmap.tsx`

No unit test — there is no React test environment (vitest runs in `node` env). Verified via type-check/build in Task 8 and manual verification.

- [ ] **Step 1: Write the component**

Create `src/components/charts/ActivityHeatmap.tsx`:

```typescript
"use client";

import type { Heatmap } from "@/lib/activity";

const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-slate-100",
  1: "bg-blue-200",
  2: "bg-blue-300",
  3: "bg-blue-500",
  4: "bg-blue-700",
};

export interface ActivityHeatmapProps {
  heatmap: Heatmap;
}

export function ActivityHeatmap({ heatmap }: ActivityHeatmapProps) {
  const { weeks, monthLabels } = heatmap;
  const labelByWeek = new Map(monthLabels.map((m) => [m.weekIndex, m.label]));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-3 text-sm">
        <span className="font-medium text-foreground">每日</span>
        <span className="cursor-not-allowed text-muted-foreground/50">每周</span>
        <span className="cursor-not-allowed text-muted-foreground/50">累计</span>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-[3px]">
          {weeks.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {col.map((cell, ri) =>
                cell === null ? (
                  <div key={ri} className="h-[11px] w-[11px]" />
                ) : (
                  <div
                    key={ri}
                    className={`h-[11px] w-[11px] rounded-[2px] ${LEVEL_CLASS[cell.level]}`}
                    title={`${cell.date} · ${cell.total.toLocaleString("en-US")} tokens`}
                  />
                ),
              )}
            </div>
          ))}
        </div>

        <div className="mt-1 flex gap-[3px]">
          {weeks.map((_, ci) => (
            <div key={ci} className="w-[11px] text-[10px] text-muted-foreground">
              {labelByWeek.has(ci) ? labelByWeek.get(ci) : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/charts/ActivityHeatmap.tsx
git commit -m "feat(ui): ActivityHeatmap CSS-grid heatmap component"
```

---

## Task 7: `ProfileSummary` server component

**Files:**
- Create: `src/components/ProfileSummary.tsx`

No unit test (server/React component); verified via build + manual in Task 8.

- [ ] **Step 1: Write the component**

Create `src/components/ProfileSummary.tsx`:

```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { ActivityHeatmap } from "@/components/charts/ActivityHeatmap";
import { formatCompactCN } from "@/lib/format";
import type { ProfileActivity } from "@/lib/services/metrics";

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-3">
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export interface ProfileSummaryProps {
  name: string;
  avatarUrl: string | null;
  activity: ProfileActivity;
}

export function ProfileSummary({ name, avatarUrl, activity }: ProfileSummaryProps) {
  const { stats, heatmap } = activity;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3">
        <UserAvatar name={name} avatarUrl={avatarUrl} size={80} />
        <h2 className="text-xl font-semibold">{name}</h2>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-center divide-x divide-border py-2">
          <StatCard value={formatCompactCN(stats.cumulativeTotal)} label="累计 Token 数" />
          <StatCard value={formatCompactCN(stats.peakDay)} label="峰值 Token 数" />
          <StatCard value={`${stats.activeDays} 天`} label="活跃天数" />
          <StatCard value={`${stats.currentStreak} 天`} label="当前连续天数" />
          <StatCard value={`${stats.longestStreak} 天`} label="最长连续天数" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Token 活动</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityHeatmap heatmap={heatmap} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ProfileSummary.tsx
git commit -m "feat(ui): ProfileSummary block (avatar, stat cards, heatmap)"
```

---

## Task 8: Wire into the dashboard + verify

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add the import**

In `src/app/(app)/dashboard/page.tsx`, add to the existing imports:

```typescript
import { dailyTotals, toolBreakdown, modelBreakdown, profileActivity } from "@/lib/services/metrics";
import { ProfileSummary } from "@/components/ProfileSummary";
```

(Replace the existing `import { dailyTotals, toolBreakdown, modelBreakdown } from "@/lib/services/metrics";` line with the version above that also imports `profileActivity`.)

- [ ] **Step 2: Fetch profileActivity in the existing Promise.all**

Replace the existing destructuring/`Promise.all` block:

```typescript
  const [trend, tools, models, tokens] = await Promise.all([
    dailyTotals(prisma, user, range, { scope: { type: "self" } }),
    toolBreakdown(prisma, user, range, { scope: { type: "self" } }),
    modelBreakdown(prisma, user, range, { scope: { type: "self" } }),
    listTokensFor(prisma, user, user.id),
  ]);
```

with:

```typescript
  const [trend, tools, models, tokens, activity] = await Promise.all([
    dailyTotals(prisma, user, range, { scope: { type: "self" } }),
    toolBreakdown(prisma, user, range, { scope: { type: "self" } }),
    modelBreakdown(prisma, user, range, { scope: { type: "self" } }),
    listTokensFor(prisma, user, user.id),
    profileActivity(prisma, user, { scope: { type: "self" } }),
  ]);
```

- [ ] **Step 3: Render ProfileSummary at the top of the returned JSX**

Insert `<ProfileSummary>` as the first child inside the outer `<div className="space-y-6">`, immediately before the existing `<div className="flex items-center justify-between">` header:

```typescript
  return (
    <div className="space-y-6">
      <ProfileSummary name={user.name} avatarUrl={user.avatarUrl} activity={activity} />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">个人仪表盘</h1>
        <DateRangePicker />
      </div>
      {/* ...rest unchanged... */}
```

- [ ] **Step 4: Type-check / lint / full test run**

Run: `pnpm lint`
Expected: no errors in the changed files.

Run: `pnpm exec vitest run tests/unit/activity.test.ts tests/unit/format.test.ts tests/integration/profile-activity.test.ts`
Expected: all PASS (DB up).

Run: `pnpm build`
Expected: build succeeds (compiles the new RSC + client component).

- [ ] **Step 5: Manual verification**

Run: `docker compose up -d db && pnpm dev`
Then open `http://localhost:3000/dashboard` (logged in as an approved user with some usage data) and confirm:
- Avatar + name render centered at the top.
- Five stat cards show: 累计 Token 数, 峰值 Token 数, 活跃天数, 当前连续天数, 最长连续天数.
- The heatmap shows a ~53-week grid; active days are blue, empty days light grey; the 每日 label is highlighted and 每周/累计 are greyed; month labels run along the bottom; hovering a cell shows `date · N tokens`.
- A user with no usage shows zeros and an all-empty grid without errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/(app)/dashboard/page.tsx
git commit -m "feat(dashboard): render ProfileSummary activity block"
```

---

## Self-Review Notes

- **Spec coverage:** identity row (avatar+name) → Task 7; five stat cards incl. 活跃天数 replacement → Tasks 5+7; all-history stats vs 12-month grid → Task 5 (no date filter) + Task 3 (windowing); daily total coloring + 5 levels → Tasks 2–3, 6; visual-only 每日/每周/累计 toggle → Task 6; streak "from yesterday" rule → Task 1 tests; empty/edge cases → Tasks 1,3,5 tests + Task 8 manual check; privacy clamp → Task 5 forged-userId test.
- **Type consistency:** `DayTotal`/`HeatmapCell`/`Heatmap` defined in Task 1 and consumed unchanged in Tasks 3, 5, 6; `ProfileActivity` defined in Task 5, consumed in Task 7; `formatCompactCN` defined in Task 4, consumed in Task 7.
- **Threshold count:** the design doc mentioned "4 cut points"; this plan uses **3** quartile cut points (p25/p50/p75) to produce exactly 4 non-zero levels — the correct count. Intentional refinement.
