import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { generateState } from "arctic";
import { buildGithubClient } from "@/lib/auth/github";

export async function GET(req: Request) {
  const gh = buildGithubClient();
  if (!gh) return NextResponse.json({ error: "github oauth not configured" }, { status: 503 });

  const state = generateState();
  const url = gh.createAuthorizationURL(state, ["read:user", "user:email"]);

  const returnTo = new URL(req.url).searchParams.get("returnTo") ?? "/dashboard";
  const jar = await cookies();
  jar.set("gh_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  jar.set("gh_oauth_return", returnTo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(url.toString());
}
