import { copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** globalSetup：用空 schema 的 dev.db 复制出 test.db，给集成测试一份独立库。 */
export default function setup() {
  const devDb = fileURLToPath(new URL("../prisma/dev.db", import.meta.url));
  const testDb = fileURLToPath(new URL("../prisma/test.db", import.meta.url));
  if (!existsSync(devDb)) {
    throw new Error(`dev.db 不存在，请先 pnpm --filter @loopin/api db:push。期望路径: ${devDb}`);
  }
  copyFileSync(devDb, testDb);
}
