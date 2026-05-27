import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registerSchema } from "@/lib/validation/auth";
import { registerUser, AuthError } from "@/lib/services/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const { user, token } = await registerUser(prisma, parsed.data);
    return NextResponse.json({
      status: user.status,
      token,
      message:
        user.status === "approved"
          ? "注册成功，请妥善保存 token（仅此一次显示）"
          : "注册成功，等待管理员审批后获取 token",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    throw e;
  }
}
