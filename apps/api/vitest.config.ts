import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/setup.ts"],
    // 集成测试串行，避免共享 SQLite 写锁冲突
    fileParallelism: false,
  },
});
