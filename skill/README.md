# dev-efficiency skill

研发本地运行的采集器：扫描 Claude Code 和 Codex CLI 的本地日志、对 Cursor 走交互式手填，按 (date, tool, model, project) 聚合 token 用量，调团队服务端的 `/api/v1/usage` 上传。

## 安装（首次）

1. 克隆/拉取本 monorepo
2. 在仓库根目录 `pnpm install`（pnpm workspace 会一并装 skill 依赖）
3. （可选）软链到 Claude Code skills 目录：
   ```bash
   mkdir -p ~/.claude/skills
   ln -s "$PWD/skill" ~/.claude/skills/dev-efficiency
   ```

## 首次配置

```bash
pnpm --filter @dev-efficiency/skill exec tsx bin/dev-efficiency-collect.ts --init
```

写入 `~/.config/dev-efficiency/config.json`（权限 0600）。

## 命令

| 命令 | 作用 |
|------|------|
| （无 flag） | 扫描 `config.backfillDays` 天 → 聚合 → 上传 |
| `--init` | 交互式配置 + token 校验 |
| `--days N` | 覆盖回扫窗口 |
| `--dry-run` | 不上传，打印聚合 JSON |
| `--verbose` | 显示每个 parser 的事件计数 |
| `--help` | 帮助 |

## 设计要点

- **隐私不变量**：上传字段由 `src/types.ts` 的 zod strict schema 闭合；parser 严禁读取 `message.content` / `text` / `input` 等含语义文本的字段。
- **幂等**：服务端按 `(userId, date, tool, model, project, source)` upsert，重复运行不重复计数。
- **流式解析**：JSONL 文件按行 stream，避免一次性加载大文件。
- **Codex 取每会话最后一个 token_count 事件**：避免同一会话被多事件累计计数。
- **Cursor**：仅 `config.cursor.enabled === true` 时交互式手填。

## 故障排查

- `Token validation failed: HTTP 401`：token 已吊销或服务端拒绝。运行 `--init` 重配。
- `Config error: ...`：config.json 损坏或缺字段。删除文件后 `--init` 重建。
- `network error contacting ...`：检查 serverUrl 网络可达。

## 可选：cron 定时

示例 crontab（macOS）每晚 18:00 自动同步：

```cron
0 18 * * * cd /path/to/dev-efficiency && pnpm --filter @dev-efficiency/skill exec tsx bin/dev-efficiency-collect.ts >> ~/.dev-efficiency.log 2>&1
```

注意 cron 环境下 Cursor 交互式手填会因无 TTY 报错——若 `cursor.enabled=true`，cron 跑会失败。建议 cron 路径上把 cursor.enabled 设为 false，或者仅手动跑 cursor 模式。
