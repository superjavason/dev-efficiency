import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";

describe("db connectivity", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates and reads a user", async () => {
    const u = await prisma.user.create({
      data: { email: "a@b.com", name: "A", passwordHash: "x" },
    });
    const found = await prisma.user.findUnique({ where: { id: u.id } });
    expect(found?.email).toBe("a@b.com");
    expect(found?.status).toBe("pending");
    expect(found?.role).toBe("member");
  });
});
