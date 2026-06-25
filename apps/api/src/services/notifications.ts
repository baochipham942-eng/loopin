import type { PrismaClient } from "@prisma/client";
import { getWechatAccessToken, wechatConfigured } from "./auth.js";

type FetchLike = typeof fetch;

const EVENT_REMINDER_TYPE = "event_reminder";
const DEFAULT_REMINDER_LEAD_MINUTES = 24 * 60;

interface SubscribeMessageResponse {
  errcode?: number;
  errmsg?: string;
}

export class NotificationError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = "NotificationError";
  }
}

function eventReminderTemplateId() {
  return process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID || process.env.WECHAT_SUBSCRIBE_EVENT_TEMPLATE_ID || "";
}

function reminderLeadMinutes() {
  const raw = process.env.WX_EVENT_REMINDER_LEAD_MINUTES || process.env.WECHAT_EVENT_REMINDER_LEAD_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_REMINDER_LEAD_MINUTES;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_REMINDER_LEAD_MINUTES;
}

function reminderAt(startAt: Date) {
  return new Date(startAt.getTime() - reminderLeadMinutes() * 60_000);
}

function trimWechatValue(value: string, max = 20) {
  const chars = Array.from(value || "");
  return chars.length > max ? chars.slice(0, max).join("") : value;
}

function formatWechatTime(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  const hh = String(value.getHours()).padStart(2, "0");
  const mm = String(value.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function reminderTip(event: { venue?: string | null; city: string }) {
  const place = event.venue || event.city;
  return place ? `地点：${place}` : "请按时参加";
}

export function notificationConfig() {
  const eventReminder = eventReminderTemplateId();
  const wechatReady = wechatConfigured();
  return {
    enabled: Boolean(eventReminder && wechatReady),
    configured: {
      wechat: wechatReady,
      eventReminder: Boolean(eventReminder),
    },
    templates: {
      eventReminder,
    },
  };
}

export async function saveEventReminderSubscription(
  db: PrismaClient,
  input: { userId: string; eventId: string; accepted: boolean }
) {
  if (!input.userId || !input.eventId) {
    throw new NotificationError("缺少用户或活动信息", 400);
  }

  const event = await db.event.findUnique({ where: { id: input.eventId }, select: { id: true, startAt: true } });
  if (!event) throw new NotificationError("活动不存在", 404);

  await db.user.upsert({
    where: { id: input.userId },
    create: { id: input.userId },
    update: {},
  });

  return db.notificationSubscription.upsert({
    where: {
      userId_eventId_type: {
        userId: input.userId,
        eventId: input.eventId,
        type: EVENT_REMINDER_TYPE,
      },
    },
    create: {
      userId: input.userId,
      eventId: input.eventId,
      type: EVENT_REMINDER_TYPE,
      status: input.accepted ? "accepted" : "declined",
      reminderAt: reminderAt(event.startAt),
      lastError: null,
    },
    update: {
      status: input.accepted ? "accepted" : "declined",
      reminderAt: reminderAt(event.startAt),
      sentAt: null,
      lastError: null,
    },
  });
}

export interface SendEventRemindersResult {
  ok: true;
  task: "sendEventReminders";
  configured: boolean;
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface EventReminderPayload {
  touser: string;
  template_id: string;
  page: string;
  miniprogram_state: string;
  data: {
    thing1: { value: string };
    time2: { value: string };
    thing3: { value: string };
  };
}

interface ReminderSubscriptionTarget {
  id: string;
  userId: string;
  eventId: string;
  status: string;
  sentAt: Date | null;
  user: { id: string; openid: string | null };
  event: { id: string; title: string; startAt: Date; city: string; venue: string | null };
}

interface ReminderReadiness {
  canSend: boolean;
  missing: string[];
  alreadySent: boolean;
}

export interface SendEventReminderTestResult {
  ok: true;
  task: "sendEventReminderTest";
  configured: boolean;
  eventId: string;
  userId: string | null;
  registrationId: string | null;
  subscriptionId: string | null;
  readiness: ReminderReadiness;
  sent: number;
  skipped: number;
  failed: number;
  page: string | null;
  data: EventReminderPayload["data"] | null;
  error: string | null;
}

export async function sendDueEventReminders(
  db: PrismaClient,
  options: { now?: Date; limit?: number; fetcher?: FetchLike } = {}
): Promise<SendEventRemindersResult> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;
  const templateId = eventReminderTemplateId();
  const configured = Boolean(templateId && wechatConfigured());
  const result: SendEventRemindersResult = {
    ok: true,
    task: "sendEventReminders",
    configured,
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  const due = await db.notificationSubscription.findMany({
    where: {
      type: EVENT_REMINDER_TYPE,
      status: "accepted",
      sentAt: null,
      reminderAt: { lte: now },
    },
    take: limit,
    orderBy: { reminderAt: "asc" },
    include: { user: true, event: true },
  });
  result.checked = due.length;

  if (!configured) {
    result.skipped = due.length;
    return result;
  }

  const token = await getWechatAccessToken(options.fetcher ?? fetch);
  for (const sub of due) {
    if (!sub.user.openid) {
      result.skipped += 1;
      await db.notificationSubscription.update({
        where: { id: sub.id },
        data: { lastError: "missing_openid" },
      });
      continue;
    }

    const payload = buildEventReminderPayload(sub, templateId, sub.user.openid);
    const sent = await sendWechatSubscribeMessage(payload, token, options.fetcher ?? fetch);
    if (sent.ok) {
      result.sent += 1;
      await db.notificationSubscription.update({
        where: { id: sub.id },
        data: { sentAt: now, lastError: null },
      });
      continue;
    }

    result.failed += 1;
    await db.notificationSubscription.update({
      where: { id: sub.id },
      data: { lastError: sent.error },
    });
  }

  return result;
}

export async function sendEventReminderTest(
  db: PrismaClient,
  input: { eventId: string; userId?: string; registrationId?: string; now?: Date; fetcher?: FetchLike }
): Promise<SendEventReminderTestResult> {
  if (!input.eventId) throw new NotificationError("缺少活动信息", 400);

  const event = await db.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
  if (!event) throw new NotificationError("活动不存在", 404);

  const registrationId = input.registrationId?.trim() || null;
  const userId = input.userId?.trim() || await userIdFromRegistration(db, input.eventId, registrationId);
  if (!userId) throw new NotificationError("缺少用户或报名信息", 400);

  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, openid: true } });
  const subscription = user
    ? await db.notificationSubscription.findUnique({
        where: {
          userId_eventId_type: {
            userId,
            eventId: input.eventId,
            type: EVENT_REMINDER_TYPE,
          },
        },
        include: {
          user: { select: { id: true, openid: true } },
          event: { select: { id: true, title: true, startAt: true, city: true, venue: true } },
        },
      })
    : null;
  const config = notificationConfig();
  const readiness = reminderReadiness(config, user, subscription);
  const base = {
    ok: true as const,
    task: "sendEventReminderTest" as const,
    configured: config.enabled,
    eventId: input.eventId,
    userId,
    registrationId,
    subscriptionId: subscription?.id ?? null,
    readiness,
    sent: 0,
    skipped: 0,
    failed: 0,
    page: null,
    data: null,
    error: null,
  };
  if (!readiness.canSend || !subscription?.user.openid) {
    return { ...base, skipped: 1 };
  }

  const payload = buildEventReminderPayload(subscription, eventReminderTemplateId(), subscription.user.openid);
  const token = await getWechatAccessToken(input.fetcher ?? fetch);
  const sent = await sendWechatSubscribeMessage(payload, token, input.fetcher ?? fetch);
  if (sent.ok) {
    await db.notificationSubscription.update({
      where: { id: subscription.id },
      data: { sentAt: input.now ?? new Date(), lastError: null },
    });
    return { ...base, sent: 1, page: payload.page, data: payload.data };
  }

  await db.notificationSubscription.update({
    where: { id: subscription.id },
    data: { lastError: sent.error },
  });
  return { ...base, failed: 1, page: payload.page, data: payload.data, error: sent.error };
}

async function userIdFromRegistration(db: PrismaClient, eventId: string, registrationId: string | null) {
  if (!registrationId) return null;
  const registration = await db.registration.findFirst({
    where: { id: registrationId, eventId },
    select: { userId: true },
  });
  return registration?.userId ?? null;
}

function reminderReadiness(
  config: ReturnType<typeof notificationConfig>,
  user: { openid: string | null } | null,
  subscription: ReminderSubscriptionTarget | null
): ReminderReadiness {
  const missing: string[] = [];
  if (!config.configured.wechat) missing.push("wechat");
  if (!config.configured.eventReminder) missing.push("eventReminderTemplate");
  if (!user) missing.push("user");
  else if (!user.openid) missing.push("openid");
  if (!subscription) missing.push("subscription");
  else if (subscription.status !== "accepted") missing.push("subscriptionAccepted");
  return {
    canSend: missing.length === 0 && !subscription?.sentAt,
    missing,
    alreadySent: Boolean(subscription?.sentAt),
  };
}

function buildEventReminderPayload(subscription: ReminderSubscriptionTarget, templateId: string, openid: string): EventReminderPayload {
  return {
    touser: openid,
    template_id: templateId,
    page: `pages/event-detail/index?eventId=${subscription.eventId}`,
    miniprogram_state: process.env.WX_SUBSCRIBE_MINIPROGRAM_STATE || "trial",
    data: {
      thing1: { value: trimWechatValue(subscription.event.title) },
      time2: { value: formatWechatTime(subscription.event.startAt) },
      thing3: { value: trimWechatValue(reminderTip(subscription.event)) },
    },
  };
}

async function sendWechatSubscribeMessage(payload: EventReminderPayload, token: string, fetcher: FetchLike) {
  const url = new URL("https://api.weixin.qq.com/cgi-bin/message/subscribe/send");
  url.searchParams.set("access_token", token);
  const res = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as SubscribeMessageResponse;
  if (res.ok && (data.errcode === 0 || data.errcode === undefined)) {
    return { ok: true as const, error: null };
  }
  return {
    ok: false as const,
    error: data.errmsg || `wechat_error_${data.errcode ?? res.status}`,
  };
}
