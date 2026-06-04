"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./categories";

export interface ModelDatum {
  model: string;
  input: number;
  output: number;
  cache: number;
  total: number;
}

const fmt = (v: unknown) =>
  typeof v === "number" ? v.toLocaleString() : String(v);

export function ModelBreakdownChart({ data }: { data: ModelDatum[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 12 }} />
          <YAxis type="category" dataKey="model" tick={{ fontSize: 12 }} width={140} />
          <Tooltip formatter={fmt} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="input" name={CATEGORY_LABELS.input} stackId="a" fill={CATEGORY_COLORS.input} />
          <Bar dataKey="output" name={CATEGORY_LABELS.output} stackId="a" fill={CATEGORY_COLORS.output} />
          <Bar dataKey="cache" name={CATEGORY_LABELS.cache} stackId="a" fill={CATEGORY_COLORS.cache} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
