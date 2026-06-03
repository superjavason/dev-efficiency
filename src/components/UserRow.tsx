"use client";

import { useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { UserAvatar } from "@/components/UserAvatar";
import { TokenCreateDialog } from "@/components/TokenCreateDialog";
import { setUserStatusAction } from "@/lib/actions/users";
import { revokeTokenAction } from "@/lib/actions/tokens";

export interface AdminUserRowData {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
  status: "pending" | "approved" | "disabled";
  avatarUrl: string | null;
  tokenCount: number;
  activeTokenId: string | null;
  isSelf: boolean;
}

export function UserRow({ data }: { data: AdminUserRowData }) {
  const [pending, startTransition] = useTransition();

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <UserAvatar name={data.name} avatarUrl={data.avatarUrl} size={32} />
          <div className="flex flex-col">
            <span className="font-medium">{data.name}</span>
            <span className="text-xs text-muted-foreground">{data.email}</span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={data.role === "admin" ? "default" : "secondary"}>{data.role}</Badge>
      </TableCell>
      <TableCell>
        {data.status === "approved" && <Badge>已启用</Badge>}
        {data.status === "disabled" && <Badge variant="destructive">已禁用</Badge>}
        {data.status === "pending" && <Badge variant="secondary">待审批</Badge>}
      </TableCell>
      <TableCell className="text-muted-foreground">{data.tokenCount}</TableCell>
      <TableCell className="text-right">
        <div className="inline-flex items-center gap-2">
          <TokenCreateDialog targetUserId={data.id} triggerLabel="代签发 token" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">更多</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {data.status === "approved" && !data.isSelf && (
                <DropdownMenuItem
                  onClick={() =>
                    startTransition(async () => {
                      if (confirm(`确定禁用「${data.name}」？此后该用户无法登录且 token 全部失效。`)) {
                        await setUserStatusAction(data.id, "disabled");
                      }
                    })
                  }
                >
                  禁用
                </DropdownMenuItem>
              )}
              {data.status === "disabled" && (
                <DropdownMenuItem
                  onClick={() =>
                    startTransition(async () => {
                      await setUserStatusAction(data.id, "approved");
                    })
                  }
                >
                  启用
                </DropdownMenuItem>
              )}
              {data.activeTokenId && (
                <DropdownMenuItem
                  onClick={() =>
                    startTransition(async () => {
                      if (confirm("确定吊销该用户最近的一个有效 token？")) {
                        await revokeTokenAction(data.activeTokenId!);
                      }
                    })
                  }
                >
                  吊销最近 token
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}
