import { randomBytes, createHash } from "node:crypto";

export function generateToken(): string {
  return "de_" + randomBytes(32).toString("base64url");
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
