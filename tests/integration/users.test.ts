import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { listUsers, updateUserStatus, UsersAuthError } from "@/lib/services/users";

async function makeUser(opts: { role?: "admin" | "member"; status?: "approved" | "disabled"; email?: string } = {}) {
  return prisma.user.create({
    data: {
      email: opts.email ?? `${Math.random().toString(36).slice(2)}@x.com`,
      name: "U",
      passwordHash: "x",
      role: opts.role ?? "member",
      status: opts.status ?? "approved",
    },
  });
}

describe("users service", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("listUsers returns all users for admin", async () => {
    const admin = await makeUser({ role: "admin" });
    await makeUser();
    await makeUser();
    const list = await listUsers(prisma, admin, {});
    expect(list).toHaveLength(3);
  });

  it("listUsers forbidden for member", async () => {
    const me = await makeUser();
    await expect(listUsers(prisma, me, {})).rejects.toBeInstanceOf(UsersAuthError);
  });

  it("listUsers can filter by status", async () => {
    const admin = await makeUser({ role: "admin" });
    await makeUser({ status: "approved" });
    await makeUser({ status: "disabled" });
    const approved = await listUsers(prisma, admin, { status: "approved" });
    const disabled = await listUsers(prisma, admin, { status: "disabled" });
    expect(approved.filter((u) => u.id !== admin.id)).toHaveLength(1);
    expect(disabled).toHaveLength(1);
  });

  it("admin can disable another user", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser();
    const updated = await updateUserStatus(prisma, admin, target.id, "disabled");
    expect(updated.status).toBe("disabled");
  });

  it("member cannot change status", async () => {
    const me = await makeUser();
    const target = await makeUser();
    await expect(
      updateUserStatus(prisma, me, target.id, "disabled"),
    ).rejects.toBeInstanceOf(UsersAuthError);
  });

  it("admin cannot disable themselves", async () => {
    const admin = await makeUser({ role: "admin" });
    await expect(
      updateUserStatus(prisma, admin, admin.id, "disabled"),
    ).rejects.toBeInstanceOf(UsersAuthError);
  });
});
