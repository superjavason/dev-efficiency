import type { PrismaClient, User, UserStatus } from "@prisma/client";

export class UsersAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsersAuthError";
  }
}

export type UserSummary = Omit<User, "passwordHash">;

const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  avatarUrl: true,
  githubId: true,
  createdAt: true,
} as const;

export async function listUsers(
  prisma: PrismaClient,
  viewer: User,
  opts: { status?: UserStatus } = {},
): Promise<UserSummary[]> {
  if (viewer.role !== "admin") {
    throw new UsersAuthError("forbidden");
  }
  return prisma.user.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: "desc" },
    select: SAFE_SELECT,
  });
}

export async function updateUserStatus(
  prisma: PrismaClient,
  viewer: User,
  userId: string,
  status: UserStatus,
): Promise<UserSummary> {
  if (viewer.role !== "admin") {
    throw new UsersAuthError("forbidden");
  }
  if (viewer.id === userId && status !== "approved") {
    throw new UsersAuthError("admin cannot disable themselves");
  }
  return prisma.user.update({
    where: { id: userId },
    data: { status },
    select: SAFE_SELECT,
  });
}
