import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  nextOrderLifecycle,
  nextPaymentStatus,
  nextRegistrationStatus,
  reservationDeadline,
  effectiveTicketPriceCents,
  OversellError,
  DEFAULT_RESERVATION_MINUTES,
  type FormValues,
} from "@loopin/core";
import { mockPaymentProvider, type PaymentProvider } from "./payments.js";

/** 报名闭环服务：reserve → complete → checkin，cancel/sweepExpired。
 *  库存正确性靠「可售=容量−已售−未过期预留」+ complete 时 DB 条件原子更新（守住 Hi.Events 超卖坑）。 */

export class SoldOutError extends Error {
  constructor(public quotaId: string) {
    super(`配额 ${quotaId} 已售罄/名额不足`);
    this.name = "SoldOutError";
  }
}

export const DEFAULT_WAITLIST_OFFER_HOURS = 24;

export interface CheckinPayload {
  v: 1;
  type: "loopin.checkin";
  eventId: string;
  registrationId: string;
  token: string;
}

export interface CheckinScanInput {
  payload?: string;
  eventId?: string;
  registrationId?: string;
  token?: string;
  by?: string;
}

export class CheckinTokenError extends Error {
  statusCode = 400;
  code = "checkin_token_invalid";

  constructor(message = "签到码无效") {
    super(message);
    this.name = "CheckinTokenError";
  }
}

export class DuplicateCheckinError extends Error {
  statusCode = 409;
  code = "already_checked_in";

  constructor(public registrationId: string) {
    super("该报名已签到，不能重复核销");
    this.name = "DuplicateCheckinError";
  }
}

export class RegistrationCancelError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "RegistrationCancelError";
  }
}

export function buildCheckinPayload(eventId: string, registrationId: string, token: string | null | undefined): string | null {
  if (!token) return null;
  return JSON.stringify({ v: 1, type: "loopin.checkin", eventId, registrationId, token } satisfies CheckinPayload);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function payloadToFields(payload: string): Partial<CheckinPayload> {
  const trimmed = payload.trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      eventId: readString(parsed.eventId),
      registrationId: readString(parsed.registrationId),
      token: readString(parsed.token),
    };
  } catch {
    // 兼容 loopin://checkin?... 或 eventId=...&registrationId=...&token=...
  }

  let params: URLSearchParams | null = null;
  try {
    params = new URL(trimmed).searchParams;
  } catch {
    if (trimmed.includes("=")) params = new URLSearchParams(trimmed);
  }
  if (!params) return { token: trimmed };

  return {
    eventId: readString(params.get("eventId")),
    registrationId: readString(params.get("registrationId")),
    token: readString(params.get("token")),
  };
}

export function resolveCheckinPayload(input: CheckinScanInput): CheckinPayload {
  const fromPayload = input.payload ? payloadToFields(input.payload) : {};
  const eventId = readString(fromPayload.eventId) ?? readString(input.eventId);
  const registrationId = readString(fromPayload.registrationId) ?? readString(input.registrationId);
  const token = readString(fromPayload.token) ?? readString(input.token);

  if (!eventId || !registrationId || !token) throw new CheckinTokenError("签到码缺少活动、报名或 token 信息");
  return { v: 1, type: "loopin.checkin", eventId, registrationId, token };
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

async function nextWaitlistPosition(db: PrismaClient, eventId: string, quotaId: string | null): Promise<number> {
  const agg = await db.waitlistEntry.aggregate({
    where: { eventId, quotaId: quotaId ?? undefined },
    _max: { position: true },
  });
  return (agg._max.position ?? 0) + 1;
}

async function createWaitlistEntry(
  db: PrismaClient,
  input: ReserveInput,
  quotaId: string | null,
  ticketPriceCents: number,
  seats: number,
  now: Date
) {
  const registration = await db.registration.create({
    data: {
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      userId: input.userId,
      status: "waitlisted",
      formValues: JSON.stringify(input.formValues),
      checkinToken: randomUUID(),
    },
  });
  const position = await nextWaitlistPosition(db, input.eventId, quotaId);
  const offerExpiresAt = new Date(now.getTime() + DEFAULT_WAITLIST_OFFER_HOURS * 60 * 60 * 1000);
  const waitlistEntry = await db.waitlistEntry.create({
    data: {
      eventId: input.eventId,
      registrationId: registration.id,
      quotaId,
      position,
      offerToken: randomUUID(),
      offerExpiresAt,
      status: "waiting",
    },
  });

  return {
    orderId: null,
    registrationId: registration.id,
    reservedUntil: null,
    status: registration.status,
    requiresApproval: false,
    waitlist: {
      id: waitlistEntry.id,
      position: waitlistEntry.position,
      offerToken: waitlistEntry.offerToken,
      offerExpiresAt: waitlistEntry.offerExpiresAt,
      status: waitlistEntry.status,
      ticketPriceCents,
      seats,
    },
  };
}

export interface ReserveInput {
  eventId: string;
  ticketTypeId: string;
  userId: string;
  formValues: FormValues;
  seats?: number;
  inviteCode?: string;
  now?: Date;
}

export class InviteCodeError extends Error {
  constructor(message = "邀请码不正确") {
    super(message);
    this.name = "InviteCodeError";
  }
}

/** 预留：软占库存（可售校验），建 reserved 订单 + reservedUntil。真正硬扣在 complete。 */
export async function reserve(db: PrismaClient, input: ReserveInput) {
  const seats = input.seats ?? 1;
  const now = input.now ?? new Date();

  const ticketType = await db.ticketType.findUniqueOrThrow({ where: { id: input.ticketTypeId } });
  // 邀请码票：配置了 inviteCode 则下单必须带对的码
  if (ticketType.inviteCode && input.inviteCode?.trim() !== ticketType.inviteCode) {
    throw new InviteCodeError();
  }
  // 早鸟价：在 earlyBirdUntil 之前生效（确定性，后端权威）
  const priceCents = effectiveTicketPriceCents(ticketType, now);
  const quotaId = await resolveQuotaId(db, input.ticketTypeId);
  const requiresApproval = ticketType.kind === "approval";

  if (quotaId && !requiresApproval) {
    const quota = await db.quota.findUniqueOrThrow({ where: { id: quotaId } });
    if (quota.capacity !== null) {
      const reserved = await liveReserved(db, quotaId, now);
      if (quota.used + reserved + seats > quota.capacity) {
        return createWaitlistEntry(db, input, quotaId, priceCents, seats, now);
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
      checkinToken: randomUUID(),
    },
  });

  const reservedUntil = requiresApproval ? null : new Date(reservationDeadline(now.getTime(), DEFAULT_RESERVATION_MINUTES));
  const order = await db.order.create({
    data: {
      registrationId: registration.id,
      amountCents: priceCents * seats,
      seats,
      quotaId,
      lifecycle: "reserved",
      payment_status: "unpaid",
      reservedUntil,
      pointInTimeData: JSON.stringify({ ticketPriceCents: priceCents, seats, requiresApproval }),
      mock: true,
    },
  });

  return { orderId: order.id, registrationId: registration.id, reservedUntil, status: registration.status, requiresApproval, waitlist: null };
}

/**
 * 成交：付款（mock）确认后调用。
 * 硬扣库存用条件原子更新：UPDATE ... WHERE capacity IS NULL OR used+seats<=capacity。
 * 受影响行数 0 = 名额被别人抢光 → OversellError（这正是 Hi.Events 没做、导致线上超卖的守门）。
 */
export interface CompleteOptions {
  provider?: PaymentProvider;
  providerPayload?: unknown;
  now?: Date;
}

export async function complete(db: PrismaClient, orderId: string, options: CompleteOptions = {}) {
  const provider = options.provider ?? mockPaymentProvider;
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
      mock: provider.identifier === "mock",
    },
  });
  const payment = await provider.confirm(db, updatedOrder, { now: options.now, payload: options.providerPayload });
  const reg = await db.registration.findUniqueOrThrow({ where: { id: order.registrationId } });
  const updatedReg = await db.registration.update({
    where: { id: reg.id },
    data: { status: nextRegistrationStatus(reg.status as any, "approve") },
  });

  return { order: updatedOrder, registration: updatedReg, payment: payment.payment };
}

/** 审核通过：submitted → approved，同时完成对应免费/审核订单并硬扣库存。 */
export async function approveRegistration(db: PrismaClient, registrationId: string) {
  const reg = await db.registration.findUniqueOrThrow({ where: { id: registrationId }, include: { order: true } });
  if (!reg.order) {
    return {
      order: null,
      registration: await db.registration.update({
        where: { id: registrationId },
        data: { status: nextRegistrationStatus(reg.status as any, "approve") },
      }),
    };
  }
  return complete(db, reg.order.id);
}

/** 审核拒绝：submitted → rejected，并取消对应未完成订单，不占库存。 */
export async function rejectRegistration(db: PrismaClient, registrationId: string) {
  const reg = await db.registration.findUniqueOrThrow({ where: { id: registrationId }, include: { order: true } });
  const nextStatus = nextRegistrationStatus(reg.status as any, "reject");

  if (reg.order && reg.order.lifecycle === "reserved") {
    await db.order.update({
      where: { id: reg.order.id },
      data: { lifecycle: nextOrderLifecycle(reg.order.lifecycle as any, "cancel") },
    });
  }

  return db.registration.update({
    where: { id: registrationId },
    data: { status: nextStatus },
  });
}

/** 候补转正：waitlisted → approved，同时硬扣库存并生成 mock completed 订单。 */
export async function promoteWaitlistRegistration(db: PrismaClient, registrationId: string, now: Date = new Date()) {
  const reg = await db.registration.findUniqueOrThrow({
    where: { id: registrationId },
    include: { ticketType: true, waitlistEntry: true, order: true },
  });
  if (!reg.waitlistEntry) throw new Error("该报名不在候补名单中");
  if (reg.order) throw new Error("该候补报名已有订单，不能重复转正");

  const seats = 1;
  if (reg.waitlistEntry.quotaId) {
    const affected = await db.$executeRaw`
      UPDATE "Quota" SET "used" = "used" + ${seats}
      WHERE "id" = ${reg.waitlistEntry.quotaId}
        AND ("capacity" IS NULL OR "used" + ${seats} <= "capacity")`;
    if (affected === 0) {
      const quota = await db.quota.findUnique({ where: { id: reg.waitlistEntry.quotaId } });
      throw new OversellError(quota?.capacity ?? 0, (quota?.used ?? 0) + seats);
    }
  }

  const order = await db.order.create({
    data: {
      registrationId: reg.id,
      amountCents: reg.ticketType.priceCents * seats,
      seats,
      quotaId: reg.waitlistEntry.quotaId,
      lifecycle: "completed",
      payment_status: "paid",
      reservedUntil: null,
      pointInTimeData: JSON.stringify({ ticketPriceCents: reg.ticketType.priceCents, seats, fromWaitlist: true, promotedAt: now.toISOString() }),
      mock: true,
    },
  });
  const payment = await mockPaymentProvider.confirm(db, order, { now });
  const registration = await db.registration.update({
    where: { id: reg.id },
    data: { status: nextRegistrationStatus(reg.status as any, "promote") },
  });
  const waitlistEntry = await db.waitlistEntry.update({
    where: { id: reg.waitlistEntry.id },
    data: { status: "promoted" },
  });

  return { order, registration, waitlistEntry, payment: payment.payment };
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

export class RefundError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "RefundError";
  }
}

/**
 * 手动退款：调支付 provider 退款，记账 refund_status/refundedAmountCents。
 * 全额退款时连带释放库存并取消报名（复用 cancel）。MVP 仅 mock provider 可退，微信支付退款未接入。
 */
export async function refundOrder(
  db: PrismaClient,
  orderId: string,
  input: { amountCents?: number; reason?: string } = {},
) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.payment_status !== "paid") throw new RefundError(409, "not_paid", "订单未支付，无法退款");
  if (order.refund_status === "full") throw new RefundError(409, "already_refunded", "订单已全额退款");
  const remaining = order.amountCents - order.refundedAmountCents;
  const amount = Math.min(input.amountCents ?? remaining, remaining);
  if (amount <= 0) throw new RefundError(400, "nothing_to_refund", "可退金额为 0");

  const result = await mockPaymentProvider.refund(db, order, { amountCents: amount, reason: input.reason });
  const refundedTotal = order.refundedAmountCents + result.refundedAmountCents;
  const full = refundedTotal >= order.amountCents;
  await db.order.update({
    where: { id: orderId },
    data: { refund_status: full ? "full" : "partial", refundedAmountCents: refundedTotal },
  });
  if (full) await cancel(db, orderId); // 释放库存 + 取消报名
  return { orderId, refundedAmountCents: result.refundedAmountCents, refundStatus: full ? "full" : "partial", provider: result.provider };
}

const VALID_TAGS = ["guest", "vip", "staff"];
/** 现场重点标记落库（guest/vip/staff，传空清除）。 */
export async function setRegistrationTag(db: PrismaClient, registrationId: string, tag: string | null) {
  const normalized = tag && VALID_TAGS.includes(tag) ? tag : null;
  return db.registration.update({ where: { id: registrationId }, data: { tag: normalized } });
}

export async function cancelRegistration(db: PrismaClient, registrationId: string, userId?: string) {
  const reg = await db.registration.findUnique({
    where: { id: registrationId },
    include: { order: true, waitlistEntry: true },
  });
  if (!reg) throw new RegistrationCancelError(404, "registration_not_found", "报名记录不存在");
  if (userId && reg.userId !== userId) throw new RegistrationCancelError(403, "registration_forbidden", "不能取消他人的报名");
  if (reg.status === "cancelled") return { registration: reg };
  if (reg.status === "checked_in") throw new RegistrationCancelError(409, "already_checked_in", "已签到报名不能取消");
  if (reg.status === "rejected") throw new RegistrationCancelError(409, "already_rejected", "未通过报名不能取消");

  if (reg.order && reg.order.lifecycle !== "cancelled" && reg.order.lifecycle !== "abandoned") {
    await cancel(db, reg.order.id);
  } else {
    await db.$transaction(async (tx) => {
      await tx.registration.update({
        where: { id: reg.id },
        data: { status: nextRegistrationStatus(reg.status as any, "cancel") },
      });
      if (reg.waitlistEntry) {
        await tx.waitlistEntry.update({
          where: { id: reg.waitlistEntry.id },
          data: { status: "cancelled" },
        });
      }
    });
  }

  const registration = await db.registration.findUniqueOrThrow({
    where: { id: registrationId },
    include: { order: true, waitlistEntry: true },
  });
  return { registration };
}

/** 签到：approved → checked_in，并写入唯一 CheckIn 记录防重复核销。 */
export async function checkin(db: PrismaClient, registrationId: string, by?: string) {
  return db.$transaction(async (tx) => {
    const reg = await tx.registration.findUniqueOrThrow({ where: { id: registrationId }, include: { checkIn: true } });
    if (reg.checkIn || reg.status === "checked_in") throw new DuplicateCheckinError(registrationId);

    const registration = await tx.registration.update({
      where: { id: registrationId },
      data: { status: nextRegistrationStatus(reg.status as any, "checkIn") },
    });
    const checkIn = await tx.checkIn.create({
      data: { registrationId: reg.id, userId: reg.userId, by },
    });
    return { registration, checkIn };
  });
}

export async function checkinByToken(db: PrismaClient, input: CheckinScanInput) {
  const payload = resolveCheckinPayload(input);
  const reg = await db.registration.findUnique({
    where: { id: payload.registrationId },
    include: { checkIn: true },
  });
  if (!reg || reg.eventId !== payload.eventId || reg.checkinToken !== payload.token) {
    throw new CheckinTokenError();
  }
  return checkin(db, reg.id, input.by);
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
