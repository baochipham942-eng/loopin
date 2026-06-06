import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  calcBudget,
  compareScenarios,
  suggestPrice,
  validateForm,
  quotaAvailable,
  OversellError,
  type BudgetInput,
  type RegistrationFormSchema,
  type FormValues,
  type TicketKind,
} from "@loopin/core";
import { prisma } from "./db.js";
import { createEvent, createTicketTypeWithQuota, setEventForm, upsertUser } from "./services/catalog.js";
import { reserve, complete, cancel, checkin, sweepExpired, SoldOutError } from "./services/registration.js";
import { generateEventPage, generateMaterials, type EventPageInput, type MaterialsInput } from "./services/ai.js";
import { llmConfigured } from "./llm.js";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // 领域错误 -> HTTP 状态
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof SoldOutError) return reply.status(409).send({ error: "sold_out", message: err.message });
    if (err instanceof OversellError) return reply.status(409).send({ error: "oversell", message: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: "internal", message: (err as Error).message });
  });

  app.get("/api/health", async () => ({ ok: true, service: "loopin-api", ts: Date.now() }));

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
        organizer: e.organizer.name,
        minPriceCents: e.ticketTypes.length ? Math.min(...e.ticketTypes.map((t) => t.priceCents)) : 0,
      })),
    };
  });

  // 活动详情：event + 票种 + 报名表 schema + 可售
  app.get<{ Params: { id: string } }>("/api/events/:id", async (req, reply) => {
    const e = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { ticketTypes: true, organizer: true, forms: { orderBy: { id: "desc" }, take: 1 } },
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
      event: { id: e.id, title: e.title, city: e.city, venue: e.venue, startAt: e.startAt, organizer: e.organizer.name },
      ticketTypes: e.ticketTypes.map((t) => ({ id: t.id, name: t.name, kind: t.kind, priceCents: t.priceCents })),
      formSchema,
      availability,
    };
  });

  // 报名列表（现场签到/名单用）
  app.get<{ Params: { id: string } }>("/api/events/:id/registrations", async (req) => {
    const regs = await prisma.registration.findMany({
      where: { eventId: req.params.id },
      orderBy: { createdAt: "desc" },
      include: { ticketType: true, order: true },
    });
    return {
      registrations: regs.map((r) => ({
        id: r.id,
        status: r.status,
        formValues: JSON.parse(r.formValues || "{}"),
        ticketName: r.ticketType.name,
        orderLifecycle: r.order?.lifecycle ?? null,
        createdAt: r.createdAt,
      })),
    };
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

  // 报名闭环
  app.post<{ Body: { eventId: string; ticketTypeId: string; userId?: string; formValues: FormValues; seats?: number } }>(
    "/api/register",
    async (req) => {
      const b = req.body;
      const userId = b.userId ?? (await upsertUser(prisma, "u_" + Date.now().toString(36))).id;
      return reserve(prisma, { eventId: b.eventId, ticketTypeId: b.ticketTypeId, userId, formValues: b.formValues, seats: b.seats });
    }
  );

  app.post<{ Params: { id: string } }>("/api/orders/:id/complete", async (req) => complete(prisma, req.params.id));
  app.post<{ Params: { id: string } }>("/api/orders/:id/cancel", async (req) => {
    await cancel(prisma, req.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/api/registrations/:id/checkin", async (req) => checkin(prisma, req.params.id));
  app.post("/api/admin/sweep-expired", async () => ({ swept: await sweepExpired(prisma) }));

  // AI 生成（接 MiMo）
  app.get("/api/ai/status", async () => ({ configured: llmConfigured() }));
  app.post<{ Body: EventPageInput }>("/api/ai/event-page", async (req) => generateEventPage(req.body));
  app.post<{ Body: MaterialsInput }>("/api/ai/materials", async (req) => generateMaterials(req.body));

  return app;
}
