import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { OAuth2RequestError } from "arctic";
import { prisma } from "@/lib/db";
import { buildGithubClient, linkOrCreateGithubUser, liveGithubFetcher, GithubOAuthUserError } from "@/lib/auth/github";
import { getSession } from "@/lib/auth/session";
import { safeReturnTo } from "@/lib/safe-return-to";

export async function GET(req: Request) {
  const gh = buildGithubClient();
  if (!gh) return NextResponse.json({ error: "github oauth not configured" }, { status: 503 });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const storedState = jar.get("gh_oauth_state")?.value;
  const returnTo = safeReturnTo(jar.get("gh_oauth_return")?.value);

  if (!code || !state || !storedState || state !== storedState) {
    return NextResponse.json({ error: "invalid oauth state" }, { status: 400 });
  }

  try {
    const tokens = await gh.validateAuthorizationCode(code);
    const accessToken = tokens.accessToken();
    const profile = await liveGithubFetcher.fetchProfile(accessToken);
    const primaryEmail = await liveGithubFetcher.fetchPrimaryEmail(accessToken);

    const user = await linkOrCreateGithubUser(prisma, { profile, primaryEmail });

    const session = await getSession();
    session.userId = user.id;
    session.role = user.role;
    await session.save();

    jar.delete("gh_oauth_state");
    jar.delete("gh_oauth_return");

    return NextResponse.redirect(new URL(returnTo, url).toString());
  } catch (e) {
    if (e instanceof GithubOAuthUserError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof OAuth2RequestError) {
      return NextResponse.json({ error: "oauth exchange failed" }, { status: 400 });
    }
    console.error("github oauth callback", e);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
