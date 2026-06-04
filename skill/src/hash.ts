import { createHash } from "node:crypto";

export function projectHash(path: string | null | undefined): string {
  if (!path) return "";
  return createHash("sha256").update(path).digest("hex").slice(0, 16);
}
