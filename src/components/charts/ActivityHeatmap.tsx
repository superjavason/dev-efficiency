"use client";

import type { Heatmap } from "@/lib/activity";

const LEVEL_CLASS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-slate-100",
  1: "bg-blue-200",
  2: "bg-blue-300",
  3: "bg-blue-500",
  4: "bg-blue-700",
};

export interface ActivityHeatmapProps {
  heatmap: Heatmap;
}

export function ActivityHeatmap({ heatmap }: ActivityHeatmapProps) {
  const { weeks, monthLabels } = heatmap;
  const labelByWeek = new Map(monthLabels.map((m) => [m.weekIndex, m.label]));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-3 text-sm">
        <span className="font-medium text-foreground">每日</span>
        <span className="cursor-not-allowed text-muted-foreground/50">每周</span>
        <span className="cursor-not-allowed text-muted-foreground/50">累计</span>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-[3px]">
          {weeks.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {col.map((cell, ri) =>
                cell === null ? (
                  <div key={ri} className="h-[11px] w-[11px]" />
                ) : (
                  <div
                    key={ri}
                    className={`h-[11px] w-[11px] rounded-[2px] ${LEVEL_CLASS[cell.level]}`}
                    title={`${cell.date} · ${cell.total.toLocaleString("en-US")} tokens`}
                  />
                ),
              )}
            </div>
          ))}
        </div>

        <div className="mt-1 flex gap-[3px]">
          {weeks.map((_, ci) => (
            <div
              key={ci}
              className="w-[11px] overflow-visible whitespace-nowrap text-[10px] text-muted-foreground"
            >
              {labelByWeek.has(ci) ? labelByWeek.get(ci) : ""}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
