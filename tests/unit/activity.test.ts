import { describe, it, expect } from "vitest";
import { computeStreaks, type DayTotal } from "@/lib/activity";

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
