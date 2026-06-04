import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/setup/global.ts"], // 跑一次 migrate deploy
    setupFiles: ["./tests/setup/env.ts"],      // 每个 worker 都加载 .env.test
    fileParallelism: false,
    env: { NODE_ENV: "test" },
    exclude: ["**/node_modules/**", "**/dist/**", "skill/**"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
