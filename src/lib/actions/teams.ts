"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { TeamRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedUser } from "@/lib/auth/current-user";
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
    const v = await requireApprovedUser();
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
    const v = await requireApprovedUser();
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
    const v = await requireApprovedUser();
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
    const v = await requireApprovedUser();
    await changeRole(prisma, v, teamId, userId, role);
    revalidatePath(`/teams/${slug}/settings`);
    return { ok: true };
  } catch (e) {
    return bag(e);
  }
}

export async function deleteTeamAction(teamId: string, slug: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await requireApprovedUser();
    await deleteTeam(prisma, v, teamId);
    revalidatePath("/teams");
    revalidatePath(`/teams/${slug}`);
    revalidatePath(`/teams/${slug}/settings`);
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
    const v = await requireApprovedUser();
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
    const v = await requireApprovedUser();
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
    const v = await requireApprovedUser();
    const r = await acceptInvite(prisma, v, code);
    slug = r.slug;
    revalidatePath("/teams");
  } catch (e) {
    return bag(e);
  }
  redirect(`/teams/${slug}`);
}
