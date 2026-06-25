#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const env = loadEnv();
const beforeLogs = snapshotSLogs();
let exitCode = 0;

try {
  validateFcEnv(env, args);
  printCheckSummary(env);

  if (args.check) {
    process.exit(0);
  }

  if (!args.configOnly) {
    runInherit("pnpm", ["deploy:build"], env);
  }

  const deployArgs = args.configOnly
    ? ["api", "deploy", "--function", "config", "-y", "--silent"]
    : args.codeOnly
      ? ["api", "deploy", "--function", "code", "-y", "--silent"]
      : ["deploy", "--silent"];
  runQuiet("s", deployArgs, env);
  console.log(args.configOnly ? "FC config deploy: ok" : args.codeOnly ? "FC code deploy: ok" : "FC deploy: ok");
} catch (err) {
  exitCode = 1;
  console.error(redact((err && err.message) || err || "FC deploy failed"));
} finally {
  cleanupSLogs(beforeLogs, args.keepLogs);
  if (exitCode) process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { check: false, configOnly: false, codeOnly: false, keepLogs: false };
  for (const arg of argv) {
    if (arg === "--check" || arg === "--dry-run") out.check = true;
    else if (arg === "--config-only") out.configOnly = true;
    else if (arg === "--code-only") out.codeOnly = true;
    else if (arg === "--keep-logs") out.keepLogs = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (out.configOnly && out.codeOnly) throw new Error("--config-only and --code-only cannot be used together.");
  return out;
}

function loadEnv() {
  return mergeEnv(
    readEnv(path.join(repoRoot, "apps/api/.env")),
    readEnv(path.join(repoRoot, ".env.local")),
    process.env
  );
}

function readEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function mergeEnv(...sources) {
  const out = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const next = String(value ?? "");
      const current = out[key];
      if (usable(next) || !usable(current)) out[key] = next;
    }
  }
  return out;
}

function validateFcEnv(source, options) {
  const required = options.codeOnly
    ? []
    : [
        "BACKOFFICE_ADMIN_TOKEN",
        "FC_DATABASE_URL",
        "WX_APPSECRET",
        "WX_SUBSCRIBE_EVENT_TEMPLATE_ID",
        "WX_EVENT_REMINDER_LEAD_MINUTES",
        "WX_SUBSCRIBE_MINIPROGRAM_STATE",
        "LLM_BASE_URL",
        "LLM_API_KEY",
        "LLM_MODEL",
      ];
  if (!options.configOnly && !options.codeOnly) required.push("ALIYUN_FC_CERT_ID");
  const missing = required.filter((key) => !usable(source[key]));
  if (missing.length) {
    throw new Error(`FC deploy env missing: ${missing.join(", ")}`);
  }

  if (options.codeOnly) return;

  const db = source.FC_DATABASE_URL.trim();
  if (!/^postgres(?:ql)?:\/\//.test(db)) {
    throw new Error("FC_DATABASE_URL must be a PostgreSQL connection string.");
  }
  let parsed;
  try {
    parsed = new URL(db);
  } catch {
    throw new Error("FC_DATABASE_URL is not a valid URL.");
  }
  if (["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("FC_DATABASE_URL points to localhost; refusing to deploy FC config.");
  }
  if (String(source.DATABASE_URL || "").startsWith("file:")) {
    console.log("Local DATABASE_URL is SQLite; FC will use FC_DATABASE_URL.");
  }
}

function usable(value) {
  const text = String(value || "").trim();
  return Boolean(
    text
      && !text.startsWith("__FILL_ME")
      && !text.includes("__FILL_ME")
      && text !== "xxx"
      && text !== "undefined"
  );
}

function printCheckSummary(source) {
  const dbKind = /^postgres(?:ql)?:\/\//.test(String(source.FC_DATABASE_URL || "")) ? "postgres" : "invalid";
  const topicFeed = usable(source.TOPIC_SIGNAL_FEED_URLS) ? "present" : "empty";
  const mode = args.codeOnly ? "code" : args.configOnly ? "config" : "full";
  console.log(`FC env check: ok (mode=${mode}, FC_DATABASE_URL=${dbKind}, TOPIC_SIGNAL_FEED_URLS=${topicFeed})`);
}

function runInherit(command, argv, source) {
  execFileSync(command, argv, {
    cwd: repoRoot,
    env: source,
    stdio: "inherit",
  });
}

function runQuiet(command, argv, source) {
  try {
    execFileSync(command, argv, {
      cwd: repoRoot,
      env: source,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 20,
      stdio: "pipe",
    });
  } catch (err) {
    const output = `${err.stdout || ""}${err.stderr || ""}`;
    if (output.trim()) console.error(redact(output));
    throw err;
  }
}

function redact(value) {
  const text = String(value || "");
  return text
    .replace(/(postgres(?:ql)?:\/\/)[^\s"'`]+/g, "$1[redacted]")
    .replace(
      /\b(DATABASE_URL|FC_DATABASE_URL|LLM_API_KEY|WX_APPSECRET|BACKOFFICE_ADMIN_TOKEN|ALIYUN_FC_CERT_ID|TOPIC_SIGNAL_FEED_URLS)(\s*[:=]\s*)([^\s]+)/g,
      "$1$2[redacted]"
    );
}

function snapshotSLogs() {
  const logs = path.join(process.env.HOME || "", ".s", "logs");
  if (!logs || !existsSync(logs)) return { logs, dirs: new Set() };
  return {
    logs,
    dirs: new Set(readdirSync(logs).map((name) => path.join(logs, name))),
  };
}

function cleanupSLogs(before, keepLogs) {
  if (keepLogs || process.env.LOOPIN_FC_KEEP_S_LOGS === "1") return;
  if (!before.logs || !existsSync(before.logs)) return;
  for (const name of readdirSync(before.logs)) {
    const dir = path.join(before.logs, name);
    if (!before.dirs.has(dir)) rmSync(dir, { force: true, recursive: true });
  }
}

function printHelp() {
  console.log(`Usage:
  pnpm deploy:fc
  pnpm deploy:fc:config
  pnpm deploy:fc:code
  pnpm deploy:fc:check
  pnpm deploy:fc:full-check

Options:
  --check        validate FC deployment env only
  --config-only  deploy function configuration only
  --code-only    deploy function code only
  --keep-logs    keep Serverless Devs logs under ~/.s/logs
`);
}
