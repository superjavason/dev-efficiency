# dev-efficiency

研发 AI 编码工具的 **Token 用量统计平台**。

开发者在本地运行采集器（`skill/` 包），扫描 Claude Code / Codex CLI 的日志（Cursor 走交互式手填），按 `(日期, 工具, 模型, 项目)` 聚合 token 用量，再用 Bearer Token 上传到本服务端。服务端把数据存进 PostgreSQL，并以「个人 / 团队 / 管理员」三种视角渲染看板。

> **隐私优先**：采集器只上传 token 计数与元数据，绝不读取消息正文、prompt 或代码内容。上传字段由 `skill/src/types.ts` 的 zod strict schema 闭合。

---

## 功能概览

- **本地采集器**：自动解析 Claude Code、Codex 的本地日志；Cursor 交互式手填；幂等上传，可重复运行不重复计数。
- **用量看板**：每日趋势、工具 / 模型分布、用户排行；token 拆分为 input / output / cache 三类。
- **多视角权限**：个人只看自己；团队成员看团队聚合；平台管理员看全局并可下钻到指定用户。
- **团队协作**：创建团队、邀请链接、成员与角色管理。
- **认证**：邮箱密码登录、可选 GitHub OAuth（浏览器侧）；API Token（采集器侧）。
- **管理后台**：用户审批（注册默认 `pending`，需管理员批准）、团队管理。

---

## 技术栈

| 层 | 选型 |
|----|------|
| 框架 | Next.js 15（App Router）+ React 19 |
| 语言 | TypeScript |
| 数据库 | PostgreSQL + Prisma 6 |
| 浏览器会话 | iron-session（加密 Cookie） |
| API 认证 | Bearer Token（哈希存储） |
| GitHub 登录 | arctic |
| 密码哈希 | @node-rs/argon2 |
| UI | Tailwind CSS v4 + shadcn/ui + Recharts |
| 校验 | zod |
| 测试 | Vitest |
| 包管理 | pnpm（workspace monorepo） |

---

## 快速开始

### 前置要求

- Node.js 22+
- pnpm 10+（本仓库只用 `pnpm`，不要用 `npm`）
- Docker（用于本地 PostgreSQL）

### 1. 安装依赖

```bash
pnpm install   # 会一并安装 skill/ 子包依赖
```

### 2. 配置环境变量

复制示例文件并按需填写：

```bash
cp .env.example .env
```

关键变量（详见 `.env.example`）：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串（本地默认指向容器映射的 `5432` 端口） |
| `SESSION_SECRET` | iron-session 加密密钥，至少 32 字符 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | 首次 seed 的管理员账号 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_REDIRECT_URI` | GitHub OAuth 凭据（留空则禁用） |
| `NEXT_PUBLIC_GITHUB_ENABLED` | 是否在登录页显示 GitHub 入口 |

### 3. 启动数据库并初始化

```bash
docker compose up -d db          # 本地 Postgres，宿主机端口 5432
pnpm prisma:migrate              # 应用数据库迁移
pnpm db:seed                     # 按 ADMIN_* 创建管理员账号
```

### 4. 启动开发服务器

```bash
pnpm dev                         # http://localhost:3000
```

用 `.env` 里的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录。

---

## 常用命令

```bash
pnpm dev                # 开发服务器
pnpm build              # 生产构建
pnpm start              # 启动生产构建
pnpm lint               # ESLint

pnpm prisma:migrate     # 本地创建/应用迁移（migrate dev）
pnpm prisma:deploy      # 应用已有迁移（migrate deploy，部署用）
pnpm prisma:generate    # 改完 schema.prisma 后重新生成 client
pnpm db:seed            # seed 管理员

pnpm test               # 跑根项目测试（需要 Postgres）
pnpm test:watch
pnpm --filter @dev-efficiency/skill test   # 跑采集器单测（无需 DB）
```

跑单个测试文件 / 单个用例：

```bash
pnpm exec vitest run tests/integration/usage.test.ts
pnpm exec vitest run -t "测试名称"
```

> 根项目测试在 `node` 环境串行运行（`fileParallelism: false`）。`tests/setup/global.ts` 会加载 `.env.test` 并对**独立的测试库**执行一次 `prisma migrate deploy`——请把 `.env.test` 的 `DATABASE_URL` 指向另一个数据库（如 `dev_efficiency_test`），并确保 Postgres 已启动。

---

## 项目结构

```
.
├── src/
│   ├── middleware.ts              # 路由守卫：保护 /dashboard /admin /teams /invite
│   ├── app/
│   │   ├── (app)/                 # 已登录页面：dashboard、teams、admin、invite
│   │   ├── (auth)/                # 登录、注册
│   │   └── api/
│   │       ├── v1/usage           # POST 上传用量（Bearer）
│   │       ├── v1/me              # GET 当前用户（Bearer）
│   │       └── auth/              # register / logout / github OAuth
│   ├── components/                # UI 组件（ui/ 为 shadcn，charts/ 为图表）
│   └── lib/
│       ├── services/              # 纯业务逻辑，首参为 prisma，便于测试
│       ├── actions/               # "use server" 服务端 action（薄封装）
│       ├── auth/                  # session、bearer、token、password、github
│       └── validation/            # zod schema
├── prisma/
│   ├── schema.prisma              # 数据模型
│   ├── migrations/                # 迁移历史
│   └── seed.ts                    # 管理员 seed
├── skill/                         # 本地采集器（独立 workspace 包）
├── tests/                         # 根项目单测 + 集成测试
└── docs/superpowers/              # 设计文档（specs/）与实现计划（plans/）
```

### 服务端分层约定

代码遵循三层结构，新增功能时请保持：

- **`lib/services/`**：纯业务逻辑，每个函数首参为 `prisma: PrismaClient`（而非全局实例），便于集成测试。鉴权与数据整形都在这里。
- **`lib/actions/`**：`"use server"` 的服务端 action，薄封装——调用 `requireApprovedUser()`、委托给 service、`revalidatePath`，返回 `{ ok, error }`。
- **`app/api/`**：面向机器客户端的 API 路由，用 `resolveBearerUser()` 做 Bearer Token 鉴权。

---

## 认证机制

项目有两套独立认证：

- **浏览器**：iron-session 加密 Cookie（`de_session`）。`middleware.ts` 守卫页面路由；服务端代码内再用 `requireApprovedUser()` 校验用户为 `approved`。
- **采集器 / API**：`Authorization: Bearer <token>`。Token 哈希存储（`AuthToken.tokenHash`），校验未吊销且用户已审批。在看板「Token 管理」里生成。

---

## 本地采集器（skill/）

采集器是一个独立的 workspace 包，开发者在自己机器上运行，把本地 AI 工具的 token 用量上传到团队服务端。

```bash
# 首次配置（写入 ~/.config/dev-efficiency/config.json，权限 0600）
pnpm --filter @dev-efficiency/skill exec tsx bin/dev-efficiency-collect.ts --init

# 扫描近 N 天 → 聚合 → 上传
pnpm --filter @dev-efficiency/skill exec tsx bin/dev-efficiency-collect.ts
```

更多用法（`--dry-run`、`--days`、cron 定时、故障排查）见 [`skill/README.md`](skill/README.md)。

---

## 数据模型要点

- `UsageRecord` 按唯一键 `(userId, date, tool, model, project, source)` **幂等 upsert**，重复上传不重复计数。
- token 计数为 `BigInt`；`totalTokens = input + output + cacheCreation + cacheRead`，写入时一并维护。
- 工具枚举在 DB / 代码中为 `claude_code` 等，API / 线上格式为 `claude-code`，边界处用 `src/lib/tool.ts` 的 `toolFromApi` / `toolToApi` 转换。

---

## 部署

提供 `Dockerfile` 与 `docker-compose.yml`。容器启动时会自动执行 `prisma migrate deploy` → `db:seed` → `next start`。

```bash
docker compose up -d --build
```

生产环境务必通过环境变量提供 `DATABASE_URL`、`SESSION_SECRET`（≥32 字符）及 `ADMIN_*`。

---

## 文档

设计规格与实现计划存放于 `docs/superpowers/`：

- `specs/` — 各阶段设计文档
- `plans/` — 实现计划

四个构建阶段（服务端核心、看板、团队、采集器）均已合并至 master。
