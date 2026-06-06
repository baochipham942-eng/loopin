/**
 * 金额一律以「分」(integer cents) 存储和运算，避免浮点误差。
 * 确定性系统的一部分——支付/盈亏计算不允许出现 0.1+0.2 这类误差。
 */
export type Cents = number;

export function yuanToCents(yuan: number): Cents {
  return Math.round(yuan * 100);
}

export function centsToYuan(cents: Cents): number {
  return cents / 100;
}

/** 格式化为人民币展示串，如 ¥1,299.00 */
export function formatCNY(cents: Cents): string {
  const yuan = centsToYuan(cents);
  const sign = yuan < 0 ? "-" : "";
  const abs = Math.abs(yuan);
  const [intPart = "0", decPart = "00"] = abs.toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}¥${grouped}.${decPart}`;
}

/** 向上取整到「整元」对应的分（票价建议用：99.3 元 -> 100 元） */
export function ceilToYuanCents(cents: Cents): Cents {
  return Math.ceil(cents / 100) * 100;
}
