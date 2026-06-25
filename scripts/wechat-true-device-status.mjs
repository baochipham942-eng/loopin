#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const env = mergedEnv();
const baseUrl = normalizeBaseUrl(args.baseUrl || env.PUBLIC_BASE_URL || "https://loopin.llmxy.xyz");
const adminToken = first(env, ["BACKOFFICE_ADMIN_TOKEN"]);

if (args.help) {
  printHelp();
  process.exit(0);
}

const result = await checkTrueDeviceStatus();
const output = args.markdown ? formatMarkdown(result) : JSON.stringify(result, null, 2);
if (args.output) writeOutput(args.output, output);
console.log(output);
if (args.strict && !result.recordReady) process.exitCode = 1;

async function checkTrueDeviceStatus() {
  if (!isFilled(adminToken)) {
    return {
      ok: false,
      baseUrl,
      checkedAt: new Date().toISOString(),
      event: null,
      status: "warn",
      recordReady: false,
      detail: "缺少本地 BACKOFFICE_ADMIN_TOKEN，无法读取生产微信诊断。",
      action: "在 .env.local 填 BACKOFFICE_ADMIN_TOKEN 后重跑。",
      diagnostics: null,
      candidate: null,
    };
  }

  const event = args.eventId ? { id: args.eventId, title: args.eventId } : await firstProductionEvent();
  if (!event?.id) {
    return {
      ok: false,
      baseUrl,
      checkedAt: new Date().toISOString(),
      event: null,
      status: "warn",
      recordReady: false,
      detail: "生产暂无可用于微信真机诊断的活动。",
      action: "先确认生产有 published 活动，再重跑。",
      diagnostics: null,
      candidate: null,
    };
  }

  const diagnostics = await fetchDiagnostics(event.id, args.userId);
  const candidate = pickCandidate(diagnostics);
  const recordReady = Boolean(candidate?.recordReady);
  return {
    ok: true,
    baseUrl,
    checkedAt: new Date().toISOString(),
    event,
    status: recordReady ? "pass" : "manual",
    recordReady,
    detail: recordReady
      ? `userId=${candidate.userId}, subscriptionSentAt=${candidate.sentAt || "sent"}`
      : "还没有同时满足 openid 绑定、报名记录、订阅授权和测试提醒已发送的 userId。",
    action: recordReady
      ? "手机确认收到测试提醒后，执行 suggestedRecordCommand 写入 readiness 标记。"
      : "用体验版完成报名和订阅授权；拿到 userId 后先跑 pnpm wechat:true-device:test-reminder -- --user-id <id> --dry-run，确认可发送后去掉 --dry-run 发送测试提醒。",
    diagnostics: summarizeDiagnostics(diagnostics),
    candidate,
    suggestedRecordCommand: candidate?.recordReady
      ? `pnpm wechat:true-device:record -- --user-id ${shellArg(candidate.userId)} --verified-at now --reminder-sent-at now`
      : "",
    suggestedTestReminderCommand: candidate && !candidate.recordReady && candidate.openidBound && candidate.registrationCount > 0 && candidate.subscriptionStatus === "accepted"
      ? `pnpm wechat:true-device:test-reminder -- --user-id ${shellArg(candidate.userId)} --dry-run`
      : "",
  };
}

async function firstProductionEvent() {
  const response = await fetch(`${baseUrl}/api/events`);
  const body = await safeJson(response);
  const event = Array.isArray(body?.events) ? body.events[0] : null;
  if (!response.ok || !event?.id) return null;
  return { id: event.id, title: event.title || event.id };
}

async function fetchDiagnostics(eventId, userId) {
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  const response = await fetch(`${baseUrl}/api/events/${encodeURIComponent(eventId)}/notification-diagnostics${query}`, {
    headers: { "x-loopin-admin-token": adminToken },
  });
  const body = await safeJson(response);
  if (!response.ok) {
    throw new Error(`diagnostics HTTP ${response.status}`);
  }
  return body;
}

function summarizeDiagnostics(body) {
  return {
    config: {
      enabled: Boolean(body?.config?.enabled),
      wechat: Boolean(body?.config?.configured?.wechat),
      eventReminder: Boolean(body?.config?.configured?.eventReminder),
    },
    query: body?.query || { userId: null },
    user: summarizeUser(body?.user),
    subscription: summarizeSubscription(body?.subscription),
    readiness: body?.readiness || null,
    recentSubscriptions: (body?.recentSubscriptions || []).map((row) => ({
      ...summarizeSubscription(row),
      user: summarizeUser(row.user),
      recordReady: isRecordReady(row.user, row, body?.recentRegistrations || []),
    })),
    recentRegistrations: (body?.recentRegistrations || []).map((row) => ({
      id: row.id,
      status: row.status,
      user: summarizeUser(row.user),
    })),
  };
}

function pickCandidate(body) {
  if (body?.query?.userId && body.user && body.subscription) {
    const selected = {
      userId: body.user.userId,
      openidBound: Boolean(body.user.openidBound),
      phoneBound: Boolean(body.user.phoneBound),
      registrationCount: Array.isArray(body.user.registrations) ? body.user.registrations.length : 0,
      subscriptionStatus: body.subscription.status,
      sentAt: body.subscription.sentAt || null,
      alreadySent: Boolean(body.readiness?.alreadySent),
    };
    return {
      ...selected,
      recordReady: selected.openidBound && selected.registrationCount > 0 && selected.subscriptionStatus === "accepted" && Boolean(selected.sentAt || selected.alreadySent),
    };
  }

  for (const row of body?.recentSubscriptions || []) {
    if (isRecordReady(row.user, row, body?.recentRegistrations || [])) {
      return {
        userId: row.user.userId,
        openidBound: Boolean(row.user.openidBound),
        phoneBound: Boolean(row.user.phoneBound),
        registrationCount: registrationsForUser(row.user.userId, body?.recentRegistrations || []).length,
        subscriptionStatus: row.status,
        sentAt: row.sentAt || null,
        alreadySent: Boolean(row.sentAt),
        recordReady: true,
      };
    }
  }
  return null;
}

function isRecordReady(user, subscription, registrations) {
  return Boolean(
    user?.userId &&
    user.openidBound &&
    subscription?.status === "accepted" &&
    subscription?.sentAt &&
    registrationsForUser(user.userId, registrations).length > 0,
  );
}

function registrationsForUser(userId, rows) {
  return rows.filter((row) => row?.user?.userId === userId);
}

function summarizeUser(user) {
  if (!user) return null;
  return {
    userId: user.userId,
    mode: user.mode,
    openidBound: Boolean(user.openidBound),
    phoneBound: Boolean(user.phoneBound),
    maskedPhone: user.maskedPhone || null,
    registrations: user.registrations || undefined,
  };
}

function summarizeSubscription(subscription) {
  if (!subscription) return null;
  return {
    id: subscription.id,
    userId: subscription.userId,
    eventId: subscription.eventId,
    status: subscription.status,
    reminderAt: subscription.reminderAt,
    sentAt: subscription.sentAt,
    lastError: subscription.lastError,
  };
}

function formatMarkdown(report) {
  const lines = [
    "# WeChat True Device Status",
    "",
    `- Base URL: \`${report.baseUrl}\``,
    `- Checked at: \`${report.checkedAt}\``,
    `- Status: \`${report.status}\``,
    `- Record ready: \`${report.recordReady}\``,
    `- Event: \`${report.event?.title || "missing"}\``,
    `- Detail: ${report.detail}`,
    `- Action: ${report.action}`,
  ];
  if (report.suggestedRecordCommand) {
    lines.push("", "## Record Command", "", "```bash", report.suggestedRecordCommand, "```");
  }
  if (report.suggestedTestReminderCommand) {
    lines.push("", "## Test Reminder Command", "", "```bash", report.suggestedTestReminderCommand, "```");
  }
  const diagnostics = report.diagnostics;
  if (diagnostics) {
    lines.push("", "## Config");
    lines.push(`- enabled=${diagnostics.config.enabled}, wechat=${diagnostics.config.wechat}, template=${diagnostics.config.eventReminder}`);
    if (diagnostics.user) {
      lines.push("", "## Selected User");
      lines.push(`- userId=\`${diagnostics.user.userId}\`, openid=${diagnostics.user.openidBound}, phone=${diagnostics.user.phoneBound}`);
      lines.push(`- subscription=\`${diagnostics.subscription?.status || "missing"}\`, sentAt=\`${diagnostics.subscription?.sentAt || "missing"}\``);
      lines.push(`- readiness=\`${JSON.stringify(diagnostics.readiness)}\``);
    }
    lines.push("", "## Recent Subscriptions", "", "| User | OpenID | Phone | Status | Sent | Record ready |", "|---|---|---|---|---|---|");
    for (const row of diagnostics.recentSubscriptions) {
      lines.push(`| ${markdownCell(row.user?.userId || row.userId)} | ${row.user?.openidBound ? "yes" : "no"} | ${row.user?.phoneBound ? "yes" : "no"} | ${markdownCell(row.status)} | ${row.sentAt ? "yes" : "no"} | ${row.recordReady ? "yes" : "no"} |`);
    }
    lines.push("", "## Recent Registrations", "", "| User | OpenID | Phone | Status |", "|---|---|---|---|");
    for (const row of diagnostics.recentRegistrations) {
      lines.push(`| ${markdownCell(row.user?.userId)} | ${row.user?.openidBound ? "yes" : "no"} | ${row.user?.phoneBound ? "yes" : "no"} | ${markdownCell(row.status)} |`);
    }
  }
  if (!report.recordReady) {
    lines.push("", "## Remaining", `- ${report.action}`);
  }
  lines.push("", "No token or secret values are printed by this check.");
  return lines.join("\n");
}

function parseArgs(argv) {
  const out = { json: false, markdown: false, strict: false, baseUrl: "", eventId: "", userId: "", output: "", help: false };
  const filtered = argv.filter((item) => item !== "--");
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--json" || arg === "--format=json") out.json = true;
    else if (arg === "--markdown" || arg === "--md" || arg === "--format=markdown") out.markdown = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--base-url") out.baseUrl = filtered[index += 1] ?? "";
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length);
    else if (arg === "--event-id") out.eventId = filtered[index += 1] ?? "";
    else if (arg.startsWith("--event-id=")) out.eventId = arg.slice("--event-id=".length);
    else if (arg === "--user-id") out.userId = filtered[index += 1] ?? "";
    else if (arg.startsWith("--user-id=")) out.userId = arg.slice("--user-id=".length);
    else if (arg === "--output" || arg === "--out") out.output = filtered[index += 1] ?? "";
    else if (arg.startsWith("--output=")) out.output = arg.slice("--output=".length);
    else if (arg.startsWith("--out=")) out.output = arg.slice("--out=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function writeOutput(file, content) {
  const target = path.resolve(repoRoot, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${content}\n`);
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
  return value.replace(/\/+$/, "");
}

async function safeJson(response) {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function shellArg(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_:@%+=,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function printHelp() {
  console.log(`Usage:
  pnpm wechat:true-device:status -- --markdown
  pnpm wechat:true-device:status -- --user-id <userId> --markdown

Options:
  --user-id <id>          Check a specific Studio diagnostic userId
  --event-id <id>         Default: first production event
  --base-url <url>        Default: PUBLIC_BASE_URL or https://loopin.llmxy.xyz
  --markdown              Render a handoff-friendly report
  --output <file>         Save report
  --strict                Exit 1 unless a record-ready user is found
`);
}
