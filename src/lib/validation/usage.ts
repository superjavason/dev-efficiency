import { z } from "zod";
import { API_TOOLS } from "@/lib/tool";

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const usageRecordSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  tool: z.enum(API_TOOLS),
  model: z.string().min(1).max(100),
  project: z.string().max(128).default(""),
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheCreationTokens: tokenCount,
  cacheReadTokens: tokenCount,
  sessionCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  source: z.enum(["auto", "manual"]),
});

export const usagePayloadSchema = z.object({
  records: z.array(usageRecordSchema).min(1).max(2000),
});

export type UsageRecordInput = z.infer<typeof usageRecordSchema>;
