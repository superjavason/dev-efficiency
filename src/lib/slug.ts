import type { PrismaClient } from "@prisma/client";

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export function slugify(input: string): string | null {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return s.length === 0 ? null : s;
}

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

/**
 * Find a free slug derived from `base`. If `base` is unused, return it as-is.
 * Otherwise try `${base}-2`, `${base}-3`, ... up to 1000 attempts.
 */
export async function ensureUniqueSlug(prisma: PrismaClient, base: string): Promise<string> {
  if (!isValidSlug(base)) {
    throw new Error(`invalid slug base: ${base}`);
  }
  const existing = await prisma.team.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  const taken = new Set(existing.map((t) => t.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (candidate.length > 60) {
      throw new Error("slug too long after disambiguation");
    }
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("could not generate unique slug after 1000 attempts");
}
