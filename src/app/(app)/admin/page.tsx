import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { parseRange } from "@/lib/range";
import {
  dailyTotals, userRanking, toolBreakdown, modelBreakdown,
} from "@/lib/services/metrics";
import { DailyTrendChart } from "@/components/charts/DailyTrendChart";
import { ToolBreakdownChart } from "@/components/charts/ToolBreakdownChart";
import { ModelBreakdownChart } from "@/components/charts/ModelBreakdownChart";
import { UserRankingTable } from "@/components/charts/UserRankingTable";
import { DateRangePicker } from "@/components/DateRangePicker";

interface SearchParams {
  preset?: string;
  from?: string;
  to?: string;
}

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.role !== "admin") redirect("/dashboard");

  const sp = await searchParams;
  const range = parseRange(sp);

  const [trend, ranking, tools, models] = await Promise.all([
    dailyTotals(prisma, user, range, {}),
    userRanking(prisma, user, range),
    toolBreakdown(prisma, user, range, {}),
    modelBreakdown(prisma, user, range, {}),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">平台总览</h1>
        <DateRangePicker />
      </div>

      <Card>
        <CardHeader><CardTitle>团队每日 Token 趋势</CardTitle></CardHeader>
        <CardContent>
          <DailyTrendChart data={trend.map((p) => ({ date: p.date, total: Number(p.total) }))} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>按工具</CardTitle></CardHeader>
          <CardContent>
            <ToolBreakdownChart data={tools.map((t) => ({ tool: t.tool, total: Number(t.total) }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>按模型</CardTitle></CardHeader>
          <CardContent>
            <ModelBreakdownChart data={models.map((m) => ({ model: m.model, total: Number(m.total) }))} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>用户排行</CardTitle></CardHeader>
        <CardContent>
          <UserRankingTable
            data={ranking.map((r) => ({
              userId: r.userId, name: r.name, email: r.email,
              avatarUrl: r.avatarUrl, total: Number(r.total),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
