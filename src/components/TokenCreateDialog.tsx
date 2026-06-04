"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OneTimeTokenDialog } from "@/components/OneTimeTokenDialog";
import { createTokenAction } from "@/lib/actions/tokens";

export function TokenCreateDialog({
  targetUserId,
  triggerLabel = "创建 token",
}: {
  targetUserId: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [issued, setIssued] = useState<string | null>(null);
  const [issuedOpen, setIssuedOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createTokenAction(targetUserId, name);
      if (res.ok && res.token) {
        setOpen(false);
        setName("");
        setIssued(res.token);
        setIssuedOpen(true);
      } else {
        setError(res.error ?? "创建失败");
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm">{triggerLabel}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建 auth token</DialogTitle>
            <DialogDescription>给这个 token 起个名字便于以后管理（例如机器名 my-mac）</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="name">名称</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-mac"
              maxLength={64}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={pending}>{pending ? "创建中..." : "创建"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {issued && (
        <OneTimeTokenDialog
          token={issued}
          open={issuedOpen}
          onOpenChange={(o) => {
            setIssuedOpen(o);
            if (!o) setIssued(null);
          }}
        />
      )}
    </>
  );
}
