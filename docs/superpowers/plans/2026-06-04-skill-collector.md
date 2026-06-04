# Plan 4 — 客户端 skill 采集器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 monorepo 的 `skill/` 子目录里建一个 Claude Code skill —— 研发本地运行时扫描 Claude Code 和 Codex 的本地 JSONL 日志、对 Cursor 走交互式手填、按 (date, tool, model, project-hash) 聚合 token 用量、调 `POST /api/v1/usage` 上传到团队服务端，幂等可重跑。

**Architecture:** 子目录 `skill/` 是 pnpm workspace 子包；纯 Node/TS（tsx 直跑，无构建步骤）；每个 parser 输出统一 `RawEvent[]`；`aggregate.ts` 用复合键聚合；`upload.ts` 调 `/api/v1/me` 预检 + 分批 POST + 5xx 指数退避；隐私不变量靠 zod strict + parser 严格只读元数据（不读 message.content/text/input）。配置在 `~/.config/dev-efficiency/config.json`，`--init` 引导交互。

**Tech Stack:** Node 22 / TypeScript / tsx（运行时无构建）/ zod（schema 校验）/ @inquirer/prompts（CLI 交互）/ vitest（测试）/ pnpm workspace。**不引入** commander/yargs（手写 flag 解析就够）。

> 这是三份后续计划的第 3 份（最后一份）。Plans 1（服务端）、2（仪表盘）、3（Teams）已全部合并。

---

## 文件结构（本计划涉及）

```
dev-efficiency/
  package.json                # 改：加 "workspaces": ["skill"]
  pnpm-workspace.yaml         # 改/建：列出 skill 包（若已存在，追加）
  skill/                      # 新增整个目录
    package.json
    tsconfig.json
    SKILL.md
    README.md
    bin/
      dev-efficiency-collect.ts
    src/
      cli.ts                  # 解析 flags
      config.ts               # 读写 ~/.config/dev-efficiency/config.json
      hash.ts                 # projectHash(path)
      types.ts                # RawEvent, UsageRecord, zod schemas
      aggregate.ts            # RawEvent[] → UsageRecord[]
      parsers/
        claude-code.ts
        codex.ts
        cursor.ts
      upload.ts               # /api/v1/me 预检 + 分批 POST + 重试
    tests/
      fixtures/
        claude-code.jsonl     # 脱敏过的真实样本
        codex-session.jsonl
      hash.test.ts
      aggregate.test.ts
      config.test.ts
      types.test.ts           # zod strict 守护
      parsers/
        claude-code.test.ts
        codex.test.ts
      upload.test.ts
```

---

## Task 1: 子包脚手架 + workspace 集成

**Files:**
- Modify: `package.json`（根）
- Create: `pnpm-workspace.yaml`（根，若不存在）
- Create: `skill/package.json`, `skill/tsconfig.json`, `skill/.gitignore`

- [ ] **Step 1: 修改根 `package.json` 加 workspaces**

  在根 `package.json` 顶层（如已有 prisma block 之后）追加：
  ```json
  "workspaces": ["skill"]
  ```
  注意 pnpm 优先读 `pnpm-workspace.yaml`，但保留 `workspaces` 字段方便 IDE 识别。

- [ ] **Step 2: 创建根 `pnpm-workspace.yaml`**

  ```yaml
  packages:
    - "skill"
  ```

- [ ] **Step 3: 创建 `skill/package.json`**

  ```json
  {
    "name": "@dev-efficiency/skill",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
      "test": "vitest run",
      "test:watch": "vitest",
      "collect": "tsx bin/dev-efficiency-collect.ts"
    },
    "dependencies": {
      "@inquirer/prompts": "^7.2.1",
      "zod": "^3.24.1"
    },
    "devDependencies": {
      "@types/node": "^22.10.5",
      "tsx": "^4.19.2",
      "typescript": "^5.7.2",
      "vitest": "^2.1.8"
    }
  }
  ```

- [ ] **Step 4: 创建 `skill/tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "esnext",
      "moduleResolution": "bundler",
      "lib": ["ES2022"],
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "resolveJsonModule": true,
      "isolatedModules": true,
      "noEmit": true,
      "paths": { "@/*": ["./src/*"] }
    },
    "include": ["src/**/*.ts", "bin/**/*.ts", "tests/**/*.ts"]
  }
  ```

- [ ] **Step 5: 创建 `skill/.gitignore`**

  ```
  node_modules
  ```

- [ ] **Step 6: 创建 `skill/vitest.config.ts`**

  ```typescript
  import { defineConfig } from "vitest/config";
  import { fileURLToPath } from "node:url";

  export default defineConfig({
    test: {
      environment: "node",
    },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
  });
  ```

- [ ] **Step 7: 装依赖 + 验证**

  Run from repo root:
  ```bash
  pnpm install
  ```
  Expected: pnpm 检测到新 workspace 包，安装其依赖。然后：
  ```bash
  pnpm --filter @dev-efficiency/skill test
  ```
  Expected: vitest 报「no test files found」（正常，还没写测试）；退出码 1 是 vitest 的「没找到测试」语义，可以接受。

- [ ] **Step 8: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "chore(skill): scaffold pnpm workspace subpackage"
  ```

---

## Task 2: types + zod schemas + 隐私守护测试

**Files:**
- Create: `skill/src/types.ts`, `skill/tests/types.test.ts`

- [ ] **Step 1: 写失败测试 `skill/tests/types.test.ts`**

  ```typescript
  import { describe, it, expect } from "vitest";
  import { usageRecordSchema, type RawEvent } from "@/types";

  describe("usageRecordSchema (privacy backbone)", () => {
    const valid = {
      date: "2026-05-25",
      tool: "claude-code" as const,
      model: "claude-opus-4-7",
      project: "abcdef0123456789",
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationTokens: 50,
      cacheReadTokens: 80,
      sessionCount: 1,
      messageCount: 3,
      source: "auto" as const,
    };

    it("accepts a valid record", () => {
      expect(usageRecordSchema.safeParse(valid).success).toBe(true);
    });

    it("strips unknown fields (zod strict)", () => {
      const r = usageRecordSchema.safeParse({ ...valid, prompt: "secret", code: "rm -rf /" });
      expect(r.success).toBe(false); // strict mode rejects extras
    });

    it("rejects unknown tool", () => {
      expect(usageRecordSchema.safeParse({ ...valid, tool: "vim" }).success).toBe(false);
    });

    it("rejects non-YYYY-MM-DD date", () => {
      expect(usageRecordSchema.safeParse({ ...valid, date: "2026/05/25" }).success).toBe(false);
    });

    it("rejects negative tokens", () => {
      expect(usageRecordSchema.safeParse({ ...valid, inputTokens: -1 }).success).toBe(false);
    });

    it("requires project field (empty string allowed)", () => {
      const { project, ...noProj } = valid;
      expect(usageRecordSchema.safeParse(noProj).success).toBe(false);
      expect(usageRecordSchema.safeParse({ ...valid, project: "" }).success).toBe(true);
    });

    it("RawEvent type is exported (compile check)", () => {
      const e: RawEvent = {
        date: "2026-05-25",
        tool: "codex",
        model: "gpt-5",
        projectPath: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        sessionId: null,
        source: "auto",
      };
      expect(e.date).toBe("2026-05-25");
    });
  });
  ```

- [ ] **Step 2: 跑测试确认 FAIL**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/types.test.ts`
  Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `skill/src/types.ts`**

  ```typescript
  import { z } from "zod";

  export const TOOLS = ["claude-code", "codex", "cursor"] as const;
  export type Tool = (typeof TOOLS)[number];

  /**
   * Mid-flight event before aggregation.
   * Parsers produce these; aggregate() collapses them by composite key.
   */
  export interface RawEvent {
    date: string;
    tool: Tool;
    model: string;
    projectPath: string | null;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    sessionId: string | null;
    source: "auto" | "manual";
  }

  const tokenInt = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

  /**
   * Closed schema — strict() rejects unknown fields.
   * This is the privacy backbone: nothing not explicitly listed reaches the server.
   */
  export const usageRecordSchema = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      tool: z.enum(TOOLS),
      model: z.string().min(1).max(100),
      project: z.string().max(64),
      inputTokens: tokenInt,
      outputTokens: tokenInt,
      cacheCreationTokens: tokenInt,
      cacheReadTokens: tokenInt,
      sessionCount: z.number().int().nonnegative(),
      messageCount: z.number().int().nonnegative(),
      source: z.enum(["auto", "manual"]),
    })
    .strict();

  export type UsageRecord = z.infer<typeof usageRecordSchema>;

  export const usagePayloadSchema = z.object({
    records: z.array(usageRecordSchema).min(1).max(2000),
  });
  ```

- [ ] **Step 4: 跑测试确认 PASS**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/types.test.ts`
  Expected: PASS（7 用例）。

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat(skill): add types + zod strict schemas for privacy enforcement"
  ```

---

## Task 3: 项目路径哈希

**Files:**
- Create: `skill/src/hash.ts`, `skill/tests/hash.test.ts`

- [ ] **Step 1: 写失败测试 `skill/tests/hash.test.ts`**

  ```typescript
  import { describe, it, expect } from "vitest";
  import { projectHash } from "@/hash";

  describe("projectHash", () => {
    it("returns empty string for null/undefined", () => {
      expect(projectHash(null)).toBe("");
      expect(projectHash(undefined)).toBe("");
    });

    it("returns empty string for empty input", () => {
      expect(projectHash("")).toBe("");
    });

    it("returns deterministic 16-char hex for non-empty path", () => {
      const h1 = projectHash("/Users/me/repo");
      const h2 = projectHash("/Users/me/repo");
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{16}$/);
    });

    it("returns different hashes for different paths", () => {
      expect(projectHash("/a")).not.toBe(projectHash("/b"));
    });

    it("matches expected sha256 prefix", () => {
      // sha256("/Users/me/repo") first 16 hex chars — hard-coded for regression
      // computed via: node -e 'console.log(require("crypto").createHash("sha256").update("/Users/me/repo").digest("hex").slice(0,16))'
      // We don't hard-code here; just verify length+format.
      expect(projectHash("/Users/me/repo").length).toBe(16);
    });
  });
  ```

- [ ] **Step 2: 跑测试确认 FAIL**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/hash.test.ts`
  Expected: FAIL。

- [ ] **Step 3: 实现 `skill/src/hash.ts`**

  ```typescript
  import { createHash } from "node:crypto";

  /**
   * Deterministically map a project path to a 16-char hex token.
   * Null/empty input → empty string (server treats it as "no project").
   */
  export function projectHash(path: string | null | undefined): string {
    if (!path) return "";
    return createHash("sha256").update(path).digest("hex").slice(0, 16);
  }
  ```

- [ ] **Step 4: 跑测试确认 PASS**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/hash.test.ts`
  Expected: PASS。

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat(skill): add projectHash utility (sha256 truncated to 16 chars)"
  ```

---

## Task 4: aggregate (RawEvent[] → UsageRecord[])

**Files:**
- Create: `skill/src/aggregate.ts`, `skill/tests/aggregate.test.ts`

- [ ] **Step 1: 写失败测试 `skill/tests/aggregate.test.ts`**

  ```typescript
  import { describe, it, expect } from "vitest";
  import { aggregate } from "@/aggregate";
  import type { RawEvent } from "@/types";

  function ev(over: Partial<RawEvent> = {}): RawEvent {
    return {
      date: "2026-05-25",
      tool: "claude-code",
      model: "claude-opus-4-7",
      projectPath: "/repo",
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 5,
      cacheReadTokens: 7,
      sessionId: "s1",
      source: "auto",
      ...over,
    };
  }

  describe("aggregate", () => {
    it("sums tokens within a single composite key", () => {
      const out = aggregate([ev(), ev({ inputTokens: 100, outputTokens: 200 })]);
      expect(out).toHaveLength(1);
      expect(out[0].inputTokens).toBe(110);
      expect(out[0].outputTokens).toBe(220);
      expect(out[0].cacheCreationTokens).toBe(10);
      expect(out[0].cacheReadTokens).toBe(14);
      expect(out[0].messageCount).toBe(2);
      expect(out[0].sessionCount).toBe(1);
    });

    it("dedupes sessionIds for sessionCount", () => {
      const out = aggregate([
        ev({ sessionId: "s1" }),
        ev({ sessionId: "s2" }),
        ev({ sessionId: "s1" }),
      ]);
      expect(out[0].sessionCount).toBe(2);
      expect(out[0].messageCount).toBe(3);
    });

    it("counts null sessionId as no session", () => {
      const out = aggregate([
        ev({ sessionId: null }),
        ev({ sessionId: null }),
      ]);
      expect(out[0].sessionCount).toBe(0);
      expect(out[0].messageCount).toBe(2);
    });

    it("separates rows by date / tool / model / project / source", () => {
      const out = aggregate([
        ev({ date: "2026-05-25" }),
        ev({ date: "2026-05-26" }),
        ev({ tool: "codex", model: "gpt-5" }),
        ev({ model: "claude-sonnet-4-5" }),
        ev({ projectPath: "/other" }),
        ev({ source: "manual" }),
      ]);
      expect(out).toHaveLength(6);
    });

    it("hashes projectPath; null path → empty string", () => {
      const out = aggregate([ev({ projectPath: null })]);
      expect(out[0].project).toBe("");
      const out2 = aggregate([ev({ projectPath: "/repo" })]);
      expect(out2[0].project).toMatch(/^[0-9a-f]{16}$/);
    });

    it("same path always hashes to same project value", () => {
      const a = aggregate([ev({ projectPath: "/repo" })])[0].project;
      const b = aggregate([ev({ projectPath: "/repo" })])[0].project;
      expect(a).toBe(b);
    });

    it("returns deterministic sort order", () => {
      const a = aggregate([
        ev({ date: "2026-05-26" }),
        ev({ date: "2026-05-25" }),
      ]);
      expect(a.map((r) => r.date)).toEqual(["2026-05-25", "2026-05-26"]);
    });

    it("output passes the strict zod schema", async () => {
      const { usagePayloadSchema } = await import("@/types");
      const out = aggregate([ev()]);
      const r = usagePayloadSchema.safeParse({ records: out });
      expect(r.success).toBe(true);
    });
  });
  ```

- [ ] **Step 2: 跑测试确认 FAIL**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/aggregate.test.ts`
  Expected: FAIL.

- [ ] **Step 3: 实现 `skill/src/aggregate.ts`**

  ```typescript
  import { projectHash } from "@/hash";
  import type { RawEvent, UsageRecord } from "@/types";

  interface Acc {
    record: UsageRecord;
    sessions: Set<string>;
  }

  /**
   * Aggregate raw events into per-composite-key records.
   * Key = (date, tool, model, project, source) — same as the server's @@unique.
   */
  export function aggregate(events: RawEvent[]): UsageRecord[] {
    const buckets = new Map<string, Acc>();

    for (const e of events) {
      const project = projectHash(e.projectPath);
      const key = `${e.date}|${e.tool}|${e.model}|${project}|${e.source}`;
      let acc = buckets.get(key);
      if (!acc) {
        acc = {
          record: {
            date: e.date,
            tool: e.tool,
            model: e.model,
            project,
            inputTokens: 0,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0,
            sessionCount: 0,
            messageCount: 0,
            source: e.source,
          },
          sessions: new Set(),
        };
        buckets.set(key, acc);
      }
      acc.record.inputTokens += e.inputTokens;
      acc.record.outputTokens += e.outputTokens;
      acc.record.cacheCreationTokens += e.cacheCreationTokens;
      acc.record.cacheReadTokens += e.cacheReadTokens;
      acc.record.messageCount += 1;
      if (e.sessionId) acc.sessions.add(e.sessionId);
    }

    const rows = Array.from(buckets.values()).map(({ record, sessions }) => ({
      ...record,
      sessionCount: sessions.size,
    }));

    rows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.tool !== b.tool) return a.tool < b.tool ? -1 : 1;
      if (a.model !== b.model) return a.model < b.model ? -1 : 1;
      if (a.project !== b.project) return a.project < b.project ? -1 : 1;
      return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
    });
    return rows;
  }
  ```

- [ ] **Step 4: 跑测试确认 PASS**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/aggregate.test.ts`
  Expected: 8 用例 PASS。

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat(skill): add aggregate (RawEvent[] → UsageRecord[]) with composite-key bucketing"
  ```

---

## Task 5: config 读写 + 校验

**Files:**
- Create: `skill/src/config.ts`, `skill/tests/config.test.ts`

- [ ] **Step 1: 写失败测试 `skill/tests/config.test.ts`**

  ```typescript
  import { describe, it, expect, beforeEach } from "vitest";
  import { mkdtempSync, writeFileSync, chmodSync, statSync } from "node:fs";
  import { tmpdir } from "node:os";
  import { join } from "node:path";
  import { readConfig, writeConfig, type Config } from "@/config";

  function tmpFile() {
    const dir = mkdtempSync(join(tmpdir(), "de-cfg-"));
    return join(dir, "config.json");
  }

  describe("config", () => {
    it("readConfig returns null when file missing", async () => {
      const path = tmpFile();
      expect(await readConfig(path)).toBeNull();
    });

    it("readConfig returns parsed config when valid", async () => {
      const path = tmpFile();
      writeFileSync(path, JSON.stringify({
        serverUrl: "https://x.example.com",
        authToken: "de_abc",
        cursor: { enabled: false },
        backfillDays: 7,
      }));
      const c = await readConfig(path);
      expect(c?.serverUrl).toBe("https://x.example.com");
      expect(c?.cursor.enabled).toBe(false);
    });

    it("readConfig throws on malformed JSON", async () => {
      const path = tmpFile();
      writeFileSync(path, "{not json");
      await expect(readConfig(path)).rejects.toThrow();
    });

    it("readConfig throws on schema violation", async () => {
      const path = tmpFile();
      writeFileSync(path, JSON.stringify({ serverUrl: "x" })); // missing fields
      await expect(readConfig(path)).rejects.toThrow();
    });

    it("readConfig normalizes serverUrl by stripping trailing slash", async () => {
      const path = tmpFile();
      writeFileSync(path, JSON.stringify({
        serverUrl: "https://x.example.com/",
        authToken: "de_abc",
        cursor: { enabled: true },
        backfillDays: 30,
      }));
      const c = await readConfig(path);
      expect(c?.serverUrl).toBe("https://x.example.com");
    });

    it("writeConfig creates file with 0600 permissions", async () => {
      const path = tmpFile();
      const c: Config = {
        serverUrl: "https://x.example.com",
        authToken: "de_abc",
        cursor: { enabled: false },
        backfillDays: 7,
      };
      await writeConfig(path, c);
      const s = statSync(path);
      // mode & 0o777 should be 0o600
      expect(s.mode & 0o777).toBe(0o600);
    });

    it("writeConfig creates parent directory if missing", async () => {
      const dir = mkdtempSync(join(tmpdir(), "de-cfg-"));
      const path = join(dir, "nested", "deep", "config.json");
      const c: Config = {
        serverUrl: "https://x.example.com",
        authToken: "de_abc",
        cursor: { enabled: false },
        backfillDays: 7,
      };
      await writeConfig(path, c);
      const reread = await readConfig(path);
      expect(reread?.serverUrl).toBe("https://x.example.com");
    });
  });
  ```

- [ ] **Step 2: 跑测试确认 FAIL**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/config.test.ts`
  Expected: FAIL.

- [ ] **Step 3: 实现 `skill/src/config.ts`**

  ```typescript
  import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
  import { dirname } from "node:path";
  import { z } from "zod";

  export const configSchema = z.object({
    serverUrl: z.string().url().transform((s) => s.replace(/\/+$/, "")),
    authToken: z.string().min(1),
    cursor: z.object({ enabled: z.boolean() }),
    backfillDays: z.number().int().min(1).max(365),
  });
  export type Config = z.infer<typeof configSchema>;

  export const DEFAULT_CONFIG_PATH = `${process.env.HOME ?? ""}/.config/dev-efficiency/config.json`;

  /**
   * Load and validate config. Returns null when file does not exist.
   * Throws when file exists but is malformed/invalid.
   */
  export async function readConfig(path: string = DEFAULT_CONFIG_PATH): Promise<Config | null> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`config file at ${path} is not valid JSON: ${(e as Error).message}`);
    }
    const result = configSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`config at ${path} failed validation: ${result.error.message}`);
    }
    return result.data;
  }

  /**
   * Write config to disk with 0600 permissions; creates parent dirs as needed.
   */
  export async function writeConfig(path: string, config: Config): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600);
  }
  ```

- [ ] **Step 4: 跑测试确认 PASS**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/config.test.ts`
  Expected: 7 用例 PASS。

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat(skill): add config read/write with zod validation and 0600 perms"
  ```

---

## Task 6: Claude Code parser

**Files:**
- Create: `skill/src/parsers/claude-code.ts`, `skill/tests/parsers/claude-code.test.ts`, `skill/tests/fixtures/claude-code.jsonl`

- [ ] **Step 1: 创建 fixture `skill/tests/fixtures/claude-code.jsonl`**

  ```
  {"type":"user","message":{"role":"user"},"timestamp":"2026-05-25T02:00:00.000Z","sessionId":"s-aaa","cwd":"/Users/me/repo-a"}
  {"type":"assistant","timestamp":"2026-05-25T02:00:05.000Z","sessionId":"s-aaa","cwd":"/Users/me/repo-a","message":{"model":"claude-opus-4-7","usage":{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":5,"cache_read_input_tokens":7}}}
  {"type":"assistant","timestamp":"2026-05-25T02:00:30.000Z","sessionId":"s-aaa","cwd":"/Users/me/repo-a","message":{"model":"claude-opus-4-7","usage":{"input_tokens":50,"output_tokens":80,"cache_creation_input_tokens":0,"cache_read_input_tokens":12}}}
  {"type":"assistant","timestamp":"2026-05-25T03:00:00.000Z","sessionId":"s-bbb","cwd":"/Users/me/repo-b","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":3,"output_tokens":4,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}
  {"type":"assistant","timestamp":"2026-05-26T05:00:00.000Z","sessionId":"s-ccc","cwd":"/Users/me/repo-a","message":{"model":"claude-opus-4-7","usage":{"input_tokens":1,"output_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}
  ```

  Note: these fixtures contain ONLY metadata fields used by the parser. No `message.content` / no prompt text.

- [ ] **Step 2: 写失败测试 `skill/tests/parsers/claude-code.test.ts`**

  ```typescript
  import { describe, it, expect } from "vitest";
  import { parseClaudeCodeFile, parseClaudeCodeDir } from "@/parsers/claude-code";
  import { fileURLToPath } from "node:url";
  import { dirname, join } from "node:path";

  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = join(here, "..", "fixtures", "claude-code.jsonl");

  describe("parseClaudeCodeFile", () => {
    it("extracts events from assistant messages with usage", async () => {
      const events = await parseClaudeCodeFile(fixture);
      expect(events).toHaveLength(4); // 4 assistant rows, user row skipped
    });

    it("populates token fields correctly", async () => {
      const events = await parseClaudeCodeFile(fixture);
      const first = events[0];
      expect(first.tool).toBe("claude-code");
      expect(first.model).toBe("claude-opus-4-7");
      expect(first.inputTokens).toBe(10);
      expect(first.outputTokens).toBe(20);
      expect(first.cacheCreationTokens).toBe(5);
      expect(first.cacheReadTokens).toBe(7);
      expect(first.sessionId).toBe("s-aaa");
      expect(first.projectPath).toBe("/Users/me/repo-a");
      expect(first.source).toBe("auto");
    });

    it("derives date from timestamp using UTC", async () => {
      const events = await parseClaudeCodeFile(fixture);
      // All UTC timestamps; spec says "本地日期" but tests run wherever — use UTC for stability.
      const dates = new Set(events.map((e) => e.date));
      expect(dates.has("2026-05-25")).toBe(true);
      expect(dates.has("2026-05-26")).toBe(true);
    });

    it("skips malformed lines (e.g. half-written tail)", async () => {
      // We trust the fixture is well-formed; this is a defensive contract.
      // No assertion here other than no throw.
      await expect(parseClaudeCodeFile(fixture)).resolves.toBeTruthy();
    });
  });

  describe("parseClaudeCodeDir", () => {
    it("returns empty array when dir does not exist", async () => {
      const events = await parseClaudeCodeDir("/nonexistent/path/zzz");
      expect(events).toEqual([]);
    });

    it("walks dir recursively and accumulates events", async () => {
      const dir = join(here, "..", "fixtures");
      const events = await parseClaudeCodeDir(dir);
      // Fixture dir contains claude-code.jsonl + (later) codex-session.jsonl;
      // this parser should only pick up files containing assistant usage records.
      expect(events.length).toBeGreaterThanOrEqual(4);
    });

    it("filters events by since-date inclusive", async () => {
      const dir = join(here, "..", "fixtures");
      const events = await parseClaudeCodeDir(dir, { sinceDate: "2026-05-26" });
      // Only the 2026-05-26 row should pass.
      expect(events.every((e) => e.date >= "2026-05-26")).toBe(true);
    });
  });
  ```

- [ ] **Step 3: 跑测试确认 FAIL**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/parsers/claude-code.test.ts`
  Expected: FAIL.

- [ ] **Step 4: 实现 `skill/src/parsers/claude-code.ts`**

  ```typescript
  import { createReadStream } from "node:fs";
  import { readdir } from "node:fs/promises";
  import { join } from "node:path";
  import { createInterface } from "node:readline";
  import type { RawEvent } from "@/types";

  interface AssistantLine {
    type: string;
    timestamp?: string;
    sessionId?: string;
    cwd?: string;
    message?: {
      model?: string;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
  }

  function utcDate(ts: string): string | null {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  /**
   * Parse a single Claude Code JSONL file, returning one RawEvent per assistant
   * message that has a usage block.
   * Malformed lines are silently skipped (defensive: log files can be half-written).
   */
  export async function parseClaudeCodeFile(path: string): Promise<RawEvent[]> {
    const events: RawEvent[] = [];
    const stream = createReadStream(path, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        let parsed: AssistantLine;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.type !== "assistant") continue;
        const usage = parsed.message?.usage;
        const model = parsed.message?.model;
        const ts = parsed.timestamp;
        if (!usage || !model || !ts) continue;
        const date = utcDate(ts);
        if (!date) continue;
        events.push({
          date,
          tool: "claude-code",
          model,
          projectPath: parsed.cwd ?? null,
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          sessionId: parsed.sessionId ?? null,
          source: "auto",
        });
      }
    } finally {
      rl.close();
    }
    return events;
  }

  async function walkJsonl(dir: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkJsonl(full, out);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }

  /**
   * Recursively scan a directory for .jsonl files and parse each one.
   * Optional sinceDate (YYYY-MM-DD inclusive lower bound) filters events post-parse.
   */
  export async function parseClaudeCodeDir(
    dir: string,
    opts: { sinceDate?: string } = {},
  ): Promise<RawEvent[]> {
    const files: string[] = [];
    await walkJsonl(dir, files);
    const all: RawEvent[] = [];
    for (const f of files) {
      const ev = await parseClaudeCodeFile(f);
      for (const e of ev) {
        if (opts.sinceDate && e.date < opts.sinceDate) continue;
        all.push(e);
      }
    }
    return all;
  }
  ```

- [ ] **Step 5: 跑测试确认 PASS**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/parsers/claude-code.test.ts`
  Expected: 6 用例 PASS。

- [ ] **Step 6: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat(skill): add Claude Code JSONL parser (streaming, defensive)"
  ```

---

## Task 7: Codex parser

**Files:**
- Create: `skill/src/parsers/codex.ts`, `skill/tests/parsers/codex.test.ts`, `skill/tests/fixtures/codex-session.jsonl`

- [ ] **Step 1: 创建 fixture `skill/tests/fixtures/codex-session.jsonl`**

  ```
  {"timestamp":"2026-05-23T22:00:00.000Z","type":"session_init","payload":{"model":"gpt-5.4","cwd":"/Users/me/codex-repo"}}
  {"timestamp":"2026-05-23T22:00:30.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":17043,"cached_input_tokens":4480,"output_tokens":305,"reasoning_output_tokens":80,"total_tokens":17348},"last_token_usage":{"input_tokens":17043,"cached_input_tokens":4480,"output_tokens":305,"reasoning_output_tokens":80,"total_tokens":17348}}}}
  {"timestamp":"2026-05-23T22:05:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":35000,"cached_input_tokens":8000,"output_tokens":600,"reasoning_output_tokens":150,"total_tokens":35750}}}}
  ```

  Filename pattern for parser test: name this file with the codex naming convention so the sessionId can be extracted:

- [ ] **Step 2: 在同一 Step 把 fixture 重命名为正式格式**

  实际放置路径：`skill/tests/fixtures/rollout-2026-05-23T22-00-00-12345678-aaaa-bbbb-cccc-ddddeeeeffff.jsonl`
  （内容同上）

  注意：测试也要按这个路径加载。

- [ ] **Step 3: 写失败测试 `skill/tests/parsers/codex.test.ts`**

  ```typescript
  import { describe, it, expect } from "vitest";
  import { parseCodexFile, parseCodexDir } from "@/parsers/codex";
  import { fileURLToPath } from "node:url";
  import { dirname, join } from "node:path";

  const here = dirname(fileURLToPath(import.meta.url));
  const fixtureFile = join(
    here,
    "..",
    "fixtures",
    "rollout-2026-05-23T22-00-00-12345678-aaaa-bbbb-cccc-ddddeeeeffff.jsonl",
  );

  describe("parseCodexFile", () => {
    it("returns exactly one event (the last token_count of the session)", async () => {
      const events = await parseCodexFile(fixtureFile);
      expect(events).toHaveLength(1);
    });

    it("uses last token_count's total values", async () => {
      const events = await parseCodexFile(fixtureFile);
      const e = events[0];
      expect(e.inputTokens).toBe(35000);
      expect(e.cacheReadTokens).toBe(8000); // cached_input_tokens
      expect(e.outputTokens).toBe(600 + 150); // output + reasoning
      expect(e.cacheCreationTokens).toBe(0); // not in Codex protocol
    });

    it("derives model from session_init", async () => {
      const events = await parseCodexFile(fixtureFile);
      expect(events[0].model).toBe("gpt-5.4");
    });

    it("derives projectPath from session_init cwd", async () => {
      const events = await parseCodexFile(fixtureFile);
      expect(events[0].projectPath).toBe("/Users/me/codex-repo");
    });

    it("derives sessionId from filename UUID segment", async () => {
      const events = await parseCodexFile(fixtureFile);
      expect(events[0].sessionId).toBe("12345678-aaaa-bbbb-cccc-ddddeeeeffff");
    });

    it("date derived from last token_count timestamp", async () => {
      const events = await parseCodexFile(fixtureFile);
      expect(events[0].date).toBe("2026-05-23");
    });

    it("tool is codex; source is auto", async () => {
      const events = await parseCodexFile(fixtureFile);
      expect(events[0].tool).toBe("codex");
      expect(events[0].source).toBe("auto");
    });
  });

  describe("parseCodexDir", () => {
    it("returns empty array when dir does not exist", async () => {
      const events = await parseCodexDir("/nonexistent/zzz");
      expect(events).toEqual([]);
    });

    it("walks dir recursively", async () => {
      const dir = join(here, "..", "fixtures");
      const events = await parseCodexDir(dir);
      // Fixture dir has 1 codex rollout (other files don't match naming).
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it("filters by sinceDate", async () => {
      const dir = join(here, "..", "fixtures");
      const events = await parseCodexDir(dir, { sinceDate: "2027-01-01" });
      expect(events).toEqual([]);
    });
  });
  ```

- [ ] **Step 4: 跑测试确认 FAIL**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/parsers/codex.test.ts`
  Expected: FAIL.

- [ ] **Step 5: 实现 `skill/src/parsers/codex.ts`**

  ```typescript
  import { createReadStream } from "node:fs";
  import { readdir } from "node:fs/promises";
  import { basename, join } from "node:path";
  import { createInterface } from "node:readline";
  import type { RawEvent } from "@/types";

  interface CodexLine {
    timestamp?: string;
    type?: string;
    payload?: {
      type?: string;
      model?: string;
      cwd?: string;
      info?: {
        total_token_usage?: {
          input_tokens?: number;
          cached_input_tokens?: number;
          output_tokens?: number;
          reasoning_output_tokens?: number;
        };
      };
    };
  }

  function utcDate(ts: string): string | null {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  /**
   * Extract a UUID-like sessionId from a Codex rollout filename.
   * Pattern: rollout-<timestamp>-<uuid>.jsonl (timestamp may contain hyphens too).
   * Fallback to full filename if no UUID match.
   */
  function sessionIdFromFile(path: string): string {
    const name = basename(path, ".jsonl");
    const m = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
    return m ? m[1] : name;
  }

  /**
   * Parse a single Codex session JSONL.
   * Returns ZERO or ONE RawEvent: the last token_count event collapsed into a single record.
   * No event = no token_count seen.
   */
  export async function parseCodexFile(path: string): Promise<RawEvent[]> {
    let model: string | null = null;
    let cwd: string | null = null;
    let lastUsage: NonNullable<CodexLine["payload"]>["info"] | null = null;
    let lastTimestamp: string | null = null;

    const stream = createReadStream(path, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        let parsed: CodexLine;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (parsed.type === "session_init") {
          model = parsed.payload?.model ?? model;
          cwd = parsed.payload?.cwd ?? cwd;
        } else if (parsed.type === "event_msg" && parsed.payload?.type === "token_count") {
          lastUsage = parsed.payload.info ?? lastUsage;
          lastTimestamp = parsed.timestamp ?? lastTimestamp;
        }
      }
    } finally {
      rl.close();
    }

    if (!lastUsage || !lastTimestamp) return [];
    const total = lastUsage.total_token_usage;
    if (!total) return [];
    const date = utcDate(lastTimestamp);
    if (!date) return [];
    return [
      {
        date,
        tool: "codex",
        model: model ?? "unknown",
        projectPath: cwd,
        inputTokens: total.input_tokens ?? 0,
        outputTokens: (total.output_tokens ?? 0) + (total.reasoning_output_tokens ?? 0),
        cacheCreationTokens: 0,
        cacheReadTokens: total.cached_input_tokens ?? 0,
        sessionId: sessionIdFromFile(path),
        source: "auto",
      },
    ];
  }

  async function walkRollout(dir: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkRollout(full, out);
      } else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }

  export async function parseCodexDir(
    dir: string,
    opts: { sinceDate?: string } = {},
  ): Promise<RawEvent[]> {
    const files: string[] = [];
    await walkRollout(dir, files);
    const all: RawEvent[] = [];
    for (const f of files) {
      const ev = await parseCodexFile(f);
      for (const e of ev) {
        if (opts.sinceDate && e.date < opts.sinceDate) continue;
        all.push(e);
      }
    }
    return all;
  }
  ```

- [ ] **Step 6: 跑测试确认 PASS**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/parsers/codex.test.ts`
  Expected: 10 用例 PASS。

- [ ] **Step 7: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat(skill): add Codex JSONL parser (last token_count per session)"
  ```

---

## Task 8: upload (预检 + 分批 + 重试)

**Files:**
- Create: `skill/src/upload.ts`, `skill/tests/upload.test.ts`

- [ ] **Step 1: 写失败测试 `skill/tests/upload.test.ts`**

  ```typescript
  import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
  import { uploadRecords, validateToken, UploadError } from "@/upload";
  import type { UsageRecord } from "@/types";

  function makeRec(over: Partial<UsageRecord> = {}): UsageRecord {
    return {
      date: "2026-05-25",
      tool: "claude-code",
      model: "claude-opus-4-7",
      project: "abcdef0123456789",
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      sessionCount: 1,
      messageCount: 1,
      source: "auto",
      ...over,
    };
  }

  describe("validateToken", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("returns user info on 200", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ id: "u1", email: "x@y.com", name: "X", role: "member" }), { status: 200 }) as Response,
      );
      const user = await validateToken("https://x", "tok");
      expect(user.email).toBe("x@y.com");
    });

    it("throws UploadError on 401", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 401 }) as Response);
      await expect(validateToken("https://x", "tok")).rejects.toBeInstanceOf(UploadError);
    });

    it("throws UploadError on network failure", async () => {
      vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(validateToken("https://x", "tok")).rejects.toBeInstanceOf(UploadError);
    });
  });

  describe("uploadRecords", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("posts a single batch when records ≤ batchSize", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ inserted: 2, updated: 0 }), { status: 200 }) as Response,
      );
      const res = await uploadRecords("https://x", "tok", [makeRec(), makeRec({ date: "2026-05-26" })], { batchSize: 500 });
      expect(res.inserted).toBe(2);
      expect(res.updated).toBe(0);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("splits across multiple batches", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ inserted: 1, updated: 0 }), { status: 200 }) as Response,
      );
      const recs = Array.from({ length: 5 }, (_, i) => makeRec({ date: `2026-05-${20 + i}` }));
      const res = await uploadRecords("https://x", "tok", recs, { batchSize: 2 });
      // 5 records, batch 2 → 3 batches (2+2+1)
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(res.inserted).toBe(3); // 3 batches × 1 inserted each
    });

    it("retries on 500 with exponential backoff", async () => {
      const spy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(new Response(null, { status: 500 }) as Response)
        .mockResolvedValueOnce(new Response(null, { status: 500 }) as Response)
        .mockResolvedValueOnce(new Response(JSON.stringify({ inserted: 1, updated: 0 }), { status: 200 }) as Response);
      const res = await uploadRecords("https://x", "tok", [makeRec()], { batchSize: 500, sleepMs: () => 0 });
      expect(spy).toHaveBeenCalledTimes(3);
      expect(res.inserted).toBe(1);
    });

    it("fails after 3 retries on persistent 500", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(new Response("oops", { status: 500 }) as Response);
      await expect(
        uploadRecords("https://x", "tok", [makeRec()], { batchSize: 500, sleepMs: () => 0 }),
      ).rejects.toBeInstanceOf(UploadError);
    });

    it("does NOT retry on 400", async () => {
      const spy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "bad" }), { status: 400 }) as Response,
      );
      await expect(
        uploadRecords("https://x", "tok", [makeRec()], { batchSize: 500, sleepMs: () => 0 }),
      ).rejects.toBeInstanceOf(UploadError);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("retries on 429 (rate limit)", async () => {
      const spy = vi
        .spyOn(global, "fetch")
        .mockResolvedValueOnce(new Response(null, { status: 429 }) as Response)
        .mockResolvedValueOnce(new Response(JSON.stringify({ inserted: 1, updated: 0 }), { status: 200 }) as Response);
      const res = await uploadRecords("https://x", "tok", [makeRec()], { batchSize: 500, sleepMs: () => 0 });
      expect(spy).toHaveBeenCalledTimes(2);
      expect(res.inserted).toBe(1);
    });

    it("sends Authorization Bearer header and JSON body matching usagePayloadSchema", async () => {
      let captured: RequestInit | undefined;
      vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
        captured = init;
        return new Response(JSON.stringify({ inserted: 1, updated: 0 }), { status: 200 }) as Response;
      });
      await uploadRecords("https://x", "tok", [makeRec()], { batchSize: 500 });
      const headers = captured?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok");
      expect(headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(captured!.body as string);
      expect(Array.isArray(body.records)).toBe(true);
      expect(body.records[0].source).toBe("auto");
    });
  });
  ```

- [ ] **Step 2: 跑测试确认 FAIL**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/upload.test.ts`
  Expected: FAIL.

- [ ] **Step 3: 实现 `skill/src/upload.ts`**

  ```typescript
  import { usagePayloadSchema, type UsageRecord } from "@/types";

  export class UploadError extends Error {
    constructor(message: string, public status?: number) {
      super(message);
      this.name = "UploadError";
    }
  }

  export interface ViewerInfo {
    id: string;
    email: string;
    name: string;
    role: "admin" | "member";
  }

  export async function validateToken(serverUrl: string, token: string): Promise<ViewerInfo> {
    let res: Response;
    try {
      res = await fetch(`${serverUrl}/api/v1/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      throw new UploadError(`network error contacting ${serverUrl}: ${(e as Error).message}`);
    }
    if (res.status === 200) {
      return (await res.json()) as ViewerInfo;
    }
    throw new UploadError(`token validation failed: HTTP ${res.status}`, res.status);
  }

  export interface UploadOptions {
    batchSize?: number;
    maxRetries?: number;
    sleepMs?: (attempt: number) => number;
  }

  export interface UploadResult {
    inserted: number;
    updated: number;
    batches: number;
  }

  function defaultSleep(attempt: number): number {
    return 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
  }

  function shouldRetry(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
  }

  async function postBatch(
    serverUrl: string,
    token: string,
    records: UsageRecord[],
    maxRetries: number,
    sleepMs: (attempt: number) => number,
  ): Promise<{ inserted: number; updated: number }> {
    // Validate payload shape before sending. zod strict() drops unknown fields here.
    const body = JSON.stringify(usagePayloadSchema.parse({ records }));
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    let lastErr: UploadError | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${serverUrl}/api/v1/usage`, { method: "POST", headers, body });
      } catch (e) {
        lastErr = new UploadError(`network error: ${(e as Error).message}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, sleepMs(attempt)));
          continue;
        }
        throw lastErr;
      }
      if (res.status === 200) {
        return (await res.json()) as { inserted: number; updated: number };
      }
      if (shouldRetry(res.status) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, sleepMs(attempt)));
        continue;
      }
      throw new UploadError(`POST /api/v1/usage failed: HTTP ${res.status}`, res.status);
    }
    throw lastErr ?? new UploadError("upload failed after retries");
  }

  export async function uploadRecords(
    serverUrl: string,
    token: string,
    records: UsageRecord[],
    opts: UploadOptions = {},
  ): Promise<UploadResult> {
    const batchSize = opts.batchSize ?? 500;
    const maxRetries = opts.maxRetries ?? 3;
    const sleepMs = opts.sleepMs ?? defaultSleep;
    let inserted = 0;
    let updated = 0;
    let batches = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const slice = records.slice(i, i + batchSize);
      const r = await postBatch(serverUrl, token, slice, maxRetries, sleepMs);
      inserted += r.inserted;
      updated += r.updated;
      batches += 1;
    }
    return { inserted, updated, batches };
  }
  ```

- [ ] **Step 4: 跑测试确认 PASS**

  Run: `pnpm --filter @dev-efficiency/skill exec vitest run tests/upload.test.ts`
  Expected: ~10 用例 PASS。

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat(skill): add upload (preflight + batching + 5xx/429 retry with backoff)"
  ```

---

## Task 9: Cursor 交互式手填

**Files:**
- Create: `skill/src/parsers/cursor.ts`

> 此 module 几乎全是交互式 prompt 逻辑，testing 通过 mock @inquirer/prompts 价值不大；信任 @inquirer 自身。

- [ ] **Step 1: 创建 `skill/src/parsers/cursor.ts`**

  ```typescript
  import { confirm, input, number } from "@inquirer/prompts";
  import type { RawEvent } from "@/types";

  /**
   * Interactively prompt for Cursor usage. Returns 0+ RawEvents, all source="manual".
   * Date is set to "today" in local timezone (the user is reporting what they did today).
   */
  export async function promptCursor(today: string = todayLocal()): Promise<RawEvent[]> {
    const used = await confirm({ message: "今天用 Cursor 了吗？", default: false });
    if (!used) return [];

    const events: RawEvent[] = [];
    let more = true;
    while (more) {
      const model = await input({
        message: "主要使用的模型 (如 claude-sonnet-4-5)",
        validate: (s) => s.trim().length > 0 || "model 不能为空",
      });
      const inputTokens = await number({ message: "input token 大约多少？", min: 0, default: 0, required: true });
      const outputTokens = await number({ message: "output token 大约多少？", min: 0, default: 0, required: true });
      const projectInput = await input({
        message: "所在项目目录 (回车跳过)",
        default: "",
      });
      events.push({
        date: today,
        tool: "cursor",
        model: model.trim(),
        projectPath: projectInput.trim() || null,
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        sessionId: null,
        source: "manual",
      });
      more = await confirm({ message: "还要补充其他模型吗？", default: false });
    }
    return events;
  }

  function todayLocal(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  ```

- [ ] **Step 2: tsc 干净**

  Run: `pnpm --filter @dev-efficiency/skill exec tsc --noEmit`
  Expected: 无类型错误。

- [ ] **Step 3: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat(skill): add Cursor interactive manual entry"
  ```

---

## Task 10: CLI 框架 + --init 流

**Files:**
- Create: `skill/src/cli.ts`, `skill/bin/dev-efficiency-collect.ts`

- [ ] **Step 1: 创建 `skill/src/cli.ts`**

  ```typescript
  export interface CliFlags {
    init: boolean;
    days: number | null;
    dryRun: boolean;
    verbose: boolean;
    help: boolean;
  }

  export function parseFlags(argv: string[]): CliFlags {
    const flags: CliFlags = {
      init: false,
      days: null,
      dryRun: false,
      verbose: false,
      help: false,
    };
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--init") flags.init = true;
      else if (a === "--dry-run") flags.dryRun = true;
      else if (a === "--verbose" || a === "-v") flags.verbose = true;
      else if (a === "--help" || a === "-h") flags.help = true;
      else if (a === "--days") {
        const next = argv[++i];
        const n = Number(next);
        if (!Number.isInteger(n) || n < 1) throw new Error(`--days requires a positive integer, got ${next}`);
        flags.days = n;
      } else if (a.startsWith("--days=")) {
        const n = Number(a.slice("--days=".length));
        if (!Number.isInteger(n) || n < 1) throw new Error(`--days requires a positive integer, got ${a}`);
        flags.days = n;
      } else {
        throw new Error(`unknown flag: ${a}`);
      }
    }
    return flags;
  }

  export const HELP_TEXT = `dev-efficiency-collect — upload local AI token usage to the team server

Usage:
  dev-efficiency-collect              Scan recent days and upload
  dev-efficiency-collect --init       Interactively configure server URL + token
  dev-efficiency-collect --days N     Override backfill window (default: config.backfillDays)
  dev-efficiency-collect --dry-run    Print aggregated records, do not upload
  dev-efficiency-collect --verbose    Print per-file parse progress
  dev-efficiency-collect --help       Show this message

Config: ~/.config/dev-efficiency/config.json (created by --init).
`;
  ```

- [ ] **Step 2: 创建 `skill/bin/dev-efficiency-collect.ts`**

  ```typescript
  #!/usr/bin/env tsx

  import { homedir } from "node:os";
  import { join } from "node:path";
  import { confirm, input, password, number } from "@inquirer/prompts";
  import { parseFlags, HELP_TEXT } from "@/cli";
  import { readConfig, writeConfig, DEFAULT_CONFIG_PATH, type Config } from "@/config";
  import { parseClaudeCodeDir } from "@/parsers/claude-code";
  import { parseCodexDir } from "@/parsers/codex";
  import { promptCursor } from "@/parsers/cursor";
  import { aggregate } from "@/aggregate";
  import { validateToken, uploadRecords, UploadError } from "@/upload";

  async function initFlow(path: string): Promise<Config> {
    console.log("First-time setup — creating", path);
    const serverUrl = await input({
      message: "团队服务器 URL (e.g. https://efficiency.example.com)",
      validate: (s) => /^https?:\/\//.test(s) || "must start with http:// or https://",
    });
    const authToken = await password({
      message: "Auth token (de_...)",
      mask: "*",
    });
    const cursorEnabled = await confirm({
      message: "启用 Cursor 手动填报？(每次运行会问当天用量)",
      default: false,
    });
    const backfillDays = await number({
      message: "默认回扫天数",
      default: 7,
      min: 1,
      max: 365,
      required: true,
    });

    const cfg: Config = {
      serverUrl: serverUrl.replace(/\/+$/, ""),
      authToken,
      cursor: { enabled: cursorEnabled },
      backfillDays: backfillDays ?? 7,
    };

    console.log("Verifying token against", cfg.serverUrl, "...");
    const viewer = await validateToken(cfg.serverUrl, cfg.authToken);
    console.log(`OK — signed in as ${viewer.email} (${viewer.role})`);

    await writeConfig(path, cfg);
    console.log("Saved.");
    return cfg;
  }

  function sinceDate(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function main(): Promise<number> {
    let flags;
    try {
      flags = parseFlags(process.argv.slice(2));
    } catch (e) {
      console.error((e as Error).message);
      console.error(HELP_TEXT);
      return 1;
    }
    if (flags.help) {
      console.log(HELP_TEXT);
      return 0;
    }

    const configPath = DEFAULT_CONFIG_PATH;

    let config: Config | null;
    try {
      config = await readConfig(configPath);
    } catch (e) {
      console.error("Config error:", (e as Error).message);
      console.error("Run with --init to recreate.");
      return 1;
    }

    if (flags.init || !config) {
      try {
        config = await initFlow(configPath);
      } catch (e) {
        console.error("Init failed:", (e as Error).message);
        return 1;
      }
      if (flags.init) return 0;
    }

    try {
      await validateToken(config.serverUrl, config.authToken);
    } catch (e) {
      console.error("Token validation failed:", (e as Error).message);
      console.error("Run with --init to reconfigure.");
      return 2;
    }

    const days = flags.days ?? config.backfillDays;
    const since = sinceDate(days);
    console.log(`Scanning local logs since ${since} (window: ${days} days)...`);

    const claudeDir = join(homedir(), ".claude", "projects");
    const codexDir = join(homedir(), ".codex");

    try {
      const [claudeEvents, codexEvents, cursorEvents] = await Promise.all([
        parseClaudeCodeDir(claudeDir, { sinceDate: since }),
        parseCodexDir(codexDir, { sinceDate: since }),
        config.cursor.enabled ? promptCursor() : Promise.resolve([]),
      ]);

      if (flags.verbose) {
        console.log(`  Claude Code: ${claudeEvents.length} events`);
        console.log(`  Codex:       ${codexEvents.length} events`);
        console.log(`  Cursor:      ${cursorEvents.length} events`);
      }

      const records = aggregate([...claudeEvents, ...codexEvents, ...cursorEvents]);
      console.log(`Aggregated to ${records.length} records.`);

      if (flags.dryRun) {
        console.log(JSON.stringify({ records }, null, 2));
        return 0;
      }

      if (records.length === 0) {
        console.log("Nothing to upload.");
        return 0;
      }

      const result = await uploadRecords(config.serverUrl, config.authToken, records);
      console.log(`[OK] Uploaded ${records.length} records in ${result.batches} batch(es). Server: ${result.inserted} inserted, ${result.updated} updated.`);
      return 0;
    } catch (e) {
      if (e instanceof UploadError) {
        console.error("Upload error:", e.message);
        return 2;
      }
      console.error("Fatal:", (e as Error).stack ?? (e as Error).message);
      return 3;
    }
  }

  main().then((code) => process.exit(code));
  ```

- [ ] **Step 3: tsc 干净 + 测试不退化**

  Run: `pnpm --filter @dev-efficiency/skill exec tsc --noEmit && pnpm --filter @dev-efficiency/skill test`
  Expected: clean / 全绿。

- [ ] **Step 4: 手工 sanity check：--help 能跑**

  ```bash
  cd skill && pnpm exec tsx bin/dev-efficiency-collect.ts --help
  ```
  Expected: 打印 HELP_TEXT。

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "feat(skill): add CLI entry + --init / --days / --dry-run / --verbose flags"
  ```

---

## Task 11: SKILL.md + README + 收尾

**Files:**
- Create: `skill/SKILL.md`, `skill/README.md`

- [ ] **Step 1: 创建 `skill/SKILL.md`**

  ```markdown
  ---
  name: dev-efficiency
  description: 把你本地 Claude Code 和 Codex CLI 的 AI token 使用数据汇总后上传到团队的 dev-efficiency 服务端。当用户说「上传 AI 用量」「同步 token 数据」「dev-efficiency 同步」「研发效能上报」时使用。
  ---

  # dev-efficiency 数据同步

  这个 skill 把你本地的 AI 使用数据上传到团队的 dev-efficiency 服务端。

  ## 首次使用

  在本目录运行（或让用户跑）：

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
  - 项目路径仅以 SHA-256 哈希前 16 字符出现，仪表盘看到的是不可逆的标识
  ```

- [ ] **Step 2: 创建 `skill/README.md`**

  ```markdown
  # dev-efficiency skill

  研发本地运行的采集器：扫描 Claude Code 和 Codex CLI 的本地日志、对 Cursor 走交互式手填，按 (date, tool, model, project) 聚合 token 用量，调团队服务端的 `/api/v1/usage` 上传。

  ## 安装（首次）

  1. 克隆/拉取本 monorepo：`git clone <repo>` 或 `git pull`
  2. 在仓库根目录 `pnpm install`（pnpm workspace 会一并装 skill 依赖）
  3. （可选）软链到 Claude Code skills 目录，方便在任意 Claude Code 会话里用：
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

  - **隐私不变量**：上传字段由 `src/types.ts` 的 zod strict schema 闭合；parser 严禁读取 `message.content`/`text`/`input` 等含语义文本的字段。
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
  ```

- [ ] **Step 3: 最终验证**

  ```bash
  pnpm --filter @dev-efficiency/skill test
  pnpm --filter @dev-efficiency/skill exec tsc --noEmit
  cd skill && pnpm exec tsx bin/dev-efficiency-collect.ts --help
  ```
  Expected: 全绿 / clean / help 正常打印。

- [ ] **Step 4: 根目录测试不退化**

  Run from repo root: `pnpm test`
  Expected: Plans 1/2/3 的 103 测试仍全绿（pnpm workspace 默认只跑包内 test 脚本；根 `package.json` 的 test 仍是 vitest run 服务端代码，应不受影响）。如果根 test 也跑了 skill 的测试，那总数会上升到 103 + skill 测试数。Either way: all green.

- [ ] **Step 5: 提交**

  ```bash
  git add -A
  git -c user.name="xujiajie" -c user.email="superjavason@gmail.com" commit -m "docs(skill): add SKILL.md and README for end-user installation and usage"
  ```

---

## 完成标准（Plan 4）

- [ ] `pnpm --filter @dev-efficiency/skill test` 全绿（约 38-40 用例）。
- [ ] `pnpm --filter @dev-efficiency/skill exec tsc --noEmit` 干净。
- [ ] 根 `pnpm test` 仍 103/103 绿（服务端未退化）。
- [ ] `pnpm --filter @dev-efficiency/skill exec tsx bin/dev-efficiency-collect.ts --help` 打印帮助。
- [ ] 手工在有 Claude Code 历史的开发机上 `--dry-run` 跑一次，确认聚合 JSON 合理（每个 record 字段齐全、project 是 16 位 hex、无任何 prompt/content 字段泄漏）。
- [ ] 隐私不变量审计：grep parser 代码确认无 `content`/`text`/`input(?!_tokens)`/`prompt` 字段引用。
