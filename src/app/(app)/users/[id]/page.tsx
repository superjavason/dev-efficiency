import { notFound, redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { parseRange } from "@/lib/range";
import {
  dailyTotals,
  toolBreakdown,
  modelBreakdown,
  profileActivity,
  MetricsAuthError,
  type MetricsScope,
} from "@/lib/services/metrics";
import { ProfileSummary } from "@/components/ProfileSummary";
import { DailyTrendChart } from "@/components/charts/DailyTrendChart";
import { ToolBreakdownChart } from "@/components/charts/ToolBreakdownChart";
import { ModelBreakdownChart } from "@/components/charts/ModelBreakdownChart";
import { DateRangePicker } from "@/components/DateRangePicker";

interface SearchParams {
  preset?: string;
  from?: string;
  to?: string;
}

export default async function UserProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const viewer = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!viewer) redirect("/login");

  const { id } = await params;
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, avatarUrl: true },
  });
  if (!target) notFound();

  const sp = await searchParams;
  const range = parseRange(sp);
  const scope: MetricsScope = { type: "user", userId: target.id };

  let data;
  try {
    data = await Promise.all([
      dailyTotals(prisma, viewer, range, { scope }),
      toolBreakdown(prisma, viewer, range, { scope }),
      modelBreakdown(prisma, viewer, range, { scope }),
      profileActivity(prisma, viewer, { scope }),
    ]);
  } catch (e) {
    if (e instanceof MetricsAuthError) {
      return (
        <div className="py-16 text-center text-muted-foreground">
          无权查看该用户的数据（需与对方同属一个团队）
        </div>
      );
    }
    throw e;
  }
  const [trend, tools, models, activity] = data;

  return (
    <div className="space-y-6">
      <ProfileSummary name={target.name} avatarUrl={target.avatarUrl} activity={activity} />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{target.name} 的用量</h1>
        <DateRangePicker />
      </div>

      <Card>
        <CardHeader><CardTitle>每日 Token 趋势</CardTitle></CardHeader>
        <CardContent>
          <DailyTrendChart
            data={trend.map((p) => ({
              date: p.date,
              input: Number(p.inputTokens),
              output: Number(p.outputTokens),
              cache: Number(p.cacheTokens),
              total: Number(p.total),
            }))}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>按工具</CardTitle></CardHeader>
          <CardContent>
            <ToolBreakdownChart
              data={tools.map((t) => ({
                tool: t.tool,
                input: Number(t.inputTokens),
                output: Number(t.outputTokens),
                cache: Number(t.cacheTokens),
                total: Number(t.total),
              }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>按模型</CardTitle></CardHeader>
          <CardContent>
            <ModelBreakdownChart
              data={models.map((m) => ({
                model: m.model,
                input: Number(m.inputTokens),
                output: Number(m.outputTokens),
                cache: Number(m.cacheTokens),
                total: Number(m.total),
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
