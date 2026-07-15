import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  dailyTotals,
  userRanking,
  toolBreakdown,
  modelBreakdown,
  profileActivity,
  MetricsAuthError,
} from "@/lib/services/metrics";
import type { MetricsScope } from "@/lib/services/metrics";

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

    const own = await dailyTotals(prisma, me, range, { scope: { type: "self" } });
    expect(own.reduce((s, p) => s + Number(p.total), 0)).toBe(10);

    const forged = await dailyTotals(prisma, me, range, { scope: { type: "self" }, userId: other.id });
    expect(forged.reduce((s, p) => s + Number(p.total), 0)).toBe(10);
  });

  it("dailyTotals for admin can target a specific userId", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser();
    await record(target.id, { date: "2026-05-25", total: 77n });
    const r = await dailyTotals(prisma, admin, range, { scope: { type: "self" }, userId: target.id });
    expect(r.reduce((s, p) => s + Number(p.total), 0)).toBe(77);
  });

  it("dailyTotals admin without userId returns ALL users", async () => {
    const admin = await makeUser({ role: "admin" });
    const a = await makeUser();
    const b = await makeUser();
    await record(a.id, { date: "2026-05-25", total: 10n });
    await record(b.id, { date: "2026-05-25", total: 30n });
    const r = await dailyTotals(prisma, admin, range, { scope: { type: "self" } });
    expect(r.reduce((s, p) => s + Number(p.total), 0)).toBe(40);
  });

  it("userRanking forbidden for member", async () => {
    const me = await makeUser();
    await expect(userRanking(prisma, me, range, { scope: { type: "self" } })).rejects.toBeInstanceOf(MetricsAuthError);
  });

  it("userRanking returns sorted aggregate for admin", async () => {
    const admin = await makeUser({ role: "admin" });
    const big = await makeUser();
    const small = await makeUser();
    await record(big.id, { total: 500n });
    await record(small.id, { total: 100n });
    const r = await userRanking(prisma, admin, range, { scope: { type: "self" } });
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

    const tools = await toolBreakdown(prisma, me, range, { scope: { type: "self" } });
    expect(tools.find((t) => t.tool === "claude-code")?.total).toBe(10n);
    expect(tools.find((t) => t.tool === "codex")?.total).toBe(30n);

    const models = await modelBreakdown(prisma, me, range, { scope: { type: "self" } });
    expect(models.find((m) => m.model === "claude-opus-4-7")?.total).toBe(10n);
  });
});

describe("metrics service team scope", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  async function makeTeamWith(members: { user: { id: string }; role?: "owner" | "member" }[]) {
    const team = await prisma.team.create({
      data: {
        name: "T",
        slug: `t-${Math.random().toString(36).slice(2, 8)}`,
        createdById: members[0].user.id,
      },
    });
    for (let i = 0; i < members.length; i++) {
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: members[i].user.id,
          role: members[i].role ?? (i === 0 ? "owner" : "member"),
        },
      });
    }
    return team;
  }

  it("team-scope dailyTotals aggregates across team members", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const team = await makeTeamWith([{ user: a }, { user: b }]);
    await record(a.id, { date: "2026-05-25", total: 100n });
    await record(b.id, { date: "2026-05-25", total: 200n });
    const scope: MetricsScope = { type: "team", teamId: team.id };
    const out = await dailyTotals(prisma, a, range, { scope });
    expect(out.reduce((s, p) => s + Number(p.total), 0)).toBe(300);
  });

  it("team-scope userRanking visible to any team member", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const team = await makeTeamWith([{ user: a }, { user: b }]);
    await record(a.id, { total: 50n });
    await record(b.id, { total: 150n });
    const scope: MetricsScope = { type: "team", teamId: team.id };
    const out = await userRanking(prisma, b, range, { scope });
    expect(out[0].userId).toBe(b.id);
    expect(out[1].userId).toBe(a.id);
  });

  it("team-scope rejected for non-member non-admin", async () => {
    const a = await makeUser();
    const team = await makeTeamWith([{ user: a }]);
    const outsider = await makeUser();
    const scope: MetricsScope = { type: "team", teamId: team.id };
    await expect(dailyTotals(prisma, outsider, range, { scope })).rejects.toBeInstanceOf(MetricsAuthError);
    await expect(userRanking(prisma, outsider, range, { scope })).rejects.toBeInstanceOf(MetricsAuthError);
  });

  it("team-scope allowed for global admin even if not a member", async () => {
    const a = await makeUser();
    const team = await makeTeamWith([{ user: a }]);
    await record(a.id, { total: 42n });
    const admin = await makeUser({ role: "admin" });
    const scope: MetricsScope = { type: "team", teamId: team.id };
    const out = await dailyTotals(prisma, admin, range, { scope });
    expect(out.reduce((s, p) => s + Number(p.total), 0)).toBe(42);
  });

  it("team-scope toolBreakdown + modelBreakdown scope correctly", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const outsider = await makeUser();
    const team = await makeTeamWith([{ user: a }, { user: b }]);
    await record(a.id, { tool: "claude_code", model: "claude-opus-4-7", total: 10n });
    await record(b.id, { tool: "codex", model: "gpt-5.4", total: 30n });
    await record(outsider.id, { tool: "claude_code", model: "claude-opus-4-7", total: 999n });
    const scope: MetricsScope = { type: "team", teamId: team.id };
    const tools = await toolBreakdown(prisma, a, range, { scope });
    const tsum = tools.reduce((s, t) => s + Number(t.total), 0);
    expect(tsum).toBe(40);
    const models = await modelBreakdown(prisma, a, range, { scope });
    expect(models.find((m) => m.model === "claude-opus-4-7")?.total).toBe(10n);
  });

  it("team-scope ignores opts.userId override (security)", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const team = await makeTeamWith([{ user: a }, { user: b }]);
    await record(a.id, { total: 10n });
    await record(b.id, { total: 20n });
    const scope: MetricsScope = { type: "team", teamId: team.id };
    const out = await dailyTotals(prisma, a, range, { scope, userId: "nonexistent-id" });
    expect(out.reduce((s, p) => s + Number(p.total), 0)).toBe(30);
  });
});

describe("metrics token breakdown (input / output / cache)", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  async function recordWithBreakdown(userId: string, parts: { input: bigint; output: bigint; cacheCreation: bigint; cacheRead: bigint; date?: string; tool?: "claude_code" | "codex"; model?: string }) {
    const total = parts.input + parts.output + parts.cacheCreation + parts.cacheRead;
    return prisma.usageRecord.create({
      data: {
        userId,
        date: new Date(`${parts.date ?? "2026-05-25"}T00:00:00.000Z`),
        tool: parts.tool ?? "claude_code",
        model: parts.model ?? "claude-opus-4-7",
        project: "",
        inputTokens: parts.input,
        outputTokens: parts.output,
        cacheCreationTokens: parts.cacheCreation,
        cacheReadTokens: parts.cacheRead,
        totalTokens: total,
        sessionCount: 1,
        messageCount: 1,
        source: "auto",
      },
    });
  }

  it("dailyTotals returns inputTokens/outputTokens/cacheTokens summed per day", async () => {
    const u = await makeUser();
    await recordWithBreakdown(u.id, { input: 100n, output: 50n, cacheCreation: 10n, cacheRead: 90n });
    const out = await dailyTotals(prisma, u, range, { scope: { type: "self" } });
    expect(out).toHaveLength(1);
    expect(out[0].inputTokens).toBe(100n);
    expect(out[0].outputTokens).toBe(50n);
    expect(out[0].cacheTokens).toBe(100n); // 10 + 90
    expect(out[0].total).toBe(250n);
  });

  it("toolBreakdown returns breakdown per tool", async () => {
    const u = await makeUser();
    await recordWithBreakdown(u.id, { input: 10n, output: 5n, cacheCreation: 1n, cacheRead: 4n, tool: "claude_code" });
    await recordWithBreakdown(u.id, { input: 20n, output: 10n, cacheCreation: 0n, cacheRead: 0n, tool: "codex" });
    const out = await toolBreakdown(prisma, u, range, { scope: { type: "self" } });
    const claude = out.find((t) => t.tool === "claude-code");
    expect(claude?.inputTokens).toBe(10n);
    expect(claude?.cacheTokens).toBe(5n);
    const codex = out.find((t) => t.tool === "codex");
    expect(codex?.cacheTokens).toBe(0n);
  });

  it("userRanking carries breakdown per user", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser();
    await recordWithBreakdown(target.id, { input: 7n, output: 8n, cacheCreation: 2n, cacheRead: 3n });
    const out = await userRanking(prisma, admin, range, { scope: { type: "self" } });
    const row = out.find((r) => r.userId === target.id);
    expect(row?.inputTokens).toBe(7n);
    expect(row?.outputTokens).toBe(8n);
    expect(row?.cacheTokens).toBe(5n);
    expect(row?.total).toBe(20n);
  });

  it("modelBreakdown sums cacheCreation + cacheRead into cacheTokens", async () => {
    const u = await makeUser();
    await recordWithBreakdown(u.id, { input: 0n, output: 0n, cacheCreation: 100n, cacheRead: 0n, model: "m-a" });
    await recordWithBreakdown(u.id, { input: 0n, output: 0n, cacheCreation: 0n, cacheRead: 200n, model: "m-b" });
    const out = await modelBreakdown(prisma, u, range, { scope: { type: "self" } });
    expect(out.find((m) => m.model === "m-a")?.cacheTokens).toBe(100n);
    expect(out.find((m) => m.model === "m-b")?.cacheTokens).toBe(200n);
  });
});

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
