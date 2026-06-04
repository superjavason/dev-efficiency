import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
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
    writeFileSync(path, JSON.stringify({ serverUrl: "x" }));
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
