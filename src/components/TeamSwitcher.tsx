import Link from "next/link";

export interface SidebarTeam {
  name: string;
  slug: string;
}

export function TeamSwitcher({ teams }: { teams: SidebarTeam[] }) {
  if (teams.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        还没加入任何团队
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {teams.map((t) => (
        <Link
          key={t.slug}
          href={`/teams/${t.slug}`}
          className="rounded px-3 py-1.5 text-sm hover:bg-accent"
          title={t.name}
        >
          <span className="block truncate">{t.name}</span>
        </Link>
      ))}
    </div>
  );
}
