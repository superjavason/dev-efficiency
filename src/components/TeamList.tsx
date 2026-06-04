import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface TeamListRow {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  createdAt: string;
}

export function TeamList({ teams }: { teams: TeamListRow[] }) {
  if (teams.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          还没有加入任何团队。点击右上角「创建团队」开始，或让 owner 把邀请链接发给你。
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {teams.map((t) => (
        <Link key={t.id} href={`/teams/${t.slug}`}>
          <Card className="h-full transition hover:shadow">
            <CardHeader>
              <CardTitle className="text-base">{t.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div className="font-mono text-xs">/{t.slug}</div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{t.memberCount} 人</Badge>
                <span className="text-xs">创建于 {t.createdAt.slice(0, 10)}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
