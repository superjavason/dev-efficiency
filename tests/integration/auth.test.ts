import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { registerUser, authenticate, AuthError } from "@/lib/services/auth";
import { resolveBearerUser } from "@/lib/auth/bearer";

describe("auth service", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("registers an approved user and issues a usable token", async () => {
    const res = await registerUser(prisma, {
      email: "dev@x.com",
      name: "Dev",
      password: "password123",
    });
    expect(res.user.status).toBe("approved");
    expect(res.token).toMatch(/^de_/);

    const u = await resolveBearerUser(prisma, `Bearer ${res.token}`);
    expect(u?.id).toBe(res.user.id);
  });

  it("rejects duplicate email", async () => {
    await registerUser(prisma, { email: "dev@x.com", name: "Dev", password: "password123" });
    await expect(
      registerUser(prisma, { email: "dev@x.com", name: "Dev2", password: "password123" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("authenticate returns user on correct credentials, null otherwise", async () => {
    await registerUser(prisma, { email: "dev@x.com", name: "Dev", password: "password123" });
    const ok = await authenticate(prisma, "dev@x.com", "password123");
    expect(ok?.email).toBe("dev@x.com");
    expect(await authenticate(prisma, "dev@x.com", "wrong")).toBeNull();
    expect(await authenticate(prisma, "nobody@x.com", "password123")).toBeNull();
  });

  it("authenticate refuses login when passwordHash is empty (OAuth-only account)", async () => {
    await prisma.user.create({
      data: { email: "g@x.com", name: "G", passwordHash: "", status: "approved" },
    });
    expect(await authenticate(prisma, "g@x.com", "anything")).toBeNull();
  });
});
