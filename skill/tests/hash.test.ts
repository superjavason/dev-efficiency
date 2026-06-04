import { describe, it, expect } from "vitest";
import { projectHash } from "@/hash";

describe("projectHash", () => {
  it("returns empty string for null/undefined", () => {
    expect(projectHash(null)).toBe("");
    expect(projectHash(undefined)).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(projectHash("")).toBe("");
  });

  it("returns deterministic 16-char hex for non-empty path", () => {
    const h1 = projectHash("/Users/me/repo");
    const h2 = projectHash("/Users/me/repo");
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns different hashes for different paths", () => {
    expect(projectHash("/a")).not.toBe(projectHash("/b"));
  });

  it("matches expected sha256 prefix length", () => {
    expect(projectHash("/Users/me/repo").length).toBe(16);
  });
});
