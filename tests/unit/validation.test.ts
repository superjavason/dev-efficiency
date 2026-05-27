import { describe, it, expect } from "vitest";
import { usagePayloadSchema } from "@/lib/validation/usage";

const validRecord = {
  date: "2026-05-25",
  tool: "claude-code",
  model: "claude-opus-4-7",
  project: "abc123",
  inputTokens: 6,
  outputTokens: 681,
  cacheCreationTokens: 13857,
  cacheReadTokens: 17031,
  sessionCount: 3,
  messageCount: 42,
  source: "auto",
};

describe("usagePayloadSchema", () => {
  it("accepts a valid payload", () => {
    const r = usagePayloadSchema.safeParse({ records: [validRecord] });
    expect(r.success).toBe(true);
  });

  it("defaults project to empty string when missing", () => {
    const { project, ...noProject } = validRecord;
    const r = usagePayloadSchema.parse({ records: [noProject] });
    expect(r.records[0].project).toBe("");
  });

  it("rejects unknown tool", () => {
    const r = usagePayloadSchema.safeParse({
      records: [{ ...validRecord, tool: "vim" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative tokens", () => {
    const r = usagePayloadSchema.safeParse({
      records: [{ ...validRecord, inputTokens: -1 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects bad date format", () => {
    const r = usagePayloadSchema.safeParse({
      records: [{ ...validRecord, date: "2026/05/25" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty records array", () => {
    expect(usagePayloadSchema.safeParse({ records: [] }).success).toBe(false);
  });
});
