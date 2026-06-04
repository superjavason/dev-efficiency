import { describe, it, expect } from "vitest";
import { slugify, isValidSlug } from "@/lib/slug";

describe("slugify", () => {
  it("converts ASCII to kebab-case", () => {
    expect(slugify("ACME Corp")).toBe("acme-corp");
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("multiple   spaces")).toBe("multiple-spaces");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("---hello---")).toBe("hello");
    expect(slugify("!!!hi!!!")).toBe("hi");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugify("a---b___c")).toBe("a-b-c");
  });

  it("truncates to 60 chars", () => {
    const long = "x".repeat(100);
    expect(slugify(long)).toBe("x".repeat(60));
  });

  it("re-trims trailing hyphen produced by truncation", () => {
    // 59 chars of 'x' + ' b' → after non-alnum→'-' and slice(0,60) the last char is '-'
    const input = "x".repeat(59) + " b";
    const out = slugify(input);
    expect(out).not.toBeNull();
    expect(out!.endsWith("-")).toBe(false);
    expect(out).toBe("x".repeat(59)); // single 'x' run, trailing '-' trimmed away
  });

  it("returns null for non-ASCII-only input", () => {
    expect(slugify("中文团队")).toBeNull();
    expect(slugify("🚀 emoji")).toBe("emoji");
    expect(slugify("🚀")).toBeNull();
    expect(slugify("")).toBeNull();
    expect(slugify("   ")).toBeNull();
  });
});

describe("isValidSlug", () => {
  it("accepts valid slugs", () => {
    expect(isValidSlug("a")).toBe(true);
    expect(isValidSlug("acme")).toBe(true);
    expect(isValidSlug("acme-corp")).toBe(true);
    expect(isValidSlug("a1-b2-c3")).toBe(true);
  });

  it("rejects invalid slugs", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("-acme")).toBe(false);
    expect(isValidSlug("acme-")).toBe(false);
    expect(isValidSlug("ACME")).toBe(false);
    expect(isValidSlug("ac me")).toBe(false);
    expect(isValidSlug("ac_me")).toBe(false);
    expect(isValidSlug("中文")).toBe(false);
    expect(isValidSlug("x".repeat(61))).toBe(false);
  });
});
