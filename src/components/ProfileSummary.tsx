import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { ActivityHeatmap } from "@/components/charts/ActivityHeatmap";
import { formatCompactCN } from "@/lib/format";
import type { ProfileActivity } from "@/lib/services/metrics";

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-3">
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export interface ProfileSummaryProps {
  name: string;
  avatarUrl: string | null;
  activity: ProfileActivity;
}

export function ProfileSummary({ name, avatarUrl, activity }: ProfileSummaryProps) {
  const { stats, heatmap } = activity;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-3">
        <UserAvatar name={name} avatarUrl={avatarUrl} size={80} />
        <h2 className="text-xl font-semibold">{name}</h2>
      </div>

      <Card>
        <CardContent className="flex items-center justify-center divide-x divide-border overflow-x-auto py-2">
          <StatCard value={formatCompactCN(stats.cumulativeTotal)} label="累计 Token 数" />
          <StatCard value={formatCompactCN(stats.peakDay)} label="峰值 Token 数" />
          <StatCard value={`${stats.activeDays} 天`} label="活跃天数" />
          <StatCard value={`${stats.currentStreak} 天`} label="当前连续天数" />
          <StatCard value={`${stats.longestStreak} 天`} label="最长连续天数" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Token 活动</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityHeatmap heatmap={heatmap} />
        </CardContent>
      </Card>
    </div>
  );
}
