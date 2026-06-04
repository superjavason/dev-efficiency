import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import type { RawEvent } from "@/types";

interface CodexLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    model?: string;
    cwd?: string;
    info?: {
      total_token_usage?: {
        input_tokens?: number;
        cached_input_tokens?: number;
        output_tokens?: number;
        reasoning_output_tokens?: number;
      };
    };
  };
}

function utcDate(ts: string): string | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function sessionIdFromFile(path: string): string {
  const name = basename(path, ".jsonl");
  const m = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
  return m ? m[1] : name;
}

export async function parseCodexFile(path: string): Promise<RawEvent[]> {
  let model: string | null = null;
  let cwd: string | null = null;
  let lastUsage: NonNullable<CodexLine["payload"]>["info"] | null = null;
  let lastTimestamp: string | null = null;

  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let parsed: CodexLine;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.type === "session_init") {
        model = parsed.payload?.model ?? model;
        cwd = parsed.payload?.cwd ?? cwd;
      } else if (parsed.type === "event_msg" && parsed.payload?.type === "token_count") {
        lastUsage = parsed.payload.info ?? lastUsage;
        lastTimestamp = parsed.timestamp ?? lastTimestamp;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  if (!lastUsage || !lastTimestamp) return [];
  const total = lastUsage.total_token_usage;
  if (!total) return [];
  const date = utcDate(lastTimestamp);
  if (!date) return [];
  return [
    {
      date,
      tool: "codex",
      model: model ?? "unknown",
      projectPath: cwd,
      inputTokens: total.input_tokens ?? 0,
      outputTokens: (total.output_tokens ?? 0) + (total.reasoning_output_tokens ?? 0),
      cacheCreationTokens: 0, // Codex protocol has no cache_creation field; intentional.
      cacheReadTokens: total.cached_input_tokens ?? 0,
      sessionId: sessionIdFromFile(path),
      source: "auto",
    },
  ];
}

async function walkRollout(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkRollout(full, out);
    } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
}

export async function parseCodexDir(
  dir: string,
  opts: { sinceDate?: string } = {},
): Promise<RawEvent[]> {
  const files: string[] = [];
  await walkRollout(dir, files);
  const all: RawEvent[] = [];
  for (const f of files) {
    const ev = await parseCodexFile(f);
    for (const e of ev) {
      if (opts.sinceDate && e.date < opts.sinceDate) continue;
      all.push(e);
    }
  }
  return all;
}
