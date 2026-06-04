import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  createTokenFor,
  listTokensFor,
  revokeToken,
  TokenAuthError,
} from "@/lib/services/tokens";
import { resolveBearerUser } from "@/lib/auth/bearer";

async function makeUser(opts: { role?: "admin" | "member"; email?: string } = {}) {
  return prisma.user.create({
    data: {
      email: opts.email ?? `${Math.random().toString(36).slice(2)}@x.com`,
      name: "U",
      passwordHash: "x",
      status: "approved",
      role: opts.role ?? "member",
    },
  });
}

describe("tokens service", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("self can create a token for themselves and use it", async () => {
    const me = await makeUser();
    const { token, record } = await createTokenFor(prisma, me, me.id, "laptop");
    expect(token).toMatch(/^de_/);
    expect(record.name).toBe("laptop");
    const u = await resolveBearerUser(prisma, `Bearer ${token}`);
    expect(u?.id).toBe(me.id);
  });

  it("member cannot create a token for another user", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await expect(createTokenFor(prisma, me, other.id, "x")).rejects.toBeInstanceOf(TokenAuthError);
  });

  it("admin can create a token for another user", async () => {
    const admin = await makeUser({ role: "admin" });
    const other = await makeUser();
    const { token } = await createTokenFor(prisma, admin, other.id, "issued-by-admin");
    const u = await resolveBearerUser(prisma, `Bearer ${token}`);
    expect(u?.id).toBe(other.id);
  });

  it("self can list and revoke own tokens; revoked token no longer authenticates", async () => {
    const me = await makeUser();
    const { token, record } = await createTokenFor(prisma, me, me.id, "n");
    const list = await listTokensFor(prisma, me, me.id);
    expect(list).toHaveLength(1);
    await revokeToken(prisma, me, record.id);
    expect(await resolveBearerUser(prisma, `Bearer ${token}`)).toBeNull();
  });

  it("member cannot revoke another user's token; admin can", async () => {
    const owner = await makeUser();
    const { record } = await createTokenFor(prisma, owner, owner.id, "n");
    const other = await makeUser();
    await expect(revokeToken(prisma, other, record.id)).rejects.toBeInstanceOf(TokenAuthError);
    const admin = await makeUser({ role: "admin" });
    await revokeToken(prisma, admin, record.id);
    const stored = await prisma.authToken.findUnique({ where: { id: record.id } });
    expect(stored?.revokedAt).not.toBeNull();
  });

  it("listTokensFor refuses cross-user listing by non-admin", async () => {
    const me = await makeUser();
    const other = await makeUser();
    await expect(listTokensFor(prisma, me, other.id)).rejects.toBeInstanceOf(TokenAuthError);
  });

  it("listed token records do not include the raw token", async () => {
    const me = await makeUser();
    await createTokenFor(prisma, me, me.id, "n");
    const list = await listTokensFor(prisma, me, me.id);
    const keys = Object.keys(list[0]);
    expect(keys).not.toContain("tokenHash");
  });
});
