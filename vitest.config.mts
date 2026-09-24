import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/api/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // tests/api/** share one local SQLite file DB; parallel file workers hit lock-contention
    // timeouts on it, so all test files run sequentially in a single process/thread.
    fileParallelism: false,
  },
});
