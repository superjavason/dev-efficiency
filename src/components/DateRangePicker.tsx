"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const PRESETS = [
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "90d", label: "近 90 天" },
] as const;

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const currentPreset = params.get("preset") ?? (params.get("from") ? "custom" : "7d");

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<Date | undefined>();
  const [to, setTo] = useState<Date | undefined>();

  function push(updates: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    // Always clear all range-related keys; caller will set the ones it wants.
    next.delete("preset");
    next.delete("from");
    next.delete("to");
    for (const [k, v] of Object.entries(updates)) {
      if (v !== null) next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  function selectPreset(value: string) {
    push({ preset: value });
  }

  function applyCustom() {
    if (!from || !to) return;
    push({ from: toIsoDate(from), to: toIsoDate(to) });
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={currentPreset === "custom" ? "7d" : currentPreset} onValueChange={selectPreset}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <CalendarIcon className="mr-2 h-4 w-4" /> 自定义
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="end">
          <div className="flex flex-col gap-2">
            <div className="flex gap-4">
              <div>
                <div className="px-1 pb-1 text-xs text-muted-foreground">开始</div>
                <Calendar mode="single" selected={from} onSelect={setFrom} />
              </div>
              <div>
                <div className="px-1 pb-1 text-xs text-muted-foreground">结束</div>
                <Calendar mode="single" selected={to} onSelect={setTo} />
              </div>
            </div>
            <Button size="sm" onClick={applyCustom} disabled={!from || !to}>
              应用
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
