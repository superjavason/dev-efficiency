"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { registerAction, type RegisterState } from "@/lib/actions/auth";
import { OneTimeTokenDialog } from "@/components/OneTimeTokenDialog";

export default function RegisterPage() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(registerAction, null);
  const [open, setOpen] = useState(false);
  const githubEnabled = Boolean(process.env.NEXT_PUBLIC_GITHUB_ENABLED);

  useEffect(() => {
    if (state?.ok) setOpen(true);
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>注册</CardTitle>
        <CardDescription>注册后会立刻签发一个 auth token（仅展示一次）</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={formAction} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="email">邮箱</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="name">姓名</Label>
            <Input id="name" name="name" type="text" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">密码（≥ 8 位）</Label>
            <Input id="password" name="password" type="password" required minLength={8} />
          </div>
          {state && !state.ok && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "注册中..." : "注册"}
          </Button>
        </form>

        {githubEnabled && (
          <>
            <div className="text-center text-xs text-muted-foreground">或</div>
            <a href="/api/auth/github">
              <Button variant="outline" className="w-full" type="button">
                使用 GitHub 注册并登录
              </Button>
            </a>
          </>
        )}

        <p className="text-center text-sm text-muted-foreground">
          已有账号？<Link className="underline" href="/login">登录</Link>
        </p>

        {state?.ok && (
          <OneTimeTokenDialog
            token={state.token}
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (!o) router.push("/dashboard");
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
