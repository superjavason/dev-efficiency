import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveBearerUser } from "@/lib/auth/bearer";

export async function GET(req: Request) {
  const user = await resolveBearerUser(prisma, req.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}
