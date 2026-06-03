# Plan 2 — Web 仪表盘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1 服务端核心之上加一套带登录的 Web 仪表盘：邮箱密码登录、GitHub OAuth 登录、个人数据看板（每日 token 趋势 + 工具/模型分布 + 自助 token 管理）、admin 平台总览 + 用户管理（禁用/启用 + 代签发/吊销 token）。

**Architecture:** Next.js App Router；**页面 = server components 直接经 Prisma 读数据**（不绕 `/api/v1/*` HTTP），**变更 = server actions 复用 Plan 1 service**。`src/middleware.ts` 做认证/角色前置拦截。所有 metrics service 必须传入 `viewer`，member 自动收敛到自己的数据。GitHub OAuth 用 `arctic` 库做协议层，与现有 iron-session 共存。Plan 1 的 Bearer 鉴权 `/api/v1/*` 不动，独立通道。

**Tech Stack:** Next.js 15 / React 19 / TypeScript（沿用）；新增 Tailwind v4、shadcn/ui、Recharts、arctic（GitHub OAuth）。继续 pnpm。

> 这是三份后续计划中的第 1 份。Plan 3（Teams）、Plan 4（客户端 skill 采集器）在本计划合并后再写。

---

## 文件结构（本计划涉及）

```
src/
  middleware.ts                              # 路由保护（新建）
  app/
    globals.css                              # Tailwind v4 入口（新建）
    layout.tsx                               # 改：引入 globals.css + 中文 title
    page.tsx                                 # 改：未登录 → /login，否则 → /dashboard
    (auth)/
      layout.tsx                             # 简洁 auth shell（新建）
      login/page.tsx                         # 新建
      register/page.tsx                      # 新建
    (app)/
      layout.tsx                             # AppShell 包裹（新建）
      dashboard/page.tsx                     # 新建：个人视图
      admin/page.tsx                         # 新建：平台总览
      admin/users/page.tsx                   # 新建：用户列表 + 管理
    api/
      auth/
        github/route.ts                      # 新建：OAuth 入口
        github/callback/route.ts             # 新建：OAuth 回调
        login|logout|register/route.ts       # 已存在，保留（也可在 UI 直接调 server action；保留兼容性）
      v1/me|usage/route.ts                   # 不动
  components/
    AppShell.tsx                             # 侧栏 + 顶栏（role-aware）
    UserAvatar.tsx                           # 头像 + 首字母 fallback
    DateRangePicker.tsx                      # client，URL 同步
    TokenList.tsx                            # client/server 拆分见 Task 13
    TokenCreateDialog.tsx
    OneTimeTokenDialog.tsx
    UserRow.tsx
    charts/
      DailyTrendChart.tsx
      ToolBreakdownChart.tsx
      ModelBreakdownChart.tsx
      UserRankingTable.tsx
    ui/                                      # shadcn 复制进来的原语
  lib/
    services/
      auth.ts                                # 改：删 approveUser、registerUser 移除 inviteCode
      usage.ts                               # 不动
      users.ts                               # 新建
      tokens.ts                              # 新建
      metrics.ts                             # 新建
    actions/
      auth.ts                                # 新建：login/register/logout server actions
      users.ts                               # 新建：updateUserStatus
      tokens.ts                              # 新建：createTokenFor/revokeToken
    auth/
      github.ts                              # 新建：arctic + linkOrCreateGithubUser
      password|token|bearer|session.ts       # 不动
    validation/
      auth.ts                                # 改：registerSchema 移除 inviteCode
      usage.ts                               # 不动
    range.ts                                 # 新建：时间范围解析（URL ↔ Date）
    utils.ts                                 # 新建：cn() 来自 shadcn init
prisma/
  schema.prisma                              # 改：删 InviteCode；User 加 avatarUrl/githubId
  migrations/<ts>_dashboard_prep/            # 新建：drop InviteCode + alter User
tests/
  integration/
    auth.test.ts                             # 改：移除 invite/approve 用例，加 register-no-invite 用例
    users.test.ts                            # 新建
    tokens.test.ts                           # 新建
    metrics.test.ts                          # 新建
    github-oauth.test.ts                     # 新建（仅测 linkOrCreate 逻辑，不打真 GitHub）
```

---

## Task 1: Plan 1 清理 + OAuth 字段迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_dashboard_prep/migration.sql`（由 `prisma migrate dev` 生成）
- Modify: `src/lib/validation/auth.ts`, `src/lib/services/auth.ts`, `src/app/api/auth/register/route.ts`, `tests/integration/auth.test.ts`

- [ ] **Step 1: 编辑 `prisma/schema.prisma` —— 删 InviteCode + 加 User.avatarUrl/githubId**

  将整个 `model InviteCode { ... }` 块删除。
  在 `model User` 内删除以下两行：
  ```prisma
    invitesCreated InviteCode[] @relation("InviteCreatedBy")
    inviteUsed     InviteCode?  @relation("InviteUsedBy")
  ```
  在 `model User` 的字段区追加：
  ```prisma
    avatarUrl    String?
    githubId     String?    @unique
  ```
  其余不动。

- [ ] **Step 2: 生成迁移**

  Run: `pnpm prisma migrate dev --name dashboard_prep`
  Expected: 生成 `prisma/migrations/<timestamp>_dashboard_prep/`，自动应用到本地 dev 库；Prisma client 重新生成。

- [ ] **Step 3: 简化 `src/lib/validation/auth.ts`（删 inviteCode 字段）**

  全文替换为：
  ```typescript
  import { z } from "zod";

  export const registerSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(100),
    password: z.string().min(8).max(200),
  });

  export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  export type RegisterInput = z.infer<typeof registerSchema>;
  export type LoginInput = z.infer<typeof loginSchema>;
  ```

- [ ] **Step 4: 简化 `src/lib/services/auth.ts`（删 approveUser、registerUser 总是直接 approve+签 token）**

  全文替换为：
  ```typescript
  import { Prisma, type PrismaClient, type User } from "@prisma/client";
  import { hashPassword, verifyPassword } from "@/lib/auth/password";
  import { generateToken, hashToken } from "@/lib/auth/token";
  import type { RegisterInput } from "@/lib/validation/auth";

  export class AuthError extends Error {
    constructor(
      message: string,
      public code: "DUPLICATE_EMAIL",
    ) {
      super(message);
      this.name = "AuthError";
    }
  }

  export interface RegisterResult {
    user: User;
    token: string; // 注册总是直接 approve 并签发一次性 token
  }

  // 接受事务客户端，使其可在 $transaction 内复用
  async function issueTokenFor(
    client: Prisma.TransactionClient,
    userId: string,
    name = "default",
  ): Promise<string> {
    const raw = generateToken();
    await client.authToken.create({
      data: { userId, tokenHash: hashToken(raw), name },
    });
    return raw;
  }

  export async function registerUser(
    prisma: PrismaClient,
    input: RegisterInput,
  ): Promise<RegisterResult> {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new AuthError("email already registered", "DUPLICATE_EMAIL");

    const passwordHash = await hashPassword(input.password);

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          status: "approved",
        },
      });
      const token = await issueTokenFor(tx, user.id);
      return { user, token };
    });
  }

  export async function authenticate(
    prisma: PrismaClient,
    email: string,
    password: string,
  ): Promise<User | null> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    if (!user.passwordHash) return null; // 空密码哈希 = OAuth-only 账号，禁止密码登录
    if (!(await verifyPassword(user.passwordHash, password))) return null;
    return user;
  }
  ```
  注意：`approveUser` 整个移除；`authenticate` 额外加一个空 passwordHash 守卫（防御性）。

- [ ] **Step 5: 简化 `src/app/api/auth/register/route.ts`**

  全文替换为：
  ```typescript
  import { NextResponse } from "next/server";
  import { prisma } from "@/lib/db";
  import { registerSchema } from "@/lib/validation/auth";
  import { registerUser, AuthError } from "@/lib/services/auth";

  export async function POST(req: Request) {
    const body = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    try {
      const { token } = await registerUser(prisma, parsed.data);
      return NextResponse.json({
        token,
        message: "注册成功，请妥善保存 token（仅此一次显示）",
      });
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
      }
      throw e;
    }
  }
  ```

- [ ] **Step 6: 改写 `tests/integration/auth.test.ts`（删 invite/approve 用例，加 register-always-issues-token 用例）**

  全文替换为：
  ```typescript
  import { describe, it, expect, beforeEach, afterAll } from "vitest";
  import { prisma, resetDb } from "../helpers/db";
  import { registerUser, authenticate, AuthError } from "@/lib/services/auth";
  import { resolveBearerUser } from "@/lib/auth/bearer";

  describe("auth service", () => {
    beforeEach(resetDb);
    afterAll(() => prisma.$disconnect());

    it("registers an approved user and issues a usable token", async () => {
      const res = await registerUser(prisma, {
        email: "dev@x.com",
        name: "Dev",
        password: "password123",
      });
      expect(res.user.status).toBe("approved");
      expect(res.token).toMatch(/^de_/);

      const u = await resolveBearerUser(prisma, `Bearer ${res.token}`);
      expect(u?.id).toBe(res.user.id);
    });

    it("rejects duplicate email", async () => {
      await registerUser(prisma, { email: "dev@x.com", name: "Dev", password: "password123" });
      await expect(
        registerUser(prisma, { email: "dev@x.com", name: "Dev2", password: "password123" }),
      ).rejects.toBeInstanceOf(AuthError);
    });

    it("authenticate returns user on correct credentials, null otherwise", async () => {
      await registerUser(prisma, { email: "dev@x.com", name: "Dev", password: "password123" });
      const ok = await authenticate(prisma, "dev@x.com", "password123");
      expect(ok?.email).toBe("dev@x.com");
      expect(await authenticate(prisma, "dev@x.com", "wrong")).toBeNull();
      expect(await authenticate(prisma, "nobody@x.com", "password123")).toBeNull();
    });

    it("authenticate refuses login when passwordHash is empty (OAuth-only account)", async () => {
      await prisma.user.create({
        data: { email: "g@x.com", name: "G", passwordHash: "", status: "approved" },
      });
      expect(await authenticate(prisma, "g@x.com", "anything")).toBeNull();
    });
  });
  ```

- [ ] **Step 7: 跑测试**

  Run: `pnpm test`
  Expected: 全绿（auth 4 个用例 + 之前的 token/password/tool/validation/bearer/usage 全部依旧 pass）。

- [ ] **Step 8: tsc 干净**

  Run: `pnpm tsc --noEmit`
  Expected: 无错误。

- [ ] **Step 9: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "refactor: drop InviteCode model, simplify registerUser, add OAuth columns"
  ```

---

## Task 2: Tailwind v4 + shadcn/ui 初始化

**Files:**
- Create: `src/app/globals.css`, `postcss.config.mjs`, `components.json`, `src/lib/utils.ts`
- Modify: `src/app/layout.tsx`, `package.json`, `tsconfig.json`

- [ ] **Step 1: 安装 Tailwind v4 + 必备依赖**

  Run:
  ```bash
  pnpm add tailwindcss @tailwindcss/postcss postcss
  pnpm add class-variance-authority clsx tailwind-merge lucide-react
  pnpm add -D @types/node
  ```
  说明：`class-variance-authority` + `clsx` + `tailwind-merge` 是 shadcn 必备；`lucide-react` 是 shadcn 默认图标库。

- [ ] **Step 2: 创建 `postcss.config.mjs`**

  ```javascript
  export default {
    plugins: {
      "@tailwindcss/postcss": {},
    },
  };
  ```

- [ ] **Step 3: 创建 `src/app/globals.css`（Tailwind v4 入口 + shadcn 主题变量）**

  ```css
  @import "tailwindcss";

  @layer base {
    :root {
      --background: 0 0% 100%;
      --foreground: 240 10% 3.9%;
      --card: 0 0% 100%;
      --card-foreground: 240 10% 3.9%;
      --popover: 0 0% 100%;
      --popover-foreground: 240 10% 3.9%;
      --primary: 240 5.9% 10%;
      --primary-foreground: 0 0% 98%;
      --secondary: 240 4.8% 95.9%;
      --secondary-foreground: 240 5.9% 10%;
      --muted: 240 4.8% 95.9%;
      --muted-foreground: 240 3.8% 46.1%;
      --accent: 240 4.8% 95.9%;
      --accent-foreground: 240 5.9% 10%;
      --destructive: 0 84.2% 60.2%;
      --destructive-foreground: 0 0% 98%;
      --border: 240 5.9% 90%;
      --input: 240 5.9% 90%;
      --ring: 240 10% 3.9%;
      --radius: 0.5rem;
    }

    .dark {
      --background: 240 10% 3.9%;
      --foreground: 0 0% 98%;
      --card: 240 10% 3.9%;
      --card-foreground: 0 0% 98%;
      --popover: 240 10% 3.9%;
      --popover-foreground: 0 0% 98%;
      --primary: 0 0% 98%;
      --primary-foreground: 240 5.9% 10%;
      --secondary: 240 3.7% 15.9%;
      --secondary-foreground: 0 0% 98%;
      --muted: 240 3.7% 15.9%;
      --muted-foreground: 240 5% 64.9%;
      --accent: 240 3.7% 15.9%;
      --accent-foreground: 0 0% 98%;
      --destructive: 0 62.8% 30.6%;
      --destructive-foreground: 0 0% 98%;
      --border: 240 3.7% 15.9%;
      --input: 240 3.7% 15.9%;
      --ring: 240 4.9% 83.9%;
    }
  }

  @theme inline {
    --color-background: hsl(var(--background));
    --color-foreground: hsl(var(--foreground));
    --color-card: hsl(var(--card));
    --color-card-foreground: hsl(var(--card-foreground));
    --color-popover: hsl(var(--popover));
    --color-popover-foreground: hsl(var(--popover-foreground));
    --color-primary: hsl(var(--primary));
    --color-primary-foreground: hsl(var(--primary-foreground));
    --color-secondary: hsl(var(--secondary));
    --color-secondary-foreground: hsl(var(--secondary-foreground));
    --color-muted: hsl(var(--muted));
    --color-muted-foreground: hsl(var(--muted-foreground));
    --color-accent: hsl(var(--accent));
    --color-accent-foreground: hsl(var(--accent-foreground));
    --color-destructive: hsl(var(--destructive));
    --color-destructive-foreground: hsl(var(--destructive-foreground));
    --color-border: hsl(var(--border));
    --color-input: hsl(var(--input));
    --color-ring: hsl(var(--ring));
    --radius-lg: var(--radius);
    --radius-md: calc(var(--radius) - 2px);
    --radius-sm: calc(var(--radius) - 4px);
  }

  @layer base {
    * {
      border-color: hsl(var(--border));
    }
    body {
      background-color: hsl(var(--background));
      color: hsl(var(--foreground));
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
  }
  ```

- [ ] **Step 4: 创建 `components.json`（shadcn 配置；Tailwind v4 + RSC + 默认风格）**

  ```json
  {
    "$schema": "https://ui.shadcn.com/schema.json",
    "style": "default",
    "rsc": true,
    "tsx": true,
    "tailwind": {
      "config": "",
      "css": "src/app/globals.css",
      "baseColor": "neutral",
      "cssVariables": true,
      "prefix": ""
    },
    "aliases": {
      "components": "@/components",
      "utils": "@/lib/utils",
      "ui": "@/components/ui",
      "lib": "@/lib",
      "hooks": "@/hooks"
    },
    "iconLibrary": "lucide"
  }
  ```

- [ ] **Step 5: 创建 `src/lib/utils.ts`（shadcn cn helper）**

  ```typescript
  import { clsx, type ClassValue } from "clsx";
  import { twMerge } from "tailwind-merge";

  export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
  }
  ```

- [ ] **Step 6: 修改 `src/app/layout.tsx` 引入 globals.css**

  全文替换为：
  ```tsx
  import type { ReactNode } from "react";
  import "./globals.css";

  export const metadata = { title: "Dev Efficiency Tracker" };

  export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="zh">
        <body className="min-h-screen bg-background text-foreground antialiased">
          {children}
        </body>
      </html>
    );
  }
  ```

- [ ] **Step 7: 跑 shadcn add 引入需要的原语**

  Run:
  ```bash
  pnpm dlx shadcn@latest add button card input label select dialog dropdown-menu table avatar badge popover calendar
  ```
  说明：交互式提示若问「TypeScript? Yes / RSC? Yes / Style? Default / Base color? Neutral」按推荐默认即可。命令会把 12 个组件复制到 `src/components/ui/`，自动追加 `react-day-picker`、`@radix-ui/*` 等所需依赖。

  Expected: `src/components/ui/` 出现上述组件 .tsx 文件；`package.json` 自动追加 `@radix-ui/*` 等依赖。

- [ ] **Step 8: 验证 `pnpm build` 仍通过**

  Run: `pnpm build`
  Expected: 编译成功；可能出现少量 unused 警告，不阻塞。

- [ ] **Step 9: tsc + 测试不退化**

  Run: `pnpm tsc --noEmit && pnpm test`
  Expected: 类型干净；36+ 测试全绿（Task 1 后用例数会增减，以实际为准）。

- [ ] **Step 10: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "chore: add Tailwind v4 + shadcn/ui scaffolding"
  ```

---

## Task 3: middleware + AppShell + UserAvatar + 根路由重定向

**Files:**
- Create: `src/middleware.ts`, `src/components/AppShell.tsx`, `src/components/UserAvatar.tsx`, `src/app/(app)/layout.tsx`, `src/app/(auth)/layout.tsx`, `src/lib/actions/auth.ts`（stub，仅含 logoutAction，Task 4 扩展）
- Modify: `src/app/page.tsx`

- [ ] **Step 1: 创建 `src/middleware.ts`**

  ```typescript
  import { NextRequest, NextResponse } from "next/server";
  import { getIronSession } from "iron-session";
  import type { SessionData } from "@/lib/auth/session";

  const sessionOptions = {
    password: process.env.SESSION_SECRET ?? "dev-only-insecure-secret-min-32-chars!!",
    cookieName: "de_session",
  };

  export async function middleware(req: NextRequest) {
    const { pathname, search } = req.nextUrl;
    const res = NextResponse.next();

    const session = await getIronSession<SessionData>(req.cookies, sessionOptions);

    const isApp = pathname.startsWith("/dashboard") || pathname.startsWith("/admin");
    if (!isApp) return res;

    if (!session.userId) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("returnTo", pathname + search);
      return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/admin") && session.role !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      url.search = "";
      return NextResponse.redirect(url);
    }

    return res;
  }

  export const config = {
    matcher: ["/dashboard/:path*", "/admin/:path*"],
  };
  ```

- [ ] **Step 2: 修改 `src/app/page.tsx` 做根路由重定向**

  全文替换为：
  ```tsx
  import { redirect } from "next/navigation";
  import { getSession } from "@/lib/auth/session";

  export default async function Home() {
    const session = await getSession();
    redirect(session.userId ? "/dashboard" : "/login");
  }
  ```

- [ ] **Step 3: 创建 `src/components/UserAvatar.tsx`**

  ```tsx
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
  ```

- [ ] **Step 4: 创建 `src/components/AppShell.tsx`（侧栏 + 顶栏）**

  ```tsx
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
  ```

  注意：`logoutAction` 在下一 Step 创建为 stub（Task 4 会扩展为完整 auth actions 文件）。

- [ ] **Step 4b: 创建 `src/lib/actions/auth.ts` stub（仅含 logoutAction，让 AppShell 可编译）**

  ```typescript
  "use server";

  import { redirect } from "next/navigation";
  import { getSession } from "@/lib/auth/session";

  export async function logoutAction() {
    const session = await getSession();
    await session.destroy();
    redirect("/login");
  }
  ```
  注意：Task 4 会用更大的版本替换本文件（追加 loginAction / registerAction 与 state 类型），保持 logoutAction 不变。

- [ ] **Step 5: 创建 `src/app/(app)/layout.tsx`（包 AppShell）**

  ```tsx
  import { redirect } from "next/navigation";
  import { getSession } from "@/lib/auth/session";
  import { prisma } from "@/lib/db";
  import { AppShell } from "@/components/AppShell";

  export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const session = await getSession();
    if (!session.userId) redirect("/login");
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true },
    });
    if (!user) redirect("/login");
    return <AppShell user={user}>{children}</AppShell>;
  }
  ```

- [ ] **Step 6: 创建 `src/app/(auth)/layout.tsx`（简洁壳）**

  ```tsx
  export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    );
  }
  ```

- [ ] **Step 7: 编译验证**

  Run: `pnpm tsc --noEmit && pnpm test`
  Expected: clean / green（stub logoutAction 已满足 AppShell 的引用）。

- [ ] **Step 8: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat: add middleware, AppShell, UserAvatar, route group layouts"
  ```

---

## Task 4: 登录/注册/登出 server actions + 页面 + 一次性 token 对话框

**Files:**
- Modify: `src/lib/actions/auth.ts`（替换 Task 3 的 stub 为完整版）
- Create: `src/components/OneTimeTokenDialog.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`

- [ ] **Step 1: 替换 `src/lib/actions/auth.ts` 为完整版（含 login/register/logout）**

  ```typescript
  "use server";

  import { redirect } from "next/navigation";
  import { prisma } from "@/lib/db";
  import { loginSchema, registerSchema } from "@/lib/validation/auth";
  import { authenticate, registerUser, AuthError } from "@/lib/services/auth";
  import { getSession } from "@/lib/auth/session";

  export type LoginState =
    | { ok: true }
    | { ok: false; error: string }
    | null;

  export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
    const parsed = loginSchema.safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    if (!parsed.success) return { ok: false, error: "请填写合法的邮箱与密码" };

    const user = await authenticate(prisma, parsed.data.email, parsed.data.password);
    if (!user || user.status !== "approved") {
      return { ok: false, error: "邮箱或密码错误，或账号被禁用" };
    }

    const session = await getSession();
    session.userId = user.id;
    session.role = user.role;
    await session.save();

    const returnTo = (formData.get("returnTo") as string) || "/dashboard";
    redirect(returnTo);
  }

  export type RegisterState =
    | { ok: true; token: string }
    | { ok: false; error: string }
    | null;

  export async function registerAction(_prev: RegisterState, formData: FormData): Promise<RegisterState> {
    const parsed = registerSchema.safeParse({
      email: formData.get("email"),
      name: formData.get("name"),
      password: formData.get("password"),
    });
    if (!parsed.success) return { ok: false, error: "请填写合法的邮箱、姓名与至少 8 位密码" };

    try {
      const { user, token } = await registerUser(prisma, parsed.data);
      const session = await getSession();
      session.userId = user.id;
      session.role = user.role;
      await session.save();
      return { ok: true, token };
    } catch (e) {
      if (e instanceof AuthError) return { ok: false, error: "该邮箱已被注册" };
      throw e;
    }
  }

  export async function logoutAction() {
    const session = await getSession();
    await session.destroy();
    redirect("/login");
  }
  ```

- [ ] **Step 2: 创建 `src/components/OneTimeTokenDialog.tsx`**

  ```tsx
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
  ```

- [ ] **Step 3: 创建 `src/app/(auth)/login/page.tsx`**

  ```tsx
  "use client";

  import { useActionState } from "react";
  import Link from "next/link";
  import { useSearchParams } from "next/navigation";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Button } from "@/components/ui/button";
  import { loginAction, type LoginState } from "@/lib/actions/auth";

  export default function LoginPage() {
    const params = useSearchParams();
    const returnTo = params.get("returnTo") ?? "/dashboard";
    const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, null);

    const githubEnabled = Boolean(process.env.NEXT_PUBLIC_GITHUB_ENABLED);

    return (
      <Card>
        <CardHeader>
          <CardTitle>登录</CardTitle>
          <CardDescription>用邮箱密码或 GitHub 登录</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="space-y-1">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">密码</Label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" />
            </div>
            {state && !state.ok && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "登录中..." : "登录"}
            </Button>
          </form>

          {githubEnabled && (
            <>
              <div className="text-center text-xs text-muted-foreground">或</div>
              <a href={`/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`}>
                <Button variant="outline" className="w-full" type="button">
                  使用 GitHub 登录
                </Button>
              </a>
            </>
          )}

          <p className="text-center text-sm text-muted-foreground">
            还没有账号？<Link className="underline" href="/register">注册</Link>
          </p>
        </CardContent>
      </Card>
    );
  }
  ```

- [ ] **Step 4: 创建 `src/app/(auth)/register/page.tsx`**

  ```tsx
  "use client";

  import { useActionState, useEffect, useState } from "react";
  import Link from "next/link";
  import { useRouter } from "next/navigation";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Button } from "@/components/ui/button";
  import { registerAction, type RegisterState } from "@/lib/actions/auth";
  import { OneTimeTokenDialog } from "@/components/OneTimeTokenDialog";

  export default function RegisterPage() {
    const router = useRouter();
    const [state, formAction, pending] = useActionState<RegisterState, FormData>(registerAction, null);
    const [open, setOpen] = useState(false);
    const githubEnabled = Boolean(process.env.NEXT_PUBLIC_GITHUB_ENABLED);

    useEffect(() => {
      if (state?.ok) setOpen(true);
    }, [state]);

    return (
      <Card>
        <CardHeader>
          <CardTitle>注册</CardTitle>
          <CardDescription>注册后会立刻签发一个 auth token（仅展示一次）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={formAction} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email">邮箱</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">姓名</Label>
              <Input id="name" name="name" type="text" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">密码（≥ 8 位）</Label>
              <Input id="password" name="password" type="password" required minLength={8} />
            </div>
            {state && !state.ok && (
              <p className="text-sm text-destructive">{state.error}</p>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "注册中..." : "注册"}
            </Button>
          </form>

          {githubEnabled && (
            <>
              <div className="text-center text-xs text-muted-foreground">或</div>
              <a href="/api/auth/github">
                <Button variant="outline" className="w-full" type="button">
                  使用 GitHub 注册并登录
                </Button>
              </a>
            </>
          )}

          <p className="text-center text-sm text-muted-foreground">
            已有账号？<Link className="underline" href="/login">登录</Link>
          </p>

          {state?.ok && (
            <OneTimeTokenDialog
              token={state.token}
              open={open}
              onOpenChange={(o) => {
                setOpen(o);
                if (!o) router.push("/dashboard");
              }}
            />
          )}
        </CardContent>
      </Card>
    );
  }
  ```

- [ ] **Step 5: 暴露 `NEXT_PUBLIC_GITHUB_ENABLED`（GitHub OAuth 入口的可见性开关）**

  修改 `.env.example` 末尾追加：
  ```
  # 仅控制前端是否显示 GitHub 登录按钮（实际 OAuth 凭据在 GITHUB_CLIENT_ID/SECRET）
  NEXT_PUBLIC_GITHUB_ENABLED=
  ```
  说明：实际值在 Task 5 配 GitHub OAuth 时一并补到 `.env`。

- [ ] **Step 6: 编译 + 测试**

  Run: `pnpm tsc --noEmit && pnpm test && pnpm build`
  Expected: 全部通过。

- [ ] **Step 7: 起 dev server 手动验证（关键）**

  Run: `pnpm dev`
  在浏览器：
  1. 访问 `/login` → 显示表单（GitHub 按钮隐藏）。
  2. 访问 `/dashboard` 未登录 → 自动跳 `/login?returnTo=%2Fdashboard`。
  3. 访问 `/register` → 提交一个新邮箱注册 → 弹出 token 对话框 → 复制按钮可用 → 关闭后跳 `/dashboard`。
  4. `/dashboard` 路由现在还没实现，会 404 —— 暂时正常，Task 8 实现。
  5. 退回 `/login`（手动改 URL），用 admin 账号（环境变量里的 `ADMIN_EMAIL`/`ADMIN_PASSWORD`，注意需先经 docker compose seed 或 `pnpm db:seed` 落地）登录 → 应该 redirect。
  6. 测完 Ctrl-C 关掉 dev server。

- [ ] **Step 8: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat: add login/register/logout actions + auth pages + OneTimeTokenDialog"
  ```

---

## Task 5: GitHub OAuth（arctic + linkOrCreateGithubUser + 路由 + 测试）

**Files:**
- Create: `src/lib/auth/github.ts`, `src/app/api/auth/github/route.ts`, `src/app/api/auth/github/callback/route.ts`, `tests/integration/github-oauth.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: 安装 arctic**

  Run: `pnpm add arctic`

- [ ] **Step 2: `.env.example` 追加 OAuth 变量**

  在文件末尾追加（如已经追加过 NEXT_PUBLIC_GITHUB_ENABLED 则保持唯一）：
  ```
  GITHUB_CLIENT_ID=
  GITHUB_CLIENT_SECRET=
  GITHUB_REDIRECT_URI=http://localhost:3000/api/auth/github/callback
  NEXT_PUBLIC_GITHUB_ENABLED=
  ```

- [ ] **Step 3: 创建 `src/lib/auth/github.ts`**

  ```typescript
  import { GitHub } from "arctic";
  import type { PrismaClient, User } from "@prisma/client";

  export interface GithubProfile {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
  }

  export interface GithubEmail {
    email: string;
    primary: boolean;
    verified: boolean;
  }

  export function buildGithubClient() {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    const redirectUri = process.env.GITHUB_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) return null;
    return new GitHub(clientId, clientSecret, redirectUri);
  }

  export interface GithubFetcher {
    fetchProfile(accessToken: string): Promise<GithubProfile>;
    fetchPrimaryEmail(accessToken: string): Promise<string>;
  }

  export const liveGithubFetcher: GithubFetcher = {
    async fetchProfile(token) {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      });
      if (!res.ok) throw new Error(`github /user failed: ${res.status}`);
      return res.json();
    },
    async fetchPrimaryEmail(token) {
      const res = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      });
      if (!res.ok) throw new Error(`github /user/emails failed: ${res.status}`);
      const emails: GithubEmail[] = await res.json();
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (!primary) throw new Error("no verified email from GitHub");
      return primary.email;
    },
  };

  export interface LinkOrCreateInput {
    profile: GithubProfile;
    primaryEmail: string;
  }

  /**
   * 按 githubId → email → 创建 的优先级落地用户。
   * 返回该用户记录。
   */
  export async function linkOrCreateGithubUser(
    prisma: PrismaClient,
    input: LinkOrCreateInput,
  ): Promise<User> {
    const avatarUrl = `https://avatars.githubusercontent.com/u/${input.profile.id}?v=4`;
    const displayName = input.profile.name?.trim() || input.profile.login;
    const githubId = String(input.profile.id);

    // 1) 按 githubId 命中
    const byGithub = await prisma.user.findUnique({ where: { githubId } });
    if (byGithub) {
      return prisma.user.update({
        where: { id: byGithub.id },
        data: { avatarUrl, name: displayName },
      });
    }

    // 2) 按 email 命中已有密码用户
    const byEmail = await prisma.user.findUnique({ where: { email: input.primaryEmail } });
    if (byEmail) {
      return prisma.user.update({
        where: { id: byEmail.id },
        data: { githubId, avatarUrl },
      });
    }

    // 3) 创建新 approved 用户（OAuth-only，passwordHash 空串拒绝密码登录）
    return prisma.user.create({
      data: {
        email: input.primaryEmail,
        name: displayName,
        passwordHash: "",
        status: "approved",
        role: "member",
        githubId,
        avatarUrl,
      },
    });
  }
  ```

- [ ] **Step 4: 创建 `src/app/api/auth/github/route.ts`**

  ```typescript
  import { NextResponse } from "next/server";
  import { cookies } from "next/headers";
  import { generateState } from "arctic";
  import { buildGithubClient } from "@/lib/auth/github";

  export async function GET(req: Request) {
    const gh = buildGithubClient();
    if (!gh) return NextResponse.json({ error: "github oauth not configured" }, { status: 503 });

    const state = generateState();
    const url = gh.createAuthorizationURL(state, ["read:user", "user:email"]);

    const returnTo = new URL(req.url).searchParams.get("returnTo") ?? "/dashboard";
    const jar = await cookies();
    jar.set("gh_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    jar.set("gh_oauth_return", returnTo, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });

    return NextResponse.redirect(url.toString());
  }
  ```

- [ ] **Step 5: 创建 `src/app/api/auth/github/callback/route.ts`**

  ```typescript
  import { NextResponse } from "next/server";
  import { cookies } from "next/headers";
  import { OAuth2RequestError } from "arctic";
  import { prisma } from "@/lib/db";
  import { buildGithubClient, linkOrCreateGithubUser, liveGithubFetcher } from "@/lib/auth/github";
  import { getSession } from "@/lib/auth/session";

  export async function GET(req: Request) {
    const gh = buildGithubClient();
    if (!gh) return NextResponse.json({ error: "github oauth not configured" }, { status: 503 });

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const jar = await cookies();
    const storedState = jar.get("gh_oauth_state")?.value;
    const returnTo = jar.get("gh_oauth_return")?.value ?? "/dashboard";

    if (!code || !state || !storedState || state !== storedState) {
      return NextResponse.json({ error: "invalid oauth state" }, { status: 400 });
    }

    try {
      const tokens = await gh.validateAuthorizationCode(code);
      const accessToken = tokens.accessToken();
      const profile = await liveGithubFetcher.fetchProfile(accessToken);
      const primaryEmail = await liveGithubFetcher.fetchPrimaryEmail(accessToken);

      const user = await linkOrCreateGithubUser(prisma, { profile, primaryEmail });

      const session = await getSession();
      session.userId = user.id;
      session.role = user.role;
      await session.save();

      jar.delete("gh_oauth_state");
      jar.delete("gh_oauth_return");

      return NextResponse.redirect(new URL(returnTo, url).toString());
    } catch (e) {
      if (e instanceof OAuth2RequestError) {
        return NextResponse.json({ error: "oauth exchange failed" }, { status: 400 });
      }
      console.error("github oauth callback", e);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
  }
  ```

- [ ] **Step 6: 创建 `tests/integration/github-oauth.test.ts`**

  ```typescript
  import { describe, it, expect, beforeEach, afterAll } from "vitest";
  import { prisma, resetDb } from "../helpers/db";
  import { linkOrCreateGithubUser, type GithubProfile } from "@/lib/auth/github";

  function profile(over: Partial<GithubProfile> = {}): GithubProfile {
    return { id: 12345, login: "octocat", name: "The Octocat", avatar_url: "x", ...over };
  }

  describe("linkOrCreateGithubUser", () => {
    beforeEach(resetDb);
    afterAll(() => prisma.$disconnect());

    it("creates a new approved user when no match", async () => {
      const u = await linkOrCreateGithubUser(prisma, {
        profile: profile(),
        primaryEmail: "octocat@example.com",
      });
      expect(u.status).toBe("approved");
      expect(u.role).toBe("member");
      expect(u.githubId).toBe("12345");
      expect(u.avatarUrl).toBe("https://avatars.githubusercontent.com/u/12345?v=4");
      expect(u.passwordHash).toBe("");
      expect(u.name).toBe("The Octocat");
    });

    it("falls back to login when GitHub name is null", async () => {
      const u = await linkOrCreateGithubUser(prisma, {
        profile: profile({ name: null }),
        primaryEmail: "octocat@example.com",
      });
      expect(u.name).toBe("octocat");
    });

    it("links by email when an existing password user matches", async () => {
      const existing = await prisma.user.create({
        data: { email: "dev@x.com", name: "Dev", passwordHash: "hash", status: "approved" },
      });
      const u = await linkOrCreateGithubUser(prisma, {
        profile: profile({ id: 555 }),
        primaryEmail: "dev@x.com",
      });
      expect(u.id).toBe(existing.id);
      expect(u.githubId).toBe("555");
      expect(u.avatarUrl).toBe("https://avatars.githubusercontent.com/u/555?v=4");
      expect(u.passwordHash).toBe("hash"); // 密码登录依旧可用
    });

    it("matches by githubId and refreshes avatar + name", async () => {
      await prisma.user.create({
        data: {
          email: "dev@x.com",
          name: "Old Name",
          passwordHash: "hash",
          status: "approved",
          githubId: "12345",
          avatarUrl: "https://avatars.githubusercontent.com/u/12345?v=2",
        },
      });
      const u = await linkOrCreateGithubUser(prisma, {
        profile: profile({ name: "New Name" }),
        primaryEmail: "ignored@example.com", // email 不应被覆盖
      });
      expect(u.email).toBe("dev@x.com");
      expect(u.name).toBe("New Name");
      expect(u.avatarUrl).toBe("https://avatars.githubusercontent.com/u/12345?v=4");
    });
  });
  ```

- [ ] **Step 7: 跑测试**

  Run: `pnpm test`
  Expected: 全绿（新增 4 个 OAuth account-matching 用例）。

- [ ] **Step 8: tsc 干净 + build 通过**

  Run: `pnpm tsc --noEmit && pnpm build`
  Expected: clean。

- [ ] **Step 9: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat: add GitHub OAuth (arctic) with link-or-create user logic"
  ```

---

## Task 6: tokens service + 测试

**Files:**
- Create: `src/lib/services/tokens.ts`, `tests/integration/tokens.test.ts`

- [ ] **Step 1: 写失败测试 `tests/integration/tokens.test.ts`**

  ```typescript
  import { describe, it, expect, beforeEach, afterAll } from "vitest";
  import { prisma, resetDb } from "../helpers/db";
  import {
    createTokenFor,
    listTokensFor,
    revokeToken,
    TokenAuthError,
  } from "@/lib/services/tokens";
  import { resolveBearerUser } from "@/lib/auth/bearer";

  async function makeUser(opts: { role?: "admin" | "member"; email?: string } = {}) {
    return prisma.user.create({
      data: {
        email: opts.email ?? `${Math.random().toString(36).slice(2)}@x.com`,
        name: "U",
        passwordHash: "x",
        status: "approved",
        role: opts.role ?? "member",
      },
    });
  }

  describe("tokens service", () => {
    beforeEach(resetDb);
    afterAll(() => prisma.$disconnect());

    it("self can create a token for themselves and use it", async () => {
      const me = await makeUser();
      const { token, record } = await createTokenFor(prisma, me, me.id, "laptop");
      expect(token).toMatch(/^de_/);
      expect(record.name).toBe("laptop");
      const u = await resolveBearerUser(prisma, `Bearer ${token}`);
      expect(u?.id).toBe(me.id);
    });

    it("member cannot create a token for another user", async () => {
      const me = await makeUser();
      const other = await makeUser();
      await expect(createTokenFor(prisma, me, other.id, "x")).rejects.toBeInstanceOf(TokenAuthError);
    });

    it("admin can create a token for another user", async () => {
      const admin = await makeUser({ role: "admin" });
      const other = await makeUser();
      const { token } = await createTokenFor(prisma, admin, other.id, "issued-by-admin");
      const u = await resolveBearerUser(prisma, `Bearer ${token}`);
      expect(u?.id).toBe(other.id);
    });

    it("self can list and revoke own tokens; revoked token no longer authenticates", async () => {
      const me = await makeUser();
      const { token, record } = await createTokenFor(prisma, me, me.id, "n");
      const list = await listTokensFor(prisma, me, me.id);
      expect(list).toHaveLength(1);
      await revokeToken(prisma, me, record.id);
      expect(await resolveBearerUser(prisma, `Bearer ${token}`)).toBeNull();
    });

    it("member cannot revoke another user's token; admin can", async () => {
      const owner = await makeUser();
      const { record } = await createTokenFor(prisma, owner, owner.id, "n");
      const other = await makeUser();
      await expect(revokeToken(prisma, other, record.id)).rejects.toBeInstanceOf(TokenAuthError);
      const admin = await makeUser({ role: "admin" });
      await revokeToken(prisma, admin, record.id);
      const stored = await prisma.authToken.findUnique({ where: { id: record.id } });
      expect(stored?.revokedAt).not.toBeNull();
    });

    it("listTokensFor refuses cross-user listing by non-admin", async () => {
      const me = await makeUser();
      const other = await makeUser();
      await expect(listTokensFor(prisma, me, other.id)).rejects.toBeInstanceOf(TokenAuthError);
    });

    it("listed token records do not include the raw token", async () => {
      const me = await makeUser();
      await createTokenFor(prisma, me, me.id, "n");
      const list = await listTokensFor(prisma, me, me.id);
      const keys = Object.keys(list[0]);
      expect(keys).not.toContain("tokenHash");
    });
  });
  ```

- [ ] **Step 2: 跑测试确认 FAIL**

  Run: `pnpm vitest run tests/integration/tokens.test.ts`
  Expected: FAIL（service 不存在）。

- [ ] **Step 3: 实现 `src/lib/services/tokens.ts`**

  ```typescript
  import type { AuthToken, PrismaClient, User } from "@prisma/client";
  import { generateToken, hashToken } from "@/lib/auth/token";

  export class TokenAuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "TokenAuthError";
    }
  }

  /** 不含 tokenHash 的安全投影，用于列表展示 */
  export type TokenSummary = Omit<AuthToken, "tokenHash">;

  const SAFE_SELECT = {
    id: true,
    userId: true,
    name: true,
    createdAt: true,
    lastUsedAt: true,
    revokedAt: true,
  } as const;

  function canActOn(viewer: User, targetUserId: string): boolean {
    return viewer.role === "admin" || viewer.id === targetUserId;
  }

  export async function listTokensFor(
    prisma: PrismaClient,
    viewer: User,
    userId: string,
  ): Promise<TokenSummary[]> {
    if (!canActOn(viewer, userId)) {
      throw new TokenAuthError("forbidden");
    }
    return prisma.authToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: SAFE_SELECT,
    });
  }

  export interface CreatedToken {
    token: string; // 明文，仅本次返回
    record: TokenSummary;
  }

  export async function createTokenFor(
    prisma: PrismaClient,
    viewer: User,
    userId: string,
    name: string,
  ): Promise<CreatedToken> {
    if (!canActOn(viewer, userId)) {
      throw new TokenAuthError("forbidden");
    }
    const raw = generateToken();
    const record = await prisma.authToken.create({
      data: { userId, tokenHash: hashToken(raw), name },
      select: SAFE_SELECT,
    });
    return { token: raw, record };
  }

  export async function revokeToken(
    prisma: PrismaClient,
    viewer: User,
    tokenId: string,
  ): Promise<void> {
    const tok = await prisma.authToken.findUnique({ where: { id: tokenId } });
    if (!tok) throw new TokenAuthError("not found");
    if (!canActOn(viewer, tok.userId)) {
      throw new TokenAuthError("forbidden");
    }
    if (tok.revokedAt) return;
    await prisma.authToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }
  ```

- [ ] **Step 4: 跑测试确认 PASS**

  Run: `pnpm vitest run tests/integration/tokens.test.ts`
  Expected: PASS。

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat: add tokens service with viewer-scoped authorization"
  ```

---

## Task 7: users service + 测试

**Files:**
- Create: `src/lib/services/users.ts`, `tests/integration/users.test.ts`

- [ ] **Step 1: 写失败测试 `tests/integration/users.test.ts`**

  ```typescript
  import { describe, it, expect, beforeEach, afterAll } from "vitest";
  import { prisma, resetDb } from "../helpers/db";
  import { listUsers, updateUserStatus, UsersAuthError } from "@/lib/services/users";

  async function makeUser(opts: { role?: "admin" | "member"; status?: "approved" | "disabled"; email?: string } = {}) {
    return prisma.user.create({
      data: {
        email: opts.email ?? `${Math.random().toString(36).slice(2)}@x.com`,
        name: "U",
        passwordHash: "x",
        role: opts.role ?? "member",
        status: opts.status ?? "approved",
      },
    });
  }

  describe("users service", () => {
    beforeEach(resetDb);
    afterAll(() => prisma.$disconnect());

    it("listUsers returns all users for admin", async () => {
      const admin = await makeUser({ role: "admin" });
      await makeUser();
      await makeUser();
      const list = await listUsers(prisma, admin, {});
      expect(list).toHaveLength(3);
    });

    it("listUsers forbidden for member", async () => {
      const me = await makeUser();
      await expect(listUsers(prisma, me, {})).rejects.toBeInstanceOf(UsersAuthError);
    });

    it("listUsers can filter by status", async () => {
      const admin = await makeUser({ role: "admin" });
      await makeUser({ status: "approved" });
      await makeUser({ status: "disabled" });
      const approved = await listUsers(prisma, admin, { status: "approved" });
      const disabled = await listUsers(prisma, admin, { status: "disabled" });
      expect(approved.filter((u) => u.id !== admin.id)).toHaveLength(1);
      expect(disabled).toHaveLength(1);
    });

    it("admin can disable another user", async () => {
      const admin = await makeUser({ role: "admin" });
      const target = await makeUser();
      const updated = await updateUserStatus(prisma, admin, target.id, "disabled");
      expect(updated.status).toBe("disabled");
    });

    it("member cannot change status", async () => {
      const me = await makeUser();
      const target = await makeUser();
      await expect(
        updateUserStatus(prisma, me, target.id, "disabled"),
      ).rejects.toBeInstanceOf(UsersAuthError);
    });

    it("admin cannot disable themselves", async () => {
      const admin = await makeUser({ role: "admin" });
      await expect(
        updateUserStatus(prisma, admin, admin.id, "disabled"),
      ).rejects.toBeInstanceOf(UsersAuthError);
    });
  });
  ```

- [ ] **Step 2: 跑测试确认 FAIL**

  Run: `pnpm vitest run tests/integration/users.test.ts`
  Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/services/users.ts`**

  ```typescript
  import type { PrismaClient, User, UserStatus } from "@prisma/client";

  export class UsersAuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "UsersAuthError";
    }
  }

  /** 安全投影：不返回 passwordHash */
  export type UserSummary = Omit<User, "passwordHash">;

  const SAFE_SELECT = {
    id: true,
    email: true,
    name: true,
    role: true,
    status: true,
    avatarUrl: true,
    githubId: true,
    createdAt: true,
  } as const;

  export async function listUsers(
    prisma: PrismaClient,
    viewer: User,
    opts: { status?: UserStatus } = {},
  ): Promise<UserSummary[]> {
    if (viewer.role !== "admin") {
      throw new UsersAuthError("forbidden");
    }
    return prisma.user.findMany({
      where: opts.status ? { status: opts.status } : undefined,
      orderBy: { createdAt: "desc" },
      select: SAFE_SELECT,
    });
  }

  export async function updateUserStatus(
    prisma: PrismaClient,
    viewer: User,
    userId: string,
    status: UserStatus,
  ): Promise<UserSummary> {
    if (viewer.role !== "admin") {
      throw new UsersAuthError("forbidden");
    }
    if (viewer.id === userId && status !== "approved") {
      throw new UsersAuthError("admin cannot disable themselves");
    }
    return prisma.user.update({
      where: { id: userId },
      data: { status },
      select: SAFE_SELECT,
    });
  }
  ```

- [ ] **Step 4: 跑测试确认 PASS**

  Run: `pnpm vitest run tests/integration/users.test.ts`
  Expected: PASS。

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat: add users service (listUsers, updateUserStatus) with admin-only guards"
  ```

---

## Task 8: metrics service + 时间范围工具 + 测试

**Files:**
- Create: `src/lib/range.ts`, `src/lib/services/metrics.ts`, `tests/integration/metrics.test.ts`, `tests/unit/range.test.ts`

- [ ] **Step 1: 写 `tests/unit/range.test.ts`（时间范围解析）**

  ```typescript
  import { describe, it, expect } from "vitest";
  import { parseRange, type DateRange } from "@/lib/range";

  describe("parseRange", () => {
    it("parses preset 7d / 30d / 90d", () => {
      const r7 = parseRange({ preset: "7d" }, new Date("2026-05-29T00:00:00.000Z"));
      expect(r7.to.toISOString().slice(0, 10)).toBe("2026-05-29");
      expect(r7.from.toISOString().slice(0, 10)).toBe("2026-05-23");
    });

    it("parses custom from/to overriding preset", () => {
      const r = parseRange({ from: "2026-05-01", to: "2026-05-10" });
      expect(r.from.toISOString().slice(0, 10)).toBe("2026-05-01");
      expect(r.to.toISOString().slice(0, 10)).toBe("2026-05-10");
    });

    it("defaults to 7d when nothing provided", () => {
      const r = parseRange({}, new Date("2026-05-29T00:00:00.000Z"));
      expect(r.from.toISOString().slice(0, 10)).toBe("2026-05-23");
    });

    it("rejects from > to by swapping", () => {
      const r = parseRange({ from: "2026-05-10", to: "2026-05-01" });
      expect(r.from < r.to).toBe(true);
    });
  });
  ```

- [ ] **Step 2: 实现 `src/lib/range.ts`**

  ```typescript
  export interface DateRange {
    from: Date;
    to: Date;
  }

  type PresetKey = "7d" | "30d" | "90d";

  const PRESET_DAYS: Record<PresetKey, number> = { "7d": 6, "30d": 29, "90d": 89 };

  function utcDate(s: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const d = new Date(`${s}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  export function parseRange(
    params: { preset?: string | null; from?: string | null; to?: string | null },
    today: Date = new Date(),
  ): DateRange {
    if (params.from && params.to) {
      const f = utcDate(params.from);
      const t = utcDate(params.to);
      if (f && t) {
        return f <= t ? { from: f, to: t } : { from: t, to: f };
      }
    }
    const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const preset = (params.preset as PresetKey) ?? "7d";
    const days = PRESET_DAYS[preset] ?? PRESET_DAYS["7d"];
    const from = new Date(todayUtc);
    from.setUTCDate(from.getUTCDate() - days);
    return { from, to: todayUtc };
  }
  ```

- [ ] **Step 3: 跑 range 单测**

  Run: `pnpm vitest run tests/unit/range.test.ts`
  Expected: PASS。

- [ ] **Step 4: 写失败测试 `tests/integration/metrics.test.ts`**

  ```typescript
  import { describe, it, expect, beforeEach, afterAll } from "vitest";
  import { prisma, resetDb } from "../helpers/db";
  import {
    dailyTotals,
    userRanking,
    toolBreakdown,
    modelBreakdown,
    MetricsAuthError,
  } from "@/lib/services/metrics";

  async function makeUser(over: { role?: "admin" | "member" } = {}) {
    return prisma.user.create({
      data: {
        email: `${Math.random().toString(36).slice(2)}@x.com`,
        name: "U",
        passwordHash: "x",
        status: "approved",
        role: over.role ?? "member",
      },
    });
  }

  async function record(
    userId: string,
    over: { date?: string; tool?: "claude_code" | "codex" | "cursor"; model?: string; total?: bigint } = {},
  ) {
    return prisma.usageRecord.create({
      data: {
        userId,
        date: new Date(`${over.date ?? "2026-05-25"}T00:00:00.000Z`),
        tool: over.tool ?? "claude_code",
        model: over.model ?? "claude-opus-4-7",
        project: "",
        inputTokens: 0n,
        outputTokens: 0n,
        cacheCreationTokens: 0n,
        cacheReadTokens: 0n,
        totalTokens: over.total ?? 100n,
        sessionCount: 1,
        messageCount: 1,
        source: "auto",
      },
    });
  }

  const range = { from: new Date("2026-05-20T00:00:00.000Z"), to: new Date("2026-05-31T00:00:00.000Z") };

  describe("metrics service viewer scoping", () => {
    beforeEach(resetDb);
    afterAll(() => prisma.$disconnect());

    it("dailyTotals for member returns only their own data even if userId is forged", async () => {
      const me = await makeUser();
      const other = await makeUser();
      await record(me.id, { date: "2026-05-25", total: 10n });
      await record(other.id, { date: "2026-05-25", total: 99n });

      const own = await dailyTotals(prisma, me, range, {});
      expect(own.reduce((s, p) => s + Number(p.total), 0)).toBe(10);

      // Forged userId: member 试图查别人 → 仍只见自己
      const forged = await dailyTotals(prisma, me, range, { userId: other.id });
      expect(forged.reduce((s, p) => s + Number(p.total), 0)).toBe(10);
    });

    it("dailyTotals for admin can target a specific userId", async () => {
      const admin = await makeUser({ role: "admin" });
      const target = await makeUser();
      await record(target.id, { date: "2026-05-25", total: 77n });
      const r = await dailyTotals(prisma, admin, range, { userId: target.id });
      expect(r.reduce((s, p) => s + Number(p.total), 0)).toBe(77);
    });

    it("dailyTotals admin without userId returns ALL users", async () => {
      const admin = await makeUser({ role: "admin" });
      const a = await makeUser();
      const b = await makeUser();
      await record(a.id, { date: "2026-05-25", total: 10n });
      await record(b.id, { date: "2026-05-25", total: 30n });
      const r = await dailyTotals(prisma, admin, range, {});
      expect(r.reduce((s, p) => s + Number(p.total), 0)).toBe(40);
    });

    it("userRanking forbidden for member", async () => {
      const me = await makeUser();
      await expect(userRanking(prisma, me, range)).rejects.toBeInstanceOf(MetricsAuthError);
    });

    it("userRanking returns sorted aggregate for admin", async () => {
      const admin = await makeUser({ role: "admin" });
      const big = await makeUser();
      const small = await makeUser();
      await record(big.id, { total: 500n });
      await record(small.id, { total: 100n });
      const r = await userRanking(prisma, admin, range);
      expect(r[0].userId).toBe(big.id);
      expect(Number(r[0].total)).toBe(500);
      expect(r[1].userId).toBe(small.id);
    });

    it("toolBreakdown/modelBreakdown collapse correctly and respect viewer scoping", async () => {
      const me = await makeUser();
      const other = await makeUser();
      await record(me.id, { tool: "claude_code", model: "claude-opus-4-7", total: 10n });
      await record(me.id, { tool: "codex", model: "gpt-5.4", total: 30n });
      await record(other.id, { tool: "claude_code", model: "claude-opus-4-7", total: 999n });

      const tools = await toolBreakdown(prisma, me, range, {});
      expect(tools.find((t) => t.tool === "claude-code")?.total).toBe(10n);
      expect(tools.find((t) => t.tool === "codex")?.total).toBe(30n);

      const models = await modelBreakdown(prisma, me, range, {});
      expect(models.find((m) => m.model === "claude-opus-4-7")?.total).toBe(10n);
    });
  });
  ```

- [ ] **Step 5: 跑测试确认 FAIL**

  Run: `pnpm vitest run tests/integration/metrics.test.ts`
  Expected: FAIL（service 不存在）。

- [ ] **Step 6: 实现 `src/lib/services/metrics.ts`**

  ```typescript
  import type { PrismaClient, Tool, User } from "@prisma/client";
  import { toolToApi, type ApiTool } from "@/lib/tool";
  import type { DateRange } from "@/lib/range";

  export class MetricsAuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MetricsAuthError";
    }
  }

  /**
   * 把请求里 raw 的 userId 收敛为「viewer 实际允许查询的 userId」：
   * - admin：opts.userId 不为空 → 查目标用户；为空 → null（=查全员）
   * - member：始终强制为 viewer.id（无论传入什么）
   */
  function effectiveUserId(viewer: User, requested?: string | null): string | null {
    if (viewer.role === "admin") return requested ?? null;
    return viewer.id;
  }

  export interface DailyPoint {
    date: string; // YYYY-MM-DD
    total: bigint;
  }

  export async function dailyTotals(
    prisma: PrismaClient,
    viewer: User,
    range: DateRange,
    opts: { userId?: string | null },
  ): Promise<DailyPoint[]> {
    const userId = effectiveUserId(viewer, opts.userId);
    const rows = await prisma.usageRecord.groupBy({
      by: ["date"],
      where: {
        date: { gte: range.from, lte: range.to },
        ...(userId ? { userId } : {}),
      },
      _sum: { totalTokens: true },
      orderBy: { date: "asc" },
    });
    return rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      total: r._sum.totalTokens ?? 0n,
    }));
  }

  export interface UserRankingRow {
    userId: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    total: bigint;
  }

  export async function userRanking(
    prisma: PrismaClient,
    viewer: User,
    range: DateRange,
  ): Promise<UserRankingRow[]> {
    if (viewer.role !== "admin") throw new MetricsAuthError("forbidden");

    const grouped = await prisma.usageRecord.groupBy({
      by: ["userId"],
      where: { date: { gte: range.from, lte: range.to } },
      _sum: { totalTokens: true },
    });
    if (grouped.length === 0) return [];

    const users = await prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.userId) } },
      select: { id: true, name: true, email: true, avatarUrl: true },
    });
    const byId = new Map(users.map((u) => [u.id, u] as const));

    return grouped
      .map((g) => ({
        userId: g.userId,
        name: byId.get(g.userId)?.name ?? "(unknown)",
        email: byId.get(g.userId)?.email ?? "",
        avatarUrl: byId.get(g.userId)?.avatarUrl ?? null,
        total: g._sum.totalTokens ?? 0n,
      }))
      .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
  }

  export interface ToolPoint {
    tool: ApiTool;
    total: bigint;
  }

  export async function toolBreakdown(
    prisma: PrismaClient,
    viewer: User,
    range: DateRange,
    opts: { userId?: string | null },
  ): Promise<ToolPoint[]> {
    const userId = effectiveUserId(viewer, opts.userId);
    const rows = await prisma.usageRecord.groupBy({
      by: ["tool"],
      where: {
        date: { gte: range.from, lte: range.to },
        ...(userId ? { userId } : {}),
      },
      _sum: { totalTokens: true },
    });
    return rows.map((r) => ({
      tool: toolToApi(r.tool),
      total: r._sum.totalTokens ?? 0n,
    }));
  }

  export interface ModelPoint {
    model: string;
    total: bigint;
  }

  export async function modelBreakdown(
    prisma: PrismaClient,
    viewer: User,
    range: DateRange,
    opts: { userId?: string | null },
  ): Promise<ModelPoint[]> {
    const userId = effectiveUserId(viewer, opts.userId);
    const rows = await prisma.usageRecord.groupBy({
      by: ["model"],
      where: {
        date: { gte: range.from, lte: range.to },
        ...(userId ? { userId } : {}),
      },
      _sum: { totalTokens: true },
      orderBy: { _sum: { totalTokens: "desc" } },
    });
    return rows.map((r) => ({
      model: r.model,
      total: r._sum.totalTokens ?? 0n,
    }));
  }
  ```

- [ ] **Step 7: 跑测试确认 PASS**

  Run: `pnpm vitest run tests/integration/metrics.test.ts tests/unit/range.test.ts`
  Expected: PASS。

- [ ] **Step 8: 全量测试不退化**

  Run: `pnpm test && pnpm tsc --noEmit`
  Expected: all green / clean。

- [ ] **Step 9: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat: add metrics service with strict viewer-scoping + range utility"
  ```

---

## Task 9: 图表组件（client，Recharts）+ DateRangePicker

**Files:**
- Create: `src/components/charts/DailyTrendChart.tsx`, `src/components/charts/ToolBreakdownChart.tsx`, `src/components/charts/ModelBreakdownChart.tsx`, `src/components/charts/UserRankingTable.tsx`, `src/components/DateRangePicker.tsx`

- [ ] **Step 1: 安装 Recharts**

  Run: `pnpm add recharts`

- [ ] **Step 2: `src/components/charts/DailyTrendChart.tsx`**

  ```tsx
  "use client";

  import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  } from "recharts";

  export interface DailyTrendDatum {
    date: string;
    total: number;
  }

  export function DailyTrendChart({ data }: { data: DailyTrendDatum[] }) {
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v: number) => v.toLocaleString()} />
            <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  ```

- [ ] **Step 3: `src/components/charts/ToolBreakdownChart.tsx`**

  ```tsx
  "use client";

  import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  } from "recharts";

  export interface ToolDatum {
    tool: string;
    total: number;
  }

  export function ToolBreakdownChart({ data }: { data: ToolDatum[] }) {
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="tool" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 12 }} />
            <Tooltip formatter={(v: number) => v.toLocaleString()} />
            <Bar dataKey="total" fill="hsl(var(--primary))" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  ```

- [ ] **Step 4: `src/components/charts/ModelBreakdownChart.tsx`**

  ```tsx
  "use client";

  import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  } from "recharts";

  export interface ModelDatum {
    model: string;
    total: number;
  }

  export function ModelBreakdownChart({ data }: { data: ModelDatum[] }) {
    return (
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="model" tick={{ fontSize: 12 }} width={140} />
            <Tooltip formatter={(v: number) => v.toLocaleString()} />
            <Bar dataKey="total" fill="hsl(var(--primary))" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  ```

- [ ] **Step 5: `src/components/charts/UserRankingTable.tsx`**

  ```tsx
  import { UserAvatar } from "@/components/UserAvatar";
  import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  } from "@/components/ui/table";

  export interface RankingRow {
    userId: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    total: number;
  }

  export function UserRankingTable({ data }: { data: RankingRow[] }) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>用户</TableHead>
            <TableHead className="text-right">Token 总量</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, idx) => (
            <TableRow key={row.userId}>
              <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <UserAvatar name={row.name} avatarUrl={row.avatarUrl} size={24} />
                  <div className="flex flex-col">
                    <span>{row.name}</span>
                    <span className="text-xs text-muted-foreground">{row.email}</span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.total.toLocaleString()}</TableCell>
            </TableRow>
          ))}
          {data.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">
                所选时段暂无数据
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    );
  }
  ```

- [ ] **Step 6: `src/components/DateRangePicker.tsx`**

  ```tsx
  "use client";

  import { useState } from "react";
  import { usePathname, useRouter, useSearchParams } from "next/navigation";
  import { CalendarIcon } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Calendar } from "@/components/ui/calendar";
  import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
  import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  } from "@/components/ui/select";

  const PRESETS = [
    { value: "7d", label: "近 7 天" },
    { value: "30d", label: "近 30 天" },
    { value: "90d", label: "近 90 天" },
  ] as const;

  function toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  export function DateRangePicker() {
    const router = useRouter();
    const pathname = usePathname();
    const params = useSearchParams();
    const currentPreset = params.get("preset") ?? (params.get("from") ? "custom" : "7d");

    const [open, setOpen] = useState(false);
    const [from, setFrom] = useState<Date | undefined>();
    const [to, setTo] = useState<Date | undefined>();

    function push(qs: URLSearchParams) {
      router.push(`${pathname}?${qs.toString()}`);
    }

    function selectPreset(value: string) {
      const qs = new URLSearchParams();
      qs.set("preset", value);
      push(qs);
    }

    function applyCustom() {
      if (!from || !to) return;
      const qs = new URLSearchParams();
      qs.set("from", toIsoDate(from));
      qs.set("to", toIsoDate(to));
      push(qs);
      setOpen(false);
    }

    return (
      <div className="flex items-center gap-2">
        <Select value={currentPreset === "custom" ? "7d" : currentPreset} onValueChange={selectPreset}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <CalendarIcon className="mr-2 h-4 w-4" /> 自定义
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="end">
            <div className="flex flex-col gap-2">
              <div className="flex gap-4">
                <div>
                  <div className="px-1 pb-1 text-xs text-muted-foreground">开始</div>
                  <Calendar mode="single" selected={from} onSelect={setFrom} />
                </div>
                <div>
                  <div className="px-1 pb-1 text-xs text-muted-foreground">结束</div>
                  <Calendar mode="single" selected={to} onSelect={setTo} />
                </div>
              </div>
              <Button size="sm" onClick={applyCustom} disabled={!from || !to}>
                应用
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    );
  }
  ```

- [ ] **Step 7: 编译验证**

  Run: `pnpm tsc --noEmit && pnpm test`
  Expected: clean / green。

- [ ] **Step 8: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat: add Recharts components and DateRangePicker"
  ```

---

## Task 10: 个人仪表盘 `/dashboard` + tokens UI

**Files:**
- Create: `src/lib/actions/tokens.ts`, `src/components/TokenList.tsx`, `src/components/TokenCreateDialog.tsx`, `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: 创建 `src/lib/actions/tokens.ts`**

  ```typescript
  "use server";

  import { revalidatePath } from "next/cache";
  import { prisma } from "@/lib/db";
  import { getSession } from "@/lib/auth/session";
  import { createTokenFor, revokeToken } from "@/lib/services/tokens";

  async function viewer() {
    const session = await getSession();
    if (!session.userId) throw new Error("unauthenticated");
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new Error("unauthenticated");
    return user;
  }

  export interface CreateTokenResult {
    ok: boolean;
    token?: string;
    error?: string;
  }

  export async function createTokenAction(targetUserId: string, name: string): Promise<CreateTokenResult> {
    try {
      const v = await viewer();
      const trimmed = name.trim() || "default";
      const { token } = await createTokenFor(prisma, v, targetUserId, trimmed);
      revalidatePath("/dashboard");
      revalidatePath(`/admin/users`);
      return { ok: true, token };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "failed" };
    }
  }

  export async function revokeTokenAction(tokenId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const v = await viewer();
      await revokeToken(prisma, v, tokenId);
      revalidatePath("/dashboard");
      revalidatePath(`/admin/users`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "failed" };
    }
  }
  ```

- [ ] **Step 2: 创建 `src/components/TokenList.tsx`**

  ```tsx
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
  ```

- [ ] **Step 3: 创建 `src/components/TokenCreateDialog.tsx`**

  ```tsx
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
  ```

- [ ] **Step 4: 创建 `src/app/(app)/dashboard/page.tsx`**

  ```tsx
  import { redirect } from "next/navigation";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { prisma } from "@/lib/db";
  import { getSession } from "@/lib/auth/session";
  import { parseRange } from "@/lib/range";
  import { dailyTotals, toolBreakdown, modelBreakdown } from "@/lib/services/metrics";
  import { listTokensFor } from "@/lib/services/tokens";
  import { DailyTrendChart } from "@/components/charts/DailyTrendChart";
  import { ToolBreakdownChart } from "@/components/charts/ToolBreakdownChart";
  import { ModelBreakdownChart } from "@/components/charts/ModelBreakdownChart";
  import { DateRangePicker } from "@/components/DateRangePicker";
  import { TokenList } from "@/components/TokenList";
  import { TokenCreateDialog } from "@/components/TokenCreateDialog";

  interface SearchParams {
    preset?: string;
    from?: string;
    to?: string;
  }

  export default async function DashboardPage({
    searchParams,
  }: {
    searchParams: Promise<SearchParams>;
  }) {
    const session = await getSession();
    if (!session.userId) redirect("/login");
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) redirect("/login");

    const sp = await searchParams;
    const range = parseRange(sp);

    const [trend, tools, models, tokens] = await Promise.all([
      dailyTotals(prisma, user, range, {}),
      toolBreakdown(prisma, user, range, {}),
      modelBreakdown(prisma, user, range, {}),
      listTokensFor(prisma, user, user.id),
    ]);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">个人仪表盘</h1>
          <DateRangePicker />
        </div>

        <Card>
          <CardHeader><CardTitle>每日 Token 趋势</CardTitle></CardHeader>
          <CardContent>
            <DailyTrendChart data={trend.map((p) => ({ date: p.date, total: Number(p.total) }))} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>按工具</CardTitle></CardHeader>
            <CardContent>
              <ToolBreakdownChart data={tools.map((t) => ({ tool: t.tool, total: Number(t.total) }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>按模型</CardTitle></CardHeader>
            <CardContent>
              <ModelBreakdownChart data={models.map((m) => ({ model: m.model, total: Number(m.total) }))} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>我的 Auth Tokens</CardTitle>
            <TokenCreateDialog targetUserId={user.id} />
          </CardHeader>
          <CardContent>
            <TokenList
              tokens={tokens.map((t) => ({
                id: t.id,
                name: t.name,
                createdAt: t.createdAt.toISOString(),
                lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
                revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    );
  }
  ```

- [ ] **Step 5: 编译 + 测试 + 手工浏览器验证**

  Run: `pnpm tsc --noEmit && pnpm test && pnpm build`
  Then: `pnpm dev`，登录后访问 `/dashboard`，确认：
  1. 三个图表正常渲染（即使数据为空也不报错）。
  2. 时间范围切换工作。
  3. 「创建 token」流程：起名 → 提交 → 弹出明文 token 对话框 → 复制可用 → 关闭后 token 出现在列表里。
  4. 吊销 token 工作（confirm 提示）；吊销后列表显示「已吊销」徽章。
  Expected: 一切正常。

- [ ] **Step 6: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat: add /dashboard with metrics charts and self-service tokens"
  ```

---

## Task 11: admin 平台总览 `/admin`

**Files:**
- Create: `src/app/(app)/admin/page.tsx`

- [ ] **Step 1: 创建 `src/app/(app)/admin/page.tsx`**

  ```tsx
  import { redirect } from "next/navigation";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import { prisma } from "@/lib/db";
  import { getSession } from "@/lib/auth/session";
  import { parseRange } from "@/lib/range";
  import {
    dailyTotals, userRanking, toolBreakdown, modelBreakdown,
  } from "@/lib/services/metrics";
  import { DailyTrendChart } from "@/components/charts/DailyTrendChart";
  import { ToolBreakdownChart } from "@/components/charts/ToolBreakdownChart";
  import { ModelBreakdownChart } from "@/components/charts/ModelBreakdownChart";
  import { UserRankingTable } from "@/components/charts/UserRankingTable";
  import { DateRangePicker } from "@/components/DateRangePicker";

  interface SearchParams {
    preset?: string;
    from?: string;
    to?: string;
  }

  export default async function AdminOverviewPage({
    searchParams,
  }: {
    searchParams: Promise<SearchParams>;
  }) {
    const session = await getSession();
    if (!session.userId) redirect("/login");
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || user.role !== "admin") redirect("/dashboard");

    const sp = await searchParams;
    const range = parseRange(sp);

    const [trend, ranking, tools, models] = await Promise.all([
      dailyTotals(prisma, user, range, {}),
      userRanking(prisma, user, range),
      toolBreakdown(prisma, user, range, {}),
      modelBreakdown(prisma, user, range, {}),
    ]);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">平台总览</h1>
          <DateRangePicker />
        </div>

        <Card>
          <CardHeader><CardTitle>团队每日 Token 趋势</CardTitle></CardHeader>
          <CardContent>
            <DailyTrendChart data={trend.map((p) => ({ date: p.date, total: Number(p.total) }))} />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>按工具</CardTitle></CardHeader>
            <CardContent>
              <ToolBreakdownChart data={tools.map((t) => ({ tool: t.tool, total: Number(t.total) }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>按模型</CardTitle></CardHeader>
            <CardContent>
              <ModelBreakdownChart data={models.map((m) => ({ model: m.model, total: Number(m.total) }))} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>用户排行</CardTitle></CardHeader>
          <CardContent>
            <UserRankingTable
              data={ranking.map((r) => ({
                userId: r.userId, name: r.name, email: r.email,
                avatarUrl: r.avatarUrl, total: Number(r.total),
              }))}
            />
          </CardContent>
        </Card>
      </div>
    );
  }
  ```

- [ ] **Step 2: 编译 + 浏览器手工验证**

  Run: `pnpm tsc --noEmit && pnpm build` 然后 `pnpm dev`。
  用 admin 账号登录后访问 `/admin` —— 应该看到完整四个区块。member 账号访问 `/admin` 应被中间件重定向到 `/dashboard`。
  Expected: 正常。

- [ ] **Step 3: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat: add /admin platform overview"
  ```

---

## Task 12: admin 用户管理 `/admin/users`

**Files:**
- Create: `src/lib/actions/users.ts`, `src/components/UserRow.tsx`, `src/app/(app)/admin/users/page.tsx`

- [ ] **Step 1: 创建 `src/lib/actions/users.ts`**

  ```typescript
  "use server";

  import { revalidatePath } from "next/cache";
  import { prisma } from "@/lib/db";
  import { getSession } from "@/lib/auth/session";
  import { updateUserStatus } from "@/lib/services/users";

  async function viewer() {
    const session = await getSession();
    if (!session.userId) throw new Error("unauthenticated");
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new Error("unauthenticated");
    return user;
  }

  export async function setUserStatusAction(
    userId: string,
    status: "approved" | "disabled",
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const v = await viewer();
      await updateUserStatus(prisma, v, userId, status);
      revalidatePath("/admin/users");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "failed" };
    }
  }
  ```

- [ ] **Step 2: 创建 `src/components/UserRow.tsx`**

  ```tsx
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
    activeTokenId: string | null; // 「最近一个未吊销的 token」用于「一键吊销」
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
  ```

- [ ] **Step 3: 创建 `src/app/(app)/admin/users/page.tsx`**

  ```tsx
  import { redirect } from "next/navigation";
  import {
    Card, CardContent, CardHeader, CardTitle,
  } from "@/components/ui/card";
  import {
    Table, TableBody, TableHead, TableHeader, TableRow,
  } from "@/components/ui/table";
  import { prisma } from "@/lib/db";
  import { getSession } from "@/lib/auth/session";
  import { listUsers } from "@/lib/services/users";
  import { UserRow, type AdminUserRowData } from "@/components/UserRow";

  export default async function AdminUsersPage() {
    const session = await getSession();
    if (!session.userId) redirect("/login");
    const viewer = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!viewer || viewer.role !== "admin") redirect("/dashboard");

    const users = await listUsers(prisma, viewer, {});

    // 拉每个用户的 token 数量 + 最近一个有效 token（避免每行 N+1，预先做两条聚合）
    const tokenAgg = await prisma.authToken.groupBy({
      by: ["userId"],
      _count: { _all: true },
    });
    const tokenCountByUser = new Map(tokenAgg.map((r) => [r.userId, r._count._all] as const));

    const activeTokens = await prisma.authToken.findMany({
      where: { revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true },
    });
    const activeTokenByUser = new Map<string, string>();
    for (const t of activeTokens) {
      if (!activeTokenByUser.has(t.userId)) activeTokenByUser.set(t.userId, t.id);
    }

    const rows: AdminUserRowData[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      avatarUrl: u.avatarUrl,
      tokenCount: tokenCountByUser.get(u.id) ?? 0,
      activeTokenId: activeTokenByUser.get(u.id) ?? null,
      isSelf: u.id === viewer.id,
    }));

    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">用户管理</h1>
        <Card>
          <CardHeader><CardTitle>全部用户（{rows.length}）</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>Token 数</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => <UserRow key={r.id} data={r} />)}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }
  ```

- [ ] **Step 4: 完整端到端验证**

  Run: `pnpm tsc --noEmit && pnpm test && pnpm build`，然后 `pnpm dev`：
  1. admin 访问 `/admin/users` → 看到全部用户列表 + 自己（不带「禁用」选项）。
  2. 对另一个用户：「代签发 token」→ 弹明文对话框 → 复制 OK。
  3. 「禁用」该用户 → 状态变红。
  4. 用被禁用用户的 token 调 `/api/v1/me`（curl）→ 返回 401（bearer 拒绝非 approved）。
  5. 「启用」该用户 → 恢复。
  6. member 访问 `/admin/users` → 跳 `/dashboard`。
  Expected: 一切正常。

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat: add /admin/users with disable/enable + admin-issued tokens"
  ```

---

## Task 13: 收尾——middleware 单测 + 全量测试 + docker 验证

**Files:**
- Create: `tests/integration/middleware.test.ts`（可选；middleware 直接调用即可）

- [ ] **Step 1: 写 middleware 单测 `tests/integration/middleware.test.ts`（轻量、专注重定向行为）**

  ```typescript
  import { describe, it, expect } from "vitest";
  import { NextRequest } from "next/server";
  import { sealData } from "iron-session";
  import { middleware } from "@/middleware";

  const secret =
    process.env.SESSION_SECRET ?? "dev-only-insecure-secret-min-32-chars!!";

  async function withSession(url: string, session?: { userId: string; role: "admin" | "member" }) {
    const headers = new Headers();
    if (session) {
      const sealed = await sealData(session, { password: secret });
      headers.set("cookie", `de_session=${sealed}`);
    }
    return new NextRequest(url, { headers });
  }

  describe("middleware", () => {
    it("redirects unauthenticated /dashboard → /login?returnTo=/dashboard", async () => {
      const req = await withSession("http://t/dashboard");
      const res = await middleware(req);
      expect(res.status).toBe(307);
      const loc = res.headers.get("location") ?? "";
      expect(loc).toContain("/login");
      expect(loc).toContain("returnTo=%2Fdashboard");
    });

    it("allows authenticated member → /dashboard", async () => {
      const req = await withSession("http://t/dashboard", { userId: "u1", role: "member" });
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it("redirects member → /dashboard from /admin", async () => {
      const req = await withSession("http://t/admin", { userId: "u1", role: "member" });
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/dashboard");
    });

    it("allows admin → /admin", async () => {
      const req = await withSession("http://t/admin/users", { userId: "u1", role: "admin" });
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it("ignores non-app routes (no redirect to login from /login)", async () => {
      const req = await withSession("http://t/login");
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });
  });
  ```

- [ ] **Step 2: 跑测试**

  Run: `pnpm test`
  Expected: 全绿。

- [ ] **Step 3: 编译 + Build**

  Run: `pnpm tsc --noEmit && pnpm build`
  Expected: clean / success。

- [ ] **Step 4: docker 端到端冒烟**

  Run:
  ```bash
  cp -n .env.example .env || true
  docker compose down -v 2>/dev/null || true
  docker compose up --build -d
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/me 2>/dev/null || echo 000)
    [ "$code" = "401" ] && break; sleep 3
  done
  # admin 登录走 server action 路径不便直接 curl；改为浏览器人工
  ```
  在浏览器打开 `http://localhost:3000`：
  1. 应该跳 `/login`。
  2. 用 `.env` 里的 ADMIN_EMAIL / ADMIN_PASSWORD 登录。
  3. 应跳到 `/dashboard`，admin 侧栏看到「管理」分组。
  4. 创建 token、访问 `/admin`、`/admin/users` 全部正常。
  关停：`docker compose down`。

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "test: add middleware redirect tests"
  ```

---

## 完成标准（Plan 2）

- [ ] `pnpm test` 全绿（含新增 OAuth account-matching、tokens、users、metrics scoping、middleware、range 用例）。
- [ ] `pnpm tsc --noEmit` clean。
- [ ] `pnpm build` 成功。
- [ ] docker compose 起服务、浏览器走通：密码登录、GitHub 登录（env 配齐时）、自助创建/吊销 token、个人仪表盘三图正常、admin 平台总览 + 用户管理（禁用/启用、代签发/吊销）。
- [ ] **隐私不变量**：服务端不存在让 member 看到他人聚合数据的路径——`dailyTotals`/`toolBreakdown`/`modelBreakdown` 内部强制 `effectiveUserId(viewer, …)` 收敛；`userRanking` 仅 admin 可调；`tokens`/`users` service 均带 viewer 守卫。

执行完后再编写 **Plan 3（Teams）**与 **Plan 4（客户端 skill 采集器）**。
