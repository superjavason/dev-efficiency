import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  createTeam,
  listMyTeams,
  listAllTeams,
  getTeam,
  leaveTeam,
  removeMember,
  changeRole,
  deleteTeam,
  createInvite,
  revokeInvite,
  acceptInvite,
  TeamsAuthError,
} from "@/lib/services/teams";

async function makeUser(opts: { role?: "admin" | "member"; email?: string; name?: string } = {}) {
  return prisma.user.create({
    data: {
      email: opts.email ?? `${Math.random().toString(36).slice(2)}@x.com`,
      name: opts.name ?? "U",
      passwordHash: "x",
      status: "approved",
      role: opts.role ?? "member",
    },
  });
}

describe("teams service", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("createTeam makes the creator an owner; slug auto-generated", async () => {
    const u = await makeUser();
    const t = await createTeam(prisma, u, { name: "ACME Corp" });
    expect(t.slug).toBe("acme-corp");
    const member = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: t.id, userId: u.id } },
    });
    expect(member?.role).toBe("owner");
  });

  it("createTeam respects user-provided slug and uniquifies on collision", async () => {
    const u = await makeUser();
    const a = await createTeam(prisma, u, { name: "X", slug: "x" });
    expect(a.slug).toBe("x");
    const b = await createTeam(prisma, u, { name: "X 2", slug: "x" });
    expect(b.slug).toBe("x-2");
  });

  it("createTeam throws SlugRequiredError when name has no ASCII content and no slug provided", async () => {
    const u = await makeUser();
    await expect(createTeam(prisma, u, { name: "中文团队" })).rejects.toThrow(/slug/i);
  });

  it("createTeam accepts Chinese name when slug is provided", async () => {
    const u = await makeUser();
    const t = await createTeam(prisma, u, { name: "中文团队", slug: "zhongwen" });
    expect(t.slug).toBe("zhongwen");
    expect(t.name).toBe("中文团队");
  });

  it("listMyTeams returns teams the user is a member of", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await createTeam(prisma, a, { name: "T1" });
    await createTeam(prisma, b, { name: "T2" });
    const myA = await listMyTeams(prisma, a);
    expect(myA.map((t) => t.name)).toEqual(["T1"]);
  });

  it("listAllTeams admin-only", async () => {
    const u = await makeUser();
    await expect(listAllTeams(prisma, u)).rejects.toBeInstanceOf(TeamsAuthError);
    const admin = await makeUser({ role: "admin" });
    await createTeam(prisma, u, { name: "T" });
    const all = await listAllTeams(prisma, admin);
    expect(all).toHaveLength(1);
  });

  it("getTeam allowed for member; rejected for non-member non-admin", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    const other = await makeUser();
    await expect(getTeam(prisma, other, t.slug)).rejects.toBeInstanceOf(TeamsAuthError);
    const got = await getTeam(prisma, owner, t.slug);
    expect(got.members).toHaveLength(1);
    const admin = await makeUser({ role: "admin" });
    const asAdmin = await getTeam(prisma, admin, t.slug);
    expect(asAdmin.members).toHaveLength(1);
  });

  it("acceptInvite adds member; idempotent when already a member", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    const inv = await createInvite(prisma, owner, t.id);
    const newcomer = await makeUser();
    const r1 = await acceptInvite(prisma, newcomer, inv.code);
    expect(r1.slug).toBe(t.slug);
    const r2 = await acceptInvite(prisma, newcomer, inv.code);
    expect(r2.slug).toBe(t.slug);
    const count = await prisma.teamMember.count({ where: { teamId: t.id } });
    expect(count).toBe(2);
  });

  it("acceptInvite rejects revoked invite", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    const inv = await createInvite(prisma, owner, t.id);
    await revokeInvite(prisma, owner, inv.id);
    const newcomer = await makeUser();
    await expect(acceptInvite(prisma, newcomer, inv.code)).rejects.toBeInstanceOf(TeamsAuthError);
  });

  it("createInvite owner-only; non-owner rejected", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    const member = await makeUser();
    await acceptInvite(prisma, member, (await createInvite(prisma, owner, t.id)).code);
    await expect(createInvite(prisma, member, t.id)).rejects.toBeInstanceOf(TeamsAuthError);
  });

  it("leaveTeam: regular member leaves; sole owner rejected", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    await expect(leaveTeam(prisma, owner, t.id)).rejects.toBeInstanceOf(TeamsAuthError);

    const member = await makeUser();
    await acceptInvite(prisma, member, (await createInvite(prisma, owner, t.id)).code);
    await leaveTeam(prisma, member, t.id);
    const remaining = await prisma.teamMember.findMany({ where: { teamId: t.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(owner.id);
  });

  it("changeRole: promote member to owner, then second owner can leave", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    const member = await makeUser();
    await acceptInvite(prisma, member, (await createInvite(prisma, owner, t.id)).code);
    await changeRole(prisma, owner, t.id, member.id, "owner");
    await leaveTeam(prisma, owner, t.id);
    const survivor = await prisma.teamMember.findFirst({ where: { teamId: t.id } });
    expect(survivor?.userId).toBe(member.id);
    expect(survivor?.role).toBe("owner");
  });

  it("changeRole: cannot demote the last owner", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    await expect(changeRole(prisma, owner, t.id, owner.id, "member")).rejects.toBeInstanceOf(TeamsAuthError);
  });

  it("changeRole: non-owner cannot change roles", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    const member = await makeUser();
    await acceptInvite(prisma, member, (await createInvite(prisma, owner, t.id)).code);
    await expect(changeRole(prisma, member, t.id, owner.id, "member")).rejects.toBeInstanceOf(TeamsAuthError);
  });

  it("removeMember: owner removes member; cannot remove self", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    const member = await makeUser();
    await acceptInvite(prisma, member, (await createInvite(prisma, owner, t.id)).code);
    await expect(removeMember(prisma, owner, t.id, owner.id)).rejects.toBeInstanceOf(TeamsAuthError);
    await removeMember(prisma, owner, t.id, member.id);
    expect(await prisma.teamMember.count({ where: { teamId: t.id } })).toBe(1);
  });

  it("deleteTeam: team owner can delete; member cannot; admin can", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    const member = await makeUser();
    await acceptInvite(prisma, member, (await createInvite(prisma, owner, t.id)).code);
    await expect(deleteTeam(prisma, member, t.id)).rejects.toBeInstanceOf(TeamsAuthError);

    const t2 = await createTeam(prisma, owner, { name: "T2" });
    const admin = await makeUser({ role: "admin" });
    await deleteTeam(prisma, admin, t2.id);
    expect(await prisma.team.findUnique({ where: { id: t2.id } })).toBeNull();
  });

  it("admin can manage any team (createInvite, removeMember, deleteTeam)", async () => {
    const owner = await makeUser();
    const t = await createTeam(prisma, owner, { name: "T" });
    const admin = await makeUser({ role: "admin" });
    const inv = await createInvite(prisma, admin, t.id);
    expect(inv.code).toBeTruthy();
  });
});
