import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/validation/auth";
import { authenticate } from "@/lib/services/auth";
import { getSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }
  const user = await authenticate(prisma, parsed.data.email, parsed.data.password);
  if (!user || user.status !== "approved") {
    return NextResponse.json({ error: "invalid credentials or not approved" }, { status: 401 });
  }
  const session = await getSession();
  session.userId = user.id;
  session.role = user.role;
  await session.save();
  return NextResponse.json({ id: user.id, name: user.name, role: user.role });
}
