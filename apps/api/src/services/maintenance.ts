import type { PrismaClient } from "@prisma/client";
import { sweepExpired } from "./registration.js";
import { sendDueEventReminders } from "./notifications.js";
import { syncTopicSignalsFromFeeds } from "./topic-signal-sync.js";

export type MaintenanceTask = "sweepExpired" | "sendEventReminders" | "syncTopicSignals" | "health";

export interface MaintenancePayload {
  task?: MaintenanceTask;
}

export interface MaintenanceResult {
  ok: true;
  task: MaintenanceTask;
  swept?: number;
  configured?: boolean;
  checked?: number;
  sent?: number;
  skipped?: number;
  failed?: number;
  feeds?: number;
  synced?: number;
  errors?: string[];
}

function parsePayload(raw: unknown): MaintenancePayload {
  if (!raw) return {};
  if (Buffer.isBuffer(raw)) return parsePayload(raw.toString("utf8"));
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    try {
      return JSON.parse(text) as MaintenancePayload;
    } catch {
      return { task: text as MaintenanceTask };
    }
  }
  if (typeof raw === "object") return raw as MaintenancePayload;
  return {};
}

export async function runMaintenanceTask(db: PrismaClient, rawPayload?: unknown): Promise<MaintenanceResult> {
  const payload = parsePayload(rawPayload);
  const task = payload.task ?? "sweepExpired";

  if (task === "health") return { ok: true, task };
  if (task === "sweepExpired") return { ok: true, task, swept: await sweepExpired(db) };
  if (task === "sendEventReminders") return sendDueEventReminders(db);
  if (task === "syncTopicSignals") return { ok: true, task, ...(await syncTopicSignalsFromFeeds(db)) };

  throw new Error(`Unsupported maintenance task: ${String(task)}`);
}
