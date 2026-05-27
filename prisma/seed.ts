import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Admin";
  if (!email || !password) {
    console.log("ADMIN_EMAIL/ADMIN_PASSWORD 未设置，跳过 admin seed");
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`admin ${email} 已存在，跳过`);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hash(password),
      role: "admin",
      status: "approved",
    },
  });
  console.log(`已创建 admin: ${email}`);
}

main().finally(() => prisma.$disconnect());
