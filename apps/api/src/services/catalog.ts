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
      quotas: { create: [{ quotaId: quota.id }] },
    },
  });
  return { ticketType, quota };
}

export async function setEventForm(db: PrismaClient, eventId: string, schema: RegistrationFormSchema) {
  return db.registrationForm.create({
    data: { eventId, schema: JSON.stringify(schema) },
  });
}

export async function upsertUser(db: PrismaClient, id: string, data: { phone?: string; nickname?: string } = {}) {
  return db.user.upsert({ where: { id }, create: { id, ...data }, update: data });
}
