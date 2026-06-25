import "dotenv/config";
import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import {
  calcBudget,
  compareScenarios,
  suggestPrice,
  validateForm,
  validateFormSchema,
  quotaAvailable,
  OversellError,
  InvalidTransitionError,
  type BudgetInput,
  type RegistrationFormSchema,
  type FormValues,
  type TicketKind,
} from "@loopin/core";
import { prisma } from "./db.js";
import { createEvent, createTicketTypeWithQuota, listTicketTypes, updateTicketType, setTicketTypeStatus, ticketTypeEventId, setEventForm, setEventPage, upsertUser, type EventPagePayload } from "./services/catalog.js";
import {
  approveRegistration,
  reserve,
  complete,
  cancel,
  refundOrder,
  RefundError,
  InviteCodeError,
  setRegistrationTag,
  cancelRegistration,
  checkin,
  checkinByToken,
  buildCheckinPayload,
  resolveCheckinPayload,
  promoteWaitlistRegistration,
  rejectRegistration,
  sweepExpired,
  CheckinTokenError,
  DuplicateCheckinError,
  RegistrationCancelError,
  SoldOutError,
  type CheckinScanInput,
} from "./services/registration.js";
import { generateEventPage, generateMaterials, type EventPageInput, type MaterialsInput } from "./services/ai.js";
import {
  createTopicSignal,
  listTopicSignalsFromDb,
  suggestTopicsFromDb,
  TopicSignalError,
  type TopicRadarInput,
  type TopicSignalInput,
} from "./services/topic-radar.js";
import { previewTopicSignalFeeds, syncTopicSignalsFromFeeds, topicSignalFeedStatus, type TopicSignalFeedConfig } from "./services/topic-signal-sync.js";
import { llmConfigured } from "./llm.js";
import { runMaintenanceTask } from "./services/maintenance.js";
import { listUserRegistrations } from "./services/users.js";
import { getEventReview } from "./services/reviews.js";
import { EventFeedbackError, listEventFeedback, submitEventFeedback, type EventFeedbackInput } from "./services/feedbacks.js";
import { createEventResource, EventResourceError, listEventResources, type EventResourceInput } from "./services/resources.js";
import { WechatAuthError, bindUserPhoneFromWechat, loginWithWechatCode, publicUser } from "./services/auth.js";
import { isAgentTaskStatus, refreshEventAgentTasks, updateAgentTaskStatus } from "./services/agent.js";
import {
  createEventSocialProfile,
  discoverPeople,
  getEventSocial,
  getOrganizerPublic,
  getUserInterestFeed,
  listEventSocialProfiles,
  SocialError,
  subscribeUserInterest,
  type EventSocialProfileInput,
  type InterestSubscriptionInput,
} from "./services/social.js";
import {
  acceptOrganizerInvitation,
  BackofficeError,
  createOrganizer,
  createOrganizerMember,
  createOrganizerInvitation,
  upsertHostProfile,
  type HostProfileInput,
  eventFeedbackCsv,
  eventRegistrationsCsv,
  eventRegistrationsExcel,
  eventRegistrationsPdf,
  eventResourcesCsv,
  eventWaitlistCsv,
  getOrganizerDetail,
  getPlatformOverview,
  listEventExporters,
  listPlatformEvents,
  listEventQuotas,
  listOrganizers,
  listOrganizerMembers,
  setOrganizerWhitelist,
  updateOrganizerMember,
  updateQuota,
  type OrganizerInvitationAcceptInput,
  type OrganizerInvitationInput,
  type OrganizerMemberInput,
  type QuotaUpdateInput,
} from "./services/backoffice.js";
import { requireBackofficeAccess } from "./services/backoffice-auth.js";
import type { BackofficePermission } from "./services/backoffice-auth.js";
import {
  NotificationError,
  notificationConfig,
  saveEventReminderSubscription,
  sendDueEventReminders,
  sendEventReminderTest,
} from "./services/notifications.js";
import { activePaymentProvider, PaymentError, paymentProviderStatuses } from "./services/payments.js";
import {
  AttributionEventError,
  recordAttributionEvent,
  summarizeAttributionFunnel,
  type AttributionEventInput,
} from "./services/attribution.js";

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function sendCsv(reply: FastifyReply, result: { filename: string; csv: string }) {
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(result.filename)}`)
    .send("\ufeff" + result.csv);
}

function sendExcel(reply: FastifyReply, result: { filename: string; xml: string }) {
  return reply
    .header("content-type", "application/vnd.ms-excel; charset=utf-8")
    .header("content-disposition", `attachment; filename="export.xls"; filename*=UTF-8''${encodeURIComponent(result.filename)}`)
    .send(result.xml);
}

function sendPdf(reply: FastifyReply, result: { filename: string; pdf: Buffer }) {
  return reply
    .header("content-type", "application/pdf")
    .header("content-disposition", `attachment; filename="export.pdf"; filename*=UTF-8''${encodeURIComponent(result.filename)}`)
    .send(result.pdf);
}

function diagnosticUser(
  user: { id: string; openid: string | null; phone: string | null; nickname: string | null },
  registrations: { id: string; status: string }[] = []
) {
  return {
    ...publicUser(user),
    nickname: user.nickname,
    registrations,
  };
}

function diagnosticSubscription(subscription: {
  id: string;
  userId: string;
  eventId: string;
  type: string;
  status: string;
  reminderAt: Date;
  sentAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}) {
  return {
    id: subscription.id,
    userId: subscription.userId,
    eventId: subscription.eventId,
    type: subscription.type,
    status: subscription.status,
    reminderAt: subscription.reminderAt,
    sentAt: subscription.sentAt,
    lastError: subscription.lastError,
    updatedAt: subscription.updatedAt,
  };
}

function diagnosticReadiness(
  config: ReturnType<typeof notificationConfig>,
  user: { openid: string | null } | null,
  subscription: { status: string; sentAt: Date | null } | null
) {
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

async function requireRegistrationBackofficeAccess(
  req: Parameters<typeof requireBackofficeAccess>[1],
  registrationId: string,
  permission: BackofficePermission
) {
  await requireBackofficeAccess(prisma, req, { permission });
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    select: { eventId: true },
  });
  if (!registration) throw new BackofficeError(404, "registration_not_found", "报名记录不存在");
  await requireBackofficeAccess(prisma, req, { permission, eventId: registration.eventId });
}

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    (req as unknown as { rawBody?: string }).rawBody = rawBody;
    if (!rawBody.trim()) return done(null, {});
    try {
      return done(null, JSON.parse(rawBody));
    } catch (err) {
      return done(err as Error, undefined);
    }
  });
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  // 领域错误 -> HTTP 状态
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof SoldOutError) return reply.status(409).send({ error: "sold_out", message: err.message });
    if (err instanceof OversellError) return reply.status(409).send({ error: "oversell", message: err.message });
    if (err instanceof DuplicateCheckinError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof CheckinTokenError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof RegistrationCancelError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof InvalidTransitionError) return reply.status(409).send({ error: "invalid_transition", message: err.message });
    if (err instanceof WechatAuthError) return reply.status(err.statusCode).send({ error: "wechat_auth", message: err.message });
    if (err instanceof NotificationError) return reply.status(err.statusCode).send({ error: "notification", message: err.message });
    if (err instanceof EventFeedbackError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof EventResourceError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof TopicSignalError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof SocialError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof BackofficeError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof PaymentError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof AttributionEventError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: "internal", message: (err as Error).message });
  });

  app.get("/api/health", async () => ({ ok: true, service: "loopin-api", ts: Date.now() }));

  // FC custom runtime lifecycle/event entrypoints. Timer trigger payload:
  // {"task":"sweepExpired"}
  app.post("/initialize", async () => ({ ok: true }));
  app.post("/invoke", async (req) => runMaintenanceTask(prisma, req.body));

  // 盈亏测算（差异化核心）
  app.post<{ Body: BudgetInput }>("/api/budget/calc", async (req) => {
    return calcBudget(req.body);
  });

  app.post<{ Body: { input: BudgetInput; headcounts?: number[] } }>("/api/budget/scenarios", async (req) => {
    return { rows: compareScenarios(req.body.input, req.body.headcounts) };
  });

  app.post<{ Body: { input: BudgetInput; desiredBreakEven: number } }>("/api/budget/suggest-price", async (req) => {
    return suggestPrice(req.body.input, req.body.desiredBreakEven);
  });

  // 报名表校验
  app.post<{ Body: { schema: RegistrationFormSchema; values: FormValues } }>("/api/form/validate", async (req) => {
    return validateForm(req.body.schema, req.body.values);
  });

  app.post<{ Body: AttributionEventInput }>("/api/attribution/events", async (req, reply) => {
    const event = await recordAttributionEvent(prisma, req.body ?? {});
    return reply.status(201).send({ ok: true, id: event.id });
  });

  // 微信登录：开发期没有 AppSecret 时保留 local user，生产配置 WX_APPSECRET 后换 openid。
  // 传 localUserId 时会把临时报名迁到 openid 用户，票夹不丢。
  app.post<{ Body: { code?: string; localUserId?: string; nickname?: string; devOpenid?: string } }>(
    "/api/auth/wechat/login",
    async (req) => {
      const result = await loginWithWechatCode(prisma, req.body);
      return publicUser(result.user, result.mode);
    }
  );

  // 手机号绑定：有 getPhoneNumber 权限时传 code；当前 MVP 可传报名表手机号绑定当前用户。
  app.post<{ Body: { userId: string; code?: string; phone?: string } }>("/api/auth/wechat/phone", async (req) => {
    const result = await bindUserPhoneFromWechat(prisma, req.body);
    return { ...publicUser(result.user), phone: result.user.phone };
  });

  // 小程序订阅消息配置。模板 ID 走 FC 环境变量，避免为了换模板重新发版。
  app.get("/api/notifications/config", async () => {
    return notificationConfig();
  });

  app.post<{ Body: { userId: string; eventId: string; accepted: boolean } }>(
    "/api/notifications/event-reminder/subscriptions",
    async (req) => {
      const subscription = await saveEventReminderSubscription(prisma, req.body);
      return {
        ok: true,
        subscription: {
          id: subscription.id,
          eventId: subscription.eventId,
          status: subscription.status,
          reminderAt: subscription.reminderAt,
          sentAt: subscription.sentAt,
        },
      };
    }
  );

  app.get<{ Params: { id: string }; Querystring: { userId?: string } }>(
    "/api/events/:id/notification-diagnostics",
    async (req) => {
      await requireBackofficeAccess(prisma, req, { permission: "events:read", eventId: req.params.id });
      const event = await prisma.event.findUnique({
        where: { id: req.params.id },
        select: { id: true, title: true, startAt: true },
      });
      if (!event) throw new BackofficeError(404, "event_not_found", "活动不存在");

      const config = notificationConfig();
      const userId = req.query.userId?.trim();
      const user = userId
        ? await prisma.user.findUnique({
            where: { id: userId },
            include: {
              registrations: {
                where: { eventId: event.id },
                select: { id: true, status: true },
                orderBy: { createdAt: "desc" },
              },
            },
          })
        : null;
      const subscription = userId
        ? await prisma.notificationSubscription.findUnique({
            where: { userId_eventId_type: { userId, eventId: event.id, type: "event_reminder" } },
          })
        : null;
      const recentSubscriptions = await prisma.notificationSubscription.findMany({
        where: { eventId: event.id, type: "event_reminder" },
        take: 8,
        orderBy: { updatedAt: "desc" },
        include: { user: true },
      });
      const recentRegistrations = await prisma.registration.findMany({
        where: { eventId: event.id },
        take: 8,
        orderBy: { createdAt: "desc" },
        include: { user: true },
      });

      return {
        event,
        config,
        query: { userId: userId || null },
        user: user ? diagnosticUser(user, user.registrations) : null,
        subscription: subscription ? diagnosticSubscription(subscription) : null,
        readiness: diagnosticReadiness(config, user, subscription),
        recentSubscriptions: recentSubscriptions.map((row) => ({
          ...diagnosticSubscription(row),
          user: diagnosticUser(row.user),
        })),
        recentRegistrations: recentRegistrations.map((row) => ({
          id: row.id,
          status: row.status,
          user: diagnosticUser(row.user),
        })),
      };
    }
  );

  app.post<{ Params: { id: string }; Body: { userId?: string; registrationId?: string } }>(
    "/api/events/:id/notifications/test-reminder",
    async (req) => {
      await requireBackofficeAccess(prisma, req, { permission: "events:write", eventId: req.params.id });
      return sendEventReminderTest(prisma, {
        eventId: req.params.id,
        userId: req.body?.userId,
        registrationId: req.body?.registrationId,
      });
    }
  );

  // 目录：建活动（含票种+配额+报名表）
  app.post<{
    Body: {
      organizerId?: string;
      title: string;
      city: string;
      startAt: string;
      venue?: string;
      ticket: { name: string; kind: TicketKind; priceCents: number; capacity: number | null };
      formSchema?: RegistrationFormSchema;
      page?: EventPagePayload;
      /** 盈亏测算输入；传了就把测算结果快照存进 BudgetPlan（差异化：建活动第一步先算账） */
      budget?: BudgetInput;
    };
  }>("/api/events", async (req) => {
    const b = req.body;
    let organizerId = b.organizerId;
    if (!organizerId) {
      const org = await prisma.organizer.create({ data: { name: "默认主办方", whitelisted: true } });
      organizerId = org.id;
    }
    const event = await createEvent(prisma, { organizerId, title: b.title, city: b.city, startAt: new Date(b.startAt), venue: b.venue });
    const { ticketType, quota } = await createTicketTypeWithQuota(prisma, { eventId: event.id, ...b.ticket });
    if (b.formSchema) await setEventForm(prisma, event.id, b.formSchema);
    if (b.page) await setEventPage(prisma, event.id, b.page);
    if (b.budget) {
      await prisma.budgetPlan.create({
        data: { eventId: event.id, input: JSON.stringify(b.budget), result: JSON.stringify(calcBudget(b.budget)) },
      });
    }
    return { eventId: event.id, ticketTypeId: ticketType.id, quotaId: quota.id, organizerId };
  });

  // 活动可售情况
  app.get<{ Params: { id: string } }>("/api/events/:id/availability", async (req) => {
    const quotas = await prisma.quota.findMany({ where: { eventId: req.params.id } });
    const now = new Date();
    const rows = [];
    for (const q of quotas) {
      const agg = await prisma.order.aggregate({ where: { quotaId: q.id, lifecycle: "reserved", reservedUntil: { gt: now } }, _sum: { seats: true } });
      const reservedActive = agg._sum.seats ?? 0;
      rows.push({
        quotaId: q.id,
        name: q.name,
        capacity: q.capacity,
        used: q.used,
        reservedActive,
        available: quotaAvailable({ capacity: q.capacity, used: q.used, reservedActive }),
      });
    }
    return { quotas: rows };
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/quotas", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "events:read", eventId: req.params.id });
    return listEventQuotas(prisma, req.params.id);
  });

  app.post<{ Params: { id: string }; Body: QuotaUpdateInput }>("/api/quotas/:id/update", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "events:write", quotaId: req.params.id });
    return updateQuota(prisma, req.params.id, req.body ?? {});
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/exports", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "exports:read", eventId: req.params.id });
    return listEventExporters(prisma, req.params.id);
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/exports/registrations.csv", async (req, reply) => {
    await requireBackofficeAccess(prisma, req, { permission: "exports:read", eventId: req.params.id });
    return sendCsv(reply, await eventRegistrationsCsv(prisma, req.params.id));
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/exports/registrations.xls", async (req, reply) => {
    await requireBackofficeAccess(prisma, req, { permission: "exports:read", eventId: req.params.id });
    return sendExcel(reply, await eventRegistrationsExcel(prisma, req.params.id));
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/exports/registrations.pdf", async (req, reply) => {
    await requireBackofficeAccess(prisma, req, { permission: "exports:read", eventId: req.params.id });
    return sendPdf(reply, await eventRegistrationsPdf(prisma, req.params.id));
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/exports/waitlist.csv", async (req, reply) => {
    await requireBackofficeAccess(prisma, req, { permission: "exports:read", eventId: req.params.id });
    return sendCsv(reply, await eventWaitlistCsv(prisma, req.params.id));
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/exports/feedback.csv", async (req, reply) => {
    await requireBackofficeAccess(prisma, req, { permission: "exports:read", eventId: req.params.id });
    return sendCsv(reply, await eventFeedbackCsv(prisma, req.params.id));
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/exports/resources.csv", async (req, reply) => {
    await requireBackofficeAccess(prisma, req, { permission: "exports:read", eventId: req.params.id });
    return sendCsv(reply, await eventResourcesCsv(prisma, req.params.id));
  });

  // 平台管理员：列出全部主办方（含活动/成员计数）+ 白名单审核
  app.get("/api/admin/organizers", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:read" });
    return listOrganizers(prisma);
  });

  app.post<{ Params: { id: string }; Body: { whitelisted?: boolean } }>("/api/organizers/:id/whitelist", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:write", organizerId: req.params.id });
    return setOrganizerWhitelist(prisma, req.params.id, req.body?.whitelisted === true);
  });

  app.get("/api/admin/overview", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:read" });
    return getPlatformOverview(prisma);
  });

  app.get("/api/admin/events", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:read" });
    return listPlatformEvents(prisma);
  });

  app.post<{ Body: { name?: string; whitelisted?: boolean } }>("/api/admin/organizers", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:write" });
    return createOrganizer(prisma, req.body ?? {});
  });

  app.get<{ Params: { id: string } }>("/api/admin/organizers/:id", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:read" });
    return getOrganizerDetail(prisma, req.params.id);
  });

  app.put<{ Params: { id: string }; Body: HostProfileInput }>("/api/organizers/:id/host-profile", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:write", organizerId: req.params.id });
    return upsertHostProfile(prisma, req.params.id, req.body ?? {});
  });

  app.get<{ Params: { id: string } }>("/api/organizers/:id/team-members", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:read", organizerId: req.params.id });
    return listOrganizerMembers(prisma, req.params.id);
  });

  app.post<{ Params: { id: string }; Body: OrganizerMemberInput }>("/api/organizers/:id/team-members", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:write", organizerId: req.params.id });
    return createOrganizerMember(prisma, req.params.id, req.body ?? {});
  });

  app.post<{ Params: { id: string }; Body: OrganizerInvitationInput }>("/api/organizers/:id/team-invitations", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:write", organizerId: req.params.id });
    return createOrganizerInvitation(prisma, req.params.id, req.body ?? {});
  });

  app.post<{ Body: OrganizerInvitationAcceptInput }>("/api/team-invitations/accept", async (req) => {
    return acceptOrganizerInvitation(prisma, req.body ?? {});
  });

  app.post<{ Params: { id: string }; Body: OrganizerMemberInput }>("/api/team-members/:id/update", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "team:write", memberId: req.params.id });
    return updateOrganizerMember(prisma, req.params.id, req.body ?? {});
  });

  // 活动列表（已发布，最新在前）
  app.get("/api/events", async () => {
    const events = await prisma.event.findMany({
      where: { status: "published" },
      orderBy: { createdAt: "desc" },
      include: { ticketTypes: true, organizer: true },
    });
    return {
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        city: e.city,
        venue: e.venue,
        startAt: e.startAt,
        organizerId: e.organizerId,
        organizer: e.organizer.name,
        minPriceCents: e.ticketTypes.length ? Math.min(...e.ticketTypes.map((t) => t.priceCents)) : 0,
      })),
    };
  });

  // 活动详情：event + 票种 + 报名表 schema + 可售
  app.get<{ Params: { id: string } }>("/api/events/:id", async (req, reply) => {
    const e = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { ticketTypes: true, organizer: { include: { hostProfile: true } }, page: true, forms: { orderBy: { id: "desc" }, take: 1 } },
    });
    if (!e) return reply.status(404).send({ error: "not_found" });

    const formSchema = e.forms[0] ? JSON.parse(e.forms[0].schema) : { fields: [] };
    const quotas = await prisma.quota.findMany({ where: { eventId: e.id } });
    const now = new Date();
    const availability: Record<string, number | null> = {};
    for (const q of quotas) {
      const agg = await prisma.order.aggregate({ where: { quotaId: q.id, lifecycle: "reserved", reservedUntil: { gt: now } }, _sum: { seats: true } });
      availability[q.id] = quotaAvailable({ capacity: q.capacity, used: q.used, reservedActive: agg._sum.seats ?? 0 });
    }
    return {
      event: {
        id: e.id, title: e.title, city: e.city, venue: e.venue, startAt: e.startAt,
        organizerId: e.organizerId, organizer: e.organizer.name,
        hostProfile: e.organizer.hostProfile
          ? { bio: e.organizer.hostProfile.bio, avatarUrl: e.organizer.hostProfile.avatarUrl, links: parseJSON<unknown>(e.organizer.hostProfile.links, null) }
          : null,
      },
      page: e.page ? {
        template: e.page.template,
        highlights: parseJSON<string[]>(e.page.highlights, []),
        agenda: parseJSON<string[]>(e.page.agenda, []),
        faq: parseJSON<{ q: string; a: string }[]>(e.page.faq, []),
      } : null,
      ticketTypes: e.ticketTypes.map((t) => ({ id: t.id, name: t.name, kind: t.kind, priceCents: t.priceCents })),
      formSchema,
      availability,
    };
  });

  // 报名列表（现场签到/名单用）
  app.get<{ Params: { id: string } }>("/api/events/:id/registrations", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "registrations:read", eventId: req.params.id });
    const regs = await prisma.registration.findMany({
      where: { eventId: req.params.id },
      orderBy: { createdAt: "desc" },
      include: { ticketType: true, order: true, waitlistEntry: true },
    });
    return {
      registrations: regs.map((r) => ({
        id: r.id,
        status: r.status,
        formValues: JSON.parse(r.formValues || "{}"),
        ticketName: r.ticketType.name,
        ticketKind: r.ticketType.kind,
        orderId: r.order?.id ?? null,
        orderAmountCents: r.order?.amountCents ?? null,
        orderLifecycle: r.order?.lifecycle ?? null,
        paymentStatus: r.order?.payment_status ?? null,
        refundStatus: r.order?.refund_status ?? null,
        refundedAmountCents: r.order?.refundedAmountCents ?? 0,
        checkinToken: r.checkinToken,
        checkinPayload: buildCheckinPayload(r.eventId, r.id, r.checkinToken),
        waitlistPosition: r.waitlistEntry?.position ?? null,
        waitlistStatus: r.waitlistEntry?.status ?? null,
        waitlistOfferExpiresAt: r.waitlistEntry?.offerExpiresAt ?? null,
        tag: r.tag ?? null,
        createdAt: r.createdAt,
      })),
    };
  });

  // 主办方更新报名表 schema（可配置报名表构建器落库）
  app.put<{ Params: { id: string }; Body: { schema: RegistrationFormSchema } }>("/api/events/:id/form", async (req, reply) => {
    await requireBackofficeAccess(prisma, req, { permission: "events:write", eventId: req.params.id });
    const schema = req.body?.schema;
    const check = validateFormSchema(schema);
    if (!check.ok) return reply.status(400).send({ error: "invalid_schema", errors: check.errors });
    await setEventForm(prisma, req.params.id, schema);
    return { ok: true, schema };
  });

  // C 端「我的活动 / 票夹」
  app.get<{ Params: { id: string } }>("/api/users/:id/registrations", async (req) => {
    return { items: await listUserRegistrations(prisma, req.params.id) };
  });

  app.post<{ Params: { userId: string; registrationId: string } }>("/api/users/:userId/registrations/:registrationId/cancel", async (req) => {
    const result = await cancelRegistration(prisma, req.params.registrationId, req.params.userId);
    return { ok: true, ...result };
  });

  // 报名增长看板：计数 + 可售 + 保本进度 + 盈亏 verdict
  app.get<{ Params: { id: string } }>("/api/events/:id/dashboard", async (req) => {
    const eventId = req.params.id;
    const regs = await prisma.registration.findMany({ where: { eventId }, select: { status: true } });
    const counts: Record<string, number> = {};
    for (const r of regs) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const confirmed = (counts["approved"] ?? 0) + (counts["checked_in"] ?? 0);

    const quotas = await prisma.quota.findMany({ where: { eventId } });
    let capacity: number | null = null;
    let used = 0;
    for (const q of quotas) {
      used += q.used;
      if (q.capacity !== null) capacity = (capacity ?? 0) + q.capacity;
    }

    const plan = await prisma.budgetPlan.findUnique({ where: { eventId } });
    const budgetResult = plan ? JSON.parse(plan.result) : null;
    const breakEven = budgetResult?.breakEvenAttendees ?? null;

    return {
      counts,
      totalRegistrations: regs.length,
      confirmed,
      capacity,
      used,
      breakEven,
      breakEvenProgress: breakEven ? Math.min(1, confirmed / breakEven) : null,
      budget: budgetResult,
    };
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/review", async (req, reply) => {
    const review = await getEventReview(prisma, req.params.id);
    if (!review) return reply.status(404).send({ error: "not_found" });
    return review;
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/attribution/funnel", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "events:read", eventId: req.params.id });
    return summarizeAttributionFunnel(prisma, req.params.id);
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/api/events/:id/feedback", async (req) => {
    const limit = Number(req.query.limit);
    return listEventFeedback(prisma, req.params.id, Number.isFinite(limit) ? limit : 20);
  });

  app.post<{ Params: { id: string }; Body: EventFeedbackInput }>("/api/events/:id/feedback", async (req) => {
    const feedback = await submitEventFeedback(prisma, req.params.id, req.body ?? {});
    return { ok: true, feedback };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/api/events/:id/resources", async (req) => {
    const limit = Number(req.query.limit);
    return listEventResources(prisma, req.params.id, Number.isFinite(limit) ? limit : 20);
  });

  app.post<{ Params: { id: string }; Body: EventResourceInput }>("/api/events/:id/resources", async (req) => {
    const resource = await createEventResource(prisma, req.params.id, req.body ?? {});
    return { ok: true, resource };
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/social", async (req) => {
    return getEventSocial(prisma, req.params.id);
  });

  // C 端：主办方公开主页（资料 + 已发布活动）
  app.get<{ Params: { id: string } }>("/api/organizers/:id/public", async (req) => {
    return getOrganizerPublic(prisma, req.params.id);
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/social-profiles", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "events:read", eventId: req.params.id });
    return listEventSocialProfiles(prisma, req.params.id);
  });

  app.post<{ Params: { id: string }; Body: EventSocialProfileInput }>("/api/events/:id/social-profiles", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "events:write", eventId: req.params.id });
    return createEventSocialProfile(prisma, req.params.id, req.body ?? {});
  });

  app.post<{ Params: { id: string }; Body: InterestSubscriptionInput }>("/api/users/:id/interest-subscriptions", async (req) => {
    return subscribeUserInterest(prisma, req.params.id, req.body ?? {});
  });

  app.get<{ Params: { id: string } }>("/api/users/:id/interest-feed", async (req) => {
    return getUserInterestFeed(prisma, req.params.id);
  });

  app.get<{ Querystring: { q?: string; city?: string; tag?: string; limit?: string } }>("/api/discovery/people", async (req) => {
    const limit = Number(req.query.limit);
    return discoverPeople(prisma, {
      q: req.query.q,
      city: req.query.city,
      tag: req.query.tag,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  });

  app.get<{ Params: { id: string } }>("/api/events/:id/agent-tasks", async (req, reply) => {
    const result = await refreshEventAgentTasks(prisma, req.params.id);
    if (!result) return reply.status(404).send({ error: "not_found" });
    return result;
  });

  app.post<{ Params: { id: string } }>("/api/events/:id/agent-tasks/refresh", async (req, reply) => {
    const result = await refreshEventAgentTasks(prisma, req.params.id);
    if (!result) return reply.status(404).send({ error: "not_found" });
    return result;
  });

  app.post<{ Params: { id: string }; Body: { status?: string } }>("/api/agent-tasks/:id/status", async (req, reply) => {
    const status = req.body?.status;
    if (!status || !isAgentTaskStatus(status)) return reply.status(400).send({ error: "invalid_status" });
    const task = await updateAgentTaskStatus(prisma, req.params.id, status);
    if (!task) return reply.status(404).send({ error: "not_found" });
    return { task };
  });

  // 报名闭环
  app.post<{ Body: { eventId: string; ticketTypeId: string; userId?: string; formValues: FormValues; seats?: number; inviteCode?: string } }>(
    "/api/register",
    async (req, reply) => {
      const b = req.body;
      const user = await upsertUser(prisma, b.userId ?? "u_" + Date.now().toString(36));
      let result;
      try {
        result = await reserve(prisma, { eventId: b.eventId, ticketTypeId: b.ticketTypeId, userId: user.id, formValues: b.formValues, seats: b.seats, inviteCode: b.inviteCode });
      } catch (err) {
        if (err instanceof InviteCodeError) return reply.status(400).send({ error: "invalid_invite_code", message: err.message });
        throw err;
      }
      await recordAttributionEvent(prisma, {
        type: "registration_reserved",
        eventId: b.eventId,
        registrationId: result.registrationId,
        userId: user.id,
        attribution: b.formValues,
        metadata: {
          ticketTypeId: b.ticketTypeId,
          status: result.status,
          waitlisted: Boolean(result.waitlist),
        },
      }).catch((err) => app.log.warn({ err }, "failed to record attribution event"));
      return result;
    }
  );

  app.get("/api/payments/providers", async () => {
    const provider = activePaymentProvider();
    return {
      active: provider.identifier,
      providers: paymentProviderStatuses(),
    };
  });
  app.post<{ Params: { id: string } }>("/api/orders/:id/payment/prepare", async (req) => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: req.params.id } });
    return activePaymentProvider().prepare(prisma, order);
  });
  app.get<{ Params: { id: string } }>("/api/orders/:id/payment/status", async (req) => {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { registration: true, payment: true },
    });
    return {
      orderId: order.id,
      lifecycle: order.lifecycle,
      paymentStatus: order.payment_status,
      refundStatus: order.refund_status,
      registrationStatus: order.registration.status,
      provider: order.payment?.provider ?? null,
      paidAt: order.payment?.paidAt ?? null,
    };
  });
  app.post<{ Params: { id: string }; Body: { providerPayload?: unknown } }>("/api/orders/:id/complete", async (req) => {
    return complete(prisma, req.params.id, { provider: activePaymentProvider(), providerPayload: req.body?.providerPayload });
  });
  app.post("/api/payments/wechatpay/notify", async (req) => {
    return activePaymentProvider().webhook(prisma, {
      headers: req.headers,
      rawBody: (req as unknown as { rawBody?: string }).rawBody,
      body: req.body,
    });
  });
  app.post<{ Params: { id: string } }>("/api/orders/:id/cancel", async (req) => {
    await cancel(prisma, req.params.id);
    return { ok: true };
  });

  // 票种管理（主办方）：读列表 / 加票种 / 改票种 / 停售
  app.get<{ Params: { id: string } }>("/api/events/:id/ticket-types", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "events:read", eventId: req.params.id });
    return { ticketTypes: await listTicketTypes(prisma, req.params.id) };
  });
  app.post<{ Params: { id: string }; Body: TicketTypeBody }>(
    "/api/events/:id/ticket-types",
    async (req, reply) => {
      await requireBackofficeAccess(prisma, req, { permission: "events:write", eventId: req.params.id });
      const b = req.body;
      if (!b?.name?.trim()) return reply.status(400).send({ error: "invalid_name", message: "票种名称不能为空" });
      const { ticketType, quota } = await createTicketTypeWithQuota(prisma, {
        eventId: req.params.id, name: b.name, kind: b.kind ?? "paid", priceCents: b.priceCents ?? 0, capacity: b.capacity ?? null,
        earlyBirdPriceCents: b.earlyBirdPriceCents ?? null,
        earlyBirdUntil: parseDate(b.earlyBirdUntil),
        inviteCode: b.inviteCode ?? null,
      });
      return { ticketTypeId: ticketType.id, quotaId: quota.id };
    },
  );
  app.post<{ Params: { id: string }; Body: TicketTypeBody }>(
    "/api/ticket-types/:id/update",
    async (req) => {
      const eventId = await ticketTypeEventId(prisma, req.params.id);
      await requireBackofficeAccess(prisma, req, { permission: "events:write", eventId });
      const b = req.body ?? {};
      const ticket = await updateTicketType(prisma, req.params.id, {
        name: b.name, kind: b.kind, priceCents: b.priceCents, capacity: b.capacity,
        earlyBirdPriceCents: b.earlyBirdPriceCents,
        earlyBirdUntil: b.earlyBirdUntil === undefined ? undefined : parseDate(b.earlyBirdUntil),
        inviteCode: b.inviteCode,
      });
      return { ticketType: { id: ticket.id, name: ticket.name, kind: ticket.kind, priceCents: ticket.priceCents, status: ticket.status } };
    },
  );
  app.post<{ Params: { id: string }; Body: { status?: "active" | "archived" } }>(
    "/api/ticket-types/:id/archive",
    async (req) => {
      const eventId = await ticketTypeEventId(prisma, req.params.id);
      await requireBackofficeAccess(prisma, req, { permission: "events:write", eventId });
      const ticket = await setTicketTypeStatus(prisma, req.params.id, req.body?.status ?? "archived");
      return { ticketType: { id: ticket.id, status: ticket.status } };
    },
  );

  // 手动退款（主办方）
  app.post<{ Params: { id: string }; Body: { amountCents?: number; reason?: string } }>(
    "/api/orders/:id/refund",
    async (req, reply) => {
      const order = await prisma.order.findUnique({ where: { id: req.params.id }, select: { registrationId: true } });
      if (!order) return reply.status(404).send({ error: "order_not_found" });
      await requireRegistrationBackofficeAccess(req, order.registrationId, "events:write");
      try {
        return await refundOrder(prisma, req.params.id, req.body ?? {});
      } catch (err) {
        if (err instanceof RefundError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
        throw err;
      }
    },
  );
  // 现场重点标记落库（guest/vip/staff）
  app.post<{ Params: { id: string }; Body: { tag?: string | null } }>("/api/registrations/:id/tag", async (req) => {
    await requireRegistrationBackofficeAccess(req, req.params.id, "checkin:write");
    const reg = await setRegistrationTag(prisma, req.params.id, req.body?.tag ?? null);
    return { registration: { id: reg.id, tag: reg.tag } };
  });
  app.post<{ Params: { id: string } }>("/api/registrations/:id/checkin", async (req) => {
    await requireRegistrationBackofficeAccess(req, req.params.id, "checkin:write");
    return checkin(prisma, req.params.id);
  });
  app.post<{ Body: CheckinScanInput }>("/api/checkin/scan", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "checkin:write" });
    const payload = resolveCheckinPayload(req.body ?? {});
    await requireBackofficeAccess(prisma, req, { permission: "checkin:write", eventId: payload.eventId });
    return checkinByToken(prisma, req.body ?? {});
  });
  app.post<{ Params: { id: string } }>("/api/registrations/:id/approve", async (req) => {
    await requireRegistrationBackofficeAccess(req, req.params.id, "registrations:write");
    return approveRegistration(prisma, req.params.id);
  });
  app.post<{ Params: { id: string } }>("/api/registrations/:id/promote", async (req) => {
    await requireRegistrationBackofficeAccess(req, req.params.id, "registrations:write");
    return promoteWaitlistRegistration(prisma, req.params.id);
  });
  app.post<{ Params: { id: string } }>("/api/registrations/:id/reject", async (req) => {
    await requireRegistrationBackofficeAccess(req, req.params.id, "registrations:write");
    return { registration: await rejectRegistration(prisma, req.params.id) };
  });
  app.post("/api/admin/sweep-expired", async () => ({ swept: await sweepExpired(prisma) }));
  app.post("/api/admin/send-event-reminders", async () => sendDueEventReminders(prisma));
  app.post("/api/admin/sync-topic-signals", async () => syncTopicSignalsFromFeeds(prisma));
  app.get("/api/admin/topic-signal-feeds/status", async (req) => {
    await requireBackofficeAccess(prisma, req, { permission: "events:read" });
    return topicSignalFeedStatus();
  });
  app.post<{ Body: { raw?: string; feeds?: TopicSignalFeedConfig[]; sampleSize?: number } }>(
    "/api/admin/topic-signal-feeds/preview",
    async (req) => {
      await requireBackofficeAccess(prisma, req, { permission: "events:read" });
      return previewTopicSignalFeeds({
        raw: req.body?.raw,
        feeds: req.body?.feeds,
        sampleSize: req.body?.sampleSize,
      });
    }
  );

  // AI 生成（接 MiMo）
  app.get("/api/ai/status", async () => ({ configured: llmConfigured() }));
  app.get<{
    Querystring: { industry?: string; city?: string; audience?: string; format?: string; source?: string; limit?: string };
  }>("/api/topic-radar/signals", async (req) => {
    const limit = Number(req.query.limit);
    return listTopicSignalsFromDb(prisma, {
      industry: req.query.industry,
      city: req.query.city,
      audience: req.query.audience,
      format: req.query.format,
      source: req.query.source,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  });
  app.post<{ Body: TopicSignalInput }>("/api/topic-radar/signals", async (req) => createTopicSignal(prisma, req.body ?? {}));
  app.post<{ Body: TopicRadarInput }>("/api/topic-radar/suggestions", async (req) => ({
    suggestions: await suggestTopicsFromDb(prisma, req.body ?? {}),
  }));
  app.post<{ Body: EventPageInput }>("/api/ai/event-page", async (req) => generateEventPage(req.body));
  app.post<{ Body: MaterialsInput }>("/api/ai/materials", async (req) => generateMaterials(req.body));

  return app;
}

interface TicketTypeBody {
  name?: string;
  kind?: TicketKind;
  priceCents?: number;
  capacity?: number | null;
  earlyBirdPriceCents?: number | null;
  earlyBirdUntil?: string | null;
  inviteCode?: string | null;
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
