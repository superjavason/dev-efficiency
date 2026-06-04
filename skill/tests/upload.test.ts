import { describe, it, expect, vi, beforeEach } from "vitest";
import { uploadRecords, validateToken, UploadError } from "@/upload";
import type { UsageRecord } from "@/types";

function makeRec(over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    date: "2026-05-25",
    tool: "claude-code",
    model: "claude-opus-4-7",
    project: "abcdef0123456789",
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    sessionCount: 1,
    messageCount: 1,
    source: "auto",
    ...over,
  };
}

describe("validateToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns user info on 200", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "u1", email: "x@y.com", name: "X", role: "member" }), { status: 200 }) as Response,
    );
    const user = await validateToken("https://x", "tok");
    expect(user.email).toBe("x@y.com");
  });

  it("throws UploadError on 401", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 401 }) as Response);
    await expect(validateToken("https://x", "tok")).rejects.toBeInstanceOf(UploadError);
  });

  it("throws UploadError on network failure", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(validateToken("https://x", "tok")).rejects.toBeInstanceOf(UploadError);
  });
});

describe("uploadRecords", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("posts a single batch when records ≤ batchSize", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ inserted: 2, updated: 0 }), { status: 200 }) as Response,
    );
    const res = await uploadRecords("https://x", "tok", [makeRec(), makeRec({ date: "2026-05-26" })], { batchSize: 500 });
    expect(res.inserted).toBe(2);
    expect(res.updated).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("splits across multiple batches", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ inserted: 1, updated: 0 }), { status: 200 }) as Response,
    );
    const recs = Array.from({ length: 5 }, (_, i) => makeRec({ date: `2026-05-${20 + i}` }));
    const res = await uploadRecords("https://x", "tok", recs, { batchSize: 2 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(res.inserted).toBe(3);
  });

  it("retries on 500 with exponential backoff", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 500 }) as Response)
      .mockResolvedValueOnce(new Response(null, { status: 500 }) as Response)
      .mockResolvedValueOnce(new Response(JSON.stringify({ inserted: 1, updated: 0 }), { status: 200 }) as Response);
    const res = await uploadRecords("https://x", "tok", [makeRec()], { batchSize: 500, sleepMs: () => 0 });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(res.inserted).toBe(1);
  });

  it("fails after 3 retries on persistent 500", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("oops", { status: 500 }) as Response);
    await expect(
      uploadRecords("https://x", "tok", [makeRec()], { batchSize: 500, sleepMs: () => 0 }),
    ).rejects.toBeInstanceOf(UploadError);
  });

  it("does NOT retry on 400", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "bad" }), { status: 400 }) as Response,
    );
    await expect(
      uploadRecords("https://x", "tok", [makeRec()], { batchSize: 500, sleepMs: () => 0 }),
    ).rejects.toBeInstanceOf(UploadError);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 (rate limit)", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 429 }) as Response)
      .mockResolvedValueOnce(new Response(JSON.stringify({ inserted: 1, updated: 0 }), { status: 200 }) as Response);
    const res = await uploadRecords("https://x", "tok", [makeRec()], { batchSize: 500, sleepMs: () => 0 });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.inserted).toBe(1);
  });

  it("sends Authorization Bearer header and JSON body matching usagePayloadSchema", async () => {
    let captured: RequestInit | undefined;
    vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      captured = init;
      return new Response(JSON.stringify({ inserted: 1, updated: 0 }), { status: 200 }) as Response;
    });
    await uploadRecords("https://x", "tok", [makeRec()], { batchSize: 500 });
    const headers = captured?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(captured!.body as string);
    expect(Array.isArray(body.records)).toBe(true);
    expect(body.records[0].source).toBe("auto");
  });
});
