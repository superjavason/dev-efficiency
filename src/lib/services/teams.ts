import type { PrismaClient, Team, TeamRole, User } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { isValidSlug, slugify, ensureUniqueSlug } from "@/lib/slug";

export class TeamsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamsAuthError";
  }
}

export interface TeamSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  memberCount: number;
}

export interface TeamMemberRow {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: TeamRole;
  joinedAt: Date;
}

export interface TeamDetail extends TeamSummary {
  members: TeamMemberRow[];
  viewerRole: TeamRole | null;
}

export interface TeamInviteDTO {
  id: string;
  teamId: string;
  code: string;
  createdAt: Date;
  revokedAt: Date | null;
}

function isPlatformAdmin(viewer: User): boolean {
  return viewer.role === "admin";
}

async function membershipOf(prisma: PrismaClient, teamId: string, userId: string) {
  return prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
}

async function assertOwner(prisma: PrismaClient, viewer: User, teamId: string): Promise<void> {
  if (isPlatformAdmin(viewer)) return;
  const m = await membershipOf(prisma, teamId, viewer.id);
  if (!m || m.role !== "owner") throw new TeamsAuthError("forbidden: not a team owner");
}

export async function listMyTeams(prisma: PrismaClient, viewer: User): Promise<TeamSummary[]> {
  const rows = await prisma.team.findMany({
    where: { members: { some: { userId: viewer.id } } },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    createdAt: t.createdAt,
    memberCount: t._count.members,
  }));
}

export async function listAllTeams(prisma: PrismaClient, viewer: User): Promise<TeamSummary[]> {
  if (!isPlatformAdmin(viewer)) throw new TeamsAuthError("forbidden: admin only");
  const rows = await prisma.team.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    createdAt: t.createdAt,
    memberCount: t._count.members,
  }));
}

export async function getTeam(
  prisma: PrismaClient,
  viewer: User,
  slug: string,
): Promise<TeamDetail> {
  const t = await prisma.team.findUnique({
    where: { slug },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
  });
  if (!t) throw new TeamsAuthError("team not found");

  const viewerMembership = t.members.find((m) => m.userId === viewer.id);
  if (!viewerMembership && !isPlatformAdmin(viewer)) {
    throw new TeamsAuthError("forbidden: not a team member");
  }

  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    createdAt: t.createdAt,
    memberCount: t.members.length,
    members: t.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
    viewerRole: viewerMembership ? viewerMembership.role : null,
  };
}

export async function createTeam(
  prisma: PrismaClient,
  viewer: User,
  input: { name: string; slug?: string },
): Promise<Team> {
  const name = input.name.trim();
  if (!name) throw new TeamsAuthError("name required");

  let baseSlug: string | null;
  if (input.slug) {
    if (!isValidSlug(input.slug)) {
      throw new TeamsAuthError("invalid slug format");
    }
    baseSlug = input.slug;
  } else {
    baseSlug = slugify(name);
    if (!baseSlug) {
      throw new TeamsAuthError("slug required for non-ASCII team name");
    }
  }
  const slug = await ensureUniqueSlug(prisma, baseSlug);

  return prisma.$transaction(async (tx) => {
    const team = await tx.team.create({
      data: { name, slug, createdById: viewer.id },
    });
    await tx.teamMember.create({
      data: { teamId: team.id, userId: viewer.id, role: "owner" },
    });
    return team;
  });
}

export async function leaveTeam(
  prisma: PrismaClient,
  viewer: User,
  teamId: string,
): Promise<void> {
  const m = await membershipOf(prisma, teamId, viewer.id);
  if (!m) throw new TeamsAuthError("not a team member");
  if (m.role === "owner") {
    const ownerCount = await prisma.teamMember.count({
      where: { teamId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new TeamsAuthError("cannot leave as the last owner; transfer ownership first");
    }
  }
  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId, userId: viewer.id } },
  });
}

export async function removeMember(
  prisma: PrismaClient,
  viewer: User,
  teamId: string,
  userId: string,
): Promise<void> {
  await assertOwner(prisma, viewer, teamId);
  if (viewer.id === userId) {
    throw new TeamsAuthError("use leaveTeam to remove yourself");
  }
  const m = await membershipOf(prisma, teamId, userId);
  if (!m) throw new TeamsAuthError("user not a member");
  if (m.role === "owner") {
    const ownerCount = await prisma.teamMember.count({
      where: { teamId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new TeamsAuthError("cannot remove the last owner");
    }
  }
  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId, userId } },
  });
}

export async function changeRole(
  prisma: PrismaClient,
  viewer: User,
  teamId: string,
  userId: string,
  role: TeamRole,
): Promise<void> {
  await assertOwner(prisma, viewer, teamId);
  const m = await membershipOf(prisma, teamId, userId);
  if (!m) throw new TeamsAuthError("user not a member");
  if (m.role === role) return;
  if (m.role === "owner" && role === "member") {
    const ownerCount = await prisma.teamMember.count({
      where: { teamId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new TeamsAuthError("cannot demote the last owner");
    }
  }
  await prisma.teamMember.update({
    where: { teamId_userId: { teamId, userId } },
    data: { role },
  });
}

export async function deleteTeam(
  prisma: PrismaClient,
  viewer: User,
  teamId: string,
): Promise<void> {
  await assertOwner(prisma, viewer, teamId);
  await prisma.team.delete({ where: { id: teamId } });
}

function generateInviteCode(): string {
  return randomBytes(24).toString("base64url");
}

export async function createInvite(
  prisma: PrismaClient,
  viewer: User,
  teamId: string,
): Promise<TeamInviteDTO> {
  await assertOwner(prisma, viewer, teamId);
  const inv = await prisma.teamInvite.create({
    data: { teamId, code: generateInviteCode(), createdById: viewer.id },
  });
  return {
    id: inv.id,
    teamId: inv.teamId,
    code: inv.code,
    createdAt: inv.createdAt,
    revokedAt: inv.revokedAt,
  };
}

export async function revokeInvite(
  prisma: PrismaClient,
  viewer: User,
  inviteId: string,
): Promise<void> {
  const inv = await prisma.teamInvite.findUnique({ where: { id: inviteId } });
  if (!inv) throw new TeamsAuthError("invite not found");
  await assertOwner(prisma, viewer, inv.teamId);
  if (inv.revokedAt) return;
  await prisma.teamInvite.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() },
  });
}

export async function acceptInvite(
  prisma: PrismaClient,
  viewer: User,
  code: string,
): Promise<{ teamId: string; slug: string }> {
  const inv = await prisma.teamInvite.findUnique({
    where: { code },
    include: { team: true },
  });
  if (!inv || inv.revokedAt) throw new TeamsAuthError("invite invalid or revoked");
  const existing = await membershipOf(prisma, inv.teamId, viewer.id);
  if (!existing) {
    await prisma.teamMember.create({
      data: { teamId: inv.teamId, userId: viewer.id, role: "member" },
    });
  }
  return { teamId: inv.teamId, slug: inv.team.slug };
}
