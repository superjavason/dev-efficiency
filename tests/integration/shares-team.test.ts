import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { sharesTeam } from "@/lib/services/teams";

async function makeUser() {
  return prisma.user.create({
    data: {
      email: `${Math.random().toString(36).slice(2)}@x.com`,
      name: "U",
      passwordHash: "x",
      status: "approved",
      role: "member",
    },
  });
}

async function makeTeamWith(userIds: string[]) {
  const team = await prisma.team.create({
    data: {
      name: "T",
      slug: `t-${Math.random().toString(36).slice(2, 8)}`,
      createdById: userIds[0],
    },
  });
  for (let i = 0; i < userIds.length; i++) {
    await prisma.teamMember.create({
      data: { teamId: team.id, userId: userIds[i], role: i === 0 ? "owner" : "member" },
    });
  }
  return team;
}

describe("sharesTeam", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("true when both users are members of the same team", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeTeamWith([a.id, b.id]);
    expect(await sharesTeam(prisma, a.id, b.id)).toBe(true);
    expect(await sharesTeam(prisma, b.id, a.id)).toBe(true);
  });

  it("false when users are in different teams", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeTeamWith([a.id]);
    await makeTeamWith([b.id]);
    expect(await sharesTeam(prisma, a.id, b.id)).toBe(false);
  });

  it("false when one user has no team at all", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeTeamWith([a.id]);
    expect(await sharesTeam(prisma, a.id, b.id)).toBe(false);
  });

  it("true for a user checked against themselves when they belong to a team", async () => {
    const a = await makeUser();
    await makeTeamWith([a.id]);
    expect(await sharesTeam(prisma, a.id, a.id)).toBe(true);
  });
});
