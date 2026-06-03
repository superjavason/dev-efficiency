"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

export interface ModelDatum {
  model: string;
  total: number;
}

export function ModelBreakdownChart({ data }: { data: ModelDatum[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 12 }} />
          <YAxis type="category" dataKey="model" tick={{ fontSize: 12 }} width={140} />
          <Tooltip formatter={(v) => typeof v === "number" ? v.toLocaleString() : String(v)} />
          <Bar dataKey="total" fill="hsl(var(--primary))" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
