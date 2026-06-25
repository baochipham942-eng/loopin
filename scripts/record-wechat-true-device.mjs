#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  await main();
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    error: err?.message || String(err),
    action: err?.action || "修复后重跑记录命令。",
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = path.resolve(repoRoot, args.targetEnvFile || ".env.local");

  if (args.help) {
    printHelp();
    return;
  }

  const verifiedAt = normalizeTime(args.verifiedAt, "WECHAT_TRUE_DEVICE_VERIFIED_AT");
  const reminderSentAt = normalizeTime(args.reminderSentAt, "WECHAT_TRUE_DEVICE_TEST_REMINDER_SENT_AT");
  const userId = requiredValue(args.userId, "WECHAT_TRUE_DEVICE_VERIFIED_USER_ID");
  const liveCheck = args.skipLiveCheck
    ? { status: "skipped", detail: "live production diagnostics were skipped by explicit operator override" }
    : await validateLiveReadiness(args, userId);

  const updates = {
    WECHAT_TRUE_DEVICE_VERIFIED_AT: verifiedAt,
    WECHAT_TRUE_DEVICE_VERIFIED_USER_ID: userId,
    WECHAT_TRUE_DEVICE_TEST_REMINDER_SENT_AT: reminderSentAt,
  };

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
    liveCheck,
    updated: Object.keys(updates),
  }, null, 2));
}

function parseArgs(argv) {
  const out = { targetEnvFile: ".env.local", dryRun: false, help: false, skipLiveCheck: false, baseUrl: "", eventId: "" };
  const filtered = argv.filter((item) => item !== "--");
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--skip-live-check" || arg === "--force") out.skipLiveCheck = true;
    else if (arg === "--base-url") out.baseUrl = filtered[index += 1] ?? "";
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length);
    else if (arg === "--event-id") out.eventId = filtered[index += 1] ?? "";
    else if (arg.startsWith("--event-id=")) out.eventId = arg.slice("--event-id=".length);
    else if (arg === "--target-env-file" || arg === "--env-file") out.targetEnvFile = filtered[index += 1] ?? "";
    else if (arg.startsWith("--target-env-file=")) out.targetEnvFile = arg.slice("--target-env-file=".length);
    else if (arg.startsWith("--env-file=")) out.targetEnvFile = arg.slice("--env-file=".length);
    else if (arg === "--verified-at") out.verifiedAt = filtered[index += 1] ?? "";
    else if (arg.startsWith("--verified-at=")) out.verifiedAt = arg.slice("--verified-at=".length);
    else if (arg === "--reminder-sent-at") out.reminderSentAt = filtered[index += 1] ?? "";
    else if (arg.startsWith("--reminder-sent-at=")) out.reminderSentAt = arg.slice("--reminder-sent-at=".length);
    else if (arg === "--user-id") out.userId = filtered[index += 1] ?? "";
    else if (arg.startsWith("--user-id=")) out.userId = arg.slice("--user-id=".length);
    else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

async function validateLiveReadiness(args, userId) {
  const env = mergedEnv();
  const baseUrl = normalizeBaseUrl(args.baseUrl || env.PUBLIC_BASE_URL || "https://loopin.llmxy.xyz");
  const adminToken = first(env, ["BACKOFFICE_ADMIN_TOKEN"]);
  if (!isFilled(adminToken)) {
    const err = new Error("缺少本地 BACKOFFICE_ADMIN_TOKEN，不能确认生产微信诊断状态。");
    err.action = "在 .env.local 填 BACKOFFICE_ADMIN_TOKEN，或仅在人工确认后加 --skip-live-check。";
    throw err;
  }

  const event = args.eventId ? { id: args.eventId, title: args.eventId } : await firstProductionEvent(baseUrl);
  if (!event?.id) {
    const err = new Error("生产暂无可用于微信真机诊断的活动。");
    err.action = "确认生产有 published 活动，或用 --event-id 指定活动后重跑。";
    throw err;
  }

  const diagnostics = await fetchDiagnostics(baseUrl, adminToken, event.id, userId);
  const readiness = evaluateReadiness(diagnostics, userId);
  if (!readiness.recordReady) {
    const err = new Error(`userId=${userId} 尚未满足真机记录条件：${readiness.missing.join("、")}`);
    err.action = `先跑 pnpm wechat:true-device:status -- --user-id ${shellArg(userId)} --markdown；完成真机报名和订阅授权后，跑 pnpm wechat:true-device:test-reminder -- --user-id ${shellArg(userId)} --dry-run --markdown 预检，去掉 --dry-run 发送测试提醒，再重跑记录命令。`;
    throw err;
  }

  return {
    status: "pass",
    baseUrl,
    event: { id: event.id, title: event.title || event.id },
    userId,
    openidBound: readiness.openidBound,
    registrationCount: readiness.registrationCount,
    subscriptionStatus: readiness.subscriptionStatus,
    reminderSent: readiness.reminderSent,
  };
}

async function firstProductionEvent(baseUrl) {
  const response = await fetch(`${baseUrl}/api/events`);
  const body = await safeJson(response);
  const event = Array.isArray(body?.events) ? body.events[0] : null;
  if (!response.ok || !event?.id) return null;
  return { id: event.id, title: event.title || event.id };
}

async function fetchDiagnostics(baseUrl, adminToken, eventId, userId) {
  const response = await fetch(`${baseUrl}/api/events/${encodeURIComponent(eventId)}/notification-diagnostics?userId=${encodeURIComponent(userId)}`, {
    headers: { "x-loopin-admin-token": adminToken },
  });
  const body = await safeJson(response);
  if (!response.ok) {
    const err = new Error(`生产微信诊断接口返回 HTTP ${response.status}`);
    err.action = "确认后台令牌、生产 API 和活动 ID 后重跑。";
    throw err;
  }
  return body;
}

function evaluateReadiness(body, userId) {
  const user = body?.user || null;
  const subscription = body?.subscription || null;
  const registrations = Array.isArray(user?.registrations) ? user.registrations : [];
  const openidBound = Boolean(user?.openidBound);
  const registrationCount = registrations.length;
  const subscriptionStatus = subscription?.status || "missing";
  const reminderSent = Boolean(subscription?.sentAt || body?.readiness?.alreadySent);
  const missing = [];

  if (user?.userId !== userId) missing.push("诊断 userId 不匹配");
  if (!openidBound) missing.push("openid 未绑定");
  if (registrationCount <= 0) missing.push("没有报名记录");
  if (subscriptionStatus !== "accepted") missing.push("没有 accepted 订阅授权");
  if (!reminderSent) missing.push("测试提醒未发送");

  return {
    userId: user?.userId || userId,
    openidBound,
    registrationCount,
    subscriptionStatus,
    reminderSent,
    recordReady: missing.length === 0,
    missing,
  };
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
    lines.push("# 微信体验版真机联调验证标记");
    for (const [key, value] of missing) {
      lines.push(`${key}=${quoteEnv(value)}`);
    }
  }
  return lines.join("\n").replace(/\n{3,}$/g, "\n\n");
}

function mergedEnv() {
  return mergeEnv(process.env, mergeEnv(readEnv(path.join(repoRoot, ".env.local")), readEnv(path.join(repoRoot, "apps/api/.env"))));
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
  return Boolean(value && String(value).trim() && String(value).trim() !== "__FILL_ME__");
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function safeJson(response) {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

function quoteEnv(value) {
  if (/^[A-Za-z0-9_:/+@.,=-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function shellArg(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_:@%+=,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function printHelp() {
  console.log(`Usage:
  pnpm wechat:true-device:record -- --user-id <userId> --verified-at now --reminder-sent-at now

Options:
  --user-id <id>             Studio 微信联调诊断里的 userId
  --event-id <id>            Default: first production event
  --base-url <url>           Default: PUBLIC_BASE_URL or https://loopin.llmxy.xyz
  --verified-at <time|now>   完成真机报名/票夹验证的时间
  --reminder-sent-at <time|now>
                             手机收到测试订阅提醒的时间
  --target-env-file <path>   default: .env.local
  --dry-run                  print result without writing
  --skip-live-check          explicit offline override; do not query production diagnostics
`);
}
