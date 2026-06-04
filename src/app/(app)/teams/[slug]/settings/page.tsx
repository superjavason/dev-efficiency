import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { getTeam, TeamsAuthError } from "@/lib/services/teams";
import { TeamSettings } from "@/components/TeamSettings";

export default async function TeamSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
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

  const isAdmin = user.role === "admin";
  if (team.viewerRole !== "owner" && !isAdmin) {
    redirect(`/teams/${slug}`);
  }

  const invites = await prisma.teamInvite.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: "desc" },
  });

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const baseUrl = `${proto}://${host}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{team.name}</h1>
        <p className="text-sm text-muted-foreground">团队设置 · /{team.slug}</p>
      </div>
      <TeamSettings
        teamId={team.id}
        teamName={team.name}
        slug={team.slug}
        viewerUserId={user.id}
        viewerRole={team.viewerRole}
        viewerIsAdmin={isAdmin}
        members={team.members.map((m) => ({
          userId: m.userId,
          name: m.name,
          email: m.email,
          avatarUrl: m.avatarUrl,
          role: m.role,
        }))}
        invites={invites.map((i) => ({
          id: i.id,
          code: i.code,
          createdAt: i.createdAt.toISOString(),
          revokedAt: i.revokedAt ? i.revokedAt.toISOString() : null,
        }))}
        baseUrl={baseUrl}
      />
    </div>
  );
}
