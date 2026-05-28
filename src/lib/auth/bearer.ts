import type { PrismaClient, User } from "@prisma/client";
import { hashToken } from "@/lib/auth/token";

export async function resolveBearerUser(
  prisma: PrismaClient,
  authHeader: string | null,
): Promise<User | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const raw = authHeader.slice("Bearer ".length).trim();
  if (!raw) return null;

  const token = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (!token || token.revokedAt) return null;
  if (token.user.status !== "approved") return null;

  await prisma.authToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  });
  return token.user;
}
