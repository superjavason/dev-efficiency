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

export async function writeConfig(path: string, config: Config): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}
