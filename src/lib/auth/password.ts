import { hash, verify } from "@node-rs/argon2";

// OWASP Argon2id minimums: 19 MiB memory, t=2, p=1.
const hashOptions = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, hashOptions);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
