"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TeamRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import {
  createTeam,
  leaveTeam,
  removeMember,
  changeRole,
  deleteTeam,
  createInvite,
  revokeInvite,
  acceptInvite,
} from "@/lib/services/teams";

async function viewer() {
  const session = await getSession();
  if (!session.userId) throw new Error("unauthenticated");
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "approved") throw new Error("unauthenticated");
  return user;
}

function bag(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : "failed" };
}

export interface CreateTeamResult {
  ok: boolean;
  slug?: string;
  error?: string;
}

export async function createTeamAction(input: { name: string; slug?: string }): Promise<CreateTeamResult> {
  try {
    const v = await viewer();
    const t = await createTeam(prisma, v, input);
    revalidatePath("/teams");
    revalidatePath("/admin/teams");
    return { ok: true, slug: t.slug };
  } catch (e) {
    return bag(e);
  }
}

export async function leaveTeamAction(teamId: string, slug: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await viewer();
    await leaveTeam(prisma, v, teamId);
    revalidatePath("/teams");
    revalidatePath(`/teams/${slug}`);
    revalidatePath(`/teams/${slug}/settings`);
    revalidatePath("/admin/teams");
    return { ok: true };
  } catch (e) {
    return bag(e);
  }
}

export async function removeMemberAction(
  teamId: string,
  userId: string,
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await viewer();
    await removeMember(prisma, v, teamId, userId);
    revalidatePath(`/teams/${slug}`);
    revalidatePath(`/teams/${slug}/settings`);
    return { ok: true };
  } catch (e) {
    return bag(e);
  }
}

export async function changeRoleAction(
  teamId: string,
  userId: string,
  role: TeamRole,
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await viewer();
    await changeRole(prisma, v, teamId, userId, role);
    revalidatePath(`/teams/${slug}/settings`);
    return { ok: true };
  } catch (e) {
    return bag(e);
  }
}

export async function deleteTeamAction(teamId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await viewer();
    await deleteTeam(prisma, v, teamId);
    revalidatePath("/teams");
    revalidatePath("/admin/teams");
    return { ok: true };
  } catch (e) {
    return bag(e);
  }
}

export interface CreateInviteResult {
  ok: boolean;
  code?: string;
  error?: string;
}

export async function createInviteAction(teamId: string, slug: string): Promise<CreateInviteResult> {
  try {
    const v = await viewer();
    const inv = await createInvite(prisma, v, teamId);
    revalidatePath(`/teams/${slug}/settings`);
    return { ok: true, code: inv.code };
  } catch (e) {
    return bag(e);
  }
}

export async function revokeInviteAction(
  inviteId: string,
  slug: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await viewer();
    await revokeInvite(prisma, v, inviteId);
    revalidatePath(`/teams/${slug}/settings`);
    return { ok: true };
  } catch (e) {
    return bag(e);
  }
}

/**
 * Accept an invite and redirect to the team dashboard. Throws (NEXT_REDIRECT) on success.
 * On failure (revoked invite, unauthenticated, etc.) returns an error result so the page can render it.
 */
export async function acceptInviteAction(code: string): Promise<{ ok: false; error: string }> {
  let slug: string;
  try {
    const v = await viewer();
    const r = await acceptInvite(prisma, v, code);
    slug = r.slug;
    revalidatePath("/teams");
  } catch (e) {
    return bag(e);
  }
  redirect(`/teams/${slug}`);
}
