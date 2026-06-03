import { describe, it, expect } from "vitest";
import { safeReturnTo } from "@/lib/safe-return-to";

describe("safeReturnTo", () => {
  it("returns fallback for empty/null/undefined", () => {
    expect(safeReturnTo(null)).toBe("/dashboard");
    expect(safeReturnTo(undefined)).toBe("/dashboard");
    expect(safeReturnTo("")).toBe("/dashboard");
  });

  it("returns fallback for absolute URLs", () => {
    expect(safeReturnTo("https://evil.com")).toBe("/dashboard");
    expect(safeReturnTo("http://x")).toBe("/dashboard");
    expect(safeReturnTo("ftp://x")).toBe("/dashboard");
  });

  it("returns fallback for protocol-relative URLs", () => {
    expect(safeReturnTo("//evil.com")).toBe("/dashboard");
  });

  it("returns fallback for non-slash-prefixed paths", () => {
    expect(safeReturnTo("dashboard")).toBe("/dashboard");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/dashboard");
  });

  it("preserves valid relative paths", () => {
    expect(safeReturnTo("/dashboard")).toBe("/dashboard");
    expect(safeReturnTo("/admin/users")).toBe("/admin/users");
    expect(safeReturnTo("/admin?tab=invites")).toBe("/admin?tab=invites");
  });

  it("respects custom fallback", () => {
    expect(safeReturnTo(null, "/")).toBe("/");
  });
});
