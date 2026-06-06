/**
 * 配额池（Quota）—— 库存从票种里抽出来做独立池（见 docs/04 §3.2，Pretix 印证）。
 * 一个 Quota 可被多个票种共享（多对多），解决"早鸟+标准共享名额""总量封顶""子场次独立库存"。
 *
 * 可售 = 上限 − 已售 − 未过期预留。capacity=null 表示不限量。
 * 真正的并发原子性靠 DB 条件更新（UPDATE ... WHERE used+N<=cap）+ CHECK 约束；
 * 这里是纯逻辑守门，供服务层断言与单测，避免 Hi.Events 那种校验/扣减不同锁导致的超卖。
 */

export interface QuotaState {
  /** 容量上限；null = 不限量 */
  capacity: number | null;
  /** 已成交占用（已完成订单） */
  used: number;
  /** 当前未过期预留占用 */
  reservedActive: number;
}

export const DEFAULT_RESERVATION_MINUTES = 15;

export class OversellError extends Error {
  constructor(public capacity: number, public attemptedTotal: number) {
    super(`超卖拦截：容量 ${capacity}，尝试占用 ${attemptedTotal}`);
    this.name = "OversellError";
  }
}

/** 可售余量；不限量返回 null */
export function quotaAvailable(q: QuotaState): number | null {
  if (q.capacity === null) return null;
  return Math.max(0, q.capacity - q.used - q.reservedActive);
}

/** 能否再预留 n 个（含已有预留与已售） */
export function canReserve(q: QuotaState, n: number): boolean {
  if (q.capacity === null) return true;
  return q.used + q.reservedActive + n <= q.capacity;
}

/** 已售+预留是否占满 */
export function isSoldOut(q: QuotaState): boolean {
  if (q.capacity === null) return false;
  return q.used + q.reservedActive >= q.capacity;
}

/**
 * 成交扣减守门：预留转成交时把 n 计入 used，超过容量抛 OversellError。
 * 对应 DB 层 `UPDATE quota SET used = used + n WHERE capacity IS NULL OR used + n <= capacity`
 * 并校验受影响行数；这里返回应写入的新 used 值。
 */
export function nextUsedAfterSell(q: QuotaState, n: number): number {
  const next = q.used + n;
  if (q.capacity !== null && next > q.capacity) {
    throw new OversellError(q.capacity, next);
  }
  return next;
}

/** 生成预留截止时间（ISO） */
export function reservationDeadline(fromMs: number, minutes: number = DEFAULT_RESERVATION_MINUTES): string {
  return new Date(fromMs + minutes * 60_000).toISOString();
}

/** 预留是否已过期（用于可售计算时排除过期预留 + 兜底回收） */
export function isReservationExpired(reservedUntilISO: string, nowMs: number): boolean {
  return Date.parse(reservedUntilISO) <= nowMs;
}
