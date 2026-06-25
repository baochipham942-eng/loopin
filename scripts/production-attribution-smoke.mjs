#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv();
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args.baseUrl || env.PUBLIC_BASE_URL || "https://loopin.llmxy.xyz");
const adminToken = args.adminToken || env.BACKOFFICE_ADMIN_TOKEN;
const source = args.source || "production_smoke";
const runId = args.runId || `smoke_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;

if (!adminToken || adminToken === "__FILL_ME__") {
  fail("Missing BACKOFFICE_ADMIN_TOKEN. Fill .env.local or pass --admin-token.");
}

const event = args.eventId ? { id: args.eventId, title: args.eventId } : await firstEvent();
if (!event?.id) fail("No production event found for attribution smoke.");

const before = await funnel(event.id);
const events = ["event_detail_view", "registration_intent", "registration_submit", "registration_reserved"];
for (const type of events) {
  await postAttribution(type, event.id);
}
const after = await funnel(event.id);

const delta = {
  detailViews: deltaOf(before.total, after.total, "detailViews"),
  registrationIntents: deltaOf(before.total, after.total, "registrationIntents"),
  registrationSubmits: deltaOf(before.total, after.total, "registrationSubmits"),
  registrationReservations: deltaOf(before.total, after.total, "registrationReservations"),
};
const ok = Object.values(delta).every((value) => value >= 1);
const result = {
  ok,
  baseUrl,
  event: { id: event.id, title: event.title || event.id },
  runId,
  source,
  delta,
  afterTotal: after.total,
  channel: after.channels.find((row) => row.key === source) || null,
};

console.log(JSON.stringify(result, null, 2));
if (!ok) process.exit(1);

async function firstEvent() {
  const response = await fetch(`${baseUrl}/api/events`);
  const body = await safeJson(response);
  if (!response.ok) fail(`Failed to fetch production events: HTTP ${response.status}`);
  return Array.isArray(body?.events) ? body.events[0] : null;
}

async function funnel(eventId) {
  const response = await fetch(`${baseUrl}/api/events/${encodeURIComponent(eventId)}/attribution/funnel`, {
    headers: { "x-loopin-admin-token": adminToken },
  });
  const body = await safeJson(response);
  if (!response.ok) fail(`Failed to fetch attribution funnel: HTTP ${response.status}`);
  if (!body?.total || !Array.isArray(body?.channels)) fail("Attribution funnel response is not usable.");
  return body;
}

async function postAttribution(type, eventId) {
  const response = await fetch(`${baseUrl}/api/attribution/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type,
      eventId,
      path: `/pages/event-detail/index?eventId=${eventId}&utm_source=${source}&utm_campaign=production_smoke`,
      attribution: {
        utm_source: source,
        utm_medium: "mini_program",
        utm_campaign: "production_smoke",
        utm_content: runId,
        channel: source,
        referrer: "codex_production_smoke",
      },
      metadata: {
        smoke: true,
        runId,
      },
    }),
  });
  const body = await safeJson(response);
  if (!response.ok || !body?.ok) fail(`Failed to record ${type}: HTTP ${response.status}`);
}

function deltaOf(before, after, key) {
  return Number(after?.[key] || 0) - Number(before?.[key] || 0);
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

function parseArgs(argv) {
  const out = {};
  const filtered = argv.filter((item) => item !== "--");
  for (let i = 0; i < filtered.length; i += 1) {
    const arg = filtered[i];
    if (arg === "--base-url") out.baseUrl = filtered[++i];
    else if (arg === "--admin-token") out.adminToken = filtered[++i];
    else if (arg === "--event-id") out.eventId = filtered[++i];
    else if (arg === "--source") out.source = filtered[++i];
    else if (arg === "--run-id") out.runId = filtered[++i];
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function loadEnv() {
  return {
    ...readEnv(path.join(repoRoot, "apps/api/.env")),
    ...readEnv(path.join(repoRoot, ".env.local")),
    ...process.env,
  };
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

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  pnpm production:attribution-smoke
  pnpm production:attribution-smoke -- --event-id <eventId>

Options:
  --base-url <url>       default https://loopin.llmxy.xyz
  --admin-token <token>  default BACKOFFICE_ADMIN_TOKEN from .env.local
  --event-id <id>        default first production event
  --source <key>         default production_smoke
  --run-id <id>          default generated timestamp id
`);
}
