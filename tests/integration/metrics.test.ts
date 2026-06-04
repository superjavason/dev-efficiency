import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  dailyTotals,
  userRanking,
  toolBreakdown,
  modelBreakdown,
  MetricsAuthError,
} from "@/lib/services/metrics";

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

async function record(
  userId: string,
  over: { date?: string; tool?: "claude_code" | "codex" | "cursor"; model?: string; total?: bigint } = {},
) {
  return prisma.usageRecord.create({
    data: {
      userId,
      date: new Date(`${over.date ?? "2026-05-25"}T00:00:00.000Z`),
      tool: over.tool ?? "claude_code",
      model: over.model ?? "claude-opus-4-7",
      project: "",
      inputTokens: 0n,
      outputTokens: 0n,
      cacheCreationTokens: 0n,
      cacheReadTokens: 0n,
      totalTokens: over.total ?? 100n,
      sessionCount: 1,
      messageCount: 1,
      source: "auto",
    },
  });
}

const range = { from: new Date("2026-05-20T00:00:00.000Z"), to: new Date("2026-05-31T00:00:00.000Z") };

describe("metrics service viewer scoping", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("dailyTotals for member returns only their own data even if userId is forged", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await record(me.id, { date: "2026-05-25", total: 10n });
    await record(other.id, { date: "2026-05-25", total: 99n });

    const own = await dailyTotals(prisma, me, range, {});
    expect(own.reduce((s, p) => s + Number(p.total), 0)).toBe(10);

    const forged = await dailyTotals(prisma, me, range, { userId: other.id });
    expect(forged.reduce((s, p) => s + Number(p.total), 0)).toBe(10);
  });

  it("dailyTotals for admin can target a specific userId", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser();
    await record(target.id, { date: "2026-05-25", total: 77n });
    const r = await dailyTotals(prisma, admin, range, { userId: target.id });
    expect(r.reduce((s, p) => s + Number(p.total), 0)).toBe(77);
  });

  it("dailyTotals admin without userId returns ALL users", async () => {
    const admin = await makeUser({ role: "admin" });
    const a = await makeUser();
    const b = await makeUser();
    await record(a.id, { date: "2026-05-25", total: 10n });
    await record(b.id, { date: "2026-05-25", total: 30n });
    const r = await dailyTotals(prisma, admin, range, {});
    expect(r.reduce((s, p) => s + Number(p.total), 0)).toBe(40);
  });

  it("userRanking forbidden for member", async () => {
    const me = await makeUser();
    await expect(userRanking(prisma, me, range)).rejects.toBeInstanceOf(MetricsAuthError);
  });

  it("userRanking returns sorted aggregate for admin", async () => {
    const admin = await makeUser({ role: "admin" });
    const big = await makeUser();
    const small = await makeUser();
    await record(big.id, { total: 500n });
    await record(small.id, { total: 100n });
    const r = await userRanking(prisma, admin, range);
    expect(r[0].userId).toBe(big.id);
    expect(Number(r[0].total)).toBe(500);
    expect(r[1].userId).toBe(small.id);
  });

  it("toolBreakdown/modelBreakdown collapse correctly and respect viewer scoping", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await record(me.id, { tool: "claude_code", model: "claude-opus-4-7", total: 10n });
    await record(me.id, { tool: "codex", model: "gpt-5.4", total: 30n });
    await record(other.id, { tool: "claude_code", model: "claude-opus-4-7", total: 999n });

    const tools = await toolBreakdown(prisma, me, range, {});
    expect(tools.find((t) => t.tool === "claude-code")?.total).toBe(10n);
    expect(tools.find((t) => t.tool === "codex")?.total).toBe(30n);

    const models = await modelBreakdown(prisma, me, range, {});
    expect(models.find((m) => m.model === "claude-opus-4-7")?.total).toBe(10n);
  });
});
