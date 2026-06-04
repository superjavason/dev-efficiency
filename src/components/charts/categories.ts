/**
 * Token category color palette used by all stacked charts.
 * 3 categories: input / output / cache (where cache = cacheCreation + cacheRead).
 * Colors chosen to be distinguishable and to read well in both light and
 * dark themes (no theme-token dependency — Recharts SVG fills don't pick up
 * shadcn CSS variables reliably across all clients).
 */
export const CATEGORY_COLORS = {
  input: "#2563eb",   // blue-600
  output: "#10b981",  // emerald-500
  cache: "#a78bfa",   // violet-400
} as const;

export const CATEGORY_LABELS = {
  input: "Input",
  output: "Output",
  cache: "Cache",
} as const;
