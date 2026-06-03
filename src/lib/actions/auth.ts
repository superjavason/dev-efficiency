"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export async function logoutAction() {
  const session = await getSession();
  await session.destroy();
  redirect("/login");
}
