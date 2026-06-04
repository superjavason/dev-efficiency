"use client";

import { Suspense } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { loginAction, type LoginState } from "@/lib/actions/auth";

function LoginForm() {
  const params = useSearchParams();
  const returnTo = params.get("returnTo") ?? "/dashboard";
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, null);

  const githubEnabled = Boolean(process.env.NEXT_PUBLIC_GITHUB_ENABLED);

  return (
    <Card>
      <CardHeader>
        <CardTitle>登录</CardTitle>
        <CardDescription>用邮箱密码或 GitHub 登录</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="space-y-1">
            <Label htmlFor="email">邮箱</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">密码</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {state && !state.ok && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "登录中..." : "登录"}
          </Button>
        </form>

        {githubEnabled && (
          <>
            <div className="text-center text-xs text-muted-foreground">或</div>
            <a href={`/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`}>
              <Button variant="outline" className="w-full" type="button">
                使用 GitHub 登录
              </Button>
            </a>
          </>
        )}

        <p className="text-center text-sm text-muted-foreground">
          还没有账号？<Link className="underline" href="/register">注册</Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
