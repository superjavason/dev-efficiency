import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true, role: true, status: true, avatarUrl: true },
  });
  if (!user || user.status !== "approved") {
    await session.destroy();
    redirect("/login");
  }
  return <AppShell user={user}>{children}</AppShell>;
}
