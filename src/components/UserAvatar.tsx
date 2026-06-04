import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-rose-200 text-rose-800",
  "bg-amber-200 text-amber-800",
  "bg-emerald-200 text-emerald-800",
  "bg-sky-200 text-sky-800",
  "bg-violet-200 text-violet-800",
  "bg-fuchsia-200 text-fuchsia-800",
];

function colorFor(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function UserAvatar({
  name,
  avatarUrl,
  size = 32,
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <Avatar
      style={{ width: size, height: size }}
      className={cn("shrink-0", className)}
    >
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
      <AvatarFallback className={cn("font-medium", colorFor(name || "?"))}>
        {initial}
      </AvatarFallback>
    </Avatar>
  );
}
