import { execSync } from "node:child_process";
import { config } from "dotenv";

export default function setup() {
  config({ path: ".env.test" });
  execSync("pnpm prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env },
  });
}
