"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export interface DailyTrendDatum {
  date: string;
  total: number;
}

export function DailyTrendChart({ data }: { data: DailyTrendDatum[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v) => typeof v === "number" ? v.toLocaleString() : String(v)} />
          <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
