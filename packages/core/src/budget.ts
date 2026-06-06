import type { Cents } from "./money.js";
import { ceilToYuanCents, formatCNY } from "./money.js";

/**
 * 活动赚钱计算器（盈亏测算）—— Loopin 差异化核心。
 *
 * 模型：
 *   设 n = 报名/售票人数（目标人数）
 *   实际到场 attendees = n * showUpRate（按人头的变动成本基于到场人数）
 *   收入 revenue(n)      = ticketPrice * n + sponsorship
 *   固定成本 fixedCost   = venue + materials + speaker + labor + marketing
 *   变动成本 variable(n) = perAttendeeCost * n * showUpRate
 *   利润 profit(n)       = revenue(n) - fixedCost - variable(n)
 *                        = contributionPerReg * n + sponsorship - fixedCost
 *   每报名贡献 contributionPerReg = ticketPrice - perAttendeeCost * showUpRate
 *   保本人数 n*          = ceil((fixedCost - sponsorship) / contributionPerReg)
 */
export interface BudgetInput {
  /** 票价（分）。免费活动填 0 */
  ticketPriceCents: Cents;
  /** 目标报名/售票人数 */
  targetAttendees: number;
  /** 到场率 0~1（用于按人头变动成本，如茶歇） */
  showUpRate: number;
  // —— 固定成本（分）——
  venueCostCents: Cents;
  materialsCostCents: Cents;
  speakerFeeCents: Cents;
  laborCostCents: Cents;
  marketingCostCents: Cents;
  // —— 变动成本（分/到场人）——
  cateringPerPersonCents: Cents;
  /** 其他按到场人头的成本（伴手礼等），可选 */
  otherPerPersonCents?: Cents;
  // —— 其他收入（分）——
  sponsorshipCents: Cents;
}

export interface BudgetResult {
  /** 固定成本合计 */
  fixedCostCents: Cents;
  /** 每报名边际贡献 */
  contributionPerRegCents: Cents;
  /** 保本人数；null 表示当前票价结构下永远无法保本 */
  breakEvenAttendees: number | null;
  /** 目标人数下的预计利润 */
  projectedProfitCents: Cents;
  /** 目标人数下的总收入 */
  projectedRevenueCents: Cents;
  /** 目标人数下的总成本 */
  projectedCostCents: Cents;
  /** 利润率 = 利润 / 收入，0~1；收入为 0 时为 null */
  profitMargin: number | null;
  /** 是否盈利（目标人数下） */
  profitable: boolean;
  /** 一句核心判断 */
  verdict: string;
}

/** 给定报名人数算利润（分） */
export function profitAt(input: BudgetInput, registrations: number): Cents {
  const fixed = fixedCost(input);
  const contribution = contributionPerReg(input);
  return Math.round(contribution * registrations + input.sponsorshipCents - fixed);
}

export function fixedCost(input: BudgetInput): Cents {
  return (
    input.venueCostCents +
    input.materialsCostCents +
    input.speakerFeeCents +
    input.laborCostCents +
    input.marketingCostCents
  );
}

export function contributionPerReg(input: BudgetInput): Cents {
  const perAttendee = input.cateringPerPersonCents + (input.otherPerPersonCents ?? 0);
  return Math.round(input.ticketPriceCents - perAttendee * input.showUpRate);
}

export function revenueAt(input: BudgetInput, registrations: number): Cents {
  return input.ticketPriceCents * registrations + input.sponsorshipCents;
}

export function calcBudget(input: BudgetInput): BudgetResult {
  const fixed = fixedCost(input);
  const contribution = contributionPerReg(input);
  const n = input.targetAttendees;

  const projectedRevenue = revenueAt(input, n);
  const projectedProfit = profitAt(input, n);
  const projectedCost = projectedRevenue - projectedProfit;

  let breakEven: number | null;
  if (contribution <= 0) {
    // 每多一个报名都不增加（甚至减少）净贡献：靠卖票无法保本
    breakEven = null;
  } else {
    breakEven = Math.max(0, Math.ceil((fixed - input.sponsorshipCents) / contribution));
  }

  const profitMargin = projectedRevenue > 0 ? projectedProfit / projectedRevenue : null;
  const profitable = projectedProfit > 0;

  return {
    fixedCostCents: fixed,
    contributionPerRegCents: contribution,
    breakEvenAttendees: breakEven,
    projectedProfitCents: projectedProfit,
    projectedRevenueCents: projectedRevenue,
    projectedCostCents: projectedCost,
    profitMargin,
    profitable,
    verdict: buildVerdict(input, { breakEven, contribution, projectedProfit, fixed }),
  };
}

function buildVerdict(
  input: BudgetInput,
  ctx: { breakEven: number | null; contribution: Cents; projectedProfit: Cents; fixed: Cents }
): string {
  const isFree = input.ticketPriceCents === 0;
  if (isFree) {
    if (ctx.projectedProfit >= 0) {
      return `免费活动，目标 ${input.targetAttendees} 人下赞助 ${formatCNY(input.sponsorshipCents)} 已覆盖成本，预计净结余 ${formatCNY(ctx.projectedProfit)}。`;
    }
    return `免费活动，目标 ${input.targetAttendees} 人下预计净亏 ${formatCNY(-ctx.projectedProfit)}，需再补赞助或压成本（当前赞助 ${formatCNY(input.sponsorshipCents)}）。`;
  }
  if (ctx.breakEven === null) {
    return `当前票价 ${formatCNY(input.ticketPriceCents)} 低于到场人均变动成本，卖得越多亏得越多，先提价或压成本。`;
  }
  const profitWord = ctx.projectedProfit >= 0 ? "可赚" : "会亏";
  return `少于 ${ctx.breakEven} 人会亏；目标 ${input.targetAttendees} 人${profitWord} ${formatCNY(Math.abs(ctx.projectedProfit))}。`;
}

// ———————————————————————————————————————————————
// 规模方案对比（30 / 50 / 100 人）
// ———————————————————————————————————————————————
export interface ScenarioRow {
  registrations: number;
  revenueCents: Cents;
  profitCents: Cents;
  profitable: boolean;
}

export function compareScenarios(
  input: BudgetInput,
  headcounts: number[] = [30, 50, 100]
): ScenarioRow[] {
  return headcounts.map((registrations) => {
    const profit = profitAt(input, registrations);
    return {
      registrations,
      revenueCents: revenueAt(input, registrations),
      profitCents: profit,
      profitable: profit > 0,
    };
  });
}

// ———————————————————————————————————————————————
// 票价建议：想在 desiredBreakEven 人保本，需要什么票价
// ———————————————————————————————————————————————
export interface PriceSuggestion {
  /** 为在目标人数保本所需的票价（向上取整到元，分） */
  suggestedPriceCents: Cents;
  /** 采用建议票价后的保本人数 */
  newBreakEvenAttendees: number | null;
}

/**
 * 给定希望"在 desiredBreakEven 人时保本"，反推所需票价。
 * 所需贡献/人 = (fixedCost - sponsorship) / desiredBreakEven
 * 所需票价 = 所需贡献 + perAttendeeCost * showUpRate
 */
export function suggestPrice(input: BudgetInput, desiredBreakEven: number): PriceSuggestion {
  if (desiredBreakEven <= 0) {
    return { suggestedPriceCents: 0, newBreakEvenAttendees: null };
  }
  const fixed = fixedCost(input);
  const perAttendee = input.cateringPerPersonCents + (input.otherPerPersonCents ?? 0);
  const requiredContribution = (fixed - input.sponsorshipCents) / desiredBreakEven;
  const rawPrice = requiredContribution + perAttendee * input.showUpRate;
  const suggestedPriceCents = ceilToYuanCents(Math.max(0, Math.round(rawPrice)));

  const newBreakEven = calcBudget({
    ...input,
    ticketPriceCents: suggestedPriceCents,
  }).breakEvenAttendees;

  return { suggestedPriceCents, newBreakEvenAttendees: newBreakEven };
}
