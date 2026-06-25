import type { PrismaClient } from "@prisma/client";
import { summarizeFeedback, type EventFeedbackSummary } from "./feedbacks.js";
import { publicEventResource } from "./resources.js";
import { suggestTopics } from "./topic-radar.js";
import { summarizeAttributionFunnel } from "./attribution.js";

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function pct(numerator: number, denominator: number) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 100);
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("、");
  return String(value).trim();
}

function containsAny(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const out = text(value);
    if (out) return out;
  }
  return "";
}

function topValues(values: string[], limit = 4) {
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    if (!value) return acc;
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

const CHANNEL_LABELS: Record<string, string> = {
  wechat_group: "微信群",
  moments: "朋友圈",
  xiaohongshu: "小红书",
  official_account: "公众号",
  friend_referral: "朋友推荐",
  wechat_share: "微信分享",
  wechat_timeline: "朋友圈分享",
  community: "社群",
  partner: "合作方",
  search: "搜索",
  organic: "自然访问",
  other: "其他",
  unknown: "未标注来源",
};

const SOURCE_KEYS = ["utm_source", "utmSource", "channel", "referrer", "from", "source", "来源", "渠道"];
const CAMPAIGN_KEYS = ["utm_campaign", "utmCampaign"];
const CONTENT_KEYS = ["utm_content", "utmContent"];
const REFERRER_KEYS = ["referrer", "from"];

function channelLabel(key: string, fallback: string) {
  return CHANNEL_LABELS[key] ?? fallback;
}

function normalizeChannel(raw: unknown): { key: string; label: string } {
  const value = text(raw);
  const lower = value.toLowerCase();
  if (!value) return { key: "unknown", label: channelLabel("unknown", "未标注来源") };
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
  if (["official_account", "公众号", "wechat_official"].includes(lower) || value.includes("公众号")) {
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
  return { key: lower.replace(/[^a-z0-9_]+/g, "_") || "other", label: channelLabel(lower, value) };
}

type ReviewRegistration = {
  status: string;
  checkIn: { id: string } | null;
  values: Record<string, unknown>;
};

function sourceForRegistration(registration: ReviewRegistration) {
  for (const key of SOURCE_KEYS) {
    const source = firstNonEmpty(registration.values[key]);
    if (source) return normalizeChannel(source);
  }
  return normalizeChannel("");
}

function trackingValue(values: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = firstNonEmpty(values[key]);
    if (value) return value;
  }
  return "";
}

function incrementCount(map: Map<string, number>, value: string) {
  if (!value) return;
  map.set(value, (map.get(value) ?? 0) + 1);
}

function countItems(map: Map<string, number>, limit = 3) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function buildMaterialCount(materials: { channel: string }[]) {
  return materials.reduce<Record<string, number>>((acc, item) => {
    const channel = normalizeChannel(item.channel);
    acc[channel.key] = (acc[channel.key] ?? 0) + 1;
    return acc;
  }, {});
}

function buildChannelAttribution(registrations: ReviewRegistration[], materialCount: Record<string, number>) {
  const byChannel = new Map<string, {
    key: string;
    label: string;
    registrations: number;
    confirmed: number;
    checkedIn: number;
    materialVersions: number;
    referrers: Map<string, number>;
    campaigns: Map<string, number>;
    contents: Map<string, number>;
  }>();

  for (const registration of registrations) {
    const channel = sourceForRegistration(registration);
    const current = byChannel.get(channel.key) ?? {
      key: channel.key,
      label: channel.label,
      registrations: 0,
      confirmed: 0,
      checkedIn: 0,
      materialVersions: materialCount[channel.key] ?? 0,
      referrers: new Map<string, number>(),
      campaigns: new Map<string, number>(),
      contents: new Map<string, number>(),
    };
    current.registrations += 1;
    if (registration.status === "approved" || registration.status === "checked_in") current.confirmed += 1;
    if (registration.status === "checked_in" || registration.checkIn) current.checkedIn += 1;
    incrementCount(current.referrers, trackingValue(registration.values, REFERRER_KEYS));
    incrementCount(current.campaigns, trackingValue(registration.values, CAMPAIGN_KEYS));
    incrementCount(current.contents, trackingValue(registration.values, CONTENT_KEYS));
    byChannel.set(channel.key, current);
  }

  for (const [key, count] of Object.entries(materialCount)) {
    if (byChannel.has(key)) continue;
    byChannel.set(key, {
      key,
      label: channelLabel(key, key),
      registrations: 0,
      confirmed: 0,
      checkedIn: 0,
      materialVersions: count,
      referrers: new Map<string, number>(),
      campaigns: new Map<string, number>(),
      contents: new Map<string, number>(),
    });
  }

  const channels = Array.from(byChannel.values())
    .map((channel) => ({
      key: channel.key,
      label: channel.label,
      registrations: channel.registrations,
      confirmed: channel.confirmed,
      checkedIn: channel.checkedIn,
      materialVersions: channel.materialVersions,
      referrers: countItems(channel.referrers),
      campaigns: countItems(channel.campaigns),
      contents: countItems(channel.contents),
      conversionRate: pct(channel.confirmed, channel.registrations),
      showUpRate: pct(channel.checkedIn, channel.confirmed),
      insight: channel.registrations
        ? `${channel.label}带来 ${channel.registrations} 个报名，${channel.confirmed} 个确认。${trackingInsight(channel.referrers, channel.contents)}`
        : `${channel.label}已生成 ${channel.materialVersions} 版物料，暂未归因到报名。`,
    }))
    .sort((a, b) => b.registrations - a.registrations || b.materialVersions - a.materialVersions || a.label.localeCompare(b.label, "zh-Hans-CN"));

  return {
    totalAttributed: channels.reduce((sum, channel) => sum + (channel.key === "unknown" ? 0 : channel.registrations), 0),
    unattributed: channels.find((channel) => channel.key === "unknown")?.registrations ?? 0,
    channels,
  };
}

function trackingInsight(referrers: Map<string, number>, contents: Map<string, number>) {
  const referrer = countItems(referrers, 1)[0];
  const content = countItems(contents, 1)[0];
  const parts = [referrer ? `主要入口 ${referrer.label}` : "", content ? `素材 ${content.label}` : ""].filter(Boolean);
  return parts.length ? ` ${parts.join("，")}。` : "";
}

function buildReinviteScripts(
  eventTitle: string,
  nextTopicTitle: string,
  segments: { key: string; label: string; count: number }[],
  feedback: EventFeedbackSummary
) {
  const topic = feedback.nextTopics[0]?.label || nextTopicTitle || "下一场同频局";
  const ratingText = feedback.averageRating ? `这场平均反馈 ${feedback.averageRating} 分，` : "";
  const templates: Record<string, string> = {
    high_intent: `${ratingText}上次「${eventTitle}」里你已经确认参与。下一场我们想围绕「${topic}」继续做小范围交流，先给老参与者留一批优先名额。`,
    potential_guests: `上次「${eventTitle}」里有一批人带着真实案例和经验。下一场「${topic}」想做得更像案例复盘，如果你愿意，可以先聊一个 10 分钟分享位。`,
    potential_sponsors: `这场「${eventTitle}」已经跑出一批明确画像的参与者。下一场「${topic}」可以提前放合作露出和社群触达，适合先约赞助/合作方案。`,
    no_show: `上次「${eventTitle}」你报名后没到现场。我们准备把下一场「${topic}」做成更小规模、更强提醒的版本，可以先给你补一个优先名额。`,
    waitlist: `上次「${eventTitle}」候补里还有人没进场。下一场「${topic}」准备先开早鸟和候补优先席，建议先从这批人开始复邀。`,
  };

  return segments
    .filter((segment) => segment.count > 0)
    .map((segment) => ({
      segmentKey: segment.key,
      label: segment.label,
      count: segment.count,
      copy: templates[segment.key] ?? `下一场「${topic}」可以优先复邀「${segment.label}」这批人。`,
    }));
}

function resourceTypeLabel(type: string) {
  const labels: Record<string, string> = {
    link: "资料链接",
    slides: "演示文稿",
    notes: "活动笔记",
    recording: "回放录音",
    gallery: "照片合集",
  };
  return labels[type] ?? "活动资料";
}

export async function getEventReview(db: PrismaClient, eventId: string, now: Date = new Date()) {
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: {
      review: true,
      budgetPlan: true,
      registrations: {
        select: {
          id: true,
          status: true,
          formValues: true,
          checkIn: { select: { id: true } },
          order: { select: { amountCents: true, lifecycle: true, payment_status: true } },
        },
      },
      materials: { select: { channel: true } },
      resources: { orderBy: { createdAt: "desc" }, take: 20 },
      feedbacks: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!event) return null;

  const counts: Record<string, number> = {};
  for (const r of event.registrations) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const confirmed = (counts.approved ?? 0) + (counts.checked_in ?? 0);
  const checkedIn = counts.checked_in ?? 0;
  const paidOrders = event.registrations.filter((r) => r.order?.payment_status === "paid");
  const revenueCents = paidOrders.reduce((sum, r) => sum + (r.order?.amountCents ?? 0), 0);
  const total = event.registrations.length;
  const budget = event.budgetPlan ? parseJSON<Record<string, unknown>>(event.budgetPlan.result, {}) : null;
  const saved = event.review ? parseJSON<Record<string, unknown>>(event.review.summary, {}) : null;
  const materialCount = buildMaterialCount(event.materials);
  const ended = event.status === "completed" || event.startAt.getTime() < now.getTime();
  const parsedRegistrations = event.registrations.map((registration) => ({
    ...registration,
    values: parseJSON<Record<string, unknown>>(registration.formValues, {}),
  }));
  const roles = topValues(parsedRegistrations.map((registration) => firstNonEmpty(
    registration.values.role,
    registration.values.profession,
    registration.values.identity,
    registration.values.title
  )));
  const companies = topValues(parsedRegistrations.map((registration) => firstNonEmpty(registration.values.company, registration.values.organization)));
  const highIntent = parsedRegistrations.filter((registration) => registration.status === "checked_in" || registration.status === "approved");
  const noShow = ended
    ? parsedRegistrations.filter((registration) => registration.status === "approved" && !registration.checkIn)
    : [];
  const potentialGuests = parsedRegistrations.filter((registration) => {
    const profile = [
      registration.values.role,
      registration.values.profession,
      registration.values.title,
      registration.values.company,
      registration.values.note,
      registration.values.bio,
    ].map(text).join(" ");
    return containsAny(profile, ["创始人", "负责人", "专家", "讲师", "投资", "VP", "总监", "主理人"]);
  });
  const potentialSponsors = parsedRegistrations.filter((registration) => {
    const profile = [
      registration.values.company,
      registration.values.role,
      registration.values.profession,
      registration.values.note,
      registration.values.bio,
    ].map(text).join(" ");
    return containsAny(profile, ["品牌", "市场", "增长", "BD", "商务", "赞助", "合作", "社区"]);
  });
  const segments = [
    { key: "high_intent", label: "高意愿复邀", count: highIntent.length, action: "优先发复盘和下一场内测邀请" },
    { key: "potential_guests", label: "潜在嘉宾", count: potentialGuests.length, action: "筛出有案例的人，约下一场分享" },
    { key: "potential_sponsors", label: "潜在赞助", count: potentialSponsors.length, action: "从品牌/增长/BD 画像里找合作线索" },
    { key: "no_show", label: "报名未到场", count: noShow.length, action: "单独触达原因，下一场给候补或提醒策略" },
    { key: "waitlist", label: "候补复邀", count: counts.waitlisted ?? 0, action: "下一场开早鸟或优先名额" },
  ];
  const primaryAudience = roles.map((role) => role.label).join("、") || "AI 产品/创业方向年轻人";
  const nextTopics = suggestTopics({
    industry: event.title.includes("出海") ? "出海" : event.title.includes("增长") ? "增长" : "AI",
    city: event.city,
    audience: primaryAudience,
    limit: 3,
  }).map((topic) => ({
    id: topic.id,
    title: topic.title,
    tagline: topic.tagline,
    suggestedPriceCents: topic.suggestedPriceCents,
    suggestedScale: topic.suggestedScale,
    breakEvenAttendees: topic.budgetResult.breakEvenAttendees,
  }));
  const feedbackSummary = summarizeFeedback(event.feedbacks, event.feedbacks.length);
  const channelAttribution = buildChannelAttribution(parsedRegistrations, materialCount);
  const attributionFunnel = await summarizeAttributionFunnel(db, event.id);
  const reinviteScripts = buildReinviteScripts(event.title, nextTopics[0]?.title ?? "", segments, feedbackSummary);
  const publicResources = event.resources
    .filter((resource) => resource.visibility !== "organizer")
    .map(publicEventResource);
  const resourcePack = [
    ...publicResources.map((resource) => ({
      ...resource,
      status: "ready",
      detail: resource.description || resourceTypeLabel(resource.type),
      source: "uploaded",
    })),
    { title: "活动资料包", status: ended ? "ready" : "pending", detail: ended ? "整理议程、重点观点和延伸阅读" : "活动结束后整理", source: "suggested" },
    { title: "讲师资料", status: potentialGuests.length ? "ready" : "pending", detail: potentialGuests.length ? "可从报名画像里筛潜在讲师" : "暂无明确讲师线索", source: "suggested" },
    { title: "精选问题", status: checkedIn ? "ready" : "pending", detail: checkedIn ? "从现场互动和表单备注里整理问题" : "签到和互动数据不足", source: "suggested" },
  ];

  return {
    event: {
      id: event.id,
      title: event.title,
      city: event.city,
      venue: event.venue,
      startAt: event.startAt,
      status: event.status,
      ended,
    },
    metrics: {
      totalRegistrations: total,
      confirmed,
      checkedIn,
      noShow: noShow.length,
      waitlisted: counts.waitlisted ?? 0,
      rejected: counts.rejected ?? 0,
      cancelled: counts.cancelled ?? 0,
      showUpRate: pct(checkedIn, confirmed),
      conversionRate: pct(confirmed, total),
      materialVersions: event.materials.length,
      channelCount: materialCount,
      revenueCents,
      estimatedProfitCents: typeof budget?.projectedProfitCents === "number"
        ? budget.projectedProfitCents
        : typeof budget?.profitAtTargetCents === "number"
          ? budget.profitAtTargetCents
          : null,
      breakEvenAttendees: typeof budget?.breakEvenAttendees === "number" ? budget.breakEvenAttendees : null,
    },
    audience: {
      roles,
      companies,
      segments,
    },
    growth: {
      channelAttribution,
      attributionFunnel,
      reinviteScripts,
    },
    resourcePack,
    feedback: {
      status: ended ? "ready" : "pending",
      title: "活动反馈问卷",
      questions: ["这场活动最有价值的部分是什么？", "你希望下一场继续聊什么？", "是否愿意作为嘉宾/赞助/志愿者参与？"],
      ...feedbackSummary,
    },
    nextTopics,
    review: saved,
    takeaways: Array.isArray(saved?.takeaways)
      ? saved.takeaways
      : [
          confirmed ? `已确认 ${confirmed} 人，后续可重点追踪到场率。` : "还没有确认报名，先复盘选题和招募入口。",
          checkedIn ? `已签到 ${checkedIn} 人，可沉淀为下一场优先邀请名单。` : "暂无签到记录，现场核验数据还不足。",
          event.materials.length ? `已生成 ${event.materials.length} 版招募物料，可对比渠道触达效果。` : "还没有物料记录，下一场建议先做渠道话术对比。",
          channelAttribution.totalAttributed ? `已有 ${channelAttribution.totalAttributed} 个报名带来源，可优先复投 ${channelAttribution.channels[0]?.label ?? "高转化渠道"}。` : "报名来源还没沉淀，下一场建议保留「从哪里知道的」字段。",
          publicResources.length ? `已补 ${publicResources.length} 个会后资料入口，可直接给参与者同步。` : "会后资料还没上传，先补演示文稿、活动笔记或回放链接。",
          roles.length ? `报名画像以 ${roles.map((role) => role.label).join("、")} 为主，下一场可以围绕这批人继续加深。` : "报名画像还不够清晰，下一场报名表建议保留身份和公司字段。",
        ],
    nextActions: Array.isArray(saved?.nextActions)
      ? saved.nextActions
      : [
          "整理高意愿参与者名单",
          "给潜在嘉宾和赞助线索打标签",
          "按渠道归因复投高转化入口",
          "复制复邀话术触达高意愿参与者",
          "补齐活动资料链接并同步给参与者",
          "补一条活动复盘和下场预告",
          "把本场预算和报名数据复制到下一场测算",
        ],
  };
}
