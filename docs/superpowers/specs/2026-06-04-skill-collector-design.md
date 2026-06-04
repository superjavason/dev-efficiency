# Plan 4 — 客户端 skill 采集器 设计

- 状态：已通过设计评审，待编写实现计划
- 日期：2026-06-04
- 父 spec：[2026-05-25-dev-efficiency-tracker-design.md](./2026-05-25-dev-efficiency-tracker-design.md)（系统总设计）

## 1. 背景与范围

Plans 1（服务端核心）、2（仪表盘）、3（Teams）已合并到 master。系统具备：Bearer 鉴权的 `POST /api/v1/usage` 上传 API、个人/团队/管理员仪表盘、用户与团队管理。

本 spec 设计 **Plan 4：客户端 skill**——研发本地的 Claude Code skill，手动触发后扫描 Claude Code 和 Codex CLI 的本地日志，按 `(日期, 工具, 模型, 项目)` 聚合 token 使用量，对 Cursor 通过交互式手填补充，最终上传到服务端。

### 不在 Plan 4 范围

- 自动定时/后台轮询（v1 仅手动；幂等补传机制使其足够）。
- GitHub Copilot 数据采集。
- 任何 prompt/代码/文件内容上传（隐私底线）。
- 服务器端 Cursor Team Admin API 集成。
- skill 自动升级机制（手动 git pull / 拷贝即可）。

## 2. 仓库布局

skill 作为同仓库子目录 `skill/`，并被纳入根 `pnpm.workspaces`：

```
dev-efficiency/
  package.json                # 添加 "workspaces": ["skill"]
  skill/
    package.json              # 独立 deps：zod、@inquirer/prompts；devDeps：vitest、tsx
    SKILL.md                  # Claude Code skill 入口（自然语言触发描述）
    README.md                 # 研发安装/配置/使用文档
    bin/
      dev-efficiency-collect.ts   # 主入口
    src/
      config.ts               # ~/.config/dev-efficiency/config.json 读写 + 验证
      cli.ts                  # 命令行参数解析（手写，无 commander 依赖）
      hash.ts                 # project 路径 → SHA-256 前 16 字符
      aggregate.ts            # 多 parser 事件 → 按唯一键聚合
      parsers/
        claude-code.ts        # ~/.claude/projects/**/*.jsonl
        codex.ts              # ~/.codex/**/*.jsonl
        cursor.ts             # 交互式手填
      upload.ts               # /api/v1/me 预检 + 分批 POST /api/v1/usage + 指数退避重试
      types.ts                # UsageRecord 输出类型（同 zod schema）
    tests/
      fixtures/               # 真实 JSONL 片段，已人工脱敏
      hash.test.ts
      aggregate.test.ts
      config.test.ts
      parsers/claude-code.test.ts
      parsers/codex.test.ts
      upload.test.ts
```

## 3. SKILL.md（Claude Code 入口）

```yaml
---
name: dev-efficiency
description: 把你本地 Claude Code 和 Codex CLI 的 AI token 使用数据汇总后上传到团队的 dev-efficiency 服务端。当用户说「上传 AI 用量」「同步 token 数据」「dev-efficiency 同步」「研发效能上报」时使用。
---
```

SKILL.md 主体引导 Claude Code 执行 `pnpm --filter @dev-efficiency/skill exec tsx bin/dev-efficiency-collect.ts`（或简化的 shell 脚本入口）。

## 4. 配置文件

`~/.config/dev-efficiency/config.json`，权限 `0600`：

```json
{
  "serverUrl": "https://efficiency.example.com",
  "authToken": "de_xxxxxxxxxxxxxxxxxxxx",
  "cursor": { "enabled": false },
  "backfillDays": 7
}
```

- 首次运行无文件 → 运行 `--init` 走交互流：
  1. 输入 serverUrl（去除尾部 `/`）
  2. 输入 authToken（隐藏输入）
  3. 是否启用 Cursor 手填？（y/N）
  4. backfillDays（默认 7）
  5. 调 `GET /api/v1/me`，200 才写入文件；4xx 提示重试
- 字段用 zod 校验，缺失或类型错则报错并指向 `--init`。

## 5. CLI

```
dev-efficiency-collect                       # 默认：扫最近 backfillDays 天 + 上传
dev-efficiency-collect --init                # 交互配置 + token 校验
dev-efficiency-collect --days <N>            # 覆盖 backfill 窗口
dev-efficiency-collect --dry-run             # 不上传，仅打印 JSON 聚合结果
dev-efficiency-collect --verbose             # 打印每个文件的解析进度
dev-efficiency-collect --help                # 帮助
```

无子命令、扁平 flags。退出码：0 成功；1 配置错误；2 服务端不可达 / 401；3 解析致命错。

## 6. 解析器

每个 parser 输出 `RawEvent` 列表（统一中间格式），形如：

```typescript
interface RawEvent {
  date: string;        // YYYY-MM-DD（本地时区）
  tool: "claude-code" | "codex" | "cursor";
  model: string;
  projectPath: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  sessionId: string | null;
  source: "auto" | "manual";
}
```

### Claude Code

- 遍历 `~/.claude/projects/**/*.jsonl`，逐行 `JSON.parse`。
- 取 `type === "assistant"` 且 `message.usage` 存在的行。
- 字段映射：`message.model` → `model`；`message.usage.input_tokens` 等 → token 字段；`timestamp` 取本地日期；`cwd` → projectPath；`sessionId` → sessionId。
- 文件大时按行流式读取（`readline` over `createReadStream`），不全文加载。

### Codex CLI

- 遍历 `~/.codex/sessions/**/*.jsonl`（含 `archived_sessions/`）。
- 对每个会话 jsonl：取该文件**最后一个** `type === "event_msg"` 且 `payload.type === "token_count"` 的事件，其 `info.total_token_usage` 是该会话累计 token；按事件 `timestamp` 取本地日期。
- 这种「按会话取最后一次累计」避免了同一会话被多事件重复计数。
- 模型从该文件首个 `session_init` 类事件的 `model` 字段读取；找不到则 `model = "unknown"`。
- 字段映射：`input_tokens`、`output_tokens`、`cached_input_tokens` → `cacheReadTokens`；`reasoning_output_tokens` 并入 `outputTokens`。`cacheCreationTokens = 0`（Codex 协议没有该概念）。
- projectPath 从 `session_init` 的 `cwd` 字段读取。
- `sessionId`：从 jsonl 文件名解析 UUID 段（Codex 命名格式 `rollout-<timestamp>-<uuid>.jsonl`）；解析失败则用文件路径作为 fallback（保证同一文件不重复计入 sessionCount）。

### Cursor（手填）

仅当 `config.cursor.enabled === true` 启用，否则**完全跳过**（无任何 prompt）。启用时使用 `@inquirer/prompts`：

```
今天用 Cursor 了吗？ (y/N)
> y
主要使用的模型 (如 claude-sonnet-4-5)?
> claude-sonnet-4-5
该模型大概 input token 数?
> 50000
output token 数?
> 8000
所在项目目录 (回车跳过)?
> /Users/xx/repo-foo
还要补充其他模型吗? (y/N)
```

每条生成一条 `source: "manual"` 的 RawEvent，date 取当天本地日期。

## 7. 聚合（`aggregate.ts`）

输入：`RawEvent[]`；输出：`UsageRecord[]`（与服务端 zod schema 完全一致）。

```typescript
interface UsageRecord {
  date: string;                  // YYYY-MM-DD
  tool: "claude-code" | "codex" | "cursor";
  model: string;
  project: string;               // 16-char hex hash, or "" if no path
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  sessionCount: number;          // distinct sessionId 数
  messageCount: number;          // RawEvent 数
  source: "auto" | "manual";
}
```

聚合 key 为 `(date, tool, model, project, source)`。`project` 计算：

```typescript
import { createHash } from "node:crypto";
function projectHash(path: string | null): string {
  if (!path) return "";
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}
```

`sessionCount` 取该 key 下去重的 sessionId 集合大小（null sessionId 不计）。

## 8. 上传（`upload.ts`）

1. **预检**：`GET ${serverUrl}/api/v1/me` 带 Bearer token。非 200 立刻退出（提示运行 `--init` 或检查 token）。
2. **分批**：每批 ≤ 500 条 record，`POST /api/v1/usage`。Body：`{ records: UsageRecord[] }`。
3. **重试**：网络错或 5xx 时指数退避（1s/2s/4s）最多 3 次。4xx 立即失败（除 429 也走退避）。
4. **进度**：默认打印 `[OK] uploaded N records (inserted X, updated Y)`；`--verbose` 打印每批。
5. **out**: 服务端返回的 `{inserted, updated}` 累加打印。

## 9. 隐私不变量

- `types.ts` 用 zod 闭合定义 `UsageRecord`，`zod.strict()`。
- `upload.ts` 在 POST 前用 schema `parse()` 一次，扔掉任何未声明字段（与服务端 Plan 1 的回归测试形成双层防御）。
- parser 严禁读取 `message.content`、`text`、`input` 等含语义文本的字段——只读 token 数、timestamp、model、cwd、sessionId。
- 提交 fixture 时人工脱敏 prompt/响应文本（fixtures 只保留必要的元数据字段）。
- `--dry-run` 输出与最终 POST body 同款；不包含 prompt/代码。

## 10. 测试策略

- **单测**：`hash.test.ts`、`aggregate.test.ts`、`config.test.ts`、两个 parser 的单测（用 fixtures）。约 25-30 个用例。
- **upload 测试**：用 `vi.spyOn(global, "fetch")` 模拟服务端响应（200 inserted/updated；401；500 重试；分批），约 6-8 用例。
- 不打真 GitHub、不打真服务器，不做端到端（服务端的端到端 docker 测试由 Plans 1/2/3 覆盖）。

## 11. 文档

`skill/README.md` 含：
- 安装：克隆 monorepo + 软链 `~/.claude/skills/dev-efficiency` 指向 `skill/`（macOS 用 `ln -s`），或直接复制目录。
- 首次配置：`dev-efficiency-collect --init`。
- 日常使用：在 Claude Code 里说「同步 AI 用量」即触发 skill；或手动 `dev-efficiency-collect`。
- 可选 cron：示例 launchd plist 或 crontab。
- Cursor 启用方式：编辑配置文件把 `cursor.enabled` 改 `true`。

## 12. 建议构建顺序

1. **config + CLI 框架**：`src/config.ts`、`src/cli.ts`、`bin/dev-efficiency-collect.ts` 骨架；`--init` 交互流；`/api/v1/me` 预检。包含 `config.test.ts`。
2. **hash + aggregate**：单测驱动，确保 sessionId 去重 + 哈希稳定。
3. **Claude Code parser** + fixture 单测。
4. **Codex parser** + fixture 单测。
5. **Cursor 交互式手填模块**（@inquirer/prompts）。
6. **upload 层**（fetch mock 测重试、批量、错误处理）。
7. **SKILL.md + README + workspace 集成**：根 `package.json` 加 `"workspaces": ["skill"]`，验证 `pnpm install` 在根目录能装 skill 依赖；`pnpm --filter ./skill test` 通过；手工跑一次 `--dry-run` 真实联调（如有服务端开发环境）。

## 13. 完成标准

- skill `pnpm --filter ./skill test` 全绿（含约 30 单测 + 8 upload 测试）。
- 根 `pnpm test` 仍全绿（不影响服务端测试）。
- `dev-efficiency-collect --dry-run` 在有 Claude Code/Codex 历史的开发机上能正确输出聚合 JSON（手工验证至少一次）。
- 隐私不变量：parser 代码不引用任何 `content/text/input/prompt` 字段；fixture 已脱敏；zod strict 防止字段泄漏。
- README 中的安装步骤研发可独立按图操作。
