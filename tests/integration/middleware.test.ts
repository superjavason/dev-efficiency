import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { sealData } from "iron-session";
import { middleware } from "@/middleware";

const secret =
  process.env.SESSION_SECRET ?? "dev-only-insecure-secret-min-32-chars!!";

async function withSession(url: string, session?: { userId: string; role: "admin" | "member" }) {
  const headers = new Headers();
  if (session) {
    const sealed = await sealData(session, { password: secret });
    headers.set("cookie", `de_session=${sealed}`);
  }
  return new NextRequest(url, { headers });
}

describe("middleware", () => {
  it("redirects unauthenticated /dashboard → /login?returnTo=/dashboard", async () => {
    const req = await withSession("http://t/dashboard");
    const res = await middleware(req);
    expect(res.status).toBe(307);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/login");
    expect(loc).toContain("returnTo=%2Fdashboard");
  });

  it("allows authenticated member → /dashboard", async () => {
    const req = await withSession("http://t/dashboard", { userId: "u1", role: "member" });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("redirects member → /dashboard from /admin", async () => {
    const req = await withSession("http://t/admin", { userId: "u1", role: "member" });
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("allows admin → /admin", async () => {
    const req = await withSession("http://t/admin/users", { userId: "u1", role: "admin" });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("ignores non-app routes (no redirect to login from /login)", async () => {
    const req = await withSession("http://t/login");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});
