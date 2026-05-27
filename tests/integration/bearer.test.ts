import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { resolveBearerUser } from "@/lib/auth/bearer";
import { generateToken, hashToken } from "@/lib/auth/token";

async function makeUserWithToken(opts?: { revoked?: boolean }) {
  const user = await prisma.user.create({
    data: { email: "u@x.com", name: "U", passwordHash: "x", status: "approved" },
  });
  const raw = generateToken();
  await prisma.authToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      name: "laptop",
      revokedAt: opts?.revoked ? new Date() : null,
    },
  });
  return { user, raw };
}

describe("resolveBearerUser", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("resolves user from a valid bearer header", async () => {
    const { user, raw } = await makeUserWithToken();
    const got = await resolveBearerUser(prisma, `Bearer ${raw}`);
    expect(got?.id).toBe(user.id);
  });

  it("updates lastUsedAt on success", async () => {
    const { raw } = await makeUserWithToken();
    await resolveBearerUser(prisma, `Bearer ${raw}`);
    const tok = await prisma.authToken.findFirst();
    expect(tok?.lastUsedAt).not.toBeNull();
  });

  it("returns null for missing/invalid header", async () => {
    expect(await resolveBearerUser(prisma, null)).toBeNull();
    expect(await resolveBearerUser(prisma, "Basic abc")).toBeNull();
    expect(await resolveBearerUser(prisma, "Bearer de_nope")).toBeNull();
  });

  it("returns null for revoked token", async () => {
    const { raw } = await makeUserWithToken({ revoked: true });
    expect(await resolveBearerUser(prisma, `Bearer ${raw}`)).toBeNull();
  });

  it("returns null when user is not approved", async () => {
    const { user, raw } = await makeUserWithToken();
    await prisma.user.update({ where: { id: user.id }, data: { status: "disabled" } });
    expect(await resolveBearerUser(prisma, `Bearer ${raw}`)).toBeNull();
  });
});
