import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveBearerUser } from "@/lib/auth/bearer";
import { usagePayloadSchema } from "@/lib/validation/usage";
import { ingestUsage } from "@/lib/services/usage";

export async function POST(req: Request) {
  const user = await resolveBearerUser(prisma, req.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = usagePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await ingestUsage(prisma, user.id, parsed.data.records);
  return NextResponse.json(result);
}
