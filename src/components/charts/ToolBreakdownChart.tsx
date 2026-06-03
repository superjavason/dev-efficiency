"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export interface ToolDatum {
  tool: string;
  total: number;
}

export function ToolBreakdownChart({ data }: { data: ToolDatum[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="tool" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v) => typeof v === "number" ? v.toLocaleString() : String(v)} />
          <Bar dataKey="total" fill="hsl(var(--primary))" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
