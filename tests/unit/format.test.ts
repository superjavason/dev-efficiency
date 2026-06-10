import { describe, it, expect } from "vitest";
import { formatCompactCN } from "@/lib/format";

describe("formatCompactCN", () => {
  it("formats hundreds of millions with 亿", () => {
    expect(formatCompactCN(160_000_000)).toBe("1.6亿");
  });

  it("formats tens of thousands with 万", () => {
    expect(formatCompactCN(52_984_000)).toBe("5298.4万");
  });

  it("strips a trailing .0", () => {
    expect(formatCompactCN(30_000_000)).toBe("3000万");
    expect(formatCompactCN(200_000_000)).toBe("2亿");
  });

  it("uses grouped digits below 万", () => {
    expect(formatCompactCN(9999)).toBe("9,999");
    expect(formatCompactCN(0)).toBe("0");
  });

  it("handles the 亿 boundary without rounding up to 10000万", () => {
    expect(formatCompactCN(100_000_000)).toBe("1亿");
    expect(formatCompactCN(99_999_999)).toBe("1亿"); // rounds up across the band edge
  });
});
