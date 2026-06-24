#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = mergedEnv();
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args.baseUrl || env.PUBLIC_BASE_URL || "https://loopin.llmxy.xyz");
const adminToken = first(env, ["BACKOFFICE_ADMIN_TOKEN"]);

const checks = [];

checks.push(await checkHealth(baseUrl));
checks.push(await checkNotifications(baseUrl));
checks.push(await checkTopicFeeds(baseUrl, adminToken));
checks.push(await checkAttributionFunnel(baseUrl, adminToken));
checks.push(await checkPayments(baseUrl));
checks.push(checkSecretRotation(env));
checks.push(checkWechatTrueDevice(env));

const summary = summarize(checks);
const exitCode = args.strict && !summary.ready ? 1 : 0;
const result = {
  ok: true,
  baseUrl,
  checkedAt: new Date().toISOString(),
  strict: args.strict,
  exitCode,
  summary,
  checks,
  remaining: checks.filter((check) => check.status !== "pass").map(({ key, label, status, action }) => ({ key, label, status, action })),
};

const output = renderResult(result, args);
if (args.output) writeOutput(args.output, output);
console.log(output);
if (exitCode) process.exitCode = exitCode;

async function checkHealth(base) {
  try {
    const response = await fetch(`${base}/api/health`);
    return {
      key: "api_health",
      label: "生产 API",
      status: response.ok ? "pass" : "fail",
      detail: `HTTP ${response.status}`,
      action: response.ok ? "" : "先恢复 FC 自定义域名和 API 服务。",
    };
  } catch (err) {
    return fail("api_health", "生产 API", err, "先恢复 FC 自定义域名和 API 服务。");
  }
}

async function checkNotifications(base) {
  try {
    const response = await fetch(`${base}/api/notifications/config`);
    const body = await safeJson(response);
    const configured = Boolean(body?.configured?.wechat && body?.configured?.eventReminder);
    return {
      key: "wechat_notifications",
      label: "微信订阅消息",
      status: response.ok && body?.enabled && configured ? "pass" : "warn",
      detail: response.ok
        ? `enabled=${Boolean(body?.enabled)}, wechat=${Boolean(body?.configured?.wechat)}, template=${Boolean(body?.configured?.eventReminder)}`
        : `HTTP ${response.status}`,
      action: response.ok && body?.enabled && configured ? "" : "补齐 WX_APPSECRET 和 WX_SUBSCRIBE_EVENT_TEMPLATE_ID 后重跑。",
    };
  } catch (err) {
    return fail("wechat_notifications", "微信订阅消息", err, "补齐微信通知配置后重跑。");
  }
}

async function checkTopicFeeds(base, token) {
  if (!token || token === "__FILL_ME__") {
    return {
      key: "topic_feed",
      label: "真实选题 feed",
      status: "warn",
      detail: "缺少本地 BACKOFFICE_ADMIN_TOKEN，无法读取生产 feed 状态。",
      action: "在 .env.local 填 BACKOFFICE_ADMIN_TOKEN 后重跑。",
    };
  }

  try {
    const response = await fetch(`${base}/api/admin/topic-signal-feeds/status`, {
      headers: { "x-loopin-admin-token": token },
    });
    const text = await response.text();
    const body = parseJson(text);
    const leaksToken = text.includes(token);
    const configured = Boolean(body?.configured && body?.feeds > 0 && body?.invalid === 0 && body?.missingAuthEnv?.length === 0);
    return {
      key: "topic_feed",
      label: "真实选题 feed",
      status: response.ok && configured && !leaksToken ? "pass" : "warn",
      detail: response.ok
        ? `configured=${Boolean(body?.configured)}, feeds=${body?.feeds ?? 0}, valid=${body?.valid ?? 0}, missingEnv=${(body?.missingAuthEnv ?? []).join(",") || "none"}, leaksToken=${leaksToken}`
        : `HTTP ${response.status}`,
      action: response.ok && configured && !leaksToken
        ? ""
        : "配置 TOPIC_SIGNAL_FEED_URLS 和对应鉴权 env，用 Studio 预检真实样本。",
    };
  } catch (err) {
    return fail("topic_feed", "真实选题 feed", err, "配置或修复 feed 状态接口后重跑。");
  }
}

async function checkPayments(base) {
  try {
    const response = await fetch(`${base}/api/payments/providers`);
    const body = await safeJson(response);
    const providers = Array.isArray(body?.providers) ? body.providers : [];
    const wechatPay = providers.find((provider) => (provider?.identifier || provider?.provider) === "wechatpay");
    const readiness = wechatPay?.readiness;
    const configured = Boolean(readiness?.configured && readiness?.canPrepare && readiness?.canVerifyNotify);
    return {
      key: "wechat_pay",
      label: "微信支付商户参数",
      status: response.ok && configured ? "pass" : "warn",
      detail: response.ok
        ? `active=${body?.active ?? "unknown"}, configured=${Boolean(readiness?.configured)}, canPrepare=${Boolean(readiness?.canPrepare)}, canVerifyNotify=${Boolean(readiness?.canVerifyNotify)}, missing=${(readiness?.missing ?? []).join(",") || "none"}`
        : `HTTP ${response.status}`,
      action: response.ok && configured
        ? ""
        : "补齐商户号、证书序列号、商户私钥、APIv3 key、平台证书/公钥后，先跑 pnpm wechatpay:check -- --markdown --output .artifacts/wechatpay-check.md 和 pnpm wechatpay:check -- --strict，再用真机回归。",
    };
  } catch (err) {
    return fail("wechat_pay", "微信支付商户参数", err, "修复支付 readiness 接口后重跑。");
  }
}

async function checkAttributionFunnel(base, token) {
  if (!token || token === "__FILL_ME__") {
    return {
      key: "attribution_funnel",
      label: "引流归因漏斗",
      status: "warn",
      detail: "缺少本地 BACKOFFICE_ADMIN_TOKEN，无法读取生产漏斗接口。",
      action: "在 .env.local 填 BACKOFFICE_ADMIN_TOKEN 后重跑。",
    };
  }

  try {
    const eventsResponse = await fetch(`${base}/api/events`);
    const eventsBody = await safeJson(eventsResponse);
    const event = Array.isArray(eventsBody?.events) ? eventsBody.events[0] : null;
    if (!eventsResponse.ok || !event?.id) {
      return {
        key: "attribution_funnel",
        label: "引流归因漏斗",
        status: "warn",
        detail: eventsResponse.ok ? "生产暂无可用于漏斗检查的活动。" : `events HTTP ${eventsResponse.status}`,
        action: "先确认生产有 published 活动，再重跑。",
      };
    }

    const response = await fetch(`${base}/api/events/${encodeURIComponent(event.id)}/attribution/funnel`, {
      headers: { "x-loopin-admin-token": token },
    });
    const body = await safeJson(response);
    const usable = Boolean(body?.total && Array.isArray(body?.channels));
    return {
      key: "attribution_funnel",
      label: "引流归因漏斗",
      status: response.ok && usable ? "pass" : "warn",
      detail: response.ok && usable
        ? `event=${event.title || event.id}, detailViews=${body.total.detailViews ?? 0}, channels=${body.channels.length}`
        : `HTTP ${response.status}`,
      action: response.ok && usable
        ? ""
        : "先执行 Supabase AttributionEvent 迁移并部署新版 FC API，再重跑。",
    };
  } catch (err) {
    return fail("attribution_funnel", "引流归因漏斗", err, "修复 AttributionEvent 迁移或漏斗接口后重跑。");
  }
}

function checkSecretRotation(source) {
  const uploadKeyPath = first(source, ["WECHAT_PRIVATE_KEY_PATH", "WX_UPLOAD_PRIVATE_KEY_PATH"]);
  const rows = [
    secretRow(source, "WX_APPSECRET", "微信 AppSecret", ["WX_APPSECRET", "WECHAT_APPSECRET"], ["WX_APPSECRET_ROTATED_AT"]),
    secretRow(source, "WECHAT_PRIVATE_KEY_PATH", "微信上传私钥", ["WECHAT_PRIVATE_KEY_PATH", "WX_UPLOAD_PRIVATE_KEY_PATH"], ["WECHAT_PRIVATE_KEY_ROTATED_AT", "WX_UPLOAD_PRIVATE_KEY_ROTATED_AT"], uploadKeyPath),
    secretRow(source, "LLM_API_KEY", "MiMo / LLM API Key", ["LLM_API_KEY"], ["LLM_API_KEY_ROTATED_AT"]),
    secretRow(source, "BACKOFFICE_ADMIN_TOKEN", "后台管理员令牌", ["BACKOFFICE_ADMIN_TOKEN"], ["BACKOFFICE_ADMIN_TOKEN_ROTATED_AT"]),
  ];
  const missing = rows.filter((row) => !row.present).map((row) => row.key);
  const notRotated = rows.filter((row) => !row.rotated).map((row) => row.key);
  const invalidRotatedAt = rows.filter((row) => row.rotatedAtValid === false).map((row) => row.key);
  const unsafeFiles = rows.filter((row) => row.fileExists === false || row.fileModeSafe === false).map((row) => row.key);
  const ready = !missing.length && !notRotated.length && !invalidRotatedAt.length && !unsafeFiles.length;
  return {
    key: "secret_rotation",
    label: "敏感密钥轮换",
    status: ready ? "pass" : "warn",
    detail: `missing=${missing.join(",") || "none"}, notRotated=${notRotated.join(",") || "none"}, invalidRotatedAt=${invalidRotatedAt.join(",") || "none"}, unsafeFiles=${unsafeFiles.join(",") || "none"}`,
    action: ready ? "" : "先跑 pnpm secrets:rotation-check -- --strict --markdown --output .artifacts/secret-rotation.md 查看缺项；外部后台轮换后用 pnpm secrets:rotation-record -- --all --rotated-at now 写入合法时间标记。",
  };
}

function checkWechatTrueDevice(source) {
  const verifiedAt = first(source, ["WECHAT_TRUE_DEVICE_VERIFIED_AT"]);
  const reminderSentAt = first(source, ["WECHAT_TRUE_DEVICE_TEST_REMINDER_SENT_AT"]);
  const userId = first(source, ["WECHAT_TRUE_DEVICE_VERIFIED_USER_ID"]);
  const ready = isFilled(verifiedAt) && isFilled(reminderSentAt);
  return {
    key: "wechat_true_device",
    label: "真机体验版微信登录/订阅提醒",
    status: ready ? "pass" : "manual",
    detail: ready
      ? `verifiedAt=${verifiedAt}, testReminderSentAt=${reminderSentAt}, userId=${isFilled(userId) ? "recorded" : "not_recorded"}`
      : `verifiedAt=${isFilled(verifiedAt) ? verifiedAt : "missing"}, testReminderSentAt=${isFilled(reminderSentAt) ? reminderSentAt : "missing"}, userId=${isFilled(userId) ? "recorded" : "not_recorded"}`,
    action: ready ? "" : "先跑 pnpm wechat:true-device:status -- --markdown 查生产诊断；按 docs/WECHAT_TRUE_DEVICE_CHECKLIST.md 完成真机报名、票夹和订阅授权后，跑 pnpm wechat:true-device:test-reminder -- --user-id <id> --dry-run --markdown 预检，去掉 --dry-run 发送测试提醒，再用 pnpm wechat:true-device:record -- --user-id <id> --verified-at now --reminder-sent-at now 写入标记。",
  };
}

function secretRow(source, key, label, presentKeys, rotatedKeys, file) {
  const fileStatus = file ? inspectFile(file) : null;
  const rotatedAt = first(source, rotatedKeys);
  const rotatedAtPresent = isFilled(rotatedAt);
  const rotatedAtValid = !rotatedAtPresent || isValidTime(rotatedAt);
  return {
    key,
    label,
    present: isFilled(first(source, presentKeys)),
    rotated: rotatedAtPresent && rotatedAtValid,
    rotatedAtValid,
    fileExists: fileStatus?.exists,
    fileModeSafe: fileStatus?.safe,
  };
}

function inspectFile(file) {
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) return { exists: false, safe: false };
  const numericMode = statSync(resolved).mode & 0o777;
  return { exists: true, safe: (numericMode & 0o077) === 0 };
}

function summarize(items) {
  const counts = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    ready: items.every((item) => item.status === "pass"),
    pass: counts.pass ?? 0,
    warn: counts.warn ?? 0,
    fail: counts.fail ?? 0,
    manual: counts.manual ?? 0,
  };
}

function formatReport(report) {
  const lines = [
    `Loopin production readiness`,
    `baseUrl: ${report.baseUrl}`,
    `checkedAt: ${report.checkedAt}`,
    `ready: ${report.summary.ready}`,
    "",
  ];
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.label}`);
    lines.push(`  ${check.detail}`);
    if (check.action) lines.push(`  ${check.action}`);
  }
  return lines.join("\n");
}

function formatMarkdown(report) {
  const lines = [
    "# Loopin Production Readiness",
    "",
    `- Base URL: \`${report.baseUrl}\``,
    `- Checked at: \`${report.checkedAt}\``,
    `- Ready: \`${report.summary.ready}\``,
    `- Strict: \`${report.strict}\`, exit code \`${report.exitCode}\``,
    `- Summary: pass \`${report.summary.pass}\`, warn \`${report.summary.warn}\`, fail \`${report.summary.fail}\`, manual \`${report.summary.manual}\``,
    "",
    "| Status | Check | Detail | Action | Runbook |",
    "|---|---|---|---|---|",
  ];

  for (const check of report.checks) {
    lines.push(
      [
        tableCell(check.status),
        tableCell(check.label),
        tableCell(check.detail),
        tableCell(check.action || "done"),
        tableCell(runbookFor(check.key)),
      ].join("|").replace(/^/, "|").concat("|"),
    );
  }

  if (report.remaining.length) {
    lines.push("", "## Remaining");
    for (const item of report.remaining) {
      lines.push(`- \`${item.status}\` ${item.label}: ${item.action}`);
    }
  }

  return lines.join("\n");
}

function renderResult(report, options) {
  if (options.json) return JSON.stringify(report, null, 2);
  if (options.markdown) return formatMarkdown(report);
  return formatReport(report);
}

function writeOutput(file, content) {
  const target = path.resolve(repoRoot, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${content}\n`);
}

function runbookFor(key) {
  const runbooks = {
    topic_feed: "docs/TOPIC_SIGNAL_FEEDS.md",
    attribution_funnel: "README.md",
    wechat_pay: "docs/WECHAT_PAY_CONFIG.md",
    secret_rotation: "docs/SECRET_ROTATION.md",
    wechat_true_device: "docs/WECHAT_TRUE_DEVICE_CHECKLIST.md",
  };
  return runbooks[key] || "";
}

function tableCell(value) {
  return ` ${String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")} `;
}

function parseArgs(argv) {
  const out = { json: false, markdown: false, strict: false, baseUrl: "", output: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json" || arg === "--format=json") out.json = true;
    else if (arg === "--markdown" || arg === "--md" || arg === "--format=markdown") out.markdown = true;
    else if (arg === "--strict" || arg === "--fail-on-remaining") out.strict = true;
    else if (arg === "--base-url") out.baseUrl = argv[index += 1] ?? "";
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length);
    else if (arg === "--output" || arg === "--out") out.output = argv[index += 1] ?? "";
    else if (arg.startsWith("--output=")) out.output = arg.slice("--output=".length);
    else if (arg.startsWith("--out=")) out.output = arg.slice("--out=".length);
  }
  return out;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
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
  return Boolean(value && value.trim() && value.trim() !== "__FILL_ME__");
}

function isValidTime(value) {
  return !Number.isNaN(Date.parse(String(value || "").trim()));
}

async function safeJson(response) {
  return parseJson(await response.text());
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fail(key, label, err, action) {
  return {
    key,
    label,
    status: "fail",
    detail: err instanceof Error ? err.message : "检查失败",
    action,
  };
}
