import { copyFileSync, cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployDir = join(repoRoot, ".fc", "api");
const postgresClientSnapshotDir = join(repoRoot, ".fc", "postgres-prisma-client");
const sqliteSchema = "prisma/schema.prisma";
const postgresSchema = "prisma/schema.postgres.prisma";

function run(command, args, env = {}) {
  execFileSync(command, args, { cwd: repoRoot, env: { ...process.env, ...env }, stdio: "inherit" });
}

function rm(path) {
  rmSync(path, { force: true, recursive: true });
}

function cleanDeployDir() {
  rm(deployDir);
}

function scrubLocalOnlyFiles() {
  rm(join(deployDir, ".env"));
  rm(join(deployDir, "test"));
  rm(join(deployDir, "vitest.config.ts"));

  const prismaDir = join(deployDir, "prisma");
  for (const file of readdirSync(prismaDir)) {
    if (file.endsWith(".db") || file.endsWith(".db-journal")) rm(join(prismaDir, file));
  }

  copyFileSync(join(repoRoot, "apps", "api", "prisma", "schema.postgres.prisma"), join(prismaDir, "schema.prisma"));
}

function writeDeployIgnore() {
  writeFileSync(
    join(deployDir, ".fcignore"),
    [
      ".env",
      "test/",
      "vitest.config.ts",
      "prisma/*.db",
      "prisma/*.db-journal",
      ".fcignore",
      "",
    ].join("\n")
  );
}

function buildApiBundle() {
  run("pnpm", [
    "--filter",
    "@loopin/api",
    "exec",
    "esbuild",
    "src/server.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    "--outfile=dist/server.js",
    "--external:@fastify/cors",
    "--external:@prisma/client",
    "--external:dotenv/config",
    "--external:fastify",
    "--external:undici",
  ]);
}

function findPrismaClientModuleRoot(baseDir) {
  const pnpmDir = join(baseDir, "node_modules", ".pnpm");
  const candidates = readdirSync(pnpmDir).filter((entry) => entry.startsWith("@prisma+client@"));
  for (const entry of candidates) {
    const moduleRoot = join(pnpmDir, entry, "node_modules");
    if (existsSync(join(moduleRoot, "@prisma", "client"))) return moduleRoot;
  }
  throw new Error(`Could not find @prisma/client virtual store under ${pnpmDir}`);
}

function getGeneratedPrismaClientDir(baseDir) {
  const moduleRoot = findPrismaClientModuleRoot(baseDir);
  return join(moduleRoot, ".prisma");
}

function snapshotGeneratedPostgresClient() {
  rm(postgresClientSnapshotDir);
  cpSync(getGeneratedPrismaClientDir(repoRoot), postgresClientSnapshotDir, { recursive: true });
}

function copyGeneratedPrismaClientFromSnapshot() {
  const target = getGeneratedPrismaClientDir(deployDir);

  rm(target);
  cpSync(postgresClientSnapshotDir, target, { recursive: true });
}

function assertGeneratedPostgresClient() {
  const deployRoot = findPrismaClientModuleRoot(deployDir);
  const generatedSchema = join(deployRoot, ".prisma", "client", "schema.prisma");
  if (!existsSync(generatedSchema)) {
    throw new Error("Prisma client was not copied into .fc/api. Run pnpm install, then retry deploy:build.");
  }
  const schema = readFileSync(generatedSchema, "utf8");
  if (!schema.includes('provider = "postgresql"')) {
    throw new Error("Deploy package Prisma client was not generated from the Postgres schema.");
  }
  if (!schema.includes("debian-openssl-1.1.x") || !schema.includes("debian-openssl-3.0.x")) {
    throw new Error("Deploy package Prisma client is missing Debian binary targets for FC.");
  }
}

cleanDeployDir();
rm(postgresClientSnapshotDir);

const postgresGenerateUrl = process.env.DATABASE_URL?.startsWith("postgres")
  ? process.env.DATABASE_URL
  : "postgresql://loopin:loopin@127.0.0.1:5432/loopin";

try {
  run("pnpm", ["--filter", "@loopin/api", "exec", "prisma", "generate", "--schema", postgresSchema], { DATABASE_URL: postgresGenerateUrl });
  snapshotGeneratedPostgresClient();
  buildApiBundle();
  run("pnpm", ["--filter", "@loopin/api", "deploy", "--prod", "--legacy", deployDir]);
  scrubLocalOnlyFiles();
  writeDeployIgnore();
} finally {
  run("pnpm", ["--filter", "@loopin/api", "exec", "prisma", "generate", "--schema", sqliteSchema]);
}

copyGeneratedPrismaClientFromSnapshot();
assertGeneratedPostgresClient();
rm(postgresClientSnapshotDir);
