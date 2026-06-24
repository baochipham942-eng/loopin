#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECRET_DEFS = [
  {
    id: "wx-appsecret",
    aliases: ["wx-appsecret", "appsecret", "wx_appsecret", "wechat-appsecret"],
    envKey: "WX_APPSECRET_ROTATED_AT",
  },
  {
    id: "wechat-upload-key",
    aliases: ["wechat-upload-key", "upload-key", "private-key", "wechat-private-key", "miniprogram-key"],
    envKey: "WECHAT_PRIVATE_KEY_ROTATED_AT",
  },
  {
    id: "llm-api-key",
    aliases: ["llm-api-key", "llm", "mimo", "mimo-api-key"],
    envKey: "LLM_API_KEY_ROTATED_AT",
  },
  {
    id: "backoffice-admin-token",
    aliases: ["backoffice-admin-token", "backoffice", "admin-token"],
    envKey: "BACKOFFICE_ADMIN_TOKEN_ROTATED_AT",
  },
];

try {
  main();
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    error: err?.message || String(err),
    action: "确认 --secret/--all 和 --rotated-at 参数后重跑；时间可用 now 或 ISO-like 日期。",
  }, null, 2));
  process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const envFile = path.resolve(repoRoot, args.targetEnvFile || ".env.local");
  const rotatedAt = normalizeTime(args.rotatedAt, "rotated-at");
  const selected = selectedSecrets(args);
  const updates = Object.fromEntries(selected.map((secret) => [secret.envKey, rotatedAt]));

  const previous = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const next = updateEnv(previous, updates);

  if (!args.dryRun) {
    mkdirSync(path.dirname(envFile), { recursive: true });
    writeFileSync(envFile, next.endsWith("\n") ? next : `${next}\n`);
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: args.dryRun,
    envFile,
    rotatedAt,
    updated: Object.keys(updates),
  }, null, 2));
}

function parseArgs(argv) {
  const out = {
    targetEnvFile: ".env.local",
    dryRun: false,
    help: false,
    all: false,
    secrets: [],
  };
  const filtered = argv.filter((item) => item !== "--");
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--all") out.all = true;
    else if (arg === "--target-env-file" || arg === "--env-file") out.targetEnvFile = filtered[index += 1] ?? "";
    else if (arg.startsWith("--target-env-file=")) out.targetEnvFile = arg.slice("--target-env-file=".length);
    else if (arg.startsWith("--env-file=")) out.targetEnvFile = arg.slice("--env-file=".length);
    else if (arg === "--rotated-at") out.rotatedAt = filtered[index += 1] ?? "";
    else if (arg.startsWith("--rotated-at=")) out.rotatedAt = arg.slice("--rotated-at=".length);
    else if (arg === "--secret" || arg === "--secrets") {
      out.secrets.push(...splitSecrets(filtered[index += 1] ?? ""));
    } else if (arg.startsWith("--secret=")) {
      out.secrets.push(...splitSecrets(arg.slice("--secret=".length)));
    } else if (arg.startsWith("--secrets=")) {
      out.secrets.push(...splitSecrets(arg.slice("--secrets=".length)));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function selectedSecrets(options) {
  if (options.all) return SECRET_DEFS;
  if (!options.secrets.length) {
    throw new Error("At least one --secret is required, or use --all");
  }
  const selected = [];
  const seen = new Set();
  for (const raw of options.secrets) {
    const normalized = raw.trim().toLowerCase();
    const found = SECRET_DEFS.find((secret) => secret.aliases.includes(normalized));
    if (!found) {
      throw new Error(`Unknown secret "${raw}". Valid values: ${SECRET_DEFS.map((secret) => secret.id).join(", ")}`);
    }
    if (!seen.has(found.id)) {
      selected.push(found);
      seen.add(found.id);
    }
  }
  return selected;
}

function splitSecrets(value) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeTime(value, label) {
  const trimmed = requiredValue(value, label);
  if (trimmed === "now") return formatShanghaiTime(new Date());
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    throw new Error(`${label} must be an ISO-like datetime or "now"`);
  }
  return trimmed;
}

function requiredValue(value, label) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || trimmed === "__FILL_ME__") {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function formatShanghaiTime(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

function updateEnv(text, updates) {
  const seen = new Set();
  const lines = text.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !(match[1] in updates)) return line;
    seen.add(match[1]);
    return `${match[1]}=${quoteEnv(updates[match[1]])}`;
  });

  const missing = Object.entries(updates).filter(([key]) => !seen.has(key));
  if (missing.length) {
    if (lines.length && lines.at(-1) !== "") lines.push("");
    lines.push("# 敏感密钥轮换验证标记");
    for (const [key, value] of missing) {
      lines.push(`${key}=${quoteEnv(value)}`);
    }
  }
  return lines.join("\n").replace(/\n{3,}$/g, "\n\n");
}

function quoteEnv(value) {
  if (/^[A-Za-z0-9_:/+@.,=-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function printHelp() {
  console.log(`Usage:
  pnpm secrets:rotation-record -- --all --rotated-at now
  pnpm secrets:rotation-record -- --secret wx-appsecret --secret llm-api-key --rotated-at 2026-06-08

Options:
  --all                    record all rotation markers
  --secret <id>            wx-appsecret | wechat-upload-key | llm-api-key | backoffice-admin-token
  --secrets <ids>          comma-separated secret ids
  --rotated-at <time|now>  rotation completion time
  --target-env-file <path> default: .env.local
  --dry-run                print result without writing
`);
}
