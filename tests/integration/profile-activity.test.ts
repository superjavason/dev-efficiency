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
    await record(me.id, "2026-06-01", 100n);
    await record(me.id, "2026-06-02", 300n);
    await record(me.id, "2026-06-10", 50n);
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
    expect(r.stats.cumulativeTotal).toBe(650);
    expect(r.stats.peakDay).toBe(500);
    expect(r.stats.activeDays).toBe(3);
    expect(r.stats.longestStreak).toBe(2);
    expect(r.stats.currentStreak).toBe(1);
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
