import type { PrismaClient, Tool, User } from "@prisma/client";
import { toolToApi, type ApiTool } from "@/lib/tool";
import type { DateRange } from "@/lib/range";

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

export interface DailyPoint {
  date: string;
  total: bigint;
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
    _sum: { totalTokens: true },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    total: r._sum.totalTokens ?? 0n,
  }));
}

export interface UserRankingRow {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  total: bigint;
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
    _sum: { totalTokens: true },
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
      total: g._sum.totalTokens ?? 0n,
    }))
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
}

export interface ToolPoint {
  tool: ApiTool;
  total: bigint;
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
    _sum: { totalTokens: true },
  });
  return rows.map((r) => ({
    tool: toolToApi(r.tool),
    total: r._sum.totalTokens ?? 0n,
  }));
}

export interface ModelPoint {
  model: string;
  total: bigint;
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
    _sum: { totalTokens: true },
    orderBy: { _sum: { totalTokens: "desc" } },
  });
  return rows.map((r) => ({
    model: r.model,
    total: r._sum.totalTokens ?? 0n,
  }));
}
