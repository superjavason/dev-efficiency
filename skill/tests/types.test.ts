import { describe, it, expect } from "vitest";
import { usageRecordSchema, type RawEvent } from "@/types";

describe("usageRecordSchema (privacy backbone)", () => {
  const valid = {
    date: "2026-05-25",
    tool: "claude-code" as const,
    model: "claude-opus-4-7",
    project: "abcdef0123456789",
    inputTokens: 100,
    outputTokens: 200,
    cacheCreationTokens: 50,
    cacheReadTokens: 80,
    sessionCount: 1,
    messageCount: 3,
    source: "auto" as const,
  };

  it("accepts a valid record", () => {
    expect(usageRecordSchema.safeParse(valid).success).toBe(true);
  });

  it("strips unknown fields (zod strict)", () => {
    const r = usageRecordSchema.safeParse({ ...valid, prompt: "secret", code: "rm -rf /" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown tool", () => {
    expect(usageRecordSchema.safeParse({ ...valid, tool: "vim" }).success).toBe(false);
  });

  it("rejects non-YYYY-MM-DD date", () => {
    expect(usageRecordSchema.safeParse({ ...valid, date: "2026/05/25" }).success).toBe(false);
  });

  it("rejects negative tokens", () => {
    expect(usageRecordSchema.safeParse({ ...valid, inputTokens: -1 }).success).toBe(false);
  });

  it("requires project field (empty string allowed)", () => {
    const { project, ...noProj } = valid;
    expect(usageRecordSchema.safeParse(noProj).success).toBe(false);
    expect(usageRecordSchema.safeParse({ ...valid, project: "" }).success).toBe(true);
  });

  it("RawEvent type is exported (compile check)", () => {
    const e: RawEvent = {
      date: "2026-05-25",
      tool: "codex",
      model: "gpt-5",
      projectPath: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      sessionId: null,
      source: "auto",
    };
    expect(e.date).toBe("2026-05-25");
  });
});
