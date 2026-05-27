import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { ingestUsage } from "@/lib/services/usage";
import type { UsageRecordInput } from "@/lib/validation/usage";
import { POST as usagePost } from "@/app/api/v1/usage/route";
import { GET as mePost } from "@/app/api/v1/me/route";
import { generateToken, hashToken } from "@/lib/auth/token";

async function makeUser() {
  return prisma.user.create({
    data: { email: "u@x.com", name: "U", passwordHash: "x", status: "approved" },
  });
}

const rec = (over: Partial<UsageRecordInput> = {}): UsageRecordInput => ({
  date: "2026-05-25",
  tool: "claude-code",
  model: "claude-opus-4-7",
  project: "proj-hash",
  inputTokens: 10,
  outputTokens: 20,
  cacheCreationTokens: 5,
  cacheReadTokens: 7,
  sessionCount: 1,
  messageCount: 3,
  source: "auto",
  ...over,
});

describe("ingestUsage", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("inserts new records and computes totalTokens", async () => {
    const u = await makeUser();
    const res = await ingestUsage(prisma, u.id, [rec()]);
    expect(res).toEqual({ inserted: 1, updated: 0 });

    const stored = await prisma.usageRecord.findFirst();
    expect(stored?.totalTokens).toBe(42n);
    expect(stored?.tool).toBe("claude_code");
  });

  it("is idempotent: re-uploading same key updates, not duplicates", async () => {
    const u = await makeUser();
    await ingestUsage(prisma, u.id, [rec()]);
    const res = await ingestUsage(prisma, u.id, [rec({ inputTokens: 99 })]);
    expect(res).toEqual({ inserted: 0, updated: 1 });

    const all = await prisma.usageRecord.findMany();
    expect(all).toHaveLength(1);
    expect(all[0].inputTokens).toBe(99n);
    expect(all[0].totalTokens).toBe(131n);
  });

  it("treats different source as a separate row", async () => {
    const u = await makeUser();
    await ingestUsage(prisma, u.id, [rec({ source: "auto" })]);
    await ingestUsage(prisma, u.id, [rec({ source: "manual" })]);
    expect(await prisma.usageRecord.count()).toBe(2);
  });

  it("treats missing project ('') as its own key", async () => {
    const u = await makeUser();
    await ingestUsage(prisma, u.id, [rec({ project: "" })]);
    await ingestUsage(prisma, u.id, [rec({ project: "" })]);
    expect(await prisma.usageRecord.count()).toBe(1);
  });
});

describe("usage route handler", () => {
  beforeEach(resetDb);

  async function approvedUserWithToken() {
    const u = await prisma.user.create({
      data: { email: "r@x.com", name: "R", passwordHash: "x", status: "approved" },
    });
    const raw = generateToken();
    await prisma.authToken.create({
      data: { userId: u.id, tokenHash: hashToken(raw), name: "m" },
    });
    return raw;
  }

  it("401 without token", async () => {
    const res = await usagePost(new Request("http://t/api/v1/usage", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("ingests with a valid token", async () => {
    const raw = await approvedUserWithToken();
    const res = await usagePost(
      new Request("http://t/api/v1/usage", {
        method: "POST",
        headers: { authorization: `Bearer ${raw}`, "content-type": "application/json" },
        body: JSON.stringify({ records: [rec()] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 1, updated: 0 });
  });

  it("GET /me returns the user", async () => {
    const raw = await approvedUserWithToken();
    const res = await mePost(
      new Request("http://t/api/v1/me", { headers: { authorization: `Bearer ${raw}` } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe("r@x.com");
  });
});
