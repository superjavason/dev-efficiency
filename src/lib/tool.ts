import { Tool } from "@prisma/client";

export const API_TOOLS = ["claude-code", "codex", "cursor"] as const;
export type ApiTool = (typeof API_TOOLS)[number];

const apiToEnum: Record<ApiTool, Tool> = {
  "claude-code": Tool.claude_code,
  codex: Tool.codex,
  cursor: Tool.cursor,
};

const enumToApi: Record<Tool, ApiTool> = {
  [Tool.claude_code]: "claude-code",
  [Tool.codex]: "codex",
  [Tool.cursor]: "cursor",
};

export function toolFromApi(s: string): Tool | null {
  return Object.hasOwn(apiToEnum, s) ? apiToEnum[s as ApiTool] : null;
}

export function toolToApi(t: Tool): ApiTool {
  return enumToApi[t];
}
