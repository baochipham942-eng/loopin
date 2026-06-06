/**
 * 报名 / 订单状态机 —— 确定性系统，不交给大模型。
 * 任何状态流转都必须经过这里校验，非法流转抛错。
 */

export type RegistrationStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "waitlisted"
  | "cancelled"
  | "checked_in";

export type RegistrationEvent =
  | "submit"
  | "approve"
  | "reject"
  | "waitlist"
  | "promote" // 候补转正
  | "checkIn"
  | "cancel";

const REGISTRATION_TRANSITIONS: Record<RegistrationStatus, Partial<Record<RegistrationEvent, RegistrationStatus>>> = {
  draft: { submit: "submitted", cancel: "cancelled" },
  submitted: { approve: "approved", reject: "rejected", waitlist: "waitlisted", cancel: "cancelled" },
  approved: { checkIn: "checked_in", cancel: "cancelled" },
  waitlisted: { promote: "approved", cancel: "cancelled" },
  rejected: {},
  cancelled: {},
  checked_in: {},
};

// 订单拆成三个正交维度（见 docs/04 §3.3，Hi.Events / Pretix 印证），
// 别揉进一个大枚举：生命周期 / 支付 / 退款 各自独立机器。

// —— 订单生命周期 ——
export type OrderLifecycle = "reserved" | "completed" | "cancelled" | "abandoned";
export type OrderLifecycleEvent = "complete" | "cancel" | "abandon";

const ORDER_LIFECYCLE_TRANSITIONS: Record<OrderLifecycle, Partial<Record<OrderLifecycleEvent, OrderLifecycle>>> = {
  reserved: { complete: "completed", cancel: "cancelled", abandon: "abandoned" },
  completed: { cancel: "cancelled" },
  cancelled: {},
  abandoned: {},
};

// —— 支付 ——
export type PaymentStatus = "unpaid" | "paid";
export type PaymentEvent = "pay";

const PAYMENT_TRANSITIONS: Record<PaymentStatus, Partial<Record<PaymentEvent, PaymentStatus>>> = {
  unpaid: { pay: "paid" },
  paid: {},
};

// —— 退款（独立于支付，支持部分退款）——
export type RefundStatus = "none" | "partial" | "full";
export type RefundEvent = "partialRefund" | "fullRefund";

const REFUND_TRANSITIONS: Record<RefundStatus, Partial<Record<RefundEvent, RefundStatus>>> = {
  none: { partialRefund: "partial", fullRefund: "full" },
  partial: { partialRefund: "partial", fullRefund: "full" },
  full: {},
};

export class InvalidTransitionError extends Error {
  constructor(public from: string, public event: string) {
    super(`非法状态流转：${from} --(${event})-->`);
    this.name = "InvalidTransitionError";
  }
}

export function nextRegistrationStatus(from: RegistrationStatus, event: RegistrationEvent): RegistrationStatus {
  const to = REGISTRATION_TRANSITIONS[from][event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

export function canRegistrationTransition(from: RegistrationStatus, event: RegistrationEvent): boolean {
  return REGISTRATION_TRANSITIONS[from][event] !== undefined;
}

export function nextOrderLifecycle(from: OrderLifecycle, event: OrderLifecycleEvent): OrderLifecycle {
  const to = ORDER_LIFECYCLE_TRANSITIONS[from][event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

export function canOrderLifecycleTransition(from: OrderLifecycle, event: OrderLifecycleEvent): boolean {
  return ORDER_LIFECYCLE_TRANSITIONS[from][event] !== undefined;
}

export function nextPaymentStatus(from: PaymentStatus, event: PaymentEvent): PaymentStatus {
  const to = PAYMENT_TRANSITIONS[from][event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

export function nextRefundStatus(from: RefundStatus, event: RefundEvent): RefundStatus {
  const to = REFUND_TRANSITIONS[from][event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

/** 跨字段不变量：仅「已支付且未全退」可发起退款。服务层在调 nextRefundStatus 前必须先过这关。 */
export function canRefund(payment: PaymentStatus, refund: RefundStatus): boolean {
  return payment === "paid" && refund !== "full";
}

export const REGISTRATION_TERMINAL: RegistrationStatus[] = ["rejected", "cancelled", "checked_in"];
export const ORDER_LIFECYCLE_TERMINAL: OrderLifecycle[] = ["cancelled", "abandoned"];
