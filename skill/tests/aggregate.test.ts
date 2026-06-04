import { describe, it, expect } from "vitest";
import { aggregate } from "@/aggregate";
import type { RawEvent } from "@/types";

function ev(over: Partial<RawEvent> = {}): RawEvent {
  return {
    date: "2026-05-25",
    tool: "claude-code",
    model: "claude-opus-4-7",
    projectPath: "/repo",
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 5,
    cacheReadTokens: 7,
    sessionId: "s1",
    source: "auto",
    ...over,
  };
}

describe("aggregate", () => {
  it("sums tokens within a single composite key", () => {
    const out = aggregate([ev(), ev({ inputTokens: 100, outputTokens: 200 })]);
    expect(out).toHaveLength(1);
    expect(out[0].inputTokens).toBe(110);
    expect(out[0].outputTokens).toBe(220);
    expect(out[0].cacheCreationTokens).toBe(10);
    expect(out[0].cacheReadTokens).toBe(14);
    expect(out[0].messageCount).toBe(2);
    expect(out[0].sessionCount).toBe(1);
  });

  it("dedupes sessionIds for sessionCount", () => {
    const out = aggregate([
      ev({ sessionId: "s1" }),
      ev({ sessionId: "s2" }),
      ev({ sessionId: "s1" }),
    ]);
    expect(out[0].sessionCount).toBe(2);
    expect(out[0].messageCount).toBe(3);
  });

  it("counts null sessionId as no session", () => {
    const out = aggregate([
      ev({ sessionId: null }),
      ev({ sessionId: null }),
    ]);
    expect(out[0].sessionCount).toBe(0);
    expect(out[0].messageCount).toBe(2);
  });

  it("separates rows by date / tool / model / project / source", () => {
    const out = aggregate([
      ev({ date: "2026-05-25" }),
      ev({ date: "2026-05-26" }),
      ev({ tool: "codex", model: "gpt-5" }),
      ev({ model: "claude-sonnet-4-5" }),
      ev({ projectPath: "/other" }),
      ev({ source: "manual" }),
    ]);
    expect(out).toHaveLength(6);
  });

  it("hashes projectPath; null path → empty string", () => {
    const out = aggregate([ev({ projectPath: null })]);
    expect(out[0].project).toBe("");
    const out2 = aggregate([ev({ projectPath: "/repo" })]);
    expect(out2[0].project).toMatch(/^[0-9a-f]{16}$/);
  });

  it("same path always hashes to same project value", () => {
    const a = aggregate([ev({ projectPath: "/repo" })])[0].project;
    const b = aggregate([ev({ projectPath: "/repo" })])[0].project;
    expect(a).toBe(b);
  });

  it("returns deterministic sort order", () => {
    const a = aggregate([
      ev({ date: "2026-05-26" }),
      ev({ date: "2026-05-25" }),
    ]);
    expect(a.map((r) => r.date)).toEqual(["2026-05-25", "2026-05-26"]);
  });

  it("output passes the strict zod schema", async () => {
    const { usagePayloadSchema } = await import("@/types");
    const out = aggregate([ev()]);
    const r = usagePayloadSchema.safeParse({ records: out });
    expect(r.success).toBe(true);
  });
});
