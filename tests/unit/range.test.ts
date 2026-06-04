import { describe, it, expect } from "vitest";
import { parseRange, type DateRange } from "@/lib/range";

describe("parseRange", () => {
  it("parses preset 7d / 30d / 90d", () => {
    const r7 = parseRange({ preset: "7d" }, new Date("2026-05-29T00:00:00.000Z"));
    expect(r7.to.toISOString().slice(0, 10)).toBe("2026-05-29");
    expect(r7.from.toISOString().slice(0, 10)).toBe("2026-05-23");
  });

  it("parses custom from/to overriding preset", () => {
    const r = parseRange({ from: "2026-05-01", to: "2026-05-10" });
    expect(r.from.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(r.to.toISOString().slice(0, 10)).toBe("2026-05-10");
  });

  it("defaults to 7d when nothing provided", () => {
    const r = parseRange({}, new Date("2026-05-29T00:00:00.000Z"));
    expect(r.from.toISOString().slice(0, 10)).toBe("2026-05-23");
  });

  it("rejects from > to by swapping", () => {
    const r = parseRange({ from: "2026-05-10", to: "2026-05-01" });
    expect(r.from < r.to).toBe(true);
  });
});
