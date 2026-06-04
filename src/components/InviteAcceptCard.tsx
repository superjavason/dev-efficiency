"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptInviteAction } from "@/lib/actions/teams";

export function InviteAcceptCard({
  teamName,
  memberCount,
  code,
  alreadyMember,
}: {
  teamName: string;
  memberCount: number;
  code: string;
  alreadyMember: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function accept() {
    setError(null);
    startTransition(async () => {
      const res = await acceptInviteAction(code);
      // success path throws NEXT_REDIRECT; only error path returns
      setError(res.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>加入团队</CardTitle>
        <CardDescription>
          你被邀请加入 <strong>{teamName}</strong>（当前 {memberCount} 人）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          加入后，你账号下的 token 使用数据将对该团队其他成员可见，用于团队效率统计。
        </p>
        {alreadyMember && (
          <p className="text-sm text-muted-foreground">你已经是该团队成员，点击下方按钮直接进入。</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={accept} disabled={pending} className="w-full">
          {pending ? "处理中..." : alreadyMember ? "进入团队" : "加入团队"}
        </Button>
      </CardContent>
    </Card>
  );
}
