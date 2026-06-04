"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteTeamAction } from "@/lib/actions/teams";

export function DeleteTeamDialog({
  teamId,
  slug,
  teamName,
}: {
  teamId: string;
  slug: string;
  teamName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await deleteTeamAction(teamId, slug);
      if (res.ok) {
        setOpen(false);
        router.push("/teams");
      } else {
        setError(res.error ?? "删除失败");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">删除团队</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除团队</DialogTitle>
          <DialogDescription>
            此操作不可恢复。所有成员关系和邀请链接将被永久删除（成员个人的 token 数据不受影响）。
            输入团队名 <span className="font-mono font-semibold">{teamName}</span> 以确认。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="confirm">团队名</Label>
          <Input id="confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={pending || confirm !== teamName}
          >
            {pending ? "删除中..." : "永久删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
