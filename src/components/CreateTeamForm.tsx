"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify, isValidSlug } from "@/lib/slug";
import { createTeamAction } from "@/lib/actions/teams";

export function CreateTeamForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const autoSlug = useMemo(() => slugify(name), [name]);
  const slugRequired = autoSlug === null && name.trim().length > 0;
  const effectiveSlug = slug || autoSlug || "";
  const slugLooksValid = effectiveSlug ? isValidSlug(effectiveSlug) : !slugRequired;

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createTeamAction({
        name: name.trim(),
        slug: slug.trim() || undefined,
      });
      if (res.ok && res.slug) {
        router.push(`/teams/${res.slug}`);
      } else {
        setError(res.error ?? "创建失败");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>创建团队</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="name">团队名</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ACME Corp 或 我的团队"
            maxLength={100}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="slug">URL slug（可选）</Label>
          <Input
            id="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={autoSlug ?? "中文团队名请手动输入(仅小写字母数字和连字符)"}
            maxLength={60}
          />
          {slugRequired && (
            <p className="text-xs text-destructive">
              中文/非 ASCII 团队名需手动输入 slug。
            </p>
          )}
          {effectiveSlug && (
            <p className="text-xs text-muted-foreground">
              URL 将是 <span className="font-mono">/teams/{effectiveSlug}</span>
              {!slugLooksValid && <span className="ml-2 text-destructive">格式不合法</span>}
            </p>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          onClick={submit}
          disabled={pending || !name.trim() || !slugLooksValid || (slugRequired && !slug)}
          className="w-full"
        >
          {pending ? "创建中..." : "创建团队"}
        </Button>
      </CardContent>
    </Card>
  );
}
