import { z } from "zod";

export const TOOLS = ["claude-code", "codex", "cursor"] as const;
export type Tool = (typeof TOOLS)[number];

export interface RawEvent {
  date: string;
  tool: Tool;
  model: string;
  projectPath: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  sessionId: string | null;
  source: "auto" | "manual";
}

const tokenInt = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const usageRecordSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    tool: z.enum(TOOLS),
    model: z.string().min(1).max(100),
    project: z.string().max(64),
    inputTokens: tokenInt,
    outputTokens: tokenInt,
    cacheCreationTokens: tokenInt,
    cacheReadTokens: tokenInt,
    sessionCount: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    source: z.enum(["auto", "manual"]),
  })
  .strict();

export type UsageRecord = z.infer<typeof usageRecordSchema>;

export const usagePayloadSchema = z.object({
  records: z.array(usageRecordSchema).min(1).max(2000),
});
