import { NextRequest, NextResponse } from "next/server";
import { unsealData } from "iron-session";
import type { SessionData } from "@/lib/auth/session";

const SESSION_PASSWORD =
  process.env.SESSION_SECRET ?? "dev-only-insecure-secret-min-32-chars!!";
const COOKIE_NAME = "de_session";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const res = NextResponse.next();

  const isApp = pathname.startsWith("/dashboard") || pathname.startsWith("/admin");
  if (!isApp) return res;

  let session: SessionData = {};
  const cookieValue = req.cookies.get(COOKIE_NAME)?.value;
  if (cookieValue) {
    try {
      session = await unsealData<SessionData>(cookieValue, {
        password: SESSION_PASSWORD,
      });
    } catch {
      // invalid / expired seal — treat as unauthenticated
    }
  }

  if (!session.userId) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("returnTo", pathname + search);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/admin") && session.role !== "admin") {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
