#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const appMigrationDir = path.join(repoRoot, "apps/api/prisma/migrations");
const supabaseMigrationDir = path.join(repoRoot, "supabase/migrations");

const appMigrations = readAppMigrationSummaries();
const supabaseSql = readSupabaseSql();
const checks = appMigrations.flatMap((migration) => migration.requirements.map((requirement) => {
  const present = requirement.type === "column"
    ? hasTable(supabaseSql, requirement.table) && supabaseSql.includes(`"${requirement.column}"`)
    : hasTable(supabaseSql, requirement.table);
  return { ...requirement, migration: migration.name, status: present ? "pass" : "fail" };
}));
const failed = checks.filter((check) => check.status === "fail");
const result = {
  ok: failed.length === 0,
  checkedAt: new Date().toISOString(),
  appMigrations: appMigrations.length,
  checks,
  failed,
};

const output = args.markdown ? formatMarkdown(result) : args.json ? JSON.stringify(result, null, 2) : formatText(result);
if (args.output) writeOutput(args.output, output);
console.log(output);
if (!result.ok || (args.strict && failed.length)) process.exitCode = 1;

function readAppMigrationSummaries() {
  if (!existsSync(appMigrationDir)) return [];
  return readdirSync(appMigrationDir)
    .filter((name) => name !== "20260606000000_init_postgres")
    .sort()
    .map((name) => {
      const sqlPath = path.join(appMigrationDir, name, "migration.sql");
      const sql = existsSync(sqlPath) ? readFileSync(sqlPath, "utf8") : "";
      return { name, requirements: extractRequirements(sql) };
    })
    .filter((migration) => migration.requirements.length > 0);
}

function readSupabaseSql() {
  if (!existsSync(supabaseMigrationDir)) return "";
  return readdirSync(supabaseMigrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(supabaseMigrationDir, name), "utf8"))
    .join("\n");
}

function extractRequirements(sql) {
  const requirements = [];
  const tables = new Set();
  for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+"([^"]+)"/g)) {
    tables.add(match[1]);
  }
  for (const match of sql.matchAll(/ALTER TABLE\s+"([^"]+)"/g)) {
    tables.add(match[1]);
  }
  for (const table of tables) {
    requirements.push({ type: "table", table });
  }
  for (const match of sql.matchAll(/ALTER TABLE\s+"([^"]+)"\s+ADD COLUMN(?: IF NOT EXISTS)?\s+"([^"]+)"/g)) {
    requirements.push({ type: "column", table: match[1], column: match[2] });
  }
  return requirements;
}

function hasTable(sql, table) {
  return sql.includes(`"${table}"`);
}

function formatText(result) {
  const lines = [
    `Supabase migration parity: ${result.ok ? "ok" : "failed"}`,
    `app migrations checked: ${result.appMigrations}`,
  ];
  for (const check of result.checks) {
    const target = check.type === "column" ? `${check.table}.${check.column}` : check.table;
    lines.push(`[${check.status}] ${check.migration} ${target}`);
  }
  return lines.join("\n");
}

function formatMarkdown(result) {
  const lines = [
    "# Supabase Migration Parity",
    "",
    `- Checked at: \`${result.checkedAt}\``,
    `- OK: \`${result.ok}\``,
    `- App migrations checked: \`${result.appMigrations}\``,
    "",
    "| Status | App migration | Requirement |",
    "|---|---|---|",
  ];
  for (const check of result.checks) {
    const target = check.type === "column" ? `${check.table}.${check.column}` : check.table;
    lines.push(`| ${check.status} | \`${check.migration}\` | \`${target}\` |`);
  }
  if (result.failed.length) {
    lines.push("", "## Missing");
    for (const check of result.failed) {
      const target = check.type === "column" ? `${check.table}.${check.column}` : check.table;
      lines.push(`- \`${check.migration}\` requires \`${target}\``);
    }
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const out = { json: false, markdown: false, strict: false, output: "" };
  const filtered = argv.filter((item) => item !== "--");
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index];
    if (arg === "--json" || arg === "--format=json") out.json = true;
    else if (arg === "--markdown" || arg === "--md" || arg === "--format=markdown") out.markdown = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--output" || arg === "--out") out.output = filtered[index += 1] ?? "";
    else if (arg.startsWith("--output=")) out.output = arg.slice("--output=".length);
    else if (arg.startsWith("--out=")) out.output = arg.slice("--out=".length);
  }
  return out;
}

function writeOutput(file, content) {
  const target = path.resolve(repoRoot, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${content}\n`);
}
