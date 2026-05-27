import { Prisma, type PrismaClient, type User } from "@prisma/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateToken, hashToken } from "@/lib/auth/token";
import type { RegisterInput } from "@/lib/validation/auth";

export class AuthError extends Error {
  constructor(
    message: string,
    public code: "DUPLICATE_EMAIL" | "BAD_INVITE" | "NOT_FOUND",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RegisterResult {
  user: User;
  token: string | null;
}

async function issueTokenFor(
  client: Prisma.TransactionClient,
  userId: string,
  name = "default",
): Promise<string> {
  const raw = generateToken();
  await client.authToken.create({
    data: { userId, tokenHash: hashToken(raw), name },
  });
  return raw;
}

export async function registerUser(
  prisma: PrismaClient,
  input: RegisterInput,
): Promise<RegisterResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AuthError("email already registered", "DUPLICATE_EMAIL");

  let approveImmediately = false;
  let inviteId: string | null = null;

  if (input.inviteCode) {
    const code = await prisma.inviteCode.findUnique({ where: { code: input.inviteCode } });
    const valid =
      code &&
      !code.usedById &&
      (!code.expiresAt || code.expiresAt > new Date());
    if (!valid) throw new AuthError("invalid or used invite code", "BAD_INVITE");
    approveImmediately = true;
    inviteId = code!.id;
  }

  // Hash before opening the transaction so argon2 doesn't hold the tx open.
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        status: approveImmediately ? "approved" : "pending",
      },
    });

    let token: string | null = null;
    if (approveImmediately) {
      await tx.inviteCode.update({
        where: { id: inviteId! },
        data: { usedById: user.id },
      });
      token = await issueTokenFor(tx, user.id);
    }

    return { user, token };
  });
}

export async function approveUser(
  prisma: PrismaClient,
  userId: string,
): Promise<{ user: User; token: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError("user not found", "NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { status: "approved" },
    });
    const token = await issueTokenFor(tx, userId);
    return { user: updated, token };
  });
}

export async function authenticate(
  prisma: PrismaClient,
  email: string,
  password: string,
): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  if (!(await verifyPassword(user.passwordHash, password))) return null;
  return user;
}
