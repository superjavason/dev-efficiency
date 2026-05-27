import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  role?: "admin" | "member";
}

const sessionOptions = {
  password: process.env.SESSION_SECRET ?? "dev-only-insecure-secret-min-32-chars!!",
  cookieName: "de_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
