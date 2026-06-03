import type { AuthToken, PrismaClient, User } from "@prisma/client";
import { generateToken, hashToken } from "@/lib/auth/token";

export class TokenAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenAuthError";
  }
}

export type TokenSummary = Omit<AuthToken, "tokenHash">;

const SAFE_SELECT = {
  id: true,
  userId: true,
  name: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

function canActOn(viewer: User, targetUserId: string): boolean {
  return viewer.role === "admin" || viewer.id === targetUserId;
}

export async function listTokensFor(
  prisma: PrismaClient,
  viewer: User,
  userId: string,
): Promise<TokenSummary[]> {
  if (!canActOn(viewer, userId)) {
    throw new TokenAuthError("forbidden");
  }
  return prisma.authToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: SAFE_SELECT,
  });
}

export interface CreatedToken {
  token: string;
  record: TokenSummary;
}

export async function createTokenFor(
  prisma: PrismaClient,
  viewer: User,
  userId: string,
  name: string,
): Promise<CreatedToken> {
  if (!canActOn(viewer, userId)) {
    throw new TokenAuthError("forbidden");
  }
  const raw = generateToken();
  const record = await prisma.authToken.create({
    data: { userId, tokenHash: hashToken(raw), name },
    select: SAFE_SELECT,
  });
  return { token: raw, record };
}

export async function revokeToken(
  prisma: PrismaClient,
  viewer: User,
  tokenId: string,
): Promise<void> {
  const tok = await prisma.authToken.findUnique({ where: { id: tokenId } });
  if (!tok) throw new TokenAuthError("not found");
  if (!canActOn(viewer, tok.userId)) {
    throw new TokenAuthError("forbidden");
  }
  if (tok.revokedAt) return;
  await prisma.authToken.update({
    where: { id: tokenId },
    data: { revokedAt: new Date() },
  });
}
