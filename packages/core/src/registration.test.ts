import { describe, it, expect } from "vitest";
import {
  nextRegistrationStatus,
  canRegistrationTransition,
  nextOrderLifecycle,
  nextPaymentStatus,
  nextRefundStatus,
  canRefund,
  InvalidTransitionError,
} from "./registration.js";

describe("报名状态机", () => {
  it("免费/审核活动正常路径：draft→submitted→approved→checked_in", () => {
    let s = nextRegistrationStatus("draft", "submit");
    expect(s).toBe("submitted");
    s = nextRegistrationStatus(s, "approve");
    expect(s).toBe("approved");
    s = nextRegistrationStatus(s, "checkIn");
    expect(s).toBe("checked_in");
  });

  it("候补转正：submitted→waitlisted→approved", () => {
    const w = nextRegistrationStatus("submitted", "waitlist");
    expect(w).toBe("waitlisted");
    expect(nextRegistrationStatus(w, "promote")).toBe("approved");
  });

  it("终态不可再流转", () => {
    expect(() => nextRegistrationStatus("checked_in", "cancel")).toThrow(InvalidTransitionError);
    expect(() => nextRegistrationStatus("rejected", "approve")).toThrow();
    expect(canRegistrationTransition("cancelled", "submit")).toBe(false);
  });

  it("不能跳过审核直接签到", () => {
    expect(() => nextRegistrationStatus("submitted", "checkIn")).toThrow();
  });
});

describe("订单生命周期机器（orderLifecycle）", () => {
  it("预留→完成：reserved→completed", () => {
    expect(nextOrderLifecycle("reserved", "complete")).toBe("completed");
  });
  it("预留超时→废弃：reserved→abandoned", () => {
    expect(nextOrderLifecycle("reserved", "abandon")).toBe("abandoned");
  });
  it("预留/完成都可取消", () => {
    expect(nextOrderLifecycle("reserved", "cancel")).toBe("cancelled");
    expect(nextOrderLifecycle("completed", "cancel")).toBe("cancelled");
  });
  it("已完成不能再废弃", () => {
    expect(() => nextOrderLifecycle("completed", "abandon")).toThrow(InvalidTransitionError);
  });
  it("终态不可流转", () => {
    expect(() => nextOrderLifecycle("cancelled", "complete")).toThrow();
    expect(() => nextOrderLifecycle("abandoned", "complete")).toThrow();
  });
});

describe("支付机器（paymentStatus）", () => {
  it("支付：unpaid→paid", () => {
    expect(nextPaymentStatus("unpaid", "pay")).toBe("paid");
  });
  it("已支付不能再支付", () => {
    expect(() => nextPaymentStatus("paid", "pay")).toThrow();
  });
});

describe("退款机器（refundStatus）", () => {
  it("部分退款：none→partial，可再全退：partial→full", () => {
    expect(nextRefundStatus("none", "partialRefund")).toBe("partial");
    expect(nextRefundStatus("partial", "fullRefund")).toBe("full");
  });
  it("全退后是终态", () => {
    expect(() => nextRefundStatus("full", "partialRefund")).toThrow();
  });
});

describe("跨字段不变量 canRefund", () => {
  it("已支付且未全退才可退款", () => {
    expect(canRefund("paid", "none")).toBe(true);
    expect(canRefund("paid", "partial")).toBe(true);
  });
  it("未支付不可退、已全退不可退", () => {
    expect(canRefund("unpaid", "none")).toBe(false);
    expect(canRefund("paid", "full")).toBe(false);
  });
});
