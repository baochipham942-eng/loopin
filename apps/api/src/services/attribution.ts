import type { AttributionEvent, PrismaClient } from "@prisma/client";

const ATTRIBUTION_EVENT_TYPES = new Set([
  "event_list_view",
  "event_detail_view",
  "registration_intent",
  "registration_submit",
  "registration_reserved",
]);

const ATTRIBUTION_KEYS = [
  "source",
  "channel",
  "referrer",
  "from",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
] as const;

const CAMEL_TO_SNAKE: Record<string, string> = {
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmContent: "utm_content",
  utmTerm: "utm_term",
};

const CHANNEL_LABELS: Record<string, string> = {
  wechat_group: "微信群",
  moments: "朋友圈",
  xiaohongshu: "小红书",
  official_account: "公众号",
  huodongxing: "活动行",
  guest_share: "嘉宾转发",
  community_partner: "社群合作",
  friend_referral: "朋友推荐",
  wechat_share: "微信分享",
  wechat_timeline: "朋友圈分享",
  partner: "合作方",
  search: "搜索",
  organic: "自然访问",
  unknown: "未标注来源",
};

export interface AttributionEventInput {
  type?: string;
  eventId?: string;
  registrationId?: string;
  userId?: string;
  path?: string;
  attribution?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AttributionFunnelRow {
  key: string;
  label: string;
  detailViews: number;
  registrationIntents: number;
  registrationSubmits: number;
  registrationReservations: number;
  detailToIntentRate: number | null;
  intentToSubmitRate: number | null;
  submitToReservedRate: number | null;
}

export interface AttributionFunnel {
  total: AttributionFunnelRow;
  channels: AttributionFunnelRow[];
}

export class AttributionEventError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export async function recordAttributionEvent(db: PrismaClient, input: AttributionEventInput = {}) {
  const type = clean(input.type);
  if (!type || !ATTRIBUTION_EVENT_TYPES.has(type)) {
    throw new AttributionEventError(400, "invalid_attribution_event_type", "归因事件类型不正确");
  }

  const eventId = clean(input.eventId);
  const registrationId = clean(input.registrationId);
  const userId = clean(input.userId);
  if (eventId && !(await db.event.findUnique({ where: { id: eventId }, select: { id: true } }))) {
    throw new AttributionEventError(404, "event_not_found", "活动不存在");
  }
  if (registrationId && !(await db.registration.findUnique({ where: { id: registrationId }, select: { id: true } }))) {
    throw new AttributionEventError(404, "registration_not_found", "报名不存在");
  }
  if (userId && !(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
    throw new AttributionEventError(404, "user_not_found", "用户不存在");
  }

  const attribution = pickAttribution(input.attribution);
  const source = firstNonEmpty(attribution.source, attribution.utm_source, attribution.channel, attribution.from, attribution.referrer);
  return db.attributionEvent.create({
    data: {
      type,
      eventId: eventId || null,
      registrationId: registrationId || null,
      userId: userId || null,
      source: source || null,
      channel: firstNonEmpty(attribution.channel, attribution.utm_source, attribution.source) || null,
      referrer: firstNonEmpty(attribution.referrer, attribution.from) || null,
      utmSource: attribution.utm_source || null,
      utmMedium: attribution.utm_medium || null,
      utmCampaign: attribution.utm_campaign || null,
      utmContent: attribution.utm_content || null,
      utmTerm: attribution.utm_term || null,
      path: clean(input.path, 240) || null,
      metadata: metadataText(input.metadata),
    },
  });
}

export async function summarizeAttributionFunnel(db: PrismaClient, eventId: string): Promise<AttributionFunnel> {
  const rows = await db.attributionEvent.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
  });
  return buildAttributionFunnel(rows);
}

export function buildAttributionFunnel(rows: AttributionEvent[]): AttributionFunnel {
  const byChannel = new Map<string, AttributionFunnelRow>();
  const total = emptyRow("all", "全部渠道");

  for (const row of rows) {
    const channel = normalizeChannel(firstNonEmpty(row.utmSource, row.channel, row.source, row.referrer));
    const current = byChannel.get(channel.key) ?? emptyRow(channel.key, channel.label);
    increment(current, row.type);
    increment(total, row.type);
    byChannel.set(channel.key, current);
  }

  const channels = Array.from(byChannel.values())
    .map(withRates)
    .sort((a, b) => b.detailViews - a.detailViews || b.registrationReservations - a.registrationReservations || a.label.localeCompare(b.label, "zh-Hans-CN"));

  return {
    total: withRates(total),
    channels,
  };
}

function increment(row: AttributionFunnelRow, type: string) {
  if (type === "event_detail_view") row.detailViews += 1;
  else if (type === "registration_intent") row.registrationIntents += 1;
  else if (type === "registration_submit") row.registrationSubmits += 1;
  else if (type === "registration_reserved") row.registrationReservations += 1;
}

function emptyRow(key: string, label: string): AttributionFunnelRow {
  return {
    key,
    label,
    detailViews: 0,
    registrationIntents: 0,
    registrationSubmits: 0,
    registrationReservations: 0,
    detailToIntentRate: null,
    intentToSubmitRate: null,
    submitToReservedRate: null,
  };
}

function withRates(row: AttributionFunnelRow): AttributionFunnelRow {
  return {
    ...row,
    detailToIntentRate: pct(row.registrationIntents, row.detailViews),
    intentToSubmitRate: pct(row.registrationSubmits, row.registrationIntents),
    submitToReservedRate: pct(row.registrationReservations, row.registrationSubmits),
  };
}

function pct(numerator: number, denominator: number) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 100);
}

function pickAttribution(input: Record<string, unknown> | undefined) {
  const source = input ?? {};
  const picked: Record<string, string> = {};
  for (const rawKey of ATTRIBUTION_KEYS) {
    const key = CAMEL_TO_SNAKE[rawKey] || rawKey;
    const value = clean(source[rawKey]);
    if (value) picked[key] = value;
  }
  if (!picked.channel) {
    const channel = firstNonEmpty(picked.utm_source, picked.source, picked.from);
    if (channel) picked.channel = channel;
  }
  return picked;
}

function clean(value: unknown, max = 120) {
  if (Array.isArray(value)) value = value[0];
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, max);
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const out = clean(value);
    if (out) return out;
  }
  return "";
}

function normalizeChannel(raw: unknown): { key: string; label: string } {
  const value = clean(raw);
  const lower = value.toLowerCase();
  if (!value) return { key: "unknown", label: channelLabel("unknown", "未标注来源") };
  if (["huodongxing", "hdx"].includes(lower) || value.includes("活动行")) {
    return { key: "huodongxing", label: channelLabel("huodongxing", "活动行") };
  }
  if (["guest_share", "speaker_share", "speaker_referral"].includes(lower) || value.includes("嘉宾转发") || value.includes("讲师转发")) {
    return { key: "guest_share", label: channelLabel("guest_share", "嘉宾转发") };
  }
  if (["community_partner", "community_cohost", "community_referral"].includes(lower) || value.includes("社群合作")) {
    return { key: "community_partner", label: channelLabel("community_partner", "社群合作") };
  }
  if (["wechat_group", "weixin_group", "wx_group"].includes(lower) || value.includes("微信群") || value.includes("社群") || value.includes("群")) {
    return { key: "wechat_group", label: channelLabel("wechat_group", "微信群") };
  }
  if (["wechat_share", "wx_share", "mini_program_share"].includes(lower) || value.includes("微信分享")) {
    return { key: "wechat_share", label: channelLabel("wechat_share", "微信分享") };
  }
  if (["wechat_timeline", "wx_timeline"].includes(lower) || value.includes("朋友圈分享")) {
    return { key: "wechat_timeline", label: channelLabel("wechat_timeline", "朋友圈分享") };
  }
  if (["moments", "wechat_moments", "pyq"].includes(lower) || value.includes("朋友圈")) {
    return { key: "moments", label: channelLabel("moments", "朋友圈") };
  }
  if (["xiaohongshu", "xhs", "rednote"].includes(lower) || value.includes("小红书")) {
    return { key: "xiaohongshu", label: channelLabel("xiaohongshu", "小红书") };
  }
  if (["official_account", "wechat_official", "公众号"].includes(lower) || value.includes("公众号")) {
    return { key: "official_account", label: channelLabel("official_account", "公众号") };
  }
  if (["friend_referral", "referral"].includes(lower) || value.includes("朋友") || value.includes("推荐")) {
    return { key: "friend_referral", label: channelLabel("friend_referral", "朋友推荐") };
  }
  if (["partner", "sponsor"].includes(lower) || value.includes("合作")) {
    return { key: "partner", label: channelLabel("partner", "合作方") };
  }
  if (["search", "seo"].includes(lower) || value.includes("搜索")) {
    return { key: "search", label: channelLabel("search", "搜索") };
  }
  if (["organic", "direct"].includes(lower) || value.includes("自然")) {
    return { key: "organic", label: channelLabel("organic", "自然访问") };
  }
  return { key: lower.replace(/[^a-z0-9_]+/g, "_") || "unknown", label: channelLabel(lower, value) };
}

function channelLabel(key: string, fallback: string) {
  return CHANNEL_LABELS[key] ?? fallback;
}

function metadataText(value: Record<string, unknown> | undefined) {
  if (!value || typeof value !== "object") return null;
  const json = JSON.stringify(value);
  return json.length > 1600 ? json.slice(0, 1600) : json;
}
