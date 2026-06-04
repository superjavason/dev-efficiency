import { Prisma, type PrismaClient, type User } from "@prisma/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateToken, hashToken } from "@/lib/auth/token";
import type { RegisterInput } from "@/lib/validation/auth";

export class AuthError extends Error {
  constructor(
    message: string,
    public code: "DUPLICATE_EMAIL",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RegisterResult {
  user: User;
  token: string;
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

  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        status: "approved",
      },
    });
    const token = await issueTokenFor(tx, user.id);
    return { user, token };
  });
}

export async function authenticate(
  prisma: PrismaClient,
  email: string,
  password: string,
): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  if (!user.passwordHash) return null;
  if (!(await verifyPassword(user.passwordHash, password))) return null;
  return user;
}
