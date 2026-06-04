import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { listAllTeams } from "@/lib/services/teams";

export default async function AdminTeamsPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.role !== "admin") redirect("/dashboard");

  const teams = await listAllTeams(prisma, user);

  // Bulk-fetch creator names for display (TeamSummary doesn't include createdBy).
  const detail = await prisma.team.findMany({
    where: { id: { in: teams.map((t) => t.id) } },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  });
  const creatorByTeam = new Map(detail.map((t) => [t.id, t.createdBy]));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">平台团队</h1>
      <Card>
        <CardHeader><CardTitle>全部团队（{teams.length}）</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>slug</TableHead>
                <TableHead>创建者</TableHead>
                <TableHead>成员数</TableHead>
                <TableHead>创建于</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((t) => {
                const creator = creatorByTeam.get(t.id);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">/{t.slug}</TableCell>
                    <TableCell className="text-sm">
                      {creator ? (
                        <>
                          <div>{creator.name}</div>
                          <div className="text-xs text-muted-foreground">{creator.email}</div>
                        </>
                      ) : "—"}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{t.memberCount}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.createdAt.toISOString().slice(0, 10)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/teams/${t.slug}/settings`}>
                        <Button size="sm" variant="outline">管理</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
              {teams.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    平台暂无团队
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
