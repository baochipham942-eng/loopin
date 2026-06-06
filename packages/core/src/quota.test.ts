import { describe, it, expect } from "vitest";
import {
  quotaAvailable,
  canReserve,
  isSoldOut,
  nextUsedAfterSell,
  reservationDeadline,
  isReservationExpired,
  OversellError,
  DEFAULT_RESERVATION_MINUTES,
  type QuotaState,
} from "./quota.js";

function q(partial: Partial<QuotaState> = {}): QuotaState {
  return { capacity: 100, used: 0, reservedActive: 0, ...partial };
}

describe("quotaAvailable — 可售 = 上限 − 已售 − 未过期预留", () => {
  it("有限容量扣减已售与预留", () => {
    expect(quotaAvailable(q({ used: 30, reservedActive: 10 }))).toBe(60);
  });
  it("不限量返回 null", () => {
    expect(quotaAvailable(q({ capacity: null, used: 9999 }))).toBeNull();
  });
  it("超占时不返回负数", () => {
    expect(quotaAvailable(q({ used: 95, reservedActive: 20 }))).toBe(0);
  });
});

describe("canReserve — 预留守门", () => {
  it("名额足够可预留", () => {
    expect(canReserve(q({ used: 90, reservedActive: 5 }), 5)).toBe(true);
  });
  it("超出名额不可预留", () => {
    expect(canReserve(q({ used: 90, reservedActive: 5 }), 6)).toBe(false);
  });
  it("不限量永远可预留", () => {
    expect(canReserve(q({ capacity: null }), 9999)).toBe(true);
  });
});

describe("isSoldOut", () => {
  it("已售+预留占满即售罄", () => {
    expect(isSoldOut(q({ used: 80, reservedActive: 20 }))).toBe(true);
    expect(isSoldOut(q({ used: 80, reservedActive: 19 }))).toBe(false);
  });
  it("不限量永不售罄", () => {
    expect(isSoldOut(q({ capacity: null, used: 9999 }))).toBe(false);
  });
});

describe("nextUsedAfterSell — 成交扣减守门（对应 DB 条件原子更新）", () => {
  it("名额内成交返回新 used", () => {
    expect(nextUsedAfterSell(q({ used: 40 }), 5)).toBe(45);
  });
  it("超卖抛 OversellError（守住 Hi.Events 踩过的坑）", () => {
    expect(() => nextUsedAfterSell(q({ used: 98 }), 5)).toThrow(OversellError);
  });
  it("不限量不限成交", () => {
    expect(nextUsedAfterSell(q({ capacity: null, used: 9999 }), 100)).toBe(10099);
  });
});

describe("预留时限", () => {
  it("默认 15 分钟", () => {
    expect(DEFAULT_RESERVATION_MINUTES).toBe(15);
  });
  it("reservationDeadline 按分钟数生成未来 ISO", () => {
    const base = Date.parse("2026-06-06T00:00:00.000Z");
    expect(reservationDeadline(base, 15)).toBe("2026-06-06T00:15:00.000Z");
  });
  it("isReservationExpired 按当前时间判定", () => {
    const deadline = "2026-06-06T00:15:00.000Z";
    expect(isReservationExpired(deadline, Date.parse("2026-06-06T00:14:59.000Z"))).toBe(false);
    expect(isReservationExpired(deadline, Date.parse("2026-06-06T00:15:01.000Z"))).toBe(true);
  });
});
