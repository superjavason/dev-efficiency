import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

/**
 * Resolve the current user from session and require they be approved.
 * Throws "unauthenticated" if no session, the user no longer exists,
 * or the user has been disabled. Use this in every server action.
 */
export async function requireApprovedUser() {
  const session = await getSession();
  if (!session.userId) throw new Error("unauthenticated");
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.status !== "approved") throw new Error("unauthenticated");
  return user;
}
