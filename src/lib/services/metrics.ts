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
 * Resolve which userId scope a query should run against.
 * Admin: honors `requested` (or null = all users).
 * Member: ALWAYS clamped to their own id — `requested` is silently ignored.
 * The silent override is intentional: it prevents forged URL params from
 * leaking other users' data and makes the service the single privacy
 * enforcement point. Do not change to throw without re-reviewing every caller.
 */
function effectiveUserId(viewer: User, requested?: string | null): string | null {
  if (viewer.role === "admin") return requested ?? null;
  return viewer.id;
}

export interface DailyPoint {
  date: string;
  total: bigint;
}

export async function dailyTotals(
  prisma: PrismaClient,
  viewer: User,
  range: DateRange,
  opts: { userId?: string | null },
): Promise<DailyPoint[]> {
  const userId = effectiveUserId(viewer, opts.userId);
  const rows = await prisma.usageRecord.groupBy({
    by: ["date"],
    where: {
      date: { gte: range.from, lte: range.to },
      ...(userId ? { userId } : {}),
    },
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
): Promise<UserRankingRow[]> {
  if (viewer.role !== "admin") throw new MetricsAuthError("forbidden");

  const grouped = await prisma.usageRecord.groupBy({
    by: ["userId"],
    where: { date: { gte: range.from, lte: range.to } },
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
  opts: { userId?: string | null },
): Promise<ToolPoint[]> {
  const userId = effectiveUserId(viewer, opts.userId);
  const rows = await prisma.usageRecord.groupBy({
    by: ["tool"],
    where: {
      date: { gte: range.from, lte: range.to },
      ...(userId ? { userId } : {}),
    },
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
  opts: { userId?: string | null },
): Promise<ModelPoint[]> {
  const userId = effectiveUserId(viewer, opts.userId);
  const rows = await prisma.usageRecord.groupBy({
    by: ["model"],
    where: {
      date: { gte: range.from, lte: range.to },
      ...(userId ? { userId } : {}),
    },
    _sum: { totalTokens: true },
    orderBy: { _sum: { totalTokens: "desc" } },
  });
  return rows.map((r) => ({
    model: r.model,
    total: r._sum.totalTokens ?? 0n,
  }));
}
