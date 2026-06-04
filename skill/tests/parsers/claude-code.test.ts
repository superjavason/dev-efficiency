import { describe, it, expect } from "vitest";
import { parseClaudeCodeFile, parseClaudeCodeDir } from "@/parsers/claude-code";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "fixtures", "claude-code.jsonl");

describe("parseClaudeCodeFile", () => {
  it("extracts events from assistant messages with usage", async () => {
    const events = await parseClaudeCodeFile(fixture);
    expect(events).toHaveLength(4);
  });

  it("populates token fields correctly", async () => {
    const events = await parseClaudeCodeFile(fixture);
    const first = events[0];
    expect(first.tool).toBe("claude-code");
    expect(first.model).toBe("claude-opus-4-7");
    expect(first.inputTokens).toBe(10);
    expect(first.outputTokens).toBe(20);
    expect(first.cacheCreationTokens).toBe(5);
    expect(first.cacheReadTokens).toBe(7);
    expect(first.sessionId).toBe("s-aaa");
    expect(first.projectPath).toBe("/Users/me/repo-a");
    expect(first.source).toBe("auto");
  });

  it("derives date from timestamp using UTC", async () => {
    const events = await parseClaudeCodeFile(fixture);
    const dates = new Set(events.map((e) => e.date));
    expect(dates.has("2026-05-25")).toBe(true);
    expect(dates.has("2026-05-26")).toBe(true);
  });

  it("does not throw on the well-formed fixture", async () => {
    await expect(parseClaudeCodeFile(fixture)).resolves.toBeTruthy();
  });
});

describe("parseClaudeCodeDir", () => {
  it("returns empty array when dir does not exist", async () => {
    const events = await parseClaudeCodeDir("/nonexistent/path/zzz");
    expect(events).toEqual([]);
  });

  it("walks dir recursively and accumulates events", async () => {
    const dir = join(here, "..", "fixtures");
    const events = await parseClaudeCodeDir(dir);
    expect(events.length).toBeGreaterThanOrEqual(4);
  });

  it("filters events by since-date inclusive", async () => {
    const dir = join(here, "..", "fixtures");
    const events = await parseClaudeCodeDir(dir, { sinceDate: "2026-05-26" });
    expect(events.every((e) => e.date >= "2026-05-26")).toBe(true);
  });
});
