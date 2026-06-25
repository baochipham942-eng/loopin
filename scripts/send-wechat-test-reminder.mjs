#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const env = mergedEnv();
const baseUrl = normalizeBaseUrl(args.baseUrl || env.PUBLIC_BASE_URL || "https://loopin.llmxy.xyz");
const adminToken = first(env, ["BACKOFFICE_ADMIN_TOKEN"]);

try {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const result = await run();
  const output = args.markdown ? formatMarkdown(result) : JSON.stringify(result, null, 2);
  if (args.output) writeOutput(args.output, output);
  console.log(output);
  if (!result.okForFlow) process.exitCode = 1;
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    status: "error",
    error: err?.message || String(err),
    action: err?.action || "修复后重跑测试提醒命令。",
  }, null, 2));
  process.exitCode = 1;
}

async function run() {
  if (!isFilled(adminToken)) {
    const err = new Error("缺少本地 BACKOFFICE_ADMIN_TOKEN，不能读取生产微信诊断或发送测试提醒。");
    err.action = "在 .env.local 填 BACKOFFICE_ADMIN_TOKEN 后重跑。";
    throw err;
  }
  if (!isFilled(args.userId) && !isFilled(args.registrationId)) {
    const err = new Error("必须提供 --user-id 或 --registration-id。");
    err.action = "先跑 pnpm wechat:true-device:status -- --markdown 找到最近真机 userId。";
    throw err;
  }
  if (args.dryRun && !isFilled(args.userId)) {
    const err = new Error("--dry-run 需要 --user-id，不能只用 --registration-id。");
    err.action = "先跑 pnpm wechat:true-device:status -- --markdown 找到最近真机 userId。";
    throw err;
  }

  const event = args.eventId ? { id: args.eventId, title: args.eventId } : await firstProductionEvent();
  if (!event?.id) {
    const err = new Error("生产暂无可用于微信真机测试提醒的活动。");
    err.action = "确认生产有 published 活动，或用 --event-id 指定活动后重跑。";
    throw err;
  }

  const before = await fetchDiagnostics(event.id, args.userId);
  const beforeReadiness = summarizeReadiness(before);
  if (args.dryRun) {
    return resultPayload({
      status: beforeReadiness.alreadySent ? "already_sent" : beforeReadiness.canSend ? "dry_run_ready" : "not_ready",
      event,
      dryRun: true,
      before: beforeReadiness,
      sendResult: null,
      after: null,
    });
  }

  if (beforeReadiness.alreadySent) {
    return resultPayload({
      status: "already_sent",
      event,
      dryRun: false,
      before: beforeReadiness,
      sendResult: null,
      after: beforeReadiness,
    });
  }

  const sendResult = await sendTestReminder(event.id);
  const after = await fetchDiagnostics(event.id, sendResult.userId || args.userId);
  const afterReadiness = summarizeReadiness(after);
  return resultPayload({
    status: sendResult.sent > 0 ? "sent" : "not_sent",
    event,
    dryRun: false,
    before: beforeReadiness,
    sendResult: summarizeSendResult(sendResult),
    after: afterReadiness,
  });
}

function resultPayload({ status, event, dryRun, before, sendResult, after }) {
  const okForFlow = status === "dry_run_ready" || status === "sent" || status === "already_sent";
  return {
    ok: okForFlow,
    okForFlow,
    status,
    dryRun,
    baseUrl,
    checkedAt: new Date().toISOString(),
    event: { id: event.id, title: event.title || event.id },
    target: {
      userId: before.userId || args.userId || sendResult?.userId || null,
      registrationId: args.registrationId || sendResult?.registrationId || null,
    },
    before,
    sendResult,
    after,
    action: actionForStatus(status, before, after),
    suggestedRecordCommand: status === "sent" || status === "already_sent"
      ? `pnpm wechat:true-device:record -- --user-id ${shellArg(before.userId || sendResult?.userId || args.userId)} --verified-at now --reminder-sent-at now`
      : "",
  };
}

function actionForStatus(status, before, after) {
  if (status === "dry_run_ready") return "条件已满足；手机在手边时去掉 --dry-run 发送一次测试提醒。";
  if (status === "sent") return "确认手机收到活动开始通知后，执行 suggestedRecordCommand 写入 readiness 标记。";
  if (status === "already_sent") return "该订阅已发送过测试提醒；确认手机收到后执行 suggestedRecordCommand。";
  const missing = (after || before)?.missing || [];
  return `先补齐真机条件：${readableMissing(missing).join("、") || "未知缺项"}。`;
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
    const err = new Error(`生产微信诊断接口返回 HTTP ${response.status}`);
    err.action = "确认后台令牌、生产 API 和活动 ID 后重跑。";
    throw err;
  }
  return body;
}

async function sendTestReminder(eventId) {
  const body = {};
  if (args.userId) body.userId = args.userId;
  if (args.registrationId) body.registrationId = args.registrationId;
  const response = await fetch(`${baseUrl}/api/events/${encodeURIComponent(eventId)}/notifications/test-reminder`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-loopin-admin-token": adminToken,
    },
    body: JSON.stringify(body),
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    const err = new Error(`测试提醒接口返回 HTTP ${response.status}`);
    err.action = "确认 userId/registrationId、订阅授权和后台令牌后重跑。";
    throw err;
  }
  return payload;
}

function summarizeReadiness(body) {
  const user = body?.user || null;
  const subscription = body?.subscription || null;
  const readiness = body?.readiness || {};
  return {
    userId: user?.userId || body?.query?.userId || null,
    openidBound: Boolean(user?.openidBound),
    phoneBound: Boolean(user?.phoneBound),
    registrationCount: Array.isArray(user?.registrations) ? user.registrations.length : 0,
    subscriptionStatus: subscription?.status || "missing",
    sentAt: subscription?.sentAt || null,
    canSend: Boolean(readiness.canSend),
    alreadySent: Boolean(readiness.alreadySent || subscription?.sentAt),
    missing: readiness.missing || [],
  };
}

function readableMissing(items) {
  const labels = {
    wechat: "微信凭证未配置",
    eventReminderTemplate: "活动提醒模板未配置",
    user: "用户不存在",
    openid: "openid 未绑定",
    subscription: "没有订阅授权",
    subscriptionAccepted: "订阅未 accepted",
  };
  return (items || []).map((item) => labels[item] || item);
}

function summarizeSendResult(result) {
  return {
    task: result?.task || "sendEventReminderTest",
    configured: Boolean(result?.configured),
    eventId: result?.eventId || null,
    userId: result?.userId || null,
    registrationId: result?.registrationId || null,
    subscriptionId: result?.subscriptionId || null,
    sent: result?.sent || 0,
    skipped: result?.skipped || 0,
    failed: result?.failed || 0,
    readiness: result?.readiness || null,
    page: result?.page || null,
    error: result?.error || null,
  };
}

function formatMarkdown(report) {
  const lines = [
    "# WeChat Test Reminder",
    "",
    `- Base URL: \`${report.baseUrl}\``,
    `- Checked at: \`${report.checkedAt}\``,
    `- Status: \`${report.status}\``,
    `- Dry run: \`${report.dryRun}\``,
    `- Event: \`${report.event.title}\``,
    `- User: \`${report.target.userId || "missing"}\``,
    `- Action: ${report.action}`,
    "",
    "## Before",
    `- openid=${report.before.openidBound}, registrations=${report.before.registrationCount}, subscription=${report.before.subscriptionStatus}, canSend=${report.before.canSend}, alreadySent=${report.before.alreadySent}`,
  ];
  if (report.sendResult) {
    lines.push("", "## Send Result");
    lines.push(`- sent=${report.sendResult.sent}, skipped=${report.sendResult.skipped}, failed=${report.sendResult.failed}, page=\`${report.sendResult.page || "missing"}\``);
  }
  if (report.after) {
    lines.push("", "## After");
    lines.push(`- sentAt=\`${report.after.sentAt || "missing"}\`, alreadySent=${report.after.alreadySent}`);
  }
  if (report.suggestedRecordCommand) {
    lines.push("", "## Record Command", "", "```bash", report.suggestedRecordCommand, "```");
  }
  if (!report.okForFlow) {
    lines.push("", "## Remaining", `- ${report.action}`);
  }
  lines.push("", "No token, openid, or secret values are printed by this command.");
  return lines.join("\n");
}

function parseArgs(argv) {
  const out = { markdown: false, dryRun: false, baseUrl: "", eventId: "", userId: "", registrationId: "", output: "", help: false };
  const filtered = argv.filter((item) => item !== "--");
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--markdown" || arg === "--md" || arg === "--format=markdown") out.markdown = true;
    else if (arg === "--base-url") out.baseUrl = filtered[index += 1] ?? "";
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length);
    else if (arg === "--event-id") out.eventId = filtered[index += 1] ?? "";
    else if (arg.startsWith("--event-id=")) out.eventId = arg.slice("--event-id=".length);
    else if (arg === "--user-id") out.userId = filtered[index += 1] ?? "";
    else if (arg.startsWith("--user-id=")) out.userId = arg.slice("--user-id=".length);
    else if (arg === "--registration-id") out.registrationId = filtered[index += 1] ?? "";
    else if (arg.startsWith("--registration-id=")) out.registrationId = arg.slice("--registration-id=".length);
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
  return String(value || "").replace(/\/+$/, "");
}

async function safeJson(response) {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

function shellArg(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_:@%+=,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function printHelp() {
  console.log(`Usage:
  pnpm wechat:true-device:test-reminder -- --user-id <userId> --dry-run
  pnpm wechat:true-device:test-reminder -- --user-id <userId>

Options:
  --user-id <id>             Studio 微信联调诊断里的 userId
  --registration-id <id>     Optional; API can derive userId from registration
  --event-id <id>            Default: first production event
  --base-url <url>           Default: PUBLIC_BASE_URL or https://loopin.llmxy.xyz
  --dry-run                  only check readiness; do not consume subscription
  --markdown                 render a handoff-friendly report
  --output <file>            save report
`);
}
