import type { PrismaClient, Tool, User } from "@prisma/client";
import { toolToApi, type ApiTool } from "@/lib/tool";
import type { DateRange } from "@/lib/range";
import {
  computeStreaks,
  buildHeatmap,
  type DayTotal,
  type Heatmap,
} from "@/lib/activity";

export class MetricsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetricsAuthError";
  }
}

/**
 * Query scope for metrics calls.
 * - `self`: existing behavior — member clamped to viewer.id; admin honors opts.userId or returns all users.
 * - `team`: aggregates across all current members of the team. Viewer must be a team member or platform admin.
 *   `opts.userId` is intentionally ignored for team scope (no per-user drill-down within team in v1).
 */
export type MetricsScope =
  | { type: "self" }
  | { type: "team"; teamId: string };

/**
 * Resolve the userId filter for a query. Returns null = "no filter" (admin self-scope, all users).
 * Throws MetricsAuthError if the viewer isn't allowed the requested scope.
 *
 * Privacy invariant — never change to throw on forged self userId without re-reading every caller:
 * silent clamp is intentional. Team scope DOES validate membership and DOES override opts.userId.
 */
async function effectiveScope(
  prisma: PrismaClient,
  viewer: User,
  scope: MetricsScope,
  requestedUserId?: string | null,
): Promise<string[] | null> {
  if (scope.type === "team") {
    const isAdmin = viewer.role === "admin";
    if (!isAdmin) {
      const m = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: scope.teamId, userId: viewer.id } },
      });
      if (!m) throw new MetricsAuthError("forbidden: not a team member");
    }
    const members = await prisma.teamMember.findMany({
      where: { teamId: scope.teamId },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  }
  if (viewer.role === "admin") {
    return requestedUserId ? [requestedUserId] : null;
  }
  return [viewer.id];
}

function whereClauseFor(range: DateRange, userIds: string[] | null) {
  const base: { date: { gte: Date; lte: Date }; userId?: { in: string[] } } = {
    date: { gte: range.from, lte: range.to },
  };
  if (userIds) {
    if (userIds.length === 0) {
      base.userId = { in: ["__no_match__"] };
    } else {
      base.userId = { in: userIds };
    }
  }
  return base;
}

/**
 * Token-category breakdown returned alongside `total` so charts can stack
 * the three components (input / output / cache).
 * `cacheTokens` = cacheCreationTokens + cacheReadTokens (these are bucketed
 * together because cache_creation is the small first-write cost paired
 * with the recurring cache_read savings).
 */
export interface TokenBreakdown {
  inputTokens: bigint;
  outputTokens: bigint;
  cacheTokens: bigint;
  total: bigint;
}

const TOKEN_SUM_SELECT = {
  inputTokens: true,
  outputTokens: true,
  cacheCreationTokens: true,
  cacheReadTokens: true,
  totalTokens: true,
} as const;

function projectSum(s: {
  inputTokens: bigint | null;
  outputTokens: bigint | null;
  cacheCreationTokens: bigint | null;
  cacheReadTokens: bigint | null;
  totalTokens: bigint | null;
}): TokenBreakdown {
  const input = s.inputTokens ?? 0n;
  const output = s.outputTokens ?? 0n;
  const cache = (s.cacheCreationTokens ?? 0n) + (s.cacheReadTokens ?? 0n);
  const total = s.totalTokens ?? 0n;
  return { inputTokens: input, outputTokens: output, cacheTokens: cache, total };
}

export interface DailyPoint extends TokenBreakdown {
  date: string;
}

export async function dailyTotals(
  prisma: PrismaClient,
  viewer: User,
  range: DateRange,
  opts: { scope: MetricsScope; userId?: string | null },
): Promise<DailyPoint[]> {
  const userIds = await effectiveScope(prisma, viewer, opts.scope, opts.userId);
  const rows = await prisma.usageRecord.groupBy({
    by: ["date"],
    where: whereClauseFor(range, userIds),
    _sum: TOKEN_SUM_SELECT,
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    ...projectSum(r._sum),
  }));
}

export interface UserRankingRow extends TokenBreakdown {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export async function userRanking(
  prisma: PrismaClient,
  viewer: User,
  range: DateRange,
  opts: { scope: MetricsScope },
): Promise<UserRankingRow[]> {
  if (opts.scope.type === "self" && viewer.role !== "admin") {
    throw new MetricsAuthError("forbidden");
  }
  const userIds = await effectiveScope(prisma, viewer, opts.scope, null);

  const grouped = await prisma.usageRecord.groupBy({
    by: ["userId"],
    where: whereClauseFor(range, userIds),
    _sum: TOKEN_SUM_SELECT,
  });
  if (grouped.length === 0) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.userId) } },
    select: { id: true, name: true, email: true, avatarUrl: true },
  });
  const byId = new Map(users.map((u) => [u.id, u] as const));

  return grouped
    .map((g) => ({
      userId: g.userId,
      name: byId.get(g.userId)?.name ?? "(unknown)",
      email: byId.get(g.userId)?.email ?? "",
      avatarUrl: byId.get(g.userId)?.avatarUrl ?? null,
      ...projectSum(g._sum),
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}

export interface ToolPoint extends TokenBreakdown {
  tool: ApiTool;
}

export async function toolBreakdown(
  prisma: PrismaClient,
  viewer: User,
  range: DateRange,
  opts: { scope: MetricsScope; userId?: string | null },
): Promise<ToolPoint[]> {
  const userIds = await effectiveScope(prisma, viewer, opts.scope, opts.userId);
  const rows = await prisma.usageRecord.groupBy({
    by: ["tool"],
    where: whereClauseFor(range, userIds),
    _sum: TOKEN_SUM_SELECT,
  });
  return rows.map((r) => ({
    tool: toolToApi(r.tool),
    ...projectSum(r._sum),
  }));
}

export interface ModelPoint extends TokenBreakdown {
  model: string;
}

export async function modelBreakdown(
  prisma: PrismaClient,
  viewer: User,
  range: DateRange,
  opts: { scope: MetricsScope; userId?: string | null },
): Promise<ModelPoint[]> {
  const userIds = await effectiveScope(prisma, viewer, opts.scope, opts.userId);
  const rows = await prisma.usageRecord.groupBy({
    by: ["model"],
    where: whereClauseFor(range, userIds),
    _sum: TOKEN_SUM_SELECT,
    orderBy: { _sum: { totalTokens: "desc" } },
  });
  return rows.map((r) => ({
    model: r.model,
    ...projectSum(r._sum),
  }));
}

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

// Personal activity summary (lifetime stats + a 12-month heatmap) for the dashboard
// profile block. Scope handling mirrors the other metrics functions via effectiveScope:
// a member is silently clamped to their own data, a team scope spans members, and an
// admin with self-scope and no `userId` resolves to *all users* (null filter). For an
// admin's own profile, pass `userId: viewer.id` explicitly.
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
