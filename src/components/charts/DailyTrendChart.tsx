"use client";

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "./categories";

export interface DailyTrendDatum {
  date: string;
  input: number;
  output: number;
  cache: number;
  total: number;
}

const fmt = (v: unknown) =>
  typeof v === "number" ? v.toLocaleString() : String(v);

export function DailyTrendChart({ data }: { data: DailyTrendDatum[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 12 }} />
          <Tooltip formatter={fmt} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="input" name={CATEGORY_LABELS.input} stackId="1" stroke={CATEGORY_COLORS.input} fill={CATEGORY_COLORS.input} fillOpacity={0.85} />
          <Area type="monotone" dataKey="output" name={CATEGORY_LABELS.output} stackId="1" stroke={CATEGORY_COLORS.output} fill={CATEGORY_COLORS.output} fillOpacity={0.85} />
          <Area type="monotone" dataKey="cache" name={CATEGORY_LABELS.cache} stackId="1" stroke={CATEGORY_COLORS.cache} fill={CATEGORY_COLORS.cache} fillOpacity={0.85} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
