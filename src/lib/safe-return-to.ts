/**
 * Normalize a user-supplied `returnTo` value. Allows ONLY relative paths
 * that start with `/` and NOT with `//` (which would be protocol-relative).
 * Falls back to `/dashboard` for anything else.
 */
export function safeReturnTo(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  return value;
}
