import Link from "next/link";
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/lib/actions/auth";

interface AppShellProps {
  user: { id: string; name: string; email: string; role: "admin" | "member"; avatarUrl: string | null };
  children: ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const isAdmin = user.role === "admin";
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r bg-card">
        <div className="px-5 py-4 text-base font-semibold">Dev Efficiency</div>
        <nav className="flex flex-col gap-1 px-2 text-sm">
          <Link className="rounded px-3 py-2 hover:bg-accent" href="/dashboard">
            个人仪表盘
          </Link>
          {isAdmin && (
            <>
              <div className="mt-4 px-3 py-1 text-xs uppercase text-muted-foreground">
                管理
              </div>
              <Link className="rounded px-3 py-2 hover:bg-accent" href="/admin">
                平台总览
              </Link>
              <Link className="rounded px-3 py-2 hover:bg-accent" href="/admin/users">
                用户管理
              </Link>
            </>
          )}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b px-6">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 outline-none">
              <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size={32} />
              <span className="text-sm">{user.name}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <form action={logoutAction}>
                <DropdownMenuItem asChild>
                  <button type="submit" className="flex w-full items-center gap-2">
                    <LogOut className="h-4 w-4" /> 登出
                  </button>
                </DropdownMenuItem>
              </form>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
