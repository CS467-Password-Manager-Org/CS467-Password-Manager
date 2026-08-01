import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    globalSetup: ["./src/__tests__/setup/global-setup.ts"],
    setupFiles: ["./src/__tests__/setup/test-env.ts"],
    // One shared Postgres container with TRUNCATE between tests (D-02) means
    // test files must not run concurrently or they truncate each other's rows.
    fileParallelism: false,
    // Container startup and the first image pull are far slower than the
    // 5s/10s defaults.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
