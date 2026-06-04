"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { revokeTokenAction } from "@/lib/actions/tokens";

export interface TokenRow {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function TokenList({ tokens }: { tokens: TokenRow[] }) {
  const [pending, startTransition] = useTransition();
  if (tokens.length === 0) {
    return <p className="text-sm text-muted-foreground">还没有 token，点击「创建 token」生成一个。</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>创建于</TableHead>
          <TableHead>最近使用</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tokens.map((t) => (
          <TableRow key={t.id}>
            <TableCell>{t.name}</TableCell>
            <TableCell className="text-muted-foreground">{t.createdAt.slice(0, 10)}</TableCell>
            <TableCell className="text-muted-foreground">{t.lastUsedAt ? t.lastUsedAt.slice(0, 10) : "—"}</TableCell>
            <TableCell>
              {t.revokedAt ? (
                <Badge variant="secondary">已吊销</Badge>
              ) : (
                <Badge>有效</Badge>
              )}
            </TableCell>
            <TableCell className="text-right">
              {!t.revokedAt && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      if (confirm(`确定吊销 token「${t.name}」？吊销后无法恢复。`)) {
                        await revokeTokenAction(t.id);
                      }
                    })
                  }
                >
                  吊销
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
