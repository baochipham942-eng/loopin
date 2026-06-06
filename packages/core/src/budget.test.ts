import { describe, it, expect } from "vitest";
import { yuanToCents } from "./money.js";
import {
  calcBudget,
  profitAt,
  compareScenarios,
  suggestPrice,
  type BudgetInput,
} from "./budget.js";

/** 一个典型付费沙龙：199 元票、目标 50 人、到场率 85% */
function paidEvent(overrides: Partial<BudgetInput> = {}): BudgetInput {
  return {
    ticketPriceCents: yuanToCents(199),
    targetAttendees: 50,
    showUpRate: 0.85,
    venueCostCents: yuanToCents(3000),
    materialsCostCents: yuanToCents(800),
    speakerFeeCents: yuanToCents(2000),
    laborCostCents: yuanToCents(1000),
    marketingCostCents: yuanToCents(1500),
    cateringPerPersonCents: yuanToCents(60),
    sponsorshipCents: 0,
    ...overrides,
  };
}

describe("calcBudget — 付费活动", () => {
  it("固定成本与每报名贡献正确", () => {
    const r = calcBudget(paidEvent());
    // 固定成本 = 3000+800+2000+1000+1500 = 8300 元
    expect(r.fixedCostCents).toBe(yuanToCents(8300));
    // 贡献/人 = 199 - 60*0.85 = 199 - 51 = 148 元
    expect(r.contributionPerRegCents).toBe(yuanToCents(148));
  });

  it("保本人数 = ceil(8300/148) = 57", () => {
    const r = calcBudget(paidEvent());
    expect(r.breakEvenAttendees).toBe(57);
  });

  it("目标 50 人下亏损（低于保本人数）", () => {
    const r = calcBudget(paidEvent());
    // profit = 148*50 - 8300 = 7400 - 8300 = -900 元
    expect(r.projectedProfitCents).toBe(yuanToCents(-900));
    expect(r.profitable).toBe(false);
    expect(r.verdict).toContain("少于 57 人会亏");
    expect(r.verdict).toContain("会亏 ¥900.00");
  });

  it("目标 80 人下盈利", () => {
    const r = calcBudget(paidEvent({ targetAttendees: 80 }));
    // profit = 148*80 - 8300 = 11840 - 8300 = 3540 元
    expect(r.projectedProfitCents).toBe(yuanToCents(3540));
    expect(r.profitable).toBe(true);
    expect(r.verdict).toContain("可赚 ¥3,540.00");
  });

  it("利润率 = 利润/收入", () => {
    const r = calcBudget(paidEvent({ targetAttendees: 80 }));
    // revenue = 199*80 = 15920；profit 3540；margin ≈ 0.2224
    expect(r.profitMargin).toBeCloseTo(3540 / 15920, 4);
  });
});

describe("profitAt — 单点利润", () => {
  it("保本人数处利润应 >= 0 且尽量接近 0", () => {
    const input = paidEvent();
    const be = calcBudget(input).breakEvenAttendees!;
    expect(profitAt(input, be)).toBeGreaterThanOrEqual(0);
    expect(profitAt(input, be - 1)).toBeLessThan(0);
  });
});

describe("calcBudget — 不可保本（票价低于人均变动成本）", () => {
  it("贡献<=0 时 breakEven 为 null 并给出提价建议文案", () => {
    const r = calcBudget(paidEvent({ ticketPriceCents: yuanToCents(40), cateringPerPersonCents: yuanToCents(60) }));
    // 贡献 = 40 - 60*0.85 = 40 - 51 = -11 < 0
    expect(r.contributionPerRegCents).toBe(yuanToCents(-11));
    expect(r.breakEvenAttendees).toBeNull();
    expect(r.verdict).toContain("先提价或压成本");
  });
});

describe("calcBudget — 免费活动", () => {
  it("赞助覆盖成本时净结余", () => {
    const r = calcBudget(
      paidEvent({ ticketPriceCents: 0, sponsorshipCents: yuanToCents(15000), targetAttendees: 80 })
    );
    expect(r.breakEvenAttendees).toBeNull(); // 免费活动无票价保本概念
    expect(r.profitable).toBe(true);
    expect(r.verdict).toContain("免费活动");
    expect(r.verdict).toContain("净结余");
  });

  it("赞助不足时净亏", () => {
    const r = calcBudget(
      paidEvent({ ticketPriceCents: 0, sponsorshipCents: yuanToCents(2000), targetAttendees: 80 })
    );
    expect(r.profitable).toBe(false);
    expect(r.verdict).toContain("预计净亏");
  });
});

describe("compareScenarios — 30/50/100 对比", () => {
  it("默认输出三档且利润随人数单调递增（贡献为正时）", () => {
    const rows = compareScenarios(paidEvent());
    expect(rows.map((r) => r.registrations)).toEqual([30, 50, 100]);
    expect(rows[0]!.profitCents).toBeLessThan(rows[1]!.profitCents);
    expect(rows[1]!.profitCents).toBeLessThan(rows[2]!.profitCents);
    // 100 人应盈利
    expect(rows[2]!.profitable).toBe(true);
  });
});

describe("suggestPrice — 票价建议", () => {
  it("为在目标人数保本反推票价，采用后保本人数 <= 目标", () => {
    const input = paidEvent({ targetAttendees: 50 });
    const s = suggestPrice(input, 50);
    // 需要在 50 人保本，原价 199 只能在 57 人保本，故建议价应更高
    expect(s.suggestedPriceCents).toBeGreaterThan(input.ticketPriceCents);
    expect(s.newBreakEvenAttendees).not.toBeNull();
    expect(s.newBreakEvenAttendees!).toBeLessThanOrEqual(50);
  });

  it("建议票价为整元", () => {
    const s = suggestPrice(paidEvent(), 40);
    expect(s.suggestedPriceCents % 100).toBe(0);
  });
});
