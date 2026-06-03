"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function OneTimeTokenDialog({
  token,
  open,
  onOpenChange,
  title = "Auth token（仅此一次显示）",
  description = "请立即复制并妥善保存。关闭后此 token 不再展示，丢失需重新创建。",
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <pre className="overflow-x-auto rounded border bg-muted px-3 py-2 text-xs">
          {token}
        </pre>
        <DialogFooter>
          <Button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(token);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4" /> 已复制
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" /> 复制
              </>
            )}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
