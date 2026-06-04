import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { listMyTeams } from "@/lib/services/teams";
import { TeamList } from "@/components/TeamList";

export default async function TeamsPage() {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "approved") redirect("/login");

  const teams = await listMyTeams(prisma, user);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">我的团队</h1>
        <Link href="/teams/new">
          <Button>创建团队</Button>
        </Link>
      </div>
      <TeamList
        teams={teams.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          memberCount: t.memberCount,
          createdAt: t.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
