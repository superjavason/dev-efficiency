import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  registerUser,
  approveUser,
  authenticate,
  AuthError,
} from "@/lib/services/auth";
import { hashPassword } from "@/lib/auth/password";
import { resolveBearerUser } from "@/lib/auth/bearer";

async function makeAdmin() {
  return prisma.user.create({
    data: {
      email: "admin@x.com",
      name: "Admin",
      passwordHash: await hashPassword("admin-pass"),
      role: "admin",
      status: "approved",
    },
  });
}

describe("auth service", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("registers a pending user when no invite code", async () => {
    const res = await registerUser(prisma, {
      email: "dev@x.com",
      name: "Dev",
      password: "password123",
    });
    expect(res.user.status).toBe("pending");
    expect(res.token).toBeNull();
  });

  it("registers an approved user + token with a valid invite code", async () => {
    const admin = await makeAdmin();
    await prisma.inviteCode.create({
      data: { code: "INVITE1", createdById: admin.id },
    });
    const res = await registerUser(prisma, {
      email: "dev@x.com",
      name: "Dev",
      password: "password123",
      inviteCode: "INVITE1",
    });
    expect(res.user.status).toBe("approved");
    expect(res.token).toMatch(/^de_/);

    const code = await prisma.inviteCode.findUnique({ where: { code: "INVITE1" } });
    expect(code?.usedById).toBe(res.user.id);

    const u = await resolveBearerUser(prisma, `Bearer ${res.token}`);
    expect(u?.id).toBe(res.user.id);
  });

  it("rejects invalid or used invite code", async () => {
    await expect(
      registerUser(prisma, {
        email: "dev@x.com",
        name: "Dev",
        password: "password123",
        inviteCode: "NOPE",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects duplicate email", async () => {
    await registerUser(prisma, { email: "dev@x.com", name: "Dev", password: "password123" });
    await expect(
      registerUser(prisma, { email: "dev@x.com", name: "Dev2", password: "password123" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("approveUser flips status and issues a token", async () => {
    const reg = await registerUser(prisma, {
      email: "dev@x.com",
      name: "Dev",
      password: "password123",
    });
    const { token } = await approveUser(prisma, reg.user.id);
    expect(token).toMatch(/^de_/);
    const u = await prisma.user.findUnique({ where: { id: reg.user.id } });
    expect(u?.status).toBe("approved");
  });

  it("authenticate returns user on correct credentials, null otherwise", async () => {
    await registerUser(prisma, { email: "dev@x.com", name: "Dev", password: "password123" });
    const ok = await authenticate(prisma, "dev@x.com", "password123");
    expect(ok?.email).toBe("dev@x.com");
    expect(await authenticate(prisma, "dev@x.com", "wrong")).toBeNull();
    expect(await authenticate(prisma, "nobody@x.com", "password123")).toBeNull();
  });
});
