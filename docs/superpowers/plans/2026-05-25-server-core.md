# 服务端核心 (Server Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建研发效能统计系统的服务端核心：数据模型、认证（注册/邀请码/审批/登录/token 签发）、以及幂等的 token 用量上传 API。

**Architecture:** Next.js (App Router) 单体应用。业务逻辑放在 `src/lib/services/*` 的纯函数里（接收 Prisma client + 入参），路由处理器 `src/app/api/**/route.ts` 保持极薄（解析请求 → 调 service → 返回）。这样测试直接打 service 层，无需构造 `NextRequest`。数据库 PostgreSQL，经 Prisma 访问。

**Tech Stack:** Next.js 15 / React 19 / TypeScript、Prisma + PostgreSQL、`@node-rs/argon2`（密码哈希）、`iron-session`（会话 cookie）、`zod`（校验）、Vitest（测试）、pnpm、docker-compose。

> 这是三份计划中的第 1 份。Plan 2（仪表盘）、Plan 3（skill 采集器）在本计划执行落地后再编写。

---

## 文件结构（本计划涉及）

```
dev-efficiency/
  package.json                      # pnpm 脚本与依赖
  tsconfig.json
  next.config.ts
  vitest.config.ts
  .env.example                      # 环境变量样例
  .env                              # 本地（gitignore）
  .env.test                         # 测试库连接（gitignore）
  Dockerfile
  docker-compose.yml                # app + db
  prisma/
    schema.prisma                   # 数据模型
    seed.ts                         # admin 账号 seed
  src/
    lib/
      db.ts                         # PrismaClient 单例
      tool.ts                       # API 工具名 <-> Prisma 枚举映射
      auth/
        password.ts                 # argon2 哈希/校验
        token.ts                    # 生成 token / sha256 哈希
        bearer.ts                   # 从 Bearer token 解析 user
        session.ts                  # iron-session 配置与读写
      validation/
        usage.ts                    # 上传 payload 的 zod schema
        auth.ts                     # 注册/登录的 zod schema
      services/
        auth.ts                     # registerUser/approveUser/issueToken/authenticate
        usage.ts                    # ingestUsage（幂等 upsert）
    app/
      api/
        v1/
          usage/route.ts            # POST 上传
          me/route.ts               # GET 当前用户
        auth/
          register/route.ts         # POST 注册
          login/route.ts            # POST 登录
          logout/route.ts           # POST 登出
  tests/
    helpers/db.ts                   # 测试库重置工具
    setup/global.ts                 # vitest 全局 setup：migrate deploy
    unit/password.test.ts
    unit/token.test.ts
    unit/validation.test.ts
    unit/tool.test.ts
    integration/auth.test.ts
    integration/usage.test.ts
    integration/bearer.test.ts
```

---

## Task 1: 项目脚手架（Next.js + pnpm + TypeScript + Vitest）

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `tests/setup/global.ts`

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "dev-efficiency",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "db:seed": "tsx prisma/seed.ts"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@node-rs/argon2": "^2.0.2",
    "@prisma/client": "^6.2.1",
    "iron-session": "^8.0.4",
    "next": "^15.1.4",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "@types/react": "^19.0.2",
    "prisma": "^6.2.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: 安装依赖**

Run: `pnpm install`
Expected: 依赖装好，生成 `pnpm-lock.yaml`，无报错。

- [ ] **Step 3: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: 创建 `next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 5: 创建 `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/setup/global.ts"], // 跑一次 migrate deploy
    setupFiles: ["./tests/setup/env.ts"],      // 每个 worker 都加载 .env.test
    fileParallelism: false, // 共享一个测试库，串行避免互相干扰
    env: { NODE_ENV: "test" },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
```

- [ ] **Step 6: 创建 `tests/setup/global.ts`（测试前迁移测试库）与 `tests/setup/env.ts`（每 worker 加载 env）**

`tests/setup/global.ts`：
```typescript
import { execSync } from "node:child_process";
import { config } from "dotenv";

export default function setup() {
  config({ path: ".env.test" });
  execSync("pnpm prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env },
  });
}
```

`tests/setup/env.ts`（确保每个测试 worker 里 `PrismaClient` 能读到测试库连接）：
```typescript
import { config } from "dotenv";

config({ path: ".env.test" });
```

- [ ] **Step 7: 创建 `.env.example`**

```bash
# 本地开发数据库（docker 容器映射到主机 5433，避开本机已占用的 5432）
DATABASE_URL="postgresql://devuser:devpass@localhost:5433/dev_efficiency?schema=public"
# 测试库（放入 .env.test，指向独立 database）
# DATABASE_URL="postgresql://devuser:devpass@localhost:5433/dev_efficiency_test?schema=public"

# 首次启动 seed 的管理员账号
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="change-me-please"
ADMIN_NAME="Admin"

# iron-session 加密密钥，至少 32 字符
SESSION_SECRET="please-change-this-to-a-long-random-string-32+"
```

- [ ] **Step 8: 安装 dotenv（global setup 需要）并提交**

Run: `pnpm add -D dotenv`
Then create `next-env.d.ts` is auto-generated on first `next` run; skip manual创建。

```bash
git add -A
git commit -m "chore: scaffold Next.js app with pnpm, TypeScript, Vitest"
```

---

## Task 2: Prisma 数据模型与迁移

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`
- Test: `tests/helpers/db.ts`（重置工具，后续测试复用）

- [ ] **Step 1: 创建 `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  admin
  member
}

enum UserStatus {
  pending
  approved
  disabled
}

enum Tool {
  claude_code @map("claude-code")
  codex       @map("codex")
  cursor      @map("cursor")
}

enum UsageSource {
  auto
  manual
}

model User {
  id           String     @id @default(cuid())
  email        String     @unique
  name         String
  passwordHash String
  role         Role       @default(member)
  status       UserStatus @default(pending)
  createdAt    DateTime   @default(now())

  tokens         AuthToken[]
  usageRecords   UsageRecord[]
  invitesCreated InviteCode[] @relation("InviteCreatedBy")
  inviteUsed     InviteCode?  @relation("InviteUsedBy")
}

model InviteCode {
  id          String    @id @default(cuid())
  code        String    @unique
  createdById String
  createdBy   User      @relation("InviteCreatedBy", fields: [createdById], references: [id])
  usedById    String?   @unique
  usedBy      User?     @relation("InviteUsedBy", fields: [usedById], references: [id])
  expiresAt   DateTime?
  createdAt   DateTime  @default(now())
}

model AuthToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  name       String
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  revokedAt  DateTime?
}

model UsageRecord {
  id                  String      @id @default(cuid())
  userId              String
  user                User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  date                DateTime    @db.Date
  tool                Tool
  model               String
  project             String      @default("")
  inputTokens         BigInt      @default(0)
  outputTokens        BigInt      @default(0)
  cacheCreationTokens BigInt      @default(0)
  cacheReadTokens     BigInt      @default(0)
  totalTokens         BigInt      @default(0)
  sessionCount        Int         @default(0)
  messageCount        Int         @default(0)
  source              UsageSource
  updatedAt           DateTime    @updatedAt

  @@unique([userId, date, tool, model, project, source])
  @@index([date])
  @@index([userId, date])
}
```

- [ ] **Step 2: 准备本地数据库**

本机 5432 已被占用，故 docker 容器映射到主机 **5433**。
Run:
```bash
docker run -d --name de-pg -e POSTGRES_USER=devuser -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=dev_efficiency -p 5433:5432 postgres:16
```
等待几秒待其就绪，然后创建测试库：
```bash
sleep 5
docker exec de-pg psql -U devuser -d dev_efficiency -c "CREATE DATABASE dev_efficiency_test;"
```
复制 env：
```bash
cp .env.example .env
printf 'DATABASE_URL="postgresql://devuser:devpass@localhost:5433/dev_efficiency_test?schema=public"\n' > .env.test
```
Expected: Postgres 容器运行，两个 database 存在。

- [ ] **Step 3: 生成首次迁移**

Run: `pnpm prisma migrate dev --name init`
Expected: 在 `prisma/migrations/` 生成迁移，应用到 `dev_efficiency`，并生成 Prisma client。

- [ ] **Step 4: 创建 `src/lib/db.ts`（Prisma 单例）**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 5: 创建 `tests/helpers/db.ts`（重置工具）**

```typescript
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function resetDb() {
  // 顺序：先删有外键依赖的表
  await prisma.usageRecord.deleteMany();
  await prisma.authToken.deleteMany();
  await prisma.inviteCode.deleteMany();
  await prisma.user.deleteMany();
}
```

- [ ] **Step 6: 写一个连通性 smoke 测试 `tests/integration/bearer.test.ts`（先占位验证 DB 可用）**

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";

describe("db connectivity", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates and reads a user", async () => {
    const u = await prisma.user.create({
      data: { email: "a@b.com", name: "A", passwordHash: "x" },
    });
    const found = await prisma.user.findUnique({ where: { id: u.id } });
    expect(found?.email).toBe("a@b.com");
    expect(found?.status).toBe("pending");
    expect(found?.role).toBe("member");
  });
});
```

- [ ] **Step 7: 运行 smoke 测试**

Run: `pnpm test`
Expected: PASS（global setup 跑 migrate deploy 到测试库，用例通过）。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: add Prisma schema, migration, prisma client singleton"
```

---

## Task 3: 密码哈希模块（argon2，TDD）

**Files:**
- Create: `src/lib/auth/password.ts`
- Test: `tests/unit/password.test.ts`

- [ ] **Step 1: 写失败测试 `tests/unit/password.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(hash).not.toBe("s3cret-pass");
    expect(await verifyPassword(hash, "s3cret-pass")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/password.test.ts`
Expected: FAIL（模块/函数不存在）。

- [ ] **Step 3: 实现 `src/lib/auth/password.ts`**

```typescript
import { hash, verify } from "@node-rs/argon2";

// OWASP Argon2id minimums: 19 MiB memory, t=2, p=1.
const hashOptions = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, hashOptions);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/password.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add argon2 password hashing module"
```

---

## Task 4: Token 模块（生成 + sha256 哈希，TDD）

**Files:**
- Create: `src/lib/auth/token.ts`
- Test: `tests/unit/token.test.ts`

- [ ] **Step 1: 写失败测试 `tests/unit/token.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { generateToken, hashToken } from "@/lib/auth/token";

describe("token", () => {
  it("generates a prefixed url-safe token", () => {
    const t = generateToken();
    expect(t.startsWith("de_")).toBe(true);
    expect(t).toMatch(/^de_[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
  });

  it("generates unique tokens", () => {
    expect(generateToken()).not.toBe(generateToken());
  });

  it("hashes deterministically with sha256 hex", () => {
    const t = "de_fixed";
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("de_other")).not.toBe(hashToken(t));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/token.test.ts`
Expected: FAIL（函数不存在）。

- [ ] **Step 3: 实现 `src/lib/auth/token.ts`**

```typescript
import { randomBytes, createHash } from "node:crypto";

export function generateToken(): string {
  return "de_" + randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/token.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add auth token generation and hashing"
```

---

## Task 5: 工具名映射（API 字符串 <-> Prisma 枚举，TDD）

**Files:**
- Create: `src/lib/tool.ts`
- Test: `tests/unit/tool.test.ts`

> 背景：Prisma 枚举成员不能含连字符，故枚举成员为 `claude_code`（DB 值经 `@map` 存为 `claude-code`）。API JSON 用 `claude-code`，需双向映射。

- [ ] **Step 1: 写失败测试 `tests/unit/tool.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { toolFromApi, toolToApi, API_TOOLS } from "@/lib/tool";

describe("tool mapping", () => {
  it("maps api string to prisma enum", () => {
    expect(toolFromApi("claude-code")).toBe("claude_code");
    expect(toolFromApi("codex")).toBe("codex");
    expect(toolFromApi("cursor")).toBe("cursor");
  });

  it("returns null for unknown tool", () => {
    expect(toolFromApi("vim")).toBeNull();
  });

  it("maps prisma enum back to api string", () => {
    expect(toolToApi("claude_code")).toBe("claude-code");
  });

  it("lists supported api tools", () => {
    expect(API_TOOLS).toEqual(["claude-code", "codex", "cursor"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/tool.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/tool.ts`**

```typescript
import { Tool } from "@prisma/client";

export const API_TOOLS = ["claude-code", "codex", "cursor"] as const;
export type ApiTool = (typeof API_TOOLS)[number];

const apiToEnum: Record<ApiTool, Tool> = {
  "claude-code": Tool.claude_code,
  codex: Tool.codex,
  cursor: Tool.cursor,
};

const enumToApi: Record<Tool, ApiTool> = {
  [Tool.claude_code]: "claude-code",
  [Tool.codex]: "codex",
  [Tool.cursor]: "cursor",
};

export function toolFromApi(s: string): Tool | null {
  return Object.hasOwn(apiToEnum, s) ? apiToEnum[s as ApiTool] : null;
}

export function toolToApi(t: Tool): ApiTool {
  return enumToApi[t];
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/tool.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add tool name <-> prisma enum mapping"
```

---

## Task 6: 上传 payload 校验 schema（zod，TDD）

**Files:**
- Create: `src/lib/validation/usage.ts`
- Test: `tests/unit/validation.test.ts`

- [ ] **Step 1: 写失败测试 `tests/unit/validation.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { usagePayloadSchema } from "@/lib/validation/usage";

const validRecord = {
  date: "2026-05-25",
  tool: "claude-code",
  model: "claude-opus-4-7",
  project: "abc123",
  inputTokens: 6,
  outputTokens: 681,
  cacheCreationTokens: 13857,
  cacheReadTokens: 17031,
  sessionCount: 3,
  messageCount: 42,
  source: "auto",
};

describe("usagePayloadSchema", () => {
  it("accepts a valid payload", () => {
    const r = usagePayloadSchema.safeParse({ records: [validRecord] });
    expect(r.success).toBe(true);
  });

  it("defaults project to empty string when missing", () => {
    const { project, ...noProject } = validRecord;
    const r = usagePayloadSchema.parse({ records: [noProject] });
    expect(r.records[0].project).toBe("");
  });

  it("rejects unknown tool", () => {
    const r = usagePayloadSchema.safeParse({
      records: [{ ...validRecord, tool: "vim" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative tokens", () => {
    const r = usagePayloadSchema.safeParse({
      records: [{ ...validRecord, inputTokens: -1 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects bad date format", () => {
    const r = usagePayloadSchema.safeParse({
      records: [{ ...validRecord, date: "2026/05/25" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty records array", () => {
    expect(usagePayloadSchema.safeParse({ records: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/unit/validation.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/validation/usage.ts`**

```typescript
import { z } from "zod";
import { API_TOOLS } from "@/lib/tool";

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const usageRecordSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
    .refine((s) => {
      const d = new Date(`${s}T00:00:00.000Z`);
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, "date must be a valid calendar date"),
  tool: z.enum(API_TOOLS),
  model: z.string().min(1).max(100),
  project: z.string().max(128).default(""),
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheCreationTokens: tokenCount,
  cacheReadTokens: tokenCount,
  sessionCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  source: z.enum(["auto", "manual"]),
});

export const usagePayloadSchema = z.object({
  records: z.array(usageRecordSchema).min(1).max(2000),
});

export type UsageRecordInput = z.infer<typeof usageRecordSchema>;
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/unit/validation.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add zod schema for usage upload payload"
```

---

## Task 7: Bearer token 解析（TDD，集成）

**Files:**
- Create: `src/lib/auth/bearer.ts`
- Test: `tests/integration/bearer.test.ts`（替换 Task 2 的占位 smoke）

- [ ] **Step 1: 重写 `tests/integration/bearer.test.ts` 为失败测试**

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { resolveBearerUser } from "@/lib/auth/bearer";
import { generateToken, hashToken } from "@/lib/auth/token";

async function makeUserWithToken(opts?: { revoked?: boolean }) {
  const user = await prisma.user.create({
    data: { email: "u@x.com", name: "U", passwordHash: "x", status: "approved" },
  });
  const raw = generateToken();
  await prisma.authToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      name: "laptop",
      revokedAt: opts?.revoked ? new Date() : null,
    },
  });
  return { user, raw };
}

describe("resolveBearerUser", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("resolves user from a valid bearer header", async () => {
    const { user, raw } = await makeUserWithToken();
    const got = await resolveBearerUser(prisma, `Bearer ${raw}`);
    expect(got?.id).toBe(user.id);
  });

  it("updates lastUsedAt on success", async () => {
    const { raw } = await makeUserWithToken();
    await resolveBearerUser(prisma, `Bearer ${raw}`);
    const tok = await prisma.authToken.findFirst();
    expect(tok?.lastUsedAt).not.toBeNull();
  });

  it("returns null for missing/invalid header", async () => {
    expect(await resolveBearerUser(prisma, null)).toBeNull();
    expect(await resolveBearerUser(prisma, "Basic abc")).toBeNull();
    expect(await resolveBearerUser(prisma, "Bearer de_nope")).toBeNull();
  });

  it("returns null for revoked token", async () => {
    const { raw } = await makeUserWithToken({ revoked: true });
    expect(await resolveBearerUser(prisma, `Bearer ${raw}`)).toBeNull();
  });

  it("returns null when user is not approved", async () => {
    const { user, raw } = await makeUserWithToken();
    await prisma.user.update({ where: { id: user.id }, data: { status: "disabled" } });
    expect(await resolveBearerUser(prisma, `Bearer ${raw}`)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/integration/bearer.test.ts`
Expected: FAIL（`resolveBearerUser` 不存在）。

- [ ] **Step 3: 实现 `src/lib/auth/bearer.ts`**

```typescript
import type { PrismaClient, User } from "@prisma/client";
import { hashToken } from "@/lib/auth/token";

export async function resolveBearerUser(
  prisma: PrismaClient,
  authHeader: string | null,
): Promise<User | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const raw = authHeader.slice("Bearer ".length).trim();
  if (!raw) return null;

  const token = await prisma.authToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    include: { user: true },
  });
  if (!token || token.revokedAt) return null;
  if (token.user.status !== "approved") return null;

  await prisma.authToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  });
  return token.user;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/integration/bearer.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add bearer token resolution"
```

---

## Task 8: 用量上传 service（幂等 upsert，TDD，集成）

**Files:**
- Create: `src/lib/services/usage.ts`
- Test: `tests/integration/usage.test.ts`

- [ ] **Step 1: 写失败测试 `tests/integration/usage.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { ingestUsage } from "@/lib/services/usage";
import type { UsageRecordInput } from "@/lib/validation/usage";

async function makeUser() {
  return prisma.user.create({
    data: { email: "u@x.com", name: "U", passwordHash: "x", status: "approved" },
  });
}

const rec = (over: Partial<UsageRecordInput> = {}): UsageRecordInput => ({
  date: "2026-05-25",
  tool: "claude-code",
  model: "claude-opus-4-7",
  project: "proj-hash",
  inputTokens: 10,
  outputTokens: 20,
  cacheCreationTokens: 5,
  cacheReadTokens: 7,
  sessionCount: 1,
  messageCount: 3,
  source: "auto",
  ...over,
});

describe("ingestUsage", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("inserts new records and computes totalTokens", async () => {
    const u = await makeUser();
    const res = await ingestUsage(prisma, u.id, [rec()]);
    expect(res).toEqual({ inserted: 1, updated: 0 });

    const stored = await prisma.usageRecord.findFirst();
    expect(stored?.totalTokens).toBe(42n); // 10+20+5+7
    expect(stored?.tool).toBe("claude_code");
  });

  it("is idempotent: re-uploading same key updates, not duplicates", async () => {
    const u = await makeUser();
    await ingestUsage(prisma, u.id, [rec()]);
    const res = await ingestUsage(prisma, u.id, [rec({ inputTokens: 99 })]);
    expect(res).toEqual({ inserted: 0, updated: 1 });

    const all = await prisma.usageRecord.findMany();
    expect(all).toHaveLength(1);
    expect(all[0].inputTokens).toBe(99n); // overwritten, not summed
    expect(all[0].totalTokens).toBe(131n); // 99+20+5+7
  });

  it("treats different source as a separate row", async () => {
    const u = await makeUser();
    await ingestUsage(prisma, u.id, [rec({ source: "auto" })]);
    await ingestUsage(prisma, u.id, [rec({ source: "manual" })]);
    expect(await prisma.usageRecord.count()).toBe(2);
  });

  it("treats missing project ('') as its own key", async () => {
    const u = await makeUser();
    await ingestUsage(prisma, u.id, [rec({ project: "" })]);
    await ingestUsage(prisma, u.id, [rec({ project: "" })]);
    expect(await prisma.usageRecord.count()).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm vitest run tests/integration/usage.test.ts`
Expected: FAIL（`ingestUsage` 不存在）。

- [ ] **Step 3: 实现 `src/lib/services/usage.ts`**

```typescript
import type { PrismaClient } from "@prisma/client";
import { toolFromApi } from "@/lib/tool";
import type { UsageRecordInput } from "@/lib/validation/usage";

export interface IngestResult {
  inserted: number;
  updated: number;
}

export async function ingestUsage(
  prisma: PrismaClient,
  userId: string,
  records: UsageRecordInput[],
): Promise<IngestResult> {
  let inserted = 0;
  let updated = 0;

  for (const r of records) {
    const tool = toolFromApi(r.tool);
    if (!tool) continue; // 已由 zod 兜底，这里防御性跳过

    const input = BigInt(r.inputTokens);
    const output = BigInt(r.outputTokens);
    const cacheCreation = BigInt(r.cacheCreationTokens);
    const cacheRead = BigInt(r.cacheReadTokens);
    const total = input + output + cacheCreation + cacheRead;

    const date = new Date(r.date + "T00:00:00.000Z");

    const existing = await prisma.usageRecord.findUnique({
      where: {
        userId_date_tool_model_project_source: {
          userId,
          date,
          tool,
          model: r.model,
          project: r.project,
          source: r.source,
        },
      },
      select: { id: true },
    });

    await prisma.usageRecord.upsert({
      where: {
        userId_date_tool_model_project_source: {
          userId,
          date,
          tool,
          model: r.model,
          project: r.project,
          source: r.source,
        },
      },
      create: {
        userId,
        date,
        tool,
        model: r.model,
        project: r.project,
        inputTokens: input,
        outputTokens: output,
        cacheCreationTokens: cacheCreation,
        cacheReadTokens: cacheRead,
        totalTokens: total,
        sessionCount: r.sessionCount,
        messageCount: r.messageCount,
        source: r.source,
      },
      update: {
        inputTokens: input,
        outputTokens: output,
        cacheCreationTokens: cacheCreation,
        cacheReadTokens: cacheRead,
        totalTokens: total,
        sessionCount: r.sessionCount,
        messageCount: r.messageCount,
      },
    });

    if (existing) updated++;
    else inserted++;
  }

  return { inserted, updated };
}
```

> 说明：upsert 的 `update` 分支用「覆盖」而非「累加」，因为采集器每次上传的是某天的全量重算值，覆盖才能保证幂等。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm vitest run tests/integration/usage.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: add idempotent usage ingestion service"
```

---

## Task 9: 认证 service（注册/邀请码/审批/签发 token/登录，TDD，集成）

**Files:**
- Create: `src/lib/validation/auth.ts`, `src/lib/services/auth.ts`
- Test: `tests/integration/auth.test.ts`

- [ ] **Step 1: 创建 `src/lib/validation/auth.ts`**

```typescript
import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8).max(200),
  inviteCode: z.string().min(1).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
```

- [ ] **Step 2: 写失败测试 `tests/integration/auth.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import {
  registerUser,
  approveUser,
  authenticate,
  AuthError,
} from "@/lib/services/auth";
import { hashPassword } from "@/lib/auth/password";
import { resolveBearerUser } from "@/lib/auth/bearer";

async function makeAdmin() {
  return prisma.user.create({
    data: {
      email: "admin@x.com",
      name: "Admin",
      passwordHash: await hashPassword("admin-pass"),
      role: "admin",
      status: "approved",
    },
  });
}

describe("auth service", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("registers a pending user when no invite code", async () => {
    const res = await registerUser(prisma, {
      email: "dev@x.com",
      name: "Dev",
      password: "password123",
    });
    expect(res.user.status).toBe("pending");
    expect(res.token).toBeNull(); // pending 不签发 token
  });

  it("registers an approved user + token with a valid invite code", async () => {
    const admin = await makeAdmin();
    await prisma.inviteCode.create({
      data: { code: "INVITE1", createdById: admin.id },
    });
    const res = await registerUser(prisma, {
      email: "dev@x.com",
      name: "Dev",
      password: "password123",
      inviteCode: "INVITE1",
    });
    expect(res.user.status).toBe("approved");
    expect(res.token).toMatch(/^de_/);

    // 邀请码标记为已用
    const code = await prisma.inviteCode.findUnique({ where: { code: "INVITE1" } });
    expect(code?.usedById).toBe(res.user.id);

    // 签发的 token 可用于 bearer 解析
    const u = await resolveBearerUser(prisma, `Bearer ${res.token}`);
    expect(u?.id).toBe(res.user.id);
  });

  it("rejects invalid or used invite code", async () => {
    await expect(
      registerUser(prisma, {
        email: "dev@x.com",
        name: "Dev",
        password: "password123",
        inviteCode: "NOPE",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects duplicate email", async () => {
    await registerUser(prisma, { email: "dev@x.com", name: "Dev", password: "password123" });
    await expect(
      registerUser(prisma, { email: "dev@x.com", name: "Dev2", password: "password123" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("approveUser flips status and issues a token", async () => {
    const reg = await registerUser(prisma, {
      email: "dev@x.com",
      name: "Dev",
      password: "password123",
    });
    const { token } = await approveUser(prisma, reg.user.id);
    expect(token).toMatch(/^de_/);
    const u = await prisma.user.findUnique({ where: { id: reg.user.id } });
    expect(u?.status).toBe("approved");
  });

  it("authenticate returns user on correct credentials, null otherwise", async () => {
    await registerUser(prisma, { email: "dev@x.com", name: "Dev", password: "password123" });
    // pending 用户也能通过密码校验（是否放行登录由上层决定）
    const ok = await authenticate(prisma, "dev@x.com", "password123");
    expect(ok?.email).toBe("dev@x.com");
    expect(await authenticate(prisma, "dev@x.com", "wrong")).toBeNull();
    expect(await authenticate(prisma, "nobody@x.com", "password123")).toBeNull();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm vitest run tests/integration/auth.test.ts`
Expected: FAIL（service 不存在）。

- [ ] **Step 4: 实现 `src/lib/services/auth.ts`**

```typescript
import { Prisma, type PrismaClient, type User } from "@prisma/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { generateToken, hashToken } from "@/lib/auth/token";
import type { RegisterInput } from "@/lib/validation/auth";

export class AuthError extends Error {
  constructor(
    message: string,
    public code: "DUPLICATE_EMAIL" | "BAD_INVITE" | "NOT_FOUND",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RegisterResult {
  user: User;
  token: string | null; // 仅在即时审批（有效邀请码）时返回明文 token
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

  let approveImmediately = false;
  let inviteId: string | null = null;

  if (input.inviteCode) {
    const code = await prisma.inviteCode.findUnique({ where: { code: input.inviteCode } });
    const valid =
      code &&
      !code.usedById &&
      (!code.expiresAt || code.expiresAt > new Date());
    if (!valid) throw new AuthError("invalid or used invite code", "BAD_INVITE");
    approveImmediately = true;
    inviteId = code!.id;
  }

  // 在开启事务前完成 argon2 哈希，避免哈希期间长时间持有事务
  const passwordHash = await hashPassword(input.password);

  // 三次写入（建用户 / 消费邀请码 / 签发 token）置于一个事务，保证原子性
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        status: approveImmediately ? "approved" : "pending",
      },
    });

    let token: string | null = null;
    if (approveImmediately) {
      await tx.inviteCode.update({
        where: { id: inviteId! },
        data: { usedById: user.id },
      });
      token = await issueTokenFor(tx, user.id);
    }

    return { user, token };
  });
}

export async function approveUser(
  prisma: PrismaClient,
  userId: string,
): Promise<{ user: User; token: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AuthError("user not found", "NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: userId },
      data: { status: "approved" },
    });
    const token = await issueTokenFor(tx, userId);
    return { user: updated, token };
  });
}

export async function authenticate(
  prisma: PrismaClient,
  email: string,
  password: string,
): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  if (!(await verifyPassword(user.passwordHash, password))) return null;
  return user;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm vitest run tests/integration/auth.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: add auth service (register, invite, approve, authenticate)"
```

---

## Task 10: 会话模块（iron-session）

**Files:**
- Create: `src/lib/auth/session.ts`

> 该模块依赖 Next.js 运行时 `cookies()`，单测价值低；在 Task 11 的路由 smoke 中间接覆盖。这里只实现。

- [ ] **Step 1: 实现 `src/lib/auth/session.ts`**

```typescript
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId?: string;
  role?: "admin" | "member";
}

const sessionOptions = {
  password: process.env.SESSION_SECRET ?? "dev-only-insecure-secret-min-32-chars!!",
  cookieName: "de_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
```

- [ ] **Step 2: 类型检查通过**

Run: `pnpm tsc --noEmit`
Expected: 无类型错误（`@types/react`/next 已装）。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat: add iron-session helper"
```

---

## Task 11: API 路由（薄封装：register/login/logout/usage/me）

**Files:**
- Create: `src/app/api/auth/register/route.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/v1/usage/route.ts`, `src/app/api/v1/me/route.ts`
- Test: 追加到 `tests/integration/usage.test.ts` 末尾的路由 smoke（直接 import route handler 调用）

- [ ] **Step 1: 实现 `src/app/api/v1/usage/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveBearerUser } from "@/lib/auth/bearer";
import { usagePayloadSchema } from "@/lib/validation/usage";
import { ingestUsage } from "@/lib/services/usage";

export async function POST(req: Request) {
  const user = await resolveBearerUser(prisma, req.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = usagePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await ingestUsage(prisma, user.id, parsed.data.records);
  return NextResponse.json(result);
}
```

- [ ] **Step 2: 实现 `src/app/api/v1/me/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveBearerUser } from "@/lib/auth/bearer";

export async function GET(req: Request) {
  const user = await resolveBearerUser(prisma, req.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}
```

- [ ] **Step 3: 实现 `src/app/api/auth/register/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { registerSchema } from "@/lib/validation/auth";
import { registerUser, AuthError } from "@/lib/services/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const { user, token } = await registerUser(prisma, parsed.data);
    return NextResponse.json({
      status: user.status,
      token, // pending 时为 null；即时审批时为一次性明文 token
      message:
        user.status === "approved"
          ? "注册成功，请妥善保存 token（仅此一次显示）"
          : "注册成功，等待管理员审批后获取 token",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    throw e;
  }
}
```

- [ ] **Step 4: 实现 `src/app/api/auth/login/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/validation/auth";
import { authenticate } from "@/lib/services/auth";
import { getSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }
  const user = await authenticate(prisma, parsed.data.email, parsed.data.password);
  if (!user || user.status !== "approved") {
    return NextResponse.json({ error: "invalid credentials or not approved" }, { status: 401 });
  }
  const session = await getSession();
  session.userId = user.id;
  session.role = user.role;
  await session.save();
  return NextResponse.json({ id: user.id, name: user.name, role: user.role });
}
```

- [ ] **Step 5: 实现 `src/app/api/auth/logout/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export async function POST() {
  const session = await getSession();
  await session.destroy();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: 给 usage route 加一个 handler 级 smoke 测试（追加到 `tests/integration/usage.test.ts`）**

```typescript
import { POST as usagePost } from "@/app/api/v1/usage/route";
import { GET as mePost } from "@/app/api/v1/me/route";
import { generateToken, hashToken } from "@/lib/auth/token";

describe("usage route handler", () => {
  beforeEach(resetDb);

  async function approvedUserWithToken() {
    const u = await prisma.user.create({
      data: { email: "r@x.com", name: "R", passwordHash: "x", status: "approved" },
    });
    const raw = generateToken();
    await prisma.authToken.create({
      data: { userId: u.id, tokenHash: hashToken(raw), name: "m" },
    });
    return raw;
  }

  it("401 without token", async () => {
    const res = await usagePost(new Request("http://t/api/v1/usage", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("ingests with a valid token", async () => {
    const raw = await approvedUserWithToken();
    const res = await usagePost(
      new Request("http://t/api/v1/usage", {
        method: "POST",
        headers: { authorization: `Bearer ${raw}`, "content-type": "application/json" },
        body: JSON.stringify({ records: [rec()] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 1, updated: 0 });
  });

  it("GET /me returns the user", async () => {
    const raw = await approvedUserWithToken();
    const res = await mePost(
      new Request("http://t/api/v1/me", { headers: { authorization: `Bearer ${raw}` } }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe("r@x.com");
  });
});
```

- [ ] **Step 7: 运行全部测试**

Run: `pnpm test`
Expected: 所有用例 PASS。

> 注意：导入 route handler 会间接加载 `@/lib/db` 的 Prisma 单例；测试中它与 `tests/helpers/db.ts` 的 client 连同一个测试库，数据互通，无需特殊处理。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: add API routes for register/login/logout/usage/me"
```

---

## Task 12: admin seed + docker-compose + Dockerfile

> 实现说明（与初稿的差异）：初稿计划用 Next.js `output: "standalone"` 多阶段镜像，但 standalone 的精简 `node_modules` **不含 `prisma` CLI 与 `tsx`**，容器启动时的 `prisma migrate deploy` / `db:seed` 会失败。改为**单阶段、全依赖镜像 + `next start`**（内部工具镜像体积非关键，换取可靠与 KISS）。同时：移除 `next.config.ts` 的 `output: "standalone"`；新增根 `layout.tsx`/`page.tsx`（`next build` 需要）与 `public/.gitkeep`；用 `packageManager` 钉死 pnpm 版本使 host 与容器一致（避免 corepack 在容器内拉到 pnpm 11 导致构建脚本允许清单配置分裂）。

**Files:**
- Create: `prisma/seed.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `public/.gitkeep`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`
- Modify: `next.config.ts`（移除 standalone）、`package.json`（加 `packageManager`，并把 `prisma`/`tsx` 移入 dependencies）

- [ ] **Step 1: 实现 `prisma/seed.ts`**

```typescript
import { PrismaClient } from "@prisma/client";
// 相对导入：seed 经 `tsx` 运行，tsx 不解析 tsconfig 的 `@/` 别名
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Admin";
  if (!email || !password) {
    console.log("ADMIN_EMAIL/ADMIN_PASSWORD 未设置，跳过 admin seed");
    return;
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`admin ${email} 已存在，跳过`);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await hashPassword(password),
      role: "admin",
      status: "approved",
    },
  });
  console.log(`已创建 admin: ${email}`);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 2: 根 `layout.tsx` / `page.tsx`（`next build` 需要）与 `public/.gitkeep`**

`src/app/layout.tsx`：
```tsx
import type { ReactNode } from "react";

export const metadata = { title: "Dev Efficiency" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  );
}
```
`src/app/page.tsx`：
```tsx
export default function Home() {
  return <main style={{ padding: 24 }}>Dev Efficiency Tracker — API is running.</main>;
}
```
并创建空文件 `public/.gitkeep`。（这两个页面是占位，Plan 2 仪表盘会扩展。）

- [ ] **Step 3: 移除 `next.config.ts` 的 standalone，并钉死 pnpm 版本 + 把 `prisma`/`tsx` 移入 dependencies**

`next.config.ts` 改为：
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```
在 `package.json` 顶层加 `"packageManager": "pnpm@10.25.0"`（与 host 版本一致；保留 `pnpm.onlyBuiltDependencies` 作为唯一的构建脚本允许清单，host 与容器都读它）。然后：
Run: `pnpm add prisma tsx`（把它们从 devDependencies 提升为 dependencies，容器运行时需要 `prisma migrate deploy` 与 `tsx prisma/seed.ts`）。

- [ ] **Step 4: 创建 `Dockerfile`（单阶段，全依赖，`next start`）**

```dockerfile
FROM node:22-slim
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate && pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "pnpm prisma migrate deploy && pnpm db:seed && pnpm start"]
```
说明：`openssl`/`ca-certificates` 供 Prisma 引擎；`COREPACK_ENABLE_DOWNLOAD_PROMPT=0` 让 corepack 非交互地拉取钉死的 pnpm。

- [ ] **Step 5: 创建 `.dockerignore`**

```
node_modules
.next
.git
.env
.env.test
docs
tests
.worktrees
```

- [ ] **Step 6: 创建 `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: devuser
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: dev_efficiency
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U devuser -d dev_efficiency"]
      interval: 5s
      timeout: 3s
      retries: 10

  app:
    build: .
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: "postgresql://devuser:devpass@db:5432/dev_efficiency?schema=public"
      ADMIN_EMAIL: ${ADMIN_EMAIL}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      ADMIN_NAME: ${ADMIN_NAME}
      SESSION_SECRET: ${SESSION_SECRET}
    ports:
      - "3000:3000"

volumes:
  pgdata:
```
迁移与 seed 走 Dockerfile 的 `CMD`，compose 不再覆盖 command。

- [ ] **Step 7: 构建并起服务验证**

```bash
cp -n .env.example .env || true
docker compose down -v 2>/dev/null || true
docker compose up --build -d   # 首次构建数分钟
# 轮询就绪（401 表示应用已起、认证生效）
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/me 2>/dev/null || echo 000)
  [ "$code" = "401" ] && break; sleep 3
done
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me-please"}'
```
Expected: 登录返回 `200`；`docker compose logs app` 含迁移、`已创建 admin: ...`、`Ready`。

- [ ] **Step 8: 关停并提交**

```bash
docker compose down
git add -A
git commit -m "chore: add admin seed, Dockerfile, docker-compose; minimal root page"
```

---

## 范围与延后项

本计划交付「可独立测试的服务端核心」。以下 spec 提及但属后续计划/部署层的内容，已显式延后（非遗漏）：

- **管理员操作 UI**：审批 pending 用户（`approveUser` service 已就绪）、创建邀请码、token 的创建/吊销/轮换列表 → **Plan 2（仪表盘）**。底层防御（bearer 拒绝已吊销 token、status 非 approved 拒绝）已在本计划实现。
- **限流**：上传/登录端点限流交由部署层的反向代理（nginx/caddy）处理，应用内不实现，保持 KISS。部署文档（Plan 2 末或单独 README）中说明。
- **TLS / 反向代理**：`docker-compose.yml` 仅暴露 3000；生产由前置反向代理负责 TLS，文档中说明。

## 完成标准（Plan 1）

- [ ] `pnpm test` 全绿（单测 + 集成 + 路由 smoke + 幂等性）。
- [ ] `docker compose up --build` 能起来，admin 可登录，`POST /api/v1/usage` 用有效 token 能写入、重复上传不翻倍。
- [ ] 隐私：API 只接收聚合计数字段，schema 不接受任何 prompt/代码字段。

执行完后再编写 **Plan 2（仪表盘）** 与 **Plan 3（skill 采集器）**。
