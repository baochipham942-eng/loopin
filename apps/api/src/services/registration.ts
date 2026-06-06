import type { PrismaClient } from "@prisma/client";
import {
  nextOrderLifecycle,
  nextPaymentStatus,
  nextRegistrationStatus,
  reservationDeadline,
  OversellError,
  DEFAULT_RESERVATION_MINUTES,
  type FormValues,
} from "@loopin/core";

/** 报名闭环服务：reserve → complete → checkin，cancel/sweepExpired。
 *  库存正确性靠「可售=容量−已售−未过期预留」+ complete 时 DB 条件原子更新（守住 Hi.Events 超卖坑）。 */

export class SoldOutError extends Error {
  constructor(public quotaId: string) {
    super(`配额 ${quotaId} 已售罄/名额不足`);
    this.name = "SoldOutError";
  }
}

/** 解析票种绑定的配额池（MVP 取第一个；多对多支持多个，后续可扩展按 subevent 选） */
async function resolveQuotaId(db: PrismaClient, ticketTypeId: string): Promise<string | null> {
  const link = await db.ticketTypeQuota.findFirst({ where: { ticketTypeId } });
  return link?.quotaId ?? null;
}

/** 当前未过期预留占用的名额数 */
async function liveReserved(db: PrismaClient, quotaId: string, now: Date): Promise<number> {
  const agg = await db.order.aggregate({
    where: { quotaId, lifecycle: "reserved", reservedUntil: { gt: now } },
    _sum: { seats: true },
  });
  return agg._sum.seats ?? 0;
}

export interface ReserveInput {
  eventId: string;
  ticketTypeId: string;
  userId: string;
  formValues: FormValues;
  seats?: number;
  now?: Date;
}

/** 预留：软占库存（可售校验），建 reserved 订单 + reservedUntil。真正硬扣在 complete。 */
export async function reserve(db: PrismaClient, input: ReserveInput) {
  const seats = input.seats ?? 1;
  const now = input.now ?? new Date();

  const ticketType = await db.ticketType.findUniqueOrThrow({ where: { id: input.ticketTypeId } });
  const quotaId = await resolveQuotaId(db, input.ticketTypeId);

  if (quotaId) {
    const quota = await db.quota.findUniqueOrThrow({ where: { id: quotaId } });
    if (quota.capacity !== null) {
      const reserved = await liveReserved(db, quotaId, now);
      if (quota.used + reserved + seats > quota.capacity) {
        throw new SoldOutError(quotaId);
      }
    }
  }

  const registration = await db.registration.create({
    data: {
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      userId: input.userId,
      status: "submitted",
      formValues: JSON.stringify(input.formValues),
    },
  });

  const reservedUntil = new Date(reservationDeadline(now.getTime(), DEFAULT_RESERVATION_MINUTES));
  const order = await db.order.create({
    data: {
      registrationId: registration.id,
      amountCents: ticketType.priceCents * seats,
      seats,
      quotaId,
      lifecycle: "reserved",
      payment_status: "unpaid",
      reservedUntil,
      pointInTimeData: JSON.stringify({ ticketPriceCents: ticketType.priceCents, seats }),
      mock: true,
    },
  });

  return { orderId: order.id, registrationId: registration.id, reservedUntil };
}

/**
 * 成交：付款（mock）确认后调用。
 * 硬扣库存用条件原子更新：UPDATE ... WHERE capacity IS NULL OR used+seats<=capacity。
 * 受影响行数 0 = 名额被别人抢光 → OversellError（这正是 Hi.Events 没做、导致线上超卖的守门）。
 */
export async function complete(db: PrismaClient, orderId: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });

  if (order.quotaId) {
    const affected = await db.$executeRaw`
      UPDATE "Quota" SET "used" = "used" + ${order.seats}
      WHERE "id" = ${order.quotaId}
        AND ("capacity" IS NULL OR "used" + ${order.seats} <= "capacity")`;
    if (affected === 0) {
      const quota = await db.quota.findUnique({ where: { id: order.quotaId } });
      throw new OversellError(quota?.capacity ?? 0, (quota?.used ?? 0) + order.seats);
    }
  }

  const updatedOrder = await db.order.update({
    where: { id: orderId },
    data: {
      lifecycle: nextOrderLifecycle(order.lifecycle as any, "complete"),
      payment_status: nextPaymentStatus(order.payment_status as any, "pay"),
    },
  });
  const reg = await db.registration.findUniqueOrThrow({ where: { id: order.registrationId } });
  const updatedReg = await db.registration.update({
    where: { id: reg.id },
    data: { status: nextRegistrationStatus(reg.status as any, "approve") },
  });

  return { order: updatedOrder, registration: updatedReg };
}

/** 取消：reserved/completed → cancelled；若已成交则原子回滚库存。 */
export async function cancel(db: PrismaClient, orderId: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const wasCompleted = order.lifecycle === "completed";

  if (wasCompleted && order.quotaId) {
    await db.$transaction(async (tx) => {
      const affected = await tx.quota.updateMany({
        where: { id: order.quotaId ?? undefined, used: { gte: order.seats } },
        data: { used: { decrement: order.seats } },
      });
      if (affected.count === 0) {
        await tx.quota.update({ where: { id: order.quotaId ?? undefined }, data: { used: 0 } });
      }
    });
  }

  await db.order.update({
    where: { id: orderId },
    data: { lifecycle: nextOrderLifecycle(order.lifecycle as any, "cancel") },
  });
  const reg = await db.registration.findUniqueOrThrow({ where: { id: order.registrationId } });
  if (reg.status !== "cancelled") {
    await db.registration.update({ where: { id: reg.id }, data: { status: "cancelled" } });
  }
}

/** 签到：approved → checked_in。 */
export async function checkin(db: PrismaClient, registrationId: string) {
  const reg = await db.registration.findUniqueOrThrow({ where: { id: registrationId } });
  return db.registration.update({
    where: { id: registrationId },
    data: { status: nextRegistrationStatus(reg.status as any, "checkIn") },
  });
}

/** 兜底回收：把超时未成交的 reserved 单置 abandoned（释放预留占用）。返回回收数。 */
export async function sweepExpired(db: PrismaClient, now: Date = new Date()): Promise<number> {
  const expired = await db.order.findMany({
    where: { lifecycle: "reserved", reservedUntil: { lt: now } },
    select: { id: true, registrationId: true },
  });
  for (const o of expired) {
    await db.order.update({ where: { id: o.id }, data: { lifecycle: "abandoned" } });
    await db.registration.update({ where: { id: o.registrationId }, data: { status: "cancelled" } });
  }
  return expired.length;
}
