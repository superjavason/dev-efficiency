import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { RawEvent } from "@/types";

interface AssistantLine {
  type: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

function utcDate(ts: string): string | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function parseClaudeCodeFile(path: string): Promise<RawEvent[]> {
  const events: RawEvent[] = [];
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let parsed: AssistantLine;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.type !== "assistant") continue;
      const usage = parsed.message?.usage;
      const model = parsed.message?.model;
      const ts = parsed.timestamp;
      if (!usage || !model || !ts) continue;
      const date = utcDate(ts);
      if (!date) continue;
      events.push({
        date,
        tool: "claude-code",
        model,
        projectPath: parsed.cwd ?? null,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        sessionId: parsed.sessionId ?? null,
        source: "auto",
      });
    }
  } finally {
    rl.close();
  }
  return events;
}

async function walkJsonl(dir: string, out: string[]): Promise<void> {
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
      await walkJsonl(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
}

export async function parseClaudeCodeDir(
  dir: string,
  opts: { sinceDate?: string } = {},
): Promise<RawEvent[]> {
  const files: string[] = [];
  await walkJsonl(dir, files);
  const all: RawEvent[] = [];
  for (const f of files) {
    const ev = await parseClaudeCodeFile(f);
    for (const e of ev) {
      if (opts.sinceDate && e.date < opts.sinceDate) continue;
      all.push(e);
    }
  }
  return all;
}
