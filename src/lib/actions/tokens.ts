"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireApprovedUser } from "@/lib/auth/current-user";
import { createTokenFor, revokeToken } from "@/lib/services/tokens";

export interface CreateTokenResult {
  ok: boolean;
  token?: string;
  error?: string;
}

export async function createTokenAction(targetUserId: string, name: string): Promise<CreateTokenResult> {
  try {
    const v = await requireApprovedUser();
    const trimmed = name.trim() || "default";
    const { token } = await createTokenFor(prisma, v, targetUserId, trimmed);
    revalidatePath("/dashboard");
    revalidatePath(`/admin/users`);
    return { ok: true, token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}

export async function revokeTokenAction(tokenId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await requireApprovedUser();
    await revokeToken(prisma, v, tokenId);
    revalidatePath("/dashboard");
    revalidatePath(`/admin/users`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}
