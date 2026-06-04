"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";
import { updateUserStatus } from "@/lib/services/users";

async function viewer() {
  const session = await getSession();
  if (!session.userId) throw new Error("unauthenticated");
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) throw new Error("unauthenticated");
  return user;
}

export async function setUserStatusAction(
  userId: string,
  status: "approved" | "disabled",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await viewer();
    await updateUserStatus(prisma, v, userId, status);
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}
