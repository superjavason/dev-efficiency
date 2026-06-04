import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { linkOrCreateGithubUser, type GithubProfile } from "@/lib/auth/github";

function profile(over: Partial<GithubProfile> = {}): GithubProfile {
  return { id: 12345, login: "octocat", name: "The Octocat", avatar_url: "x", ...over };
}

describe("linkOrCreateGithubUser", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates a new approved user when no match", async () => {
    const u = await linkOrCreateGithubUser(prisma, {
      profile: profile(),
      primaryEmail: "octocat@example.com",
    });
    expect(u.status).toBe("approved");
    expect(u.role).toBe("member");
    expect(u.githubId).toBe("12345");
    expect(u.avatarUrl).toBe("https://avatars.githubusercontent.com/u/12345?v=4");
    expect(u.passwordHash).toBe("");
    expect(u.name).toBe("The Octocat");
  });

  it("falls back to login when GitHub name is null", async () => {
    const u = await linkOrCreateGithubUser(prisma, {
      profile: profile({ name: null }),
      primaryEmail: "octocat@example.com",
    });
    expect(u.name).toBe("octocat");
  });

  it("links by email when an existing password user matches", async () => {
    const existing = await prisma.user.create({
      data: { email: "dev@x.com", name: "Dev", passwordHash: "hash", status: "approved" },
    });
    const u = await linkOrCreateGithubUser(prisma, {
      profile: profile({ id: 555 }),
      primaryEmail: "dev@x.com",
    });
    expect(u.id).toBe(existing.id);
    expect(u.githubId).toBe("555");
    expect(u.avatarUrl).toBe("https://avatars.githubusercontent.com/u/555?v=4");
    expect(u.passwordHash).toBe("hash");
  });

  it("matches by githubId and refreshes avatar + name", async () => {
    await prisma.user.create({
      data: {
        email: "dev@x.com",
        name: "Old Name",
        passwordHash: "hash",
        status: "approved",
        githubId: "12345",
        avatarUrl: "https://avatars.githubusercontent.com/u/12345?v=2",
      },
    });
    const u = await linkOrCreateGithubUser(prisma, {
      profile: profile({ name: "New Name" }),
      primaryEmail: "ignored@example.com",
    });
    expect(u.email).toBe("dev@x.com");
    expect(u.name).toBe("New Name");
    expect(u.avatarUrl).toBe("https://avatars.githubusercontent.com/u/12345?v=4");
  });
});
