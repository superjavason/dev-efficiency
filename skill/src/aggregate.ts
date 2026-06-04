import { projectHash } from "@/hash";
import type { RawEvent, UsageRecord } from "@/types";

interface Acc {
  record: UsageRecord;
  sessions: Set<string>;
}

export function aggregate(events: RawEvent[]): UsageRecord[] {
  const buckets = new Map<string, Acc>();

  for (const e of events) {
    const project = projectHash(e.projectPath);
    const key = `${e.date}|${e.tool}|${e.model}|${project}|${e.source}`;
    let acc = buckets.get(key);
    if (!acc) {
      acc = {
        record: {
          date: e.date,
          tool: e.tool,
          model: e.model,
          project,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          sessionCount: 0,
          messageCount: 0,
          source: e.source,
        },
        sessions: new Set(),
      };
      buckets.set(key, acc);
    }
    acc.record.inputTokens += e.inputTokens;
    acc.record.outputTokens += e.outputTokens;
    acc.record.cacheCreationTokens += e.cacheCreationTokens;
    acc.record.cacheReadTokens += e.cacheReadTokens;
    acc.record.messageCount += 1;
    if (e.sessionId) acc.sessions.add(e.sessionId);
  }

  const rows = Array.from(buckets.values()).map(({ record, sessions }) => ({
    ...record,
    sessionCount: sessions.size,
  }));

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.tool !== b.tool) return a.tool < b.tool ? -1 : 1;
    if (a.model !== b.model) return a.model < b.model ? -1 : 1;
    if (a.project !== b.project) return a.project < b.project ? -1 : 1;
    return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
  });
  return rows;
}
