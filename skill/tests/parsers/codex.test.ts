import { describe, it, expect } from "vitest";
import { parseCodexFile, parseCodexDir } from "@/parsers/codex";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureFile = join(
  here,
  "..",
  "fixtures",
  "rollout-2026-05-23T22-00-00-12345678-aaaa-bbbb-cccc-ddddeeeeffff.jsonl",
);

describe("parseCodexFile", () => {
  it("returns exactly one event (the last token_count of the session)", async () => {
    const events = await parseCodexFile(fixtureFile);
    expect(events).toHaveLength(1);
  });

  it("uses last token_count's total values", async () => {
    const events = await parseCodexFile(fixtureFile);
    const e = events[0];
    expect(e.inputTokens).toBe(35000);
    expect(e.cacheReadTokens).toBe(8000);
    expect(e.outputTokens).toBe(600 + 150);
    expect(e.cacheCreationTokens).toBe(0);
  });

  it("derives model from session_init", async () => {
    const events = await parseCodexFile(fixtureFile);
    expect(events[0].model).toBe("gpt-5.4");
  });

  it("derives projectPath from session_init cwd", async () => {
    const events = await parseCodexFile(fixtureFile);
    expect(events[0].projectPath).toBe("/Users/me/codex-repo");
  });

  it("derives sessionId from filename UUID segment", async () => {
    const events = await parseCodexFile(fixtureFile);
    expect(events[0].sessionId).toBe("12345678-aaaa-bbbb-cccc-ddddeeeeffff");
  });

  it("date derived from last token_count timestamp", async () => {
    const events = await parseCodexFile(fixtureFile);
    expect(events[0].date).toBe("2026-05-23");
  });

  it("tool is codex; source is auto", async () => {
    const events = await parseCodexFile(fixtureFile);
    expect(events[0].tool).toBe("codex");
    expect(events[0].source).toBe("auto");
  });
});

describe("parseCodexFile — real-format (session_meta + turn_context)", () => {
  const realFixture = join(
    here,
    "..",
    "fixtures",
    "rollout-2026-05-25T22-01-33-019e6128-528d-7883-8500-76bc6633a23b.jsonl",
  );

  it("extracts model from turn_context when session_meta lacks model", async () => {
    const events = await parseCodexFile(realFixture);
    expect(events).toHaveLength(1);
    expect(events[0].model).toBe("gpt-5.4");
    expect(events[0].projectPath).toBe("/Users/me/real-codex-repo");
  });

  it("uses token_count totals from the real-format fixture", async () => {
    const events = await parseCodexFile(realFixture);
    const e = events[0];
    expect(e.inputTokens).toBe(12345);
    expect(e.cacheReadTokens).toBe(2000);
    expect(e.outputTokens).toBe(500 + 100);
    expect(e.cacheCreationTokens).toBe(0);
  });
});

describe("parseCodexDir", () => {
  it("returns empty array when dir does not exist", async () => {
    const events = await parseCodexDir("/nonexistent/zzz");
    expect(events).toEqual([]);
  });

  it("walks dir recursively and finds rollout-*.jsonl files", async () => {
    const dir = join(here, "..", "fixtures");
    const events = await parseCodexDir(dir);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by sinceDate", async () => {
    const dir = join(here, "..", "fixtures");
    const events = await parseCodexDir(dir, { sinceDate: "2027-01-01" });
    expect(events).toEqual([]);
  });
});
