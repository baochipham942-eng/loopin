#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(repoRoot, ".env.local");
const apiEnvPath = path.join(repoRoot, "apps/api/.env");
const args = parseArgs(process.argv.slice(2));
const rootEnv = readEnv(envPath);
const apiEnv = readEnv(apiEnvPath);
const env = mergeEnv(rootEnv, apiEnv);

const uploadKeyPath = first(env, ["WECHAT_PRIVATE_KEY_PATH", "WX_UPLOAD_PRIVATE_KEY_PATH"]);
const checks = [
  {
    key: "WX_APPSECRET",
    label: "微信 AppSecret",
    present: isFilled(first(env, ["WX_APPSECRET", "WECHAT_APPSECRET"])),
    rotatedAt: first(env, ["WX_APPSECRET_ROTATED_AT"]),
    action: "在微信公众平台重置小程序密钥，更新 .env.local 和 FC 环境变量 WX_APPSECRET，再验证 /api/notifications/config。",
  },
  {
    key: "WECHAT_PRIVATE_KEY_PATH",
    label: "微信上传私钥",
    present: isFilled(uploadKeyPath),
    rotatedAt: first(env, ["WECHAT_PRIVATE_KEY_ROTATED_AT", "WX_UPLOAD_PRIVATE_KEY_ROTATED_AT"]),
    action: "在微信公众平台重新生成代码上传密钥，更新 WECHAT_PRIVATE_KEY_PATH 或 WX_UPLOAD_PRIVATE_KEY_PATH，删除旧 key 文件，再跑 pnpm mini:check。",
    file: uploadKeyPath,
  },
  {
    key: "LLM_API_KEY",
    label: "MiMo / LLM API Key",
    present: isFilled(first(env, ["LLM_API_KEY"])),
    rotatedAt: first(env, ["LLM_API_KEY_ROTATED_AT"]),
    action: "在模型供应商后台重置 API Key，更新 .env.local、apps/api/.env 和 FC 环境变量 LLM_API_KEY，再跑 AI 物料 smoke。",
  },
  {
    key: "BACKOFFICE_ADMIN_TOKEN",
    label: "后台管理员令牌",
    present: isFilled(first(env, ["BACKOFFICE_ADMIN_TOKEN"])),
    rotatedAt: first(env, ["BACKOFFICE_ADMIN_TOKEN_ROTATED_AT"]),
    action: "生成新后台令牌，更新 .env.local 和 FC 环境变量 BACKOFFICE_ADMIN_TOKEN，Studio 本地保存的旧令牌也要替换。",
  },
];

const rows = checks.map((check) => {
  const fileStatus = check.file ? inspectFile(check.file) : null;
  const rotatedAt = check.rotatedAt;
  const rotatedAtPresent = isFilled(rotatedAt);
  const rotatedAtValid = !rotatedAtPresent || isValidTime(rotatedAt);
  return {
    key: check.key,
    label: check.label,
    present: check.present,
    rotated: rotatedAtPresent && rotatedAtValid,
    rotatedAt: rotatedAtPresent ? rotatedAt : null,
    rotatedAtValid,
    fileExists: fileStatus?.exists,
    fileMode: fileStatus?.mode,
    fileModeSafe: fileStatus?.safe,
    action: check.action,
  };
});

const result = {
  ok: true,
  envFiles: {
    root: existsSync(envPath),
    api: existsSync(apiEnvPath),
  },
  rotationRequired: rows.some((row) => !row.rotated),
  strict: args.strict,
  exitCode: args.strict && rows.some((row) => !row.present || !row.rotated || row.rotatedAtValid === false || row.fileExists === false || row.fileModeSafe === false) ? 1 : 0,
  rows,
};

const output = args.markdown ? formatMarkdown(result) : JSON.stringify(result, null, 2);
if (args.output) writeOutput(args.output, output);
console.log(output);
if (result.exitCode) process.exitCode = result.exitCode;

function parseArgs(argv) {
  const out = { markdown: false, strict: false, output: "" };
  const filtered = argv.filter((item) => item !== "--");
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index];
    if (arg === "--markdown" || arg === "--md" || arg === "--format=markdown") out.markdown = true;
    else if (arg === "--strict" || arg === "--fail-on-remaining") out.strict = true;
    else if (arg === "--output" || arg === "--out") out.output = filtered[index += 1] ?? "";
    else if (arg.startsWith("--output=")) out.output = arg.slice("--output=".length);
    else if (arg.startsWith("--out=")) out.output = arg.slice("--out=".length);
  }
  return out;
}

function formatMarkdown(report) {
  const lines = [
    "# Loopin Secret Rotation Check",
    "",
    `- root .env.local: ${report.envFiles.root ? "present" : "missing"}`,
    `- apps/api/.env: ${report.envFiles.api ? "present" : "missing"}`,
    `- rotation required: ${report.rotationRequired ? "yes" : "no"}`,
    `- strict: ${report.strict ? "yes" : "no"}, exit code: ${report.exitCode}`,
    "",
    "| Secret | Present | Rotated | File | Next action |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const row of report.rows) {
    lines.push([
      row.label,
      row.present ? "yes" : "no",
      rotatedSummary(row),
      fileSummary(row),
      row.action,
    ].map(markdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  const remaining = report.rows.filter((row) => !row.present || !row.rotated || row.fileExists === false || row.fileModeSafe === false);
  if (remaining.length) {
    lines.push("", "## Remaining");
    for (const row of remaining) {
      const reason = row.rotatedAtValid === false ? "轮换时间不是合法日期；" : "";
      lines.push(`- ${row.label}: ${reason}${row.action}`);
    }
    lines.push(
      "",
      "## Record Commands",
      "",
      "```bash",
      "pnpm secrets:rotation-check -- --strict --markdown --output .artifacts/secret-rotation.md",
      "pnpm secrets:rotation-record -- --all --rotated-at now",
      "pnpm production:readiness -- --markdown --output .artifacts/production-readiness.md",
      "```",
    );
  }
  lines.push("");
  lines.push("No secret values are printed by this check.");
  return lines.join("\n");
}

function writeOutput(file, content) {
  const target = path.resolve(repoRoot, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${content}\n`);
}

function fileSummary(row) {
  if (row.fileExists === undefined) return "";
  if (!row.fileExists) return "missing";
  return row.fileModeSafe ? `${row.fileMode} ok` : `${row.fileMode} unsafe`;
}

function rotatedSummary(row) {
  if (!row.rotatedAt) return "no";
  if (!row.rotatedAtValid) return `invalid (${row.rotatedAt})`;
  return `yes (${row.rotatedAt})`;
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function readEnv(file) {
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}

function mergeEnv(primary, fallback) {
  const out = { ...fallback, ...primary };
  for (const key of new Set([...Object.keys(primary), ...Object.keys(fallback)])) {
    if (!isFilled(out[key]) && isFilled(fallback[key])) out[key] = fallback[key];
  }
  return out;
}

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
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

function first(source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return "";
}

function isFilled(value) {
  return Boolean(value && value.trim() && value.trim() !== "__FILL_ME__");
}

function isValidTime(value) {
  return !Number.isNaN(Date.parse(String(value || "").trim()));
}

function inspectFile(file) {
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) return { exists: false, mode: null, safe: false };
  const numericMode = statSync(resolved).mode & 0o777;
  const mode = numericMode.toString(8).padStart(3, "0");
  return { exists: true, mode, safe: (numericMode & 0o077) === 0 };
}
