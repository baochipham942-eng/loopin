/**
 * 领域类型 —— 与 Backend/Data spec 的核心数据对象对应。
 * Prisma schema（apps/api）是持久化真相来源，这里是跨端共享的 TS 类型视图。
 */
import type { RegistrationStatus, OrderLifecycle, PaymentStatus, RefundStatus } from "./registration.js";
import type { RegistrationFormSchema } from "./form-schema.js";
import type { Cents } from "./money.js";

export type EventStatus = "draft" | "published" | "closed" | "completed" | "cancelled";
export type TicketKind = "free" | "approval" | "paid";

export interface Organizer {
  id: string;
  name: string;
  whitelisted: boolean; // 第一版主办方白名单邀请制
}

export interface EventEntity {
  id: string;
  organizerId: string;
  title: string;
  status: EventStatus;
  startAt: string; // ISO
  city: string;
  venue?: string;
  coverUrl?: string;
}

export interface TicketType {
  id: string;
  eventId: string;
  name: string;
  kind: TicketKind;
  priceCents: Cents; // free/approval = 0
  /** 库存不在票种上，由 Quota 池承载（多对多）。见 quota.ts / docs/04 §3.2 */
  quotaIds: string[];
}

/** 配额池：库存独立实体，可被多个票种共享 */
export interface Quota {
  id: string;
  eventId: string;
  name: string;
  capacity: number | null; // null = 不限量
  used: number;
}

export interface Registration {
  id: string;
  eventId: string;
  ticketTypeId: string;
  userId: string;
  status: RegistrationStatus;
  formValues: Record<string, string | string[]>;
  createdAt: string;
}

export interface Order {
  id: string;
  registrationId: string;
  amountCents: Cents;
  /** 三个正交状态维度，见 registration.ts */
  lifecycle: OrderLifecycle;
  payment: PaymentStatus;
  refund: RefundStatus;
  /** 预留过期时间（ISO）；lifecycle=reserved 时有效，用于超卖防护 */
  reservedUntil?: string;
  refundedAmountCents?: Cents;
  /** MVP: 付费 mock，记录是否走 mock 通道 */
  mock: boolean;
}

export interface EventPageConfig {
  eventId: string;
  template: string; // ai_tech / city_salon / startup_pitch / career / host
  highlights: string[];
  agenda: string[];
  faq: { q: string; a: string }[];
  formSchema: RegistrationFormSchema;
}
