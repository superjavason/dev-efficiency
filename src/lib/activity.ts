export interface DayTotal {
  date: string; // YYYY-MM-DD
  total: number;
}

export interface HeatmapCell {
  date: string; // YYYY-MM-DD
  total: number; // 0 if no activity
  level: 0 | 1 | 2 | 3 | 4;
}

export interface Heatmap {
  // column-major: weeks[col] is one week (length 7, Sunday..Saturday).
  // A cell is null for days after `today` in the trailing partial week.
  weeks: (HeatmapCell | null)[][];
  monthLabels: { label: string; weekIndex: number }[];
}

// --- internal date helpers (UTC midnights to avoid DST drift) ---

function parseDay(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(s: string, n: number): string {
  const d = parseDay(s);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDay(d);
}

function dayOfWeek(s: string): number {
  return parseDay(s).getUTCDay(); // 0 = Sunday
}

function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000);
}

export function computeStreaks(
  days: DayTotal[],
  today: string,
): { currentStreak: number; longestStreak: number; activeDays: number } {
  const active = new Set(days.filter((x) => x.total > 0).map((x) => x.date));
  const activeDays = active.size;

  let longestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of [...active].sort()) {
    run = prev !== null && diffDays(prev, date) === 1 ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    prev = date;
  }

  let cursor: string;
  if (active.has(today)) cursor = today;
  else if (active.has(addDays(today, -1))) cursor = addDays(today, -1);
  else return { currentStreak: 0, longestStreak, activeDays };

  let currentStreak = 0;
  while (active.has(cursor)) {
    currentStreak += 1;
    cursor = addDays(cursor, -1);
  }
  return { currentStreak, longestStreak, activeDays };
}

// Three quartile cut points (p25, p50, p75) of active days' totals → 4 non-zero levels.
export function computeThresholds(days: DayTotal[]): number[] {
  const totals = days
    .filter((x) => x.total > 0)
    .map((x) => x.total)
    .sort((a, b) => a - b);
  if (totals.length === 0) return [1, 1, 1];
  const q = (p: number) => totals[Math.floor((totals.length - 1) * p)];
  return [q(0.25), q(0.5), q(0.75)];
}

export function bucketLevel(total: number, thresholds: number[]): 0 | 1 | 2 | 3 | 4 {
  if (total <= 0) return 0;
  let level = 1;
  for (const t of thresholds) {
    if (total >= t) level += 1;
  }
  return Math.min(level, 4) as 0 | 1 | 2 | 3 | 4;
}

export function buildHeatmap(days: DayTotal[], today: string): Heatmap {
  const totalByDate = new Map(days.map((x) => [x.date, x.total]));

  // Window: today-364 .. today, with the start aligned back to its Sunday.
  const windowStart = addDays(today, -364);
  const start = addDays(windowStart, -dayOfWeek(windowStart));

  // Thresholds computed over the in-window day totals (the cells actually shown).
  const inWindow: DayTotal[] = [];
  for (let cur = start; diffDays(cur, today) >= 0; cur = addDays(cur, 1)) {
    inWindow.push({ date: cur, total: totalByDate.get(cur) ?? 0 });
  }
  const thresholds = computeThresholds(inWindow);

  const weeks: (HeatmapCell | null)[][] = [];
  const monthLabels: { label: string; weekIndex: number }[] = [];
  let seenMonth = "";
  let weekIndex = 0;

  for (let colStart = start; diffDays(colStart, today) >= 0; colStart = addDays(colStart, 7)) {
    const col: (HeatmapCell | null)[] = [];
    for (let row = 0; row < 7; row++) {
      const date = addDays(colStart, row);
      if (date > today) {
        // future day in the trailing partial week (ISO date strings compare chronologically)
        col.push(null);
      } else {
        const total = totalByDate.get(date) ?? 0;
        col.push({ date, total, level: bucketLevel(total, thresholds) });
      }
    }
    const label = `${parseDay(colStart).getUTCMonth() + 1}月`;
    if (label !== seenMonth) {
      monthLabels.push({ label, weekIndex });
      seenMonth = label;
    }
    weeks.push(col);
    weekIndex += 1;
  }

  return { weeks, monthLabels };
}



export interface WeeklyHeatmapCell {
  weekLabel: string;
  total: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export function computeWeeklyThresholds(weeklyTotals: number[]): number[] {
  const totals = weeklyTotals.filter((x) => x > 0).sort((a, b) => a - b);
  if (totals.length === 0) return [1, 1, 1];
  const q = (p: number) => totals[Math.floor((totals.length - 1) * p)];
  return [q(0.25), q(0.5), q(0.75)];
}
