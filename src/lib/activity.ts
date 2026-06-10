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

