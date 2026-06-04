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
