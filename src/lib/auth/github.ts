import { GitHub } from "arctic";
import type { PrismaClient, User } from "@prisma/client";

export interface GithubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export function buildGithubClient() {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return new GitHub(clientId, clientSecret, redirectUri);
}

export interface GithubFetcher {
  fetchProfile(accessToken: string): Promise<GithubProfile>;
  fetchPrimaryEmail(accessToken: string): Promise<string>;
}

export const liveGithubFetcher: GithubFetcher = {
  async fetchProfile(token) {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) throw new Error(`github /user failed: ${res.status}`);
    return res.json();
  },
  async fetchPrimaryEmail(token) {
    const res = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) throw new Error(`github /user/emails failed: ${res.status}`);
    const emails: GithubEmail[] = await res.json();
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (!primary) throw new Error("no verified email from GitHub");
    return primary.email;
  },
};

export interface LinkOrCreateInput {
  profile: GithubProfile;
  primaryEmail: string;
}

/**
 * 按 githubId → email → 创建 的优先级落地用户。返回该用户。
 */
export async function linkOrCreateGithubUser(
  prisma: PrismaClient,
  input: LinkOrCreateInput,
): Promise<User> {
  const avatarUrl = `https://avatars.githubusercontent.com/u/${input.profile.id}?v=4`;
  const displayName = input.profile.name?.trim() || input.profile.login;
  const githubId = String(input.profile.id);

  const byGithub = await prisma.user.findUnique({ where: { githubId } });
  if (byGithub) {
    return prisma.user.update({
      where: { id: byGithub.id },
      data: { avatarUrl, name: displayName },
    });
  }

  const byEmail = await prisma.user.findUnique({ where: { email: input.primaryEmail } });
  if (byEmail) {
    return prisma.user.update({
      where: { id: byEmail.id },
      data: { githubId, avatarUrl },
    });
  }

  return prisma.user.create({
    data: {
      email: input.primaryEmail,
      name: displayName,
      passwordHash: "",
      status: "approved",
      role: "member",
      githubId,
      avatarUrl,
    },
  });
}
