"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loginSchema, registerSchema } from "@/lib/validation/auth";
import { authenticate, registerUser, AuthError } from "@/lib/services/auth";
import { getSession } from "@/lib/auth/session";
import { safeReturnTo } from "@/lib/safe-return-to";

export type LoginState =
  | { ok: true }
  | { ok: false; error: string }
  | null;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "请填写合法的邮箱与密码" };

  const user = await authenticate(prisma, parsed.data.email, parsed.data.password);
  if (!user || user.status !== "approved") {
    return { ok: false, error: "邮箱或密码错误，或账号被禁用" };
  }

  const session = await getSession();
  session.userId = user.id;
  session.role = user.role;
  await session.save();

  const returnTo = safeReturnTo(formData.get("returnTo") as string | null);
  redirect(returnTo);
}

export type RegisterState =
  | { ok: true; token: string }
  | { ok: false; error: string }
  | null;

export async function registerAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
  const parsed = registerSchema.safeParse({
    email: formData.get("email"),
    name: formData.get("name"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "请填写合法的邮箱、姓名与至少 8 位密码" };

  try {
    const { user, token } = await registerUser(prisma, parsed.data);
    const session = await getSession();
    session.userId = user.id;
    session.role = user.role;
    await session.save();
    return { ok: true, token };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: "该邮箱已被注册" };
    throw e;
  }
}

export async function logoutAction() {
  const session = await getSession();
  await session.destroy();
  redirect("/login");
}
