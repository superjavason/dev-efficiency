---
name: dev-efficiency
description: 把你本地 Claude Code 和 Codex CLI 的 AI token 使用数据汇总后上传到团队的 dev-efficiency 服务端。当用户说「上传 AI 用量」「同步 token 数据」「dev-efficiency 同步」「研发效能上报」时使用。
---

# dev-efficiency 数据同步

这个 skill 把你本地的 AI 使用数据上传到团队的 dev-efficiency 服务端。

## 首次使用

```bash
pnpm --filter @dev-efficiency/skill exec tsx bin/dev-efficiency-collect.ts --init
```

按提示输入：
- 服务器 URL（管理员告诉你）
- Auth token（在团队仪表盘的「我的 Auth Tokens」→「创建 token」生成）
- 是否启用 Cursor 手填
- 默认回扫天数（推荐 7）

## 日常使用

```bash
pnpm --filter @dev-efficiency/skill exec tsx bin/dev-efficiency-collect.ts
```

会扫描 `~/.claude/projects/` 和 `~/.codex/`，把最近 N 天的 token 用量聚合上传。重复运行幂等。

## 仅本地预览，不上传

```bash
pnpm --filter @dev-efficiency/skill exec tsx bin/dev-efficiency-collect.ts --dry-run
```

## 隐私

- 上传的字段只有：日期、工具、模型、项目哈希、token 计数、会话/消息数、来源
- **永远不会**上传 prompt 内容、代码内容、文件内容、项目路径明文
- 项目路径仅以 SHA-256 哈希前 16 字符出现
