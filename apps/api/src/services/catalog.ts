import type { PrismaClient } from "@prisma/client";
import type { RegistrationFormSchema, TicketKind } from "@loopin/core";

/** 建活动目录：活动 + 票种 + 配额池（票种↔配额多对多）。 */

export async function createEvent(
  db: PrismaClient,
  input: { organizerId: string; title: string; city: string; startAt: Date; venue?: string }
) {
  return db.event.create({
    data: {
      organizerId: input.organizerId,
      title: input.title,
      city: input.city,
      startAt: input.startAt,
      venue: input.venue,
      status: "published",
    },
  });
}

/** 建票种并绑定一个配额池（capacity=null 不限量）。返回 {ticketType, quota}。 */
export async function createTicketTypeWithQuota(
  db: PrismaClient,
  input: {
    eventId: string;
    name: string;
    kind: TicketKind;
    priceCents: number;
    capacity: number | null;
    quotaName?: string;
    earlyBirdPriceCents?: number | null;
    earlyBirdUntil?: Date | null;
    inviteCode?: string | null;
  }
) {
  const quota = await db.quota.create({
    data: { eventId: input.eventId, name: input.quotaName ?? `${input.name}名额`, capacity: input.capacity },
  });
  const ticketType = await db.ticketType.create({
    data: {
      eventId: input.eventId,
      name: input.name,
      kind: input.kind,
      priceCents: input.priceCents,
      earlyBirdPriceCents: input.earlyBirdPriceCents ?? null,
      earlyBirdUntil: input.earlyBirdUntil ?? null,
      inviteCode: input.inviteCode || null,
      quotas: { create: [{ quotaId: quota.id }] },
    },
  });
  return { ticketType, quota };
}

/** 票种列表（带绑定配额的容量/已售），供主办方票种管理读取。 */
export async function listTicketTypes(db: PrismaClient, eventId: string) {
  const tickets = await db.ticketType.findMany({
    where: { eventId },
    include: { quotas: { include: { quota: true } } },
    orderBy: [{ status: "asc" }, { priceCents: "asc" }],
  });
  return tickets.map((t) => {
    const quota = t.quotas[0]?.quota ?? null;
    return {
      id: t.id, name: t.name, kind: t.kind, priceCents: t.priceCents, status: t.status,
      earlyBirdPriceCents: t.earlyBirdPriceCents, earlyBirdUntil: t.earlyBirdUntil, inviteCode: t.inviteCode,
      capacity: quota?.capacity ?? null, used: quota?.used ?? 0, quotaId: quota?.id ?? null,
    };
  });
}

/** 改票种（名称/类型/价格/容量）。容量落在绑定的配额池上。 */
export async function updateTicketType(
  db: PrismaClient,
  id: string,
  input: {
    name?: string; kind?: TicketKind; priceCents?: number; capacity?: number | null;
    earlyBirdPriceCents?: number | null; earlyBirdUntil?: Date | null; inviteCode?: string | null;
  },
) {
  const data: {
    name?: string; kind?: string; priceCents?: number;
    earlyBirdPriceCents?: number | null; earlyBirdUntil?: Date | null; inviteCode?: string | null;
  } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.kind !== undefined) data.kind = input.kind;
  if (input.priceCents !== undefined) data.priceCents = input.priceCents;
  if (input.earlyBirdPriceCents !== undefined) data.earlyBirdPriceCents = input.earlyBirdPriceCents;
  if (input.earlyBirdUntil !== undefined) data.earlyBirdUntil = input.earlyBirdUntil;
  if (input.inviteCode !== undefined) data.inviteCode = input.inviteCode || null;
  const ticket = await db.ticketType.update({
    where: { id }, data, include: { quotas: { include: { quota: true } } },
  });
  if (input.capacity !== undefined) {
    const quotaId = ticket.quotas[0]?.quotaId;
    if (quotaId) await db.quota.update({ where: { id: quotaId }, data: { capacity: input.capacity } });
  }
  return ticket;
}

/** 停售/恢复票种（不硬删，保历史订单）。 */
export async function setTicketTypeStatus(db: PrismaClient, id: string, status: "active" | "archived") {
  return db.ticketType.update({ where: { id }, data: { status } });
}

/** 票种归属的活动 id（路由鉴权用）。 */
export async function ticketTypeEventId(db: PrismaClient, id: string): Promise<string> {
  const t = await db.ticketType.findUniqueOrThrow({ where: { id }, select: { eventId: true } });
  return t.eventId;
}

export async function setEventForm(db: PrismaClient, eventId: string, schema: RegistrationFormSchema) {
  return db.registrationForm.create({
    data: { eventId, schema: JSON.stringify(schema) },
  });
}

export interface EventPagePayload {
  template?: string;
  highlights?: string[];
  agenda?: string[];
  faq?: { q: string; a: string }[];
}

function pageData(eventId: string, page: EventPagePayload) {
  return {
    eventId,
    template: page.template || "ai_designer",
    highlights: JSON.stringify(page.highlights || []),
    agenda: JSON.stringify(page.agenda || []),
    faq: JSON.stringify(page.faq || []),
  };
}

export async function setEventPage(db: PrismaClient, eventId: string, page: EventPagePayload) {
  const data = pageData(eventId, page);
  return db.eventPage.upsert({
    where: { eventId },
    create: data,
    update: {
      template: data.template,
      highlights: data.highlights,
      agenda: data.agenda,
      faq: data.faq,
    },
  });
}

export async function upsertUser(db: PrismaClient, id: string, data: { phone?: string; nickname?: string } = {}) {
  return db.user.upsert({ where: { id }, create: { id, ...data }, update: data });
}
