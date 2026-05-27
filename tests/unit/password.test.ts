import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(hash).not.toBe("s3cret-pass");
    expect(await verifyPassword(hash, "s3cret-pass")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("returns false for a malformed stored hash", async () => {
    expect(await verifyPassword("not-a-valid-hash", "anything")).toBe(false);
  });
});
