# 研发效能统计系统 — 设计方案

- 状态：已通过设计评审，待编写实现计划
- 日期：2026-05-25
- 作者：xujiajie（superjavason@gmail.com）

## 1. 背景与目标

统计研发团队的 AI 编程效率，核心指标是**每位研发每天的 AI token 使用量**，按以下两个维度拆分：

- **工具**：Claude Code、Codex CLI、Cursor
- **模型**：如 `claude-opus-4-7`、`gpt-5.4` 等

研发通过安装一个统一发布的 Claude Code skill，在本地采集数据后上传到管理者自托管的服务端。系统对研发进行认证：研发先注册账号、由管理者准入，拿到一个一次性展示的 auth-token，把 token 配置到 skill 后即可上传。

### 非目标（v1 不做）

- 成本（USD）估算与定价表（数据模型预留，作为 v1.5 纯展示层增强）。
- Cursor / Copilot 的云端 Admin API 自动采集（Cursor v1 走手动填报）。
- 自动定时上传（v1 仅手动触发；幂等补传机制使其足够）。
- 上传任何 prompt、代码、文件内容（隐私底线，永不上传）。

## 2. 系统总览

三个组件，由「上传 API 契约 + 数据模型」绑定：

```
┌─────────────────┐   HTTPS + Bearer token    ┌──────────────────────────┐
│  研发本地         │ ─────────────────────────▶│  服务端 (Next.js 单体)      │
│  dev-efficiency  │   POST /api/v1/usage      │                          │
│  skill (采集器)   │                           │  · 上传 API (Bearer 认证)  │
│                  │                           │  · 认证 (注册/审批/登录)    │
│  解析本地日志:    │                           │  · 仪表盘 UI (管理员/个人)  │
│  Claude Code ✓   │                           │  · Prisma + PostgreSQL    │
│  Codex      ✓    │                           │                          │
│  Cursor(手填) ✓  │                           └──────────────────────────┘
└─────────────────┘                                docker-compose (app + db)
```

### 技术栈

- 服务端 + 仪表盘：**Next.js（App Router）单体应用**，TypeScript。
- ORM / 数据库：**Prisma + PostgreSQL**。
- 图表：Recharts。
- 部署：**自托管单机，docker-compose（app + db）一键起**。
- 客户端 skill 采集脚本：Node/TS（贴合团队 pnpm 习惯）。
- 包管理与构建：全程 `pnpm`。

## 3. 数据模型（Prisma / PostgreSQL）

### User

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string (cuid) | 主键 |
| email | string unique | 登录账号 |
| name | string | 显示名 |
| passwordHash | string | argon2/bcrypt 哈希 |
| role | enum(admin, member) | 角色 |
| status | enum(pending, approved, disabled) | 准入状态 |
| createdAt | datetime | |

### InviteCode（邀请码路径）

| 字段 | 类型 | 说明 |
|------|------|------|
| code | string unique | 邀请码 |
| createdById | string | 签发管理员 |
| usedById | string? | 使用者（用后置空表示已用） |
| expiresAt | datetime? | 过期时间 |
| createdAt | datetime | |

### AuthToken（支持多机 / 轮换）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| userId | string | 归属用户 |
| tokenHash | string | sha256 哈希存储，明文仅创建时展示一次 |
| name | string | 机器名 / 备注 |
| createdAt | datetime | |
| lastUsedAt | datetime? | 最近一次上传时间 |
| revokedAt | datetime? | 吊销时间 |

### UsageRecord

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| userId | string | 归属用户 |
| date | date | 当天（按本地时区归桶） |
| tool | enum(claude-code, codex, cursor) | 工具 |
| model | string | 模型名 |
| project | string? | 脱敏后的项目哈希（可空） |
| inputTokens | bigint | |
| outputTokens | bigint | |
| cacheCreationTokens | bigint | |
| cacheReadTokens | bigint | |
| totalTokens | bigint | 冗余汇总，便于查询 |
| sessionCount | int | 当桶去重会话数 |
| messageCount | int | 当桶消息/请求数 |
| source | enum(auto, manual) | 自动解析 / 手动填报 |
| updatedAt | datetime | |

- **唯一键**：`(userId, date, tool, model, project, source)` → 上传走 upsert，**重复上传不重复计数**（幂等）。

## 4. 上传 API 契约

### `POST /api/v1/usage`

- Header：`Authorization: Bearer <token>`
- Body：
  ```json
  {
    "records": [
      {
        "date": "2026-05-25",
        "tool": "claude-code",
        "model": "claude-opus-4-7",
        "project": "<sha256-hash-or-null>",
        "inputTokens": 6,
        "outputTokens": 681,
        "cacheCreationTokens": 13857,
        "cacheReadTokens": 17031,
        "sessionCount": 3,
        "messageCount": 42,
        "source": "auto"
      }
    ]
  }
  ```
- 行为：校验 token → 解析归属用户 → 按唯一键 upsert（`totalTokens` 服务端重算）→ 更新 `AuthToken.lastUsedAt`。
- 返回：`{ inserted, updated }`。

### `GET /api/v1/me`

- 校验 token，返回 `{ id, email, name, role }`。skill 用它验证配置是否正确。

## 5. 认证流程

1. **管理员引导**：首次启动用环境变量（`ADMIN_EMAIL` / `ADMIN_PASSWORD`）seed 出一个 admin 账号。
2. **研发注册**：提交 `email / name / password` + 邀请码；或注册后进入 `pending`，等管理员在后台审批。
3. **签发 token**：审批/注册通过后，系统生成一个 auth-token，**仅展示一次**（之后只存哈希）。研发可在后台再创建新 token（多机/轮换），并可吊销。
4. **仪表盘登录**：账号 = email + password，session cookie。`member` 只能看自己的数据，`admin` 看全部。
5. **skill 上传**：携带 auth-token，服务端 token → user，数据写入归属该用户。

## 6. 客户端 skill（采集器）

- **形态**：一个 Claude Code skill（`SKILL.md` + Node/TS 采集脚本）。
- **配置**：`~/.config/dev-efficiency/config.json` = `{ "serverUrl": "...", "authToken": "..." }`。skill 引导研发填入 token，并用 `GET /api/v1/me` 验证连通与有效性。
- **触发**：手动运行。默认回扫**最近 7 天**（可配置窗口），幂等补传，漏了的天数下次运行自动补齐。
- **采集逻辑**：

  - **Claude Code** ✓：遍历 `~/.claude/projects/**/*.jsonl`，取每条含 `message.usage` + `message.model` + `timestamp` 的记录，按 `(date, model, project)` 聚合 input/output/cacheCreation/cacheRead token、消息数、`sessionId` 去重会话数。project 取目录/`cwd`，**SHA-256 脱敏**后上传。
  - **Codex CLI** ✓：遍历 `~/.codex`（含 `archived_sessions`）的会话 jsonl，取 `type=event_msg` 且 `payload.type=token_count` 事件；用 `last_token_usage` 增量求和（避免 `total_token_usage` 累计值重复计数），model 取会话元数据（如 `gpt-5.4`），project 取会话 `workdir`，按 `(date, model, project)` 聚合。
  - **Cursor**（手动）：交互式让研发填写当天各模型大致用量，`source=manual` 上传。
  - 聚合完成后 `POST /api/v1/usage` 上传。

- **token 字段映射**：
  - Claude Code：`usage.input_tokens / output_tokens / cache_creation_input_tokens / cache_read_input_tokens`。
  - Codex：`last_token_usage.input_tokens / output_tokens`；`cached_input_tokens` 计入 `cacheReadTokens`；`reasoning_output_tokens` 并入 `outputTokens`。

## 7. 隐私与安全

- **只传聚合后的 token 计数**：绝不含 prompt、代码、文件内容；项目名以 SHA-256 脱敏后上传。
- 密码用 argon2（或 bcrypt）哈希；auth-token 以 sha256 哈希存储，明文仅创建时展示一次，可吊销 / 轮换。
- 上传端点与登录端点限流。
- 建议部署在反向代理 + TLS 之后（自托管，部署文档中说明）。

## 8. 仪表盘视图

- **管理员**：团队每日总 token 趋势；按人排行；按工具占比；按模型占比；可选时间范围；可下钻到某人 / 某项目。
- **个人（member）**：自己的每日趋势 + 工具 / 模型分布。
- 图表组件：Recharts。

## 9. 部署

- `docker-compose.yml`：`app`（Next.js）+ `db`（PostgreSQL）+ 持久化 volume。
- `.env`：`DATABASE_URL` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `SESSION_SECRET`。
- 启动时自动执行 Prisma migrate 与 admin seed。

## 10. 测试策略

- **解析器单测**：用真实样本造 fixture（Claude Code JSONL、Codex rollout JSONL），断言按 `(date, model, project)` 聚合的 token / 会话数正确；覆盖跨天、跨会话、缓存 token 等场景。
- **API 集成测试**：注册 → 审批 → 签发 token → 上传 → 查询 全链路；**幂等性测试**（同数据上传两次结果不翻倍）。
- **认证测试**：无 token / 错误 token / 已吊销 token 均被拒；member 不能访问他人数据。

## 11. 建议构建顺序

1. **服务端核心**：数据模型（Prisma schema + migrate）+ 认证（注册 / 审批 / 登录 / token 签发）+ 上传 API（含幂等 upsert）。
2. **仪表盘**：管理员视图 + 个人视图 + 图表。
3. **客户端 skill**：配置与验证 + Claude Code 解析器 + Codex 解析器 + Cursor 手动填报 + 上传。

每一步均可独立测试后再进入下一步。
