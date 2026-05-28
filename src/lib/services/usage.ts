import type { PrismaClient } from "@prisma/client";
import { toolFromApi } from "@/lib/tool";
import type { UsageRecordInput } from "@/lib/validation/usage";

export interface IngestResult {
  inserted: number;
  updated: number;
}

export async function ingestUsage(
  prisma: PrismaClient,
  userId: string,
  records: UsageRecordInput[],
): Promise<IngestResult> {
  let inserted = 0;
  let updated = 0;

  for (const r of records) {
    const tool = toolFromApi(r.tool);
    if (!tool) continue;

    const input = BigInt(r.inputTokens);
    const output = BigInt(r.outputTokens);
    const cacheCreation = BigInt(r.cacheCreationTokens);
    const cacheRead = BigInt(r.cacheReadTokens);
    const total = input + output + cacheCreation + cacheRead;

    const date = new Date(r.date + "T00:00:00.000Z");

    const existing = await prisma.usageRecord.findUnique({
      where: {
        userId_date_tool_model_project_source: {
          userId,
          date,
          tool,
          model: r.model,
          project: r.project,
          source: r.source,
        },
      },
      select: { id: true },
    });

    await prisma.usageRecord.upsert({
      where: {
        userId_date_tool_model_project_source: {
          userId,
          date,
          tool,
          model: r.model,
          project: r.project,
          source: r.source,
        },
      },
      create: {
        userId,
        date,
        tool,
        model: r.model,
        project: r.project,
        inputTokens: input,
        outputTokens: output,
        cacheCreationTokens: cacheCreation,
        cacheReadTokens: cacheRead,
        totalTokens: total,
        sessionCount: r.sessionCount,
        messageCount: r.messageCount,
        source: r.source,
      },
      update: {
        inputTokens: input,
        outputTokens: output,
        cacheCreationTokens: cacheCreation,
        cacheReadTokens: cacheRead,
        totalTokens: total,
        sessionCount: r.sessionCount,
        messageCount: r.messageCount,
      },
    });

    if (existing) updated++;
    else inserted++;
  }

  return { inserted, updated };
}
