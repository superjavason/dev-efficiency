"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { createTokenFor, revokeToken } from "@/lib/services/tokens";

async function viewer() {
  const session = await getSession();
  if (!session.userId) throw new Error("unauthenticated");
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) throw new Error("unauthenticated");
  return user;
}

export interface CreateTokenResult {
  ok: boolean;
  token?: string;
  error?: string;
}

export async function createTokenAction(targetUserId: string, name: string): Promise<CreateTokenResult> {
  try {
    const v = await viewer();
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
    const v = await viewer();
    await revokeToken(prisma, v, tokenId);
    revalidatePath("/dashboard");
    revalidatePath(`/admin/users`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}
