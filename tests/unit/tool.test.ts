import { describe, it, expect } from "vitest";
import { toolFromApi, toolToApi, API_TOOLS } from "@/lib/tool";

describe("tool mapping", () => {
  it("maps api string to prisma enum", () => {
    expect(toolFromApi("claude-code")).toBe("claude_code");
    expect(toolFromApi("codex")).toBe("codex");
    expect(toolFromApi("cursor")).toBe("cursor");
  });

  it("returns null for unknown tool", () => {
    expect(toolFromApi("vim")).toBeNull();
  });

  it("maps prisma enum back to api string", () => {
    expect(toolToApi("claude_code")).toBe("claude-code");
  });

  it("lists supported api tools", () => {
    expect(API_TOOLS).toEqual(["claude-code", "codex", "cursor"]);
  });
});
