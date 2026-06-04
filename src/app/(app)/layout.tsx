import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/AppShell";
import { listMyTeams } from "@/lib/services/teams";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "approved") {
    await session.destroy();
    redirect("/login");
  }
  const myTeams = await listMyTeams(prisma, user);
  return (
    <AppShell
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
      }}
      myTeams={myTeams.map((t) => ({ name: t.name, slug: t.slug }))}
    >
      {children}
    </AppShell>
  );
}
