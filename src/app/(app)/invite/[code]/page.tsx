import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { InviteAcceptCard } from "@/components/InviteAcceptCard";

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await getSession();
  if (!session.userId) {
    redirect(`/login?returnTo=${encodeURIComponent(`/invite/${code}`)}`);
  }
  const viewer = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!viewer || viewer.status !== "approved") {
    redirect(`/login?returnTo=${encodeURIComponent(`/invite/${code}`)}`);
  }

  const invite = await prisma.teamInvite.findUnique({
    where: { code },
    include: { team: { include: { _count: { select: { members: true } } } } },
  });

  if (!invite || invite.revokedAt) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold">邀请链接无效</h1>
        <p className="text-sm text-muted-foreground">
          该邀请链接已被吊销或不存在。请向团队 owner 索取新链接。
        </p>
      </div>
    );
  }

  const alreadyMember = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: invite.teamId, userId: session.userId } },
  });

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <InviteAcceptCard
        teamName={invite.team.name}
        memberCount={invite.team._count.members}
        code={invite.code}
        alreadyMember={!!alreadyMember}
      />
    </div>
  );
}
