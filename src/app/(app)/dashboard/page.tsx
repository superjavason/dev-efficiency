import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { parseRange } from "@/lib/range";
import { dailyTotals, toolBreakdown, modelBreakdown } from "@/lib/services/metrics";
import { listTokensFor } from "@/lib/services/tokens";
import { DailyTrendChart } from "@/components/charts/DailyTrendChart";
import { ToolBreakdownChart } from "@/components/charts/ToolBreakdownChart";
import { ModelBreakdownChart } from "@/components/charts/ModelBreakdownChart";
import { DateRangePicker } from "@/components/DateRangePicker";
import { TokenList } from "@/components/TokenList";
import { TokenCreateDialog } from "@/components/TokenCreateDialog";

interface SearchParams {
  preset?: string;
  from?: string;
  to?: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) redirect("/login");

  const sp = await searchParams;
  const range = parseRange(sp);

  const [trend, tools, models, tokens] = await Promise.all([
    dailyTotals(prisma, user, range, { scope: { type: "self" } }),
    toolBreakdown(prisma, user, range, { scope: { type: "self" } }),
    modelBreakdown(prisma, user, range, { scope: { type: "self" } }),
    listTokensFor(prisma, user, user.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">个人仪表盘</h1>
        <DateRangePicker />
      </div>

      <Card>
        <CardHeader><CardTitle>每日 Token 趋势</CardTitle></CardHeader>
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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>我的 Auth Tokens</CardTitle>
          <TokenCreateDialog targetUserId={user.id} />
        </CardHeader>
        <CardContent>
          <TokenList
            tokens={tokens.map((t) => ({
              id: t.id,
              name: t.name,
              createdAt: t.createdAt.toISOString(),
              lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
              revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
