import { describe, it, expect } from "vitest";
import { computeStreaks, computeThresholds, bucketLevel, type DayTotal } from "@/lib/activity";

const d = (date: string, total: number): DayTotal => ({ date, total });

describe("computeStreaks", () => {
  it("returns zeros for empty history", () => {
    expect(computeStreaks([], "2026-06-10")).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      activeDays: 0,
    });
  });

  it("counts a single active day today", () => {
    expect(computeStreaks([d("2026-06-10", 5)], "2026-06-10")).toEqual({
      currentStreak: 1,
      longestStreak: 1,
      activeDays: 1,
    });
  });

  it("ignores days whose total is zero", () => {
    const r = computeStreaks([d("2026-06-09", 0), d("2026-06-10", 7)], "2026-06-10");
    expect(r.activeDays).toBe(1);
    expect(r.currentStreak).toBe(1);
    expect(r.longestStreak).toBe(1);
  });

  it("current streak counts from yesterday when today is inactive", () => {
    const days = [d("2026-06-08", 1), d("2026-06-09", 1)];
    const r = computeStreaks(days, "2026-06-10");
    expect(r.currentStreak).toBe(2);
    expect(r.longestStreak).toBe(2);
  });

  it("current streak is 0 when neither today nor yesterday is active", () => {
    const days = [d("2026-06-01", 1), d("2026-06-02", 1)];
    const r = computeStreaks(days, "2026-06-10");
    expect(r.currentStreak).toBe(0);
    expect(r.longestStreak).toBe(2);
  });

  it("longest streak spans a month boundary and exceeds current", () => {
    const days = [
      d("2026-05-30", 1), d("2026-05-31", 1), d("2026-06-01", 1), d("2026-06-02", 1),
      d("2026-06-10", 1),
    ];
    const r = computeStreaks(days, "2026-06-10");
    expect(r.longestStreak).toBe(4);
    expect(r.currentStreak).toBe(1);
    expect(r.activeDays).toBe(5);
  });
});

describe("computeThresholds + bucketLevel", () => {
  it("treats all-zero data as level 0", () => {
    const days = [d("2026-06-09", 0), d("2026-06-10", 0)];
    const th = computeThresholds(days);
    expect(bucketLevel(0, th)).toBe(0);
  });

  it("maps zero total to level 0 regardless of thresholds", () => {
    expect(bucketLevel(0, [10, 20, 30])).toBe(0);
    expect(bucketLevel(-5, [10, 20, 30])).toBe(0);
  });

  it("assigns ascending levels across quartile thresholds", () => {
    expect(bucketLevel(5, [10, 20, 30])).toBe(1); // below p25
    expect(bucketLevel(10, [10, 20, 30])).toBe(2); // >= p25
    expect(bucketLevel(25, [10, 20, 30])).toBe(3); // >= p50
    expect(bucketLevel(30, [10, 20, 30])).toBe(4); // >= p75
    expect(bucketLevel(999, [10, 20, 30])).toBe(4); // capped at 4
  });

  it("puts every active cell on the same level when all totals are equal", () => {
    const days = [d("2026-06-08", 50), d("2026-06-09", 50), d("2026-06-10", 50)];
    const th = computeThresholds(days);
    expect(bucketLevel(50, th)).toBe(4);
  });

  it("returns [p25, p50, p75] of active day totals", () => {
    // sorted [10,20,30,40]: floor(3*0.25)=0→10, floor(3*0.5)=1→20, floor(3*0.75)=2→30
    const days = [d("2026-06-07", 40), d("2026-06-08", 10), d("2026-06-09", 30), d("2026-06-10", 20)];
    expect(computeThresholds(days)).toEqual([10, 20, 30]);
  });

  it("with a single active day, totals below it are level 1 and at/above are level 4", () => {
    const th = computeThresholds([d("2026-06-10", 100)]);
    expect(th).toEqual([100, 100, 100]);
    expect(bucketLevel(99, th)).toBe(1);
    expect(bucketLevel(100, th)).toBe(4);
  });
});
