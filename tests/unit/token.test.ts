import { describe, it, expect } from "vitest";
import { generateToken, hashToken } from "@/lib/auth/token";

describe("token", () => {
  it("generates a prefixed url-safe token", () => {
    const t = generateToken();
    expect(t.startsWith("de_")).toBe(true);
    expect(t).toMatch(/^de_[A-Za-z0-9_-]{43}$/);
  });

  it("generates unique tokens", () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it("hashes deterministically with sha256 hex", () => {
    const t = "de_fixed";
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("de_other")).not.toBe(hashToken(t));
  });
});
