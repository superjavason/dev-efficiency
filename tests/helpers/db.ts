import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function resetDb() {
  await prisma.usageRecord.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.inviteCode.deleteMany();
  await prisma.user.deleteMany();
}
