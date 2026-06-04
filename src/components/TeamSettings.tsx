"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/UserAvatar";
import { DeleteTeamDialog } from "@/components/DeleteTeamDialog";
import {
  changeRoleAction, removeMemberAction, leaveTeamAction,
  createInviteAction, revokeInviteAction,
} from "@/lib/actions/teams";

export interface TeamSettingsMember {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: "owner" | "member";
}

export interface TeamSettingsInvite {
  id: string;
  code: string;
  createdAt: string;
  revokedAt: string | null;
}

export function TeamSettings({
  teamId,
  teamName,
  slug,
  viewerUserId,
  viewerRole,
  viewerIsAdmin,
  members,
  invites,
  baseUrl,
}: {
  teamId: string;
  teamName: string;
  slug: string;
  viewerUserId: string;
  viewerRole: "owner" | "member" | null;
  viewerIsAdmin: boolean;
  members: TeamSettingsMember[];
  invites: TeamSettingsInvite[];
  baseUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);

  const canManage = viewerRole === "owner" || viewerIsAdmin;
  const ownerCount = members.filter((m) => m.role === "owner").length;

  function inviteUrl(code: string) {
    return `${baseUrl}/invite/${code}`;
  }

  async function copyInvite(inv: TeamSettingsInvite) {
    try {
      await navigator.clipboard.writeText(inviteUrl(inv.code));
      setCopiedInviteId(inv.id);
      setTimeout(() => setCopiedInviteId(null), 1500);
    } catch {
      /* clipboard unavailable; user can copy from the visible text */
    }
  }

  function withResult(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "操作失败");
      else router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <Card className="border-destructive">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>成员（{members.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead>角色</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const isSelf = m.userId === viewerUserId;
                const isLastOwner = m.role === "owner" && ownerCount <= 1;
                return (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <UserAvatar name={m.name} avatarUrl={m.avatarUrl} size={32} />
                        <div className="flex flex-col">
                          <span className="font-medium">{m.name}{isSelf && <span className="text-xs text-muted-foreground"> (你)</span>}</span>
                          <span className="text-xs text-muted-foreground">{m.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <Select
                          value={m.role}
                          onValueChange={(role) =>
                            withResult(() => changeRoleAction(teamId, m.userId, role as "owner" | "member", slug))
                          }
                          disabled={pending || isLastOwner}
                        >
                          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="owner">owner</SelectItem>
                            <SelectItem value="member">member</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={m.role === "owner" ? "default" : "secondary"}>{m.role}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isSelf ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending || isLastOwner}
                          onClick={() => withResult(() => leaveTeamAction(teamId, slug))}
                        >
                          离开团队
                        </Button>
                      ) : canManage ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={pending || isLastOwner}
                          onClick={() => {
                            if (confirm(`确定移除「${m.name}」？此后该用户在本团队的数据不再共享。`)) {
                              withResult(() => removeMemberAction(teamId, m.userId, slug));
                            }
                          }}
                        >
                          移除
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>邀请链接</CardTitle>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => withResult(async () => {
                const r = await createInviteAction(teamId, slug);
                return r.ok ? { ok: true } : r;
              })}
            >
              生成新链接
            </Button>
          </CardHeader>
          <CardContent>
            {invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有邀请链接。点击「生成新链接」创建一个，发给要加入的成员。</p>
            ) : (
              <div className="space-y-2">
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-2 rounded border p-2">
                    <code className="flex-1 truncate text-xs">{inviteUrl(inv.code)}</code>
                    {inv.revokedAt ? (
                      <Badge variant="secondary">已吊销</Badge>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => copyInvite(inv)}>
                          {copiedInviteId === inv.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => {
                            if (confirm("确定吊销此邀请链接？")) {
                              withResult(() => revokeInviteAction(inv.id, slug));
                            }
                          }}
                        >
                          吊销
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canManage && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">危险区</CardTitle>
          </CardHeader>
          <CardContent>
            <DeleteTeamDialog teamId={teamId} slug={slug} teamName={teamName} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
