"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireApprovedUser } from "@/lib/auth/current-user";
import { updateUserStatus } from "@/lib/services/users";

export async function setUserStatusAction(
  userId: string,
  status: "approved" | "disabled",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const v = await requireApprovedUser();
    await updateUserStatus(prisma, v, userId, status);
    revalidatePath("/admin/users");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "failed" };
  }
}
