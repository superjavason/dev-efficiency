"use client";

import { useState, useMemo } from "react";
import { type Heatmap, computeWeeklyThresholds, bucketLevel } from "@/lib/activity";

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

type ViewMode = "daily" | "weekly" | "cumulative";

export function ActivityHeatmap({ heatmap }: ActivityHeatmapProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("daily");

  const { weeks, monthLabels } = heatmap;
  const labelByWeek = new Map(monthLabels.map((m) => [m.weekIndex, m.label]));
  const columnsStyle = {
    gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))`,
  };

  const { weeklyData, cumulativeData } = useMemo(() => {
    let runningTotal = 0;

    const wData = weeks.map((col, i) => {
      let weekTotal = 0;
      let firstDate = "";
      col.forEach((cell) => {
        if (cell) {
          weekTotal += cell.total;
          if (!firstDate) firstDate = cell.date;
        }
      });
      runningTotal += weekTotal;
      return { index: i, total: weekTotal, cumulativeTotal: runningTotal, date: firstDate };
    });

    const thresholds = computeWeeklyThresholds(wData.map((d) => d.total));

    // For cumulative, we want to visualize the running total.
    // We'll compute thresholds based on the cumulative totals so the color gradient
    // increases over time.
    const cumThresholds = computeWeeklyThresholds(wData.map((d) => d.cumulativeTotal));

    return {
      weeklyData: wData.map((d) => ({
        ...d,
        level: bucketLevel(d.total, thresholds)
      })),
      cumulativeData: wData.map((d) => ({
        ...d,
        level: bucketLevel(d.cumulativeTotal, cumThresholds)
      }))
    };
  }, [weeks]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-3 text-sm">
        <button
          onClick={() => setViewMode("daily")}
          className={viewMode === "daily" ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
        >
          每日
        </button>
        <button
          onClick={() => setViewMode("weekly")}
          className={viewMode === "weekly" ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
        >
          每周
        </button>
        <button
          onClick={() => setViewMode("cumulative")}
          className={viewMode === "cumulative" ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}
        >
          累计
        </button>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="min-w-max">
          {viewMode === "daily" && (
            <div
              className="grid grid-flow-col gap-[3px]"
              style={{ ...columnsStyle, gridTemplateRows: "repeat(7, 1fr)" }}
            >
              {weeks.map((col, ci) =>
                col.map((cell, ri) =>
                  cell === null ? (
                    <div key={`${ci}-${ri}`} className="aspect-square min-w-[11px]" />
                  ) : (
                    <div
                      key={`${ci}-${ri}`}
                      className={`aspect-square min-w-[11px] rounded-[2px] ${LEVEL_CLASS[cell.level]}`}
                      title={`${cell.date} · ${cell.total.toLocaleString("en-US")} tokens`}
                    />
                  ),
                ),
              )}
            </div>
          )}

          {viewMode === "weekly" && (
            <div
              className="grid grid-flow-col gap-[3px] items-end"
              style={{ ...columnsStyle, gridTemplateRows: "1fr" }}
            >
              {weeklyData.map((week) => (
                <div
                  key={week.index}
                  className={`aspect-square min-w-[11px] rounded-[2px] ${LEVEL_CLASS[week.level as 0 | 1 | 2 | 3 | 4]}`}
                  title={`Week of ${week.date || 'unknown'} · ${week.total.toLocaleString("en-US")} tokens`}
                />
              ))}
            </div>
          )}

          {viewMode === "cumulative" && (
            <div
              className="grid grid-flow-col gap-[3px] items-end"
              style={{ ...columnsStyle, gridTemplateRows: "1fr" }}
            >
              {cumulativeData.map((week) => (
                <div
                  key={week.index}
                  className={`aspect-square min-w-[11px] rounded-[2px] ${LEVEL_CLASS[week.level as 0 | 1 | 2 | 3 | 4]}`}
                  title={`Up to Week of ${week.date || 'unknown'} · ${week.cumulativeTotal.toLocaleString("en-US")} tokens`}
                />
              ))}
            </div>
          )}

          <div className="mt-1 grid grid-flow-col gap-[3px]" style={columnsStyle}>
            {weeks.map((_, ci) => (
              <div
                key={ci}
                className="overflow-visible whitespace-nowrap text-[10px] text-muted-foreground min-w-[11px]"
              >
                {labelByWeek.has(ci) ? labelByWeek.get(ci) : ""}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
