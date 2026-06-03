export interface DateRange {
  from: Date;
  to: Date;
}

type PresetKey = "7d" | "30d" | "90d";

const PRESET_DAYS: Record<PresetKey, number> = { "7d": 6, "30d": 29, "90d": 89 };

function utcDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseRange(
  params: { preset?: string | null; from?: string | null; to?: string | null },
  today: Date = new Date(),
): DateRange {
  if (params.from && params.to) {
    const f = utcDate(params.from);
    const t = utcDate(params.to);
    if (f && t) {
      return f <= t ? { from: f, to: t } : { from: t, to: f };
    }
  }
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const preset = (params.preset as PresetKey) ?? "7d";
  const days = PRESET_DAYS[preset] ?? PRESET_DAYS["7d"];
  const from = new Date(todayUtc);
  from.setUTCDate(from.getUTCDate() - days);
  return { from, to: todayUtc };
}
