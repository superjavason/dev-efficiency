import { confirm, input, number } from "@inquirer/prompts";
import type { RawEvent } from "@/types";

export async function promptCursor(today: string = todayLocal()): Promise<RawEvent[]> {
  const used = await confirm({ message: "今天用 Cursor 了吗？", default: false });
  if (!used) return [];

  const events: RawEvent[] = [];
  let more = true;
  while (more) {
    const model = await input({
      message: "主要使用的模型 (如 claude-sonnet-4-5)",
      validate: (s) => s.trim().length > 0 || "model 不能为空",
    });
    const inputTokens = await number({ message: "input token 大约多少？", min: 0, default: 0, required: true });
    const outputTokens = await number({ message: "output token 大约多少？", min: 0, default: 0, required: true });
    const projectInput = await input({
      message: "所在项目目录 (回车跳过)",
      default: "",
    });
    events.push({
      date: today,
      tool: "cursor",
      model: model.trim(),
      projectPath: projectInput.trim() || null,
      inputTokens: inputTokens ?? 0,
      outputTokens: outputTokens ?? 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      sessionId: null,
      source: "manual",
    });
    more = await confirm({ message: "还要补充其他模型吗？", default: false });
  }
  return events;
}

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
