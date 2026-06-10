# Profile Activity Block — Design

**Date:** 2026-06-10
**Status:** Approved
**Scope:** Add a personal "profile activity" block to the top of the user dashboard:
avatar + name, five summary stat cards, and a GitHub-style daily-activity heatmap
(fixed last 12 months).

## Goal

Reproduce the layout in the reference screenshot on `/dashboard`:

```
            (avatar)
            Jason.Xu

[累计Token] [峰值Token] [活跃天数] [当前连续天数] [最长连续天数]

Token 活动                                   每日  每周  累计
[ ░░▓░░░▓░░ ... 53-week dotted heatmap ... ░▓░ ]
7月  8月  9月 ...                                       6月
```

The block sits **above** the existing charts (DailyTrendChart, ToolBreakdownChart,
ModelBreakdownChart, TokenList) and does not change them.

## Decisions (from brainstorming)

- **Identity row:** avatar + display name only. No `@handle`, no "Plus" badge —
  the `User` model has no username/tier field and we are not adding one.
- **Stat cards:** five cards, all derived from existing daily token aggregates.
  The screenshot's "最长任务时长" is **replaced by 活跃天数** because the collector
  captures no timing/duration data (only daily token aggregates + session/message
  counts).
- **Stats window = all history**; **heatmap window = last 12 months**. This split is
  intentional: cumulative/peak/streaks describe the whole account, the grid shows the
  recent year.
- **Coloring:** daily **total tokens** (`input+output+cacheCreation+cacheRead`),
  bucketed into 5 intensity levels (0 = empty, 1–4 = ascending blue).
- **每日 / 每周 / 累计 toggle:** rendered for visual fidelity, but only **每日** is
  active. 每周 / 累计 are greyed-out and non-functional in this iteration.

## Stat card definitions

| Card (label)    | Meaning                                   | Computation (over all history)          |
|-----------------|-------------------------------------------|-----------------------------------------|
| 累计 Token 数   | Lifetime total tokens                     | `sum(dailyTotal)`                       |
| 峰值 Token 数   | Highest single-day total                  | `max(dailyTotal)`                       |
| 活跃天数        | Number of days with any token activity    | `count(day where dailyTotal > 0)`       |
| 当前连续天数    | Current consecutive active-day streak     | see streak rules                        |
| 最长连续天数    | Longest consecutive active-day streak ever| see streak rules                        |

### Streak rules

- A day is "active" if its `dailyTotal > 0`.
- **Longest streak:** the longest run of consecutive calendar days that are all active.
- **Current streak:** the run of consecutive active days ending at **today**. If today
  has no activity, the streak is counted ending at **yesterday** (GitHub behavior), so a
  user mid-streak who hasn't worked yet today still sees their streak. If neither today
  nor yesterday is active, current streak = 0.
- Empty history → all streaks/stats = 0.

## Architecture

Follows the project's three-layer separation (`services/` business logic, thin
page/RSC consumer) and isolates pure date/grid math so it is unit-testable without a DB.

### 1. `src/lib/activity.ts` — pure functions, no DB

The testable core. Operates on a list of `{ date: string (YYYY-MM-DD), total: number }`
already sorted ascending.

```ts
export interface DayTotal { date: string; total: number; }

export interface HeatmapCell {
  date: string;       // YYYY-MM-DD
  total: number;      // 0 if no activity
  level: 0 | 1 | 2 | 3 | 4;
}

export interface Heatmap {
  weeks: (HeatmapCell | null)[][];   // column-major: weeks[col] = one week of 7 cells; see layout note
  monthLabels: { label: string; weekIndex: number }[];
}

export function computeStreaks(
  days: DayTotal[],
  today: string,                     // injected for determinism/testing
): { currentStreak: number; longestStreak: number; activeDays: number };

export function bucketLevel(total: number, thresholds: number[]): 0|1|2|3|4;

export function computeThresholds(days: DayTotal[]): number[];
// quantiles (e.g. 25/50/75/90th percentile) of the *active* days' totals,
// so coloring adapts per user. Returns 4 ascending cut points.

export function buildHeatmap(
  days: DayTotal[],
  today: string,
): Heatmap;
```

**Heatmap layout:** the grid is column-major like GitHub — each **column is one week**
(Sunday→Saturday), columns run left→right oldest→newest. The window starts at the
Sunday on/before `today − 364 days` and ends at `today`, so the grid is 53 columns × 7
rows. `weeks` is an array of columns; each column is a length-7 array of cells (a cell
may be `null` for days past `today` in the final partial week or before the window
start). `monthLabels` maps a month name to the column index where that month first
appears, for the bottom axis (`7月 8月 …`).

`today` is passed in (not read from `Date.now()` inside the pure module) so tests are
deterministic and the module stays side-effect free.

### 2. `src/lib/services/metrics.ts` — new `profileActivity()`

```ts
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
): Promise<ProfileActivity>;
```

- Resolves user scope with the existing `effectiveScope` (self scope clamps to the
  viewer; same privacy semantics as `dailyTotals`).
- Queries **all-history** daily totals: `prisma.usageRecord.groupBy({ by: ["date"],
  _sum: { totalTokens: true }, where: { userId in scope }, orderBy: { date: "asc" } })`.
  No date-range filter (the heatmap windowing happens in pure code).
- Converts `BigInt` `_sum.totalTokens` to `number` at this boundary (max realistic
  lifetime ~1e8–1e9, well within `Number.MAX_SAFE_INTEGER` ≈ 9e15).
- Computes `cumulativeTotal`/`peakDay` inline, delegates streaks to `computeStreaks`,
  builds the grid with `buildHeatmap`. `today` defaults to the current date (computed in
  the service, not the pure module) and is overridable for tests.
- Returns plain `number`s (not `BigInt`) — this is a view-summary function, and the
  client component needs numbers anyway.

### 3. `src/components/ActivityHeatmap.tsx` — client component

```ts
"use client";
export interface ActivityHeatmapProps { heatmap: Heatmap; }
```

- Renders a CSS-grid / flex matrix of small rounded squares (not Recharts — a calendar
  heatmap is a fixed grid, simpler and closer to the screenshot as plain DOM).
- 5-step blue scale: level 0 = faint grey-blue empty cell; levels 1–4 ascend to
  `#2563eb` (reuse the `input` blue from `categories.ts` as the darkest step).
- Hover tooltip per cell: `YYYY-MM-DD · {total.toLocaleString()} tokens`.
- Bottom month axis from `heatmap.monthLabels`.
- Top-right toggle: 每日 (active) / 每周 / 累计 (greyed, `disabled`, no handler).

### 4. `src/components/ProfileSummary.tsx`

- Server component. Props: `{ name: string; avatarUrl: string | null; activity:
  ProfileActivity }`.
- Renders centered `UserAvatar` (existing component) + name, a responsive row of five
  `StatCard`s (big number + label, numbers via `toLocaleString` with 万/亿 not required —
  plain grouped number is acceptable for v1), then `<ActivityHeatmap heatmap=... />`
  inside a card titled "Token 活动".

### 5. `src/app/(app)/dashboard/page.tsx`

- Add `profileActivity(prisma, user, { scope: { type: "self" } })` to the existing
  `Promise.all([...])`.
- Render `<ProfileSummary name={user.name} avatarUrl={user.avatarUrl} activity={...} />`
  above the current charts grid. No change to existing charts or the date-range selector
  (the heatmap is independent of the URL range).

## Data flow

```
dashboard/page.tsx (RSC)
  └─ profileActivity(prisma, user, {scope:self})         [services/metrics.ts]
       ├─ effectiveScope → userIds                       [existing]
       ├─ groupBy date, sum totalTokens (all history)    [Prisma]
       ├─ BigInt → number
       ├─ computeStreaks(days, today)                    [activity.ts, pure]
       └─ buildHeatmap(days, today)                      [activity.ts, pure]
  └─ <ProfileSummary>                                    [server component]
       ├─ UserAvatar + name
       ├─ StatCard ×5
       └─ <ActivityHeatmap>                              [client component]
```

## Testing

### Unit — `tests/unit/activity.test.ts` (no DB; or skill-style vitest under root unit dir)

- `computeStreaks`: empty; single active day; broken streak; current streak counting
  from today vs. yesterday vs. zero; longest > current.
- `computeThresholds` / `bucketLevel`: all-zero data → everything level 0; ascending
  totals map to ascending levels; single active day.
- `buildHeatmap`: correct column count (53) and 7 rows; window start aligns to Sunday;
  cells after `today` are `null`; `monthLabels` indices; a known date maps to the right
  cell.

### Integration — `tests/integration/profile-activity.test.ts` (real Postgres)

- Seed `UsageRecord`s across several days (including a gap and a multi-day run) for a
  user; assert `cumulativeTotal`, `peakDay`, `activeDays`, `currentStreak`,
  `longestStreak`, and heatmap cell levels with a fixed injected `today`.
- Privacy: a member viewer only sees their own data (self-scope clamp), mirroring the
  existing `dailyTotals` scope test.

## Edge cases

- **No data at all:** all five stats = 0; heatmap renders a full grid of empty cells;
  no errors.
- **Activity only today:** currentStreak = 1, longestStreak = 1, activeDays = 1.
- **Today inactive, yesterday active:** currentStreak counts the run ending yesterday.
- **Future-dated cells** in the trailing partial week render as `null` (blank), not
  level-0 squares, so the grid doesn't imply "inactive" for days that haven't happened.
- **Single active day / all-equal totals:** thresholds degrade gracefully — all active
  cells land on the same (non-zero) level rather than throwing.

## Out of scope (this iteration)

- 每周 / 累计 heatmap modes (toggle is visual-only).
- Username/handle and plan/tier ("Plus") — no schema change.
- Task/session duration metrics — not collected.
- Team-scope profile block (self only for now).
