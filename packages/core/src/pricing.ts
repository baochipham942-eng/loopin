/** 票种定价（确定性，后端权威，前端不算钱）。 */

export interface TicketPricing {
  priceCents: number;
  earlyBirdPriceCents?: number | null;
  earlyBirdUntil?: Date | string | null;
}

/**
 * 生效票价：在 earlyBirdUntil 之前用 earlyBirdPriceCents，否则用 priceCents。
 * now 必须显式传入，保证可测、不依赖墙上时钟。
 */
export function effectiveTicketPriceCents(t: TicketPricing, now: Date): number {
  if (t.earlyBirdPriceCents != null && t.earlyBirdUntil != null) {
    const until = t.earlyBirdUntil instanceof Date ? t.earlyBirdUntil : new Date(t.earlyBirdUntil);
    if (!Number.isNaN(until.getTime()) && now.getTime() < until.getTime()) {
      return t.earlyBirdPriceCents;
    }
  }
  return t.priceCents;
}
