import { redirect } from "next/navigation";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { listUsers } from "@/lib/services/users";
import { UserRow, type AdminUserRowData } from "@/components/UserRow";

export default async function AdminUsersPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const viewer = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!viewer || viewer.role !== "admin") redirect("/dashboard");

  const users = await listUsers(prisma, viewer, {});

  const tokenAgg = await prisma.authToken.groupBy({
    by: ["userId"],
    _count: { _all: true },
  });
  const tokenCountByUser = new Map(tokenAgg.map((r) => [r.userId, r._count._all] as const));

  const activeTokens = await prisma.authToken.findMany({
    where: { revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true },
  });
  const activeTokenByUser = new Map<string, string>();
  for (const t of activeTokens) {
    if (!activeTokenByUser.has(t.userId)) activeTokenByUser.set(t.userId, t.id);
  }

  const rows: AdminUserRowData[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    avatarUrl: u.avatarUrl,
    tokenCount: tokenCountByUser.get(u.id) ?? 0,
    activeTokenId: activeTokenByUser.get(u.id) ?? null,
    isSelf: u.id === viewer.id,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">用户管理</h1>
      <Card>
        <CardHeader><CardTitle>全部用户（{rows.length}）</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>Token 数</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => <UserRow key={r.id} data={r} />)}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
