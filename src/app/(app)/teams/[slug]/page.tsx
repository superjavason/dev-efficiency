import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { parseRange } from "@/lib/range";
import {
  dailyTotals, userRanking, toolBreakdown, modelBreakdown,
} from "@/lib/services/metrics";
import { getTeam, TeamsAuthError } from "@/lib/services/teams";
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

export default async function TeamDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "approved") redirect("/login");

  let team;
  try {
    team = await getTeam(prisma, user, slug);
  } catch (e) {
    if (e instanceof TeamsAuthError) notFound();
    throw e;
  }

  const sp = await searchParams;
  const range = parseRange(sp);
  const scope = { type: "team" as const, teamId: team.id };

  const [trend, ranking, tools, models] = await Promise.all([
    dailyTotals(prisma, user, range, { scope }),
    userRanking(prisma, user, range, { scope }),
    toolBreakdown(prisma, user, range, { scope }),
    modelBreakdown(prisma, user, range, { scope }),
  ]);

  const canManage = team.viewerRole === "owner" || user.role === "admin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{team.name}</h1>
          <p className="text-sm text-muted-foreground">
            团队 · {team.memberCount} 人 · /{team.slug}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker />
          {canManage && (
            <Link href={`/teams/${team.slug}/settings`}>
              <Button variant="outline">设置</Button>
            </Link>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>团队每日 Token 趋势</CardTitle></CardHeader>
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

      <Card>
        <CardHeader><CardTitle>团队内排行</CardTitle></CardHeader>
        <CardContent>
          <UserRankingTable
            data={ranking.map((r) => ({
              userId: r.userId,
              name: r.name,
              email: r.email,
              avatarUrl: r.avatarUrl,
              input: Number(r.inputTokens),
              output: Number(r.outputTokens),
              cache: Number(r.cacheTokens),
              total: Number(r.total),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
