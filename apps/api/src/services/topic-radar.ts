import { calcBudget, type BudgetInput } from "@loopin/core";
import type { PrismaClient, TopicSignal as TopicSignalRow } from "@prisma/client";

export interface TopicRadarInput {
  industry?: string;
  city?: string;
  audience?: string;
  format?: string;
  limit?: number;
  externalSignals?: TopicRadarSignal[];
}

export interface TopicRadarSignal {
  id: string;
  source: string;
  label: string;
  topic: string;
  city?: string;
  industries: string[];
  audiences: string[];
  formats: string[];
  heat: number;
  evidence: string;
  opportunity: string;
  updatedAt: string;
}

export interface TopicSignalInput {
  id?: string;
  externalId?: string;
  source?: string;
  label?: string;
  topic?: string;
  city?: string;
  industries?: string[] | string;
  audiences?: string[] | string;
  formats?: string[] | string;
  heat?: number;
  evidence?: string;
  opportunity?: string;
  status?: string;
  capturedAt?: string;
  updatedAt?: string;
}

export interface TopicRadarSignalQuery {
  industry?: string;
  city?: string;
  audience?: string;
  format?: string;
  source?: string;
  limit?: number;
  externalSignals?: TopicRadarSignal[];
}

export interface TopicRadarSignalCatalogItem extends TopicRadarSignal {
  matchScore: number;
  matchedFields: string[];
}

export interface TopicRadarSignalCatalog {
  signals: TopicRadarSignalCatalogItem[];
  sources: {
    source: string;
    label: string;
    count: number;
    maxHeat: number;
    latestUpdatedAt: string;
    topEvidence: string[];
  }[];
  facets: {
    cities: string[];
    industries: string[];
    audiences: string[];
    formats: string[];
    sources: string[];
  };
  updatedAt: string;
}

export interface TopicRadarSuggestion {
  id: string;
  title: string;
  tagline: string;
  recommendationReason: string;
  targetAudience: string[];
  suggestedPriceCents: number;
  suggestedScale: number;
  city: string;
  format: string;
  benchmarkReferences: string[];
  potentialGuests: string[];
  potentialSponsors: string[];
  risks: string[];
  budgetPreset: BudgetInput;
  budgetResult: ReturnType<typeof calcBudget>;
  marketSignals: TopicRadarSignal[];
  sourceBreakdown: {
    source: string;
    label: string;
    heat: number;
    hits: number;
    evidence: string[];
  }[];
  confidence: number;
  eventPageSeed: {
    theme: string;
    audience: string;
    style: string;
  };
  score: number;
  source: string;
}

const SIGNAL_STATUSES = new Set(["active", "archived"]);

export class TopicSignalError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

interface RadarSeed {
  id: string;
  title: string;
  tagline: string;
  industries: string[];
  audiences: string[];
  formats: string[];
  basePriceCents: number;
  baseScale: number;
  baseCosts: Omit<BudgetInput, "ticketPriceCents" | "targetAttendees" | "showUpRate" | "sponsorshipCents">;
  reason: string;
  benchmarks: string[];
  guests: string[];
  sponsors: string[];
  risks: string[];
  style: string;
}

const BUILTIN_SIGNAL_UPDATED_AT = "2026-06-07";

const CITY_COST: Record<string, { venue: number; catering: number; marketing: number }> = {
  北京: { venue: 420000, catering: 7000, marketing: 180000 },
  上海: { venue: 420000, catering: 7000, marketing: 180000 },
  深圳: { venue: 360000, catering: 6500, marketing: 160000 },
  杭州: { venue: 320000, catering: 6000, marketing: 140000 },
  广州: { venue: 320000, catering: 6000, marketing: 140000 },
  成都: { venue: 240000, catering: 5000, marketing: 110000 },
};
const DEFAULT_CITY_COST = CITY_COST.上海!;

const SEEDS: RadarSeed[] = [
  {
    id: "ai-agent-workflow",
    title: "AI Agent 工作流实战局",
    tagline: "把 Agent 从概念拉到真实工作流",
    industries: ["AI", "产品", "效率工具"],
    audiences: ["产品经理", "创业者", "运营", "独立开发者"],
    formats: ["沙龙", "工作坊"],
    basePriceCents: 19900,
    baseScale: 50,
    baseCosts: baseCosts({ speakerFeeCents: 200000, materialsCostCents: 80000 }),
    reason: "AI Agent 讨论热度高，但主办方容易停在概念层。实战工作流能让参与者带走可复用方法，付费意愿更明确。",
    benchmarks: ["Luma 上的 AI builder 小型沙龙", "产品社群里的 Agent 工作流分享"],
    guests: ["AI 产品负责人", "自动化工具创业者", "真实落地过 Agent 的 PM"],
    sponsors: ["AI 工具服务商", "低代码平台", "云服务开发者生态"],
    risks: ["容易变成泛泛聊趋势", "嘉宾必须有真实案例", "需要提前收集参与者工具栈"],
    style: "AI 科技感 + 实战工坊",
  },
  {
    id: "ai-product-night",
    title: "AI 产品人深夜局",
    tagline: "聊产品人正在经历的工作方式变化",
    industries: ["AI", "产品", "职场成长"],
    audiences: ["产品经理", "设计师", "运营"],
    formats: ["圆桌", "沙龙"],
    basePriceCents: 15900,
    baseScale: 40,
    baseCosts: baseCosts({ speakerFeeCents: 150000, materialsCostCents: 60000 }),
    reason: "产品人面对 AI 转型有焦虑也有表达欲，圆桌型活动更容易形成同频感和复购。",
    benchmarks: ["城市 PM 社群闭门夜谈", "AI 产品经理同频交流局"],
    guests: ["AI 产品经理", "有转型经验的传统 PM", "产品团队负责人"],
    sponsors: ["招聘平台", "AI 学习产品", "效率工具"],
    risks: ["话题过宽会散", "需要主持人控制分享深度", "报名表要筛掉纯蹭热点人群"],
    style: "城市沙龙 + 深夜谈话",
  },
  {
    id: "global-growth-retro",
    title: "出海增长复盘局",
    tagline: "拆一条真实出海增长路径",
    industries: ["出海", "增长", "创业"],
    audiences: ["创业者", "增长负责人", "产品经理"],
    formats: ["案例复盘", "圆桌"],
    basePriceCents: 29900,
    baseScale: 45,
    baseCosts: baseCosts({ speakerFeeCents: 300000, materialsCostCents: 100000 }),
    reason: "出海团队更愿意为真实案例付费，复盘型内容比泛趋势更容易转化高质量报名。",
    benchmarks: ["跨境 SaaS 增长闭门会", "独立开发者出海复盘"],
    guests: ["出海 SaaS 创始人", "海外增长负责人", "跨境投放操盘手"],
    sponsors: ["云服务商", "支付服务商", "跨境营销工具"],
    risks: ["真实数据披露尺度有限", "容易被广告化", "需要明确行业范围"],
    style: "创业复盘 + 闭门讨论",
  },
  {
    id: "indie-maker-revenue",
    title: "独立开发者变现夜校",
    tagline: "从 side project 到第一笔收入",
    industries: ["独立开发", "AI", "创业"],
    audiences: ["独立开发者", "设计师", "产品经理"],
    formats: ["工作坊", "路演"],
    basePriceCents: 9900,
    baseScale: 35,
    baseCosts: baseCosts({ speakerFeeCents: 100000, materialsCostCents: 50000 }),
    reason: "独立开发者需要低成本试错和同伴反馈，夜校形式能降低参与门槛并形成连续活动。",
    benchmarks: ["Indie Hackers meetup", "小型 maker demo night"],
    guests: ["有收入的独立开发者", "设计转开发创作者", "AI 小工具作者"],
    sponsors: ["开发者工具", "域名/云服务", "支付工具"],
    risks: ["项目成熟度差异大", "需要安排 demo 节奏", "票价不宜过高"],
    style: "轻量夜校 + demo 互评",
  },
  {
    id: "xiaohongshu-local-growth",
    title: "小红书本地获客拆解局",
    tagline: "把内容种草变成真实报名",
    industries: ["增长", "内容", "主理人"],
    audiences: ["主理人", "运营", "本地服务创业者"],
    formats: ["案例复盘", "工作坊"],
    basePriceCents: 19900,
    baseScale: 45,
    baseCosts: baseCosts({ speakerFeeCents: 180000, materialsCostCents: 90000 }),
    reason: "本地活动和主理人品牌都需要低成本获客，小红书案例拆解能直接服务报名增长。",
    benchmarks: ["主理人内容增长课", "本地生活种草复盘会"],
    guests: ["小红书运营负责人", "本地品牌主理人", "内容增长顾问"],
    sponsors: ["内容工具", "本地生活服务商", "摄影/设计工作室"],
    risks: ["平台规则更新快", "案例容易停在表面", "需要准备可复制模板"],
    style: "主理人局 + 增长工作坊",
  },
  {
    id: "b2b-sales-interview",
    title: "B2B 客户访谈实战局",
    tagline: "把客户访谈做成销售和产品共用资产",
    industries: ["B2B", "产品", "销售"],
    audiences: ["产品经理", "销售负责人", "创业者"],
    formats: ["工作坊", "沙龙"],
    basePriceCents: 25900,
    baseScale: 35,
    baseCosts: baseCosts({ speakerFeeCents: 250000, materialsCostCents: 80000 }),
    reason: "B2B 团队对客户理解有刚需，访谈方法能同时服务产品决策和销售转化。",
    benchmarks: ["SaaS 产品增长工作坊", "客户发现实战训练营"],
    guests: ["B2B 产品负责人", "销售 VP", "做过客户发现的创始人"],
    sponsors: ["CRM 工具", "销售自动化工具", "企业服务社区"],
    risks: ["参与者行业差异大", "需要现场练习材料", "案例保密边界要提前说明"],
    style: "B2B 实战工作坊",
  },
  {
    id: "creator-brand-salon",
    title: "主理人品牌增长小局",
    tagline: "从个人表达走到稳定成交",
    industries: ["主理人", "内容", "增长"],
    audiences: ["主理人", "自由职业者", "内容创作者"],
    formats: ["圆桌", "沙龙"],
    basePriceCents: 12900,
    baseScale: 30,
    baseCosts: baseCosts({ speakerFeeCents: 120000, materialsCostCents: 60000 }),
    reason: "主理人需要同频圈层和可执行的私域增长方法，小规模圆桌更容易建立信任。",
    benchmarks: ["主理人闭门茶话会", "内容创作者线下共学"],
    guests: ["稳定经营私域的主理人", "个人品牌顾问", "内容创作者"],
    sponsors: ["空间品牌", "设计工具", "社群工具"],
    risks: ["容易变成经验闲聊", "要控制人数和画像", "复购需要连续主题"],
    style: "主理人圆桌 + 城市生活感",
  },
  {
    id: "startup-finance-drill",
    title: "早期创业融资演练场",
    tagline: "把 pitch、财务和问答提前练一遍",
    industries: ["创业", "融资", "产品"],
    audiences: ["创业者", "独立开发者", "产品负责人"],
    formats: ["路演", "工作坊"],
    basePriceCents: 29900,
    baseScale: 30,
    baseCosts: baseCosts({ speakerFeeCents: 300000, materialsCostCents: 100000 }),
    reason: "早期团队愿意为高质量反馈付费，路演演练能带来强参与感和后续服务机会。",
    benchmarks: ["pre-demo day 路演训练", "创业者闭门 pitch night"],
    guests: ["早期投资人", "连续创业者", "财务顾问"],
    sponsors: ["创业服务机构", "云服务商", "联合办公空间"],
    risks: ["参与者项目质量不齐", "需避免投资承诺暗示", "时间控制要求高"],
    style: "创业路演 + 结构化反馈",
  },
];

export function suggestTopics(input: TopicRadarInput = {}): TopicRadarSuggestion[] {
  const city = clean(input.city) || "上海";
  const limit = Math.max(1, Math.min(10, input.limit ?? 6));
  const signals = signalCatalog(input.externalSignals);
  return SEEDS
    .map((seed, index) => buildSuggestion(seed, input, city, signals, index))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "zh-Hans-CN"))
    .slice(0, limit);
}

export function listTopicSignals(input: TopicRadarSignalQuery = {}): TopicRadarSignalCatalog {
  const limit = Math.max(1, Math.min(50, input.limit ?? 12));
  const source = clean(input.source);
  const hasQuery = Boolean(clean(input.industry) || clean(input.city) || clean(input.audience) || clean(input.format));
  const allSignals = signalCatalog(input.externalSignals);
  const scored = allSignals
    .map((signal) => {
      const match = signalQueryMatch(input, signal);
      return { ...signal, matchScore: match.score, matchedFields: match.fields };
    })
    .filter((signal) => !source || signal.source === source)
    .filter((signal) => !hasQuery || signal.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore || b.heat - a.heat || a.id.localeCompare(b.id));

  return {
    signals: scored.slice(0, limit),
    sources: sourceSummaries(scored),
    facets: signalFacets(allSignals),
    updatedAt: latestUpdatedAt(allSignals),
  };
}

export async function createTopicSignal(db: PrismaClient, input: TopicSignalInput) {
  const data = topicSignalData(input);
  const signal = data.externalId
    ? await db.topicSignal.upsert({
        where: { source_externalId: { source: data.source, externalId: data.externalId } },
        create: data,
        update: data,
      })
    : await db.topicSignal.create({ data });

  return { signal: topicSignalRowToRadarSignal(signal) };
}

export async function listTopicSignalsFromDb(db: PrismaClient, input: TopicRadarSignalQuery = {}) {
  const persistedSignals = await loadActiveTopicSignals(db);
  return listTopicSignals({
    ...input,
    externalSignals: [...persistedSignals, ...(input.externalSignals ?? [])],
  });
}

export async function suggestTopicsFromDb(db: PrismaClient, input: TopicRadarInput = {}) {
  const persistedSignals = await loadActiveTopicSignals(db);
  return suggestTopics({
    ...input,
    externalSignals: [...persistedSignals, ...(input.externalSignals ?? [])],
  });
}

function buildSuggestion(seed: RadarSeed, input: TopicRadarInput, city: string, signals: TopicRadarSignal[], index: number): TopicRadarSuggestion {
  const format = bestMatch(clean(input.format), seed.formats) || seed.formats[0] || "沙龙";
  const audience = mergeAudience(clean(input.audience), seed.audiences);
  const marketSignals = matchSignals(seed, input, city, signals).slice(0, 4);
  const score = scoreSeed(seed, input, marketSignals, index);
  const suggestedScale = seed.baseScale;
  const suggestedPriceCents = priceForCity(seed.basePriceCents, city);
  const budgetPreset = buildBudget(seed, city, suggestedPriceCents, suggestedScale);
  const sourceBreakdown = sourceBreakdownFor(seed, marketSignals);
  return {
    id: seed.id,
    title: seed.title,
    tagline: seed.tagline,
    recommendationReason: seed.reason,
    targetAudience: audience,
    suggestedPriceCents,
    suggestedScale,
    city,
    format,
    benchmarkReferences: seed.benchmarks,
    potentialGuests: seed.guests,
    potentialSponsors: seed.sponsors,
    risks: seed.risks,
    budgetPreset,
    budgetResult: calcBudget(budgetPreset),
    marketSignals,
    sourceBreakdown,
    confidence: confidenceFor(sourceBreakdown),
    eventPageSeed: {
      theme: seed.title,
      audience: audience.join("、"),
      style: seed.style,
    },
    score,
    source: marketSignals.length ? "manual_seed_v1+market_signal_v1" : "manual_seed_v1",
  };
}

function buildBudget(seed: RadarSeed, city: string, ticketPriceCents: number, targetAttendees: number): BudgetInput {
  const cityCost = CITY_COST[city] ?? DEFAULT_CITY_COST;
  return {
    ...seed.baseCosts,
    ticketPriceCents,
    targetAttendees,
    showUpRate: 0.85,
    venueCostCents: cityCost.venue,
    cateringPerPersonCents: cityCost.catering,
    marketingCostCents: Math.max(seed.baseCosts.marketingCostCents, cityCost.marketing),
    sponsorshipCents: 0,
  };
}

function baseCosts(overrides: Partial<BudgetInput> = {}): Omit<BudgetInput, "ticketPriceCents" | "targetAttendees" | "showUpRate" | "sponsorshipCents"> {
  return {
    venueCostCents: 300000,
    materialsCostCents: 80000,
    speakerFeeCents: 180000,
    laborCostCents: 100000,
    marketingCostCents: 120000,
    cateringPerPersonCents: 6000,
    ...overrides,
  };
}

function scoreSeed(seed: RadarSeed, input: TopicRadarInput, signals: TopicRadarSignal[], index: number) {
  let score = 70 - index;
  score += matchScore(input.industry, seed.industries, 16);
  score += matchScore(input.audience, seed.audiences, 12);
  score += matchScore(input.format, seed.formats, 8);
  score += signalScore(signals);
  return score;
}

function matchScore(value: string | undefined, candidates: string[], points: number) {
  const text = clean(value);
  if (!text) return 0;
  return candidates.some((candidate) => includesEither(text, candidate)) ? points : 0;
}

function bestMatch(value: string, candidates: string[]) {
  if (!value) return "";
  return candidates.find((candidate) => includesEither(value, candidate)) || "";
}

function mergeAudience(preferred: string, candidates: string[]) {
  if (!preferred) return candidates.slice(0, 4);
  const first = preferred.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set([...first, ...candidates])).slice(0, 4);
}

function priceForCity(base: number, city: string) {
  if (city === "北京" || city === "上海") return base + 2000;
  if (city === "成都") return Math.max(0, base - 2000);
  return base;
}

function includesEither(a: string, b: string) {
  const left = clean(a).toLowerCase();
  const right = clean(b).toLowerCase();
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function signalCatalog(extraSignals: TopicRadarSignal[] | undefined) {
  const extras = Array.isArray(extraSignals) ? extraSignals.map(normalizeSignal).filter(isSignal) : [];
  return [...extras, ...BUILTIN_SIGNALS];
}

function isSignal(signal: TopicRadarSignal | null): signal is TopicRadarSignal {
  return signal !== null;
}

function normalizeSignal(signal: TopicRadarSignal): TopicRadarSignal | null {
  const id = clean(signal.id);
  const topic = clean(signal.topic);
  const label = clean(signal.label);
  const source = clean(signal.source);
  if (!id || !topic || !label || !source) return null;
  return {
    id,
    topic,
    label,
    source,
    city: clean(signal.city),
    industries: normalizeList(signal.industries),
    audiences: normalizeList(signal.audiences),
    formats: normalizeList(signal.formats),
    heat: clampHeat(signal.heat),
    evidence: clean(signal.evidence),
    opportunity: clean(signal.opportunity),
    updatedAt: clean(signal.updatedAt) || BUILTIN_SIGNAL_UPDATED_AT,
  };
}

function normalizeList(values: unknown) {
  if (Array.isArray(values)) return uniqueSorted(values.map(clean).filter(Boolean)).slice(0, 8);
  if (typeof values === "string") return uniqueSorted(values.split(/[、,，/;\n]/).map(clean).filter(Boolean)).slice(0, 8);
  return [];
}

function clampHeat(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function matchSignals(seed: RadarSeed, input: TopicRadarInput, city: string, signals: TopicRadarSignal[]) {
  return signals
    .map((signal) => ({ signal, match: signalMatchScore(seed, input, city, signal) }))
    .filter((item) => item.match > 0)
    .sort((a, b) => b.match - a.match || b.signal.heat - a.signal.heat || a.signal.id.localeCompare(b.signal.id))
    .map((item) => item.signal);
}

function signalMatchScore(seed: RadarSeed, input: TopicRadarInput, city: string, signal: TopicRadarSignal) {
  let score = 0;
  if (signal.city && includesEither(signal.city, city)) score += 8;
  score += listOverlapScore(seed.industries, signal.industries, 8);
  score += listOverlapScore(seed.audiences, signal.audiences, 6);
  score += listOverlapScore(seed.formats, signal.formats, 5);
  if (input.industry) score += matchScore(input.industry, signal.industries, 5);
  if (input.audience) score += matchScore(input.audience, signal.audiences, 4);
  if (input.format) score += matchScore(input.format, signal.formats, 3);
  if (includesEither(seed.title, signal.topic) || includesEither(seed.tagline, signal.topic)) score += 10;
  return score ? score + signal.heat / 10 : 0;
}

function listOverlapScore(left: string[], right: string[], points: number) {
  if (!left.length || !right.length) return 0;
  return left.some((item) => right.some((candidate) => includesEither(item, candidate))) ? points : 0;
}

function signalScore(signals: TopicRadarSignal[]) {
  if (!signals.length) return 0;
  const heat = signals.reduce((sum, signal) => sum + signal.heat, 0) / signals.length;
  const sourceDiversity = new Set(signals.map((signal) => signal.source)).size;
  return Math.round(Math.min(22, heat / 7 + sourceDiversity * 3));
}

function sourceBreakdownFor(seed: RadarSeed, signals: TopicRadarSignal[]) {
  const bySource = new Map<string, { source: string; label: string; heat: number; hits: number; evidence: string[] }>();
  bySource.set("manual_seed_v1", {
    source: "manual_seed_v1",
    label: "内部选题种子",
    heat: 72,
    hits: 1,
    evidence: [seed.reason],
  });
  for (const signal of signals) {
    const current = bySource.get(signal.source) || {
      source: signal.source,
      label: signal.label,
      heat: 0,
      hits: 0,
      evidence: [],
    };
    current.hits += 1;
    current.heat = Math.max(current.heat, signal.heat);
    if (signal.evidence) current.evidence.push(signal.evidence);
    bySource.set(signal.source, current);
  }
  return Array.from(bySource.values()).map((item) => ({
    ...item,
    evidence: item.evidence.slice(0, 3),
  }));
}

function confidenceFor(breakdown: ReturnType<typeof sourceBreakdownFor>) {
  const sourceCount = breakdown.length;
  const avgHeat = breakdown.reduce((sum, item) => sum + item.heat, 0) / Math.max(1, breakdown.length);
  return Math.max(50, Math.min(95, Math.round(avgHeat * 0.55 + sourceCount * 10)));
}

function signalQueryMatch(input: TopicRadarSignalQuery, signal: TopicRadarSignal) {
  let score = 0;
  const fields: string[] = [];
  if (input.city && signal.city && includesEither(input.city, signal.city)) {
    score += 12;
    fields.push("城市");
  }
  if (queryListMatch(input.industry, signal.industries)) {
    score += 14;
    fields.push("行业");
  }
  if (queryListMatch(input.audience, signal.audiences)) {
    score += 10;
    fields.push("人群");
  }
  if (queryListMatch(input.format, signal.formats)) {
    score += 8;
    fields.push("形式");
  }
  if (!fields.length && !(input.industry || input.city || input.audience || input.format)) {
    return { score: Math.round(signal.heat), fields: ["热度"] };
  }
  return { score: score ? Math.round(score + signal.heat / 10) : 0, fields };
}

function queryListMatch(value: string | undefined, candidates: string[]) {
  const text = clean(value);
  if (!text) return false;
  const parts = text.split(/[、,，/]/).map((item) => item.trim()).filter(Boolean);
  return candidates.some((candidate) => includesEither(text, candidate) || parts.some((part) => includesEither(part, candidate)));
}

function sourceSummaries(signals: TopicRadarSignalCatalogItem[]) {
  const bySource = new Map<string, {
    source: string;
    label: string;
    count: number;
    maxHeat: number;
    latestUpdatedAt: string;
    evidence: { text: string; heat: number }[];
  }>();
  for (const signal of signals) {
    const current = bySource.get(signal.source) || {
      source: signal.source,
      label: signal.label,
      count: 0,
      maxHeat: 0,
      latestUpdatedAt: signal.updatedAt,
      evidence: [],
    };
    current.count += 1;
    current.maxHeat = Math.max(current.maxHeat, signal.heat);
    current.latestUpdatedAt = newerDate(current.latestUpdatedAt, signal.updatedAt);
    if (signal.evidence) current.evidence.push({ text: signal.evidence, heat: signal.heat });
    bySource.set(signal.source, current);
  }
  return Array.from(bySource.values())
    .map((item) => ({
      source: item.source,
      label: item.label,
      count: item.count,
      maxHeat: item.maxHeat,
      latestUpdatedAt: item.latestUpdatedAt,
      topEvidence: item.evidence.sort((a, b) => b.heat - a.heat).map((evidence) => evidence.text).slice(0, 3),
    }))
    .sort((a, b) => b.maxHeat - a.maxHeat || b.count - a.count || a.label.localeCompare(b.label, "zh-Hans-CN"));
}

function signalFacets(signals: TopicRadarSignal[]) {
  return {
    cities: uniqueSorted(signals.map((signal) => signal.city || "")),
    industries: uniqueSorted(signals.flatMap((signal) => signal.industries)),
    audiences: uniqueSorted(signals.flatMap((signal) => signal.audiences)),
    formats: uniqueSorted(signals.flatMap((signal) => signal.formats)),
    sources: uniqueSorted(signals.map((signal) => signal.source)),
  };
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.map(clean).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function latestUpdatedAt(signals: TopicRadarSignal[]) {
  return signals.reduce((latest, signal) => newerDate(latest, signal.updatedAt), BUILTIN_SIGNAL_UPDATED_AT);
}

function newerDate(left: string, right: string) {
  return Date.parse(right) > Date.parse(left) ? right : left;
}

async function loadActiveTopicSignals(db: PrismaClient) {
  const signals = await db.topicSignal.findMany({
    where: { status: "active" },
    orderBy: [{ updatedAt: "desc" }, { heat: "desc" }],
    take: 200,
  });
  return signals.map(topicSignalRowToRadarSignal);
}

function topicSignalData(input: TopicSignalInput) {
  const source = truncate(clean(input.source).replace(/\s+/g, "_"), 80);
  if (!source) throw new TopicSignalError(400, "invalid_source", "信号来源不能为空");

  const topic = truncate(clean(input.topic), 120);
  if (!topic) throw new TopicSignalError(400, "invalid_topic", "信号主题不能为空");

  const evidence = truncate(clean(input.evidence), 500);
  if (!evidence) throw new TopicSignalError(400, "invalid_evidence", "信号证据不能为空");

  const industries = normalizeList(input.industries);
  const audiences = normalizeList(input.audiences);
  const formats = normalizeList(input.formats);
  const city = truncate(clean(input.city), 40);
  if (!city && !industries.length && !audiences.length && !formats.length) {
    throw new TopicSignalError(400, "empty_match_fields", "信号至少需要城市、行业、人群或形式中的一个匹配字段");
  }

  const status = clean(input.status).toLowerCase();
  const capturedAt = parseDate(input.capturedAt || input.updatedAt);
  return {
    source,
    externalId: truncate(clean(input.externalId || input.id), 120) || null,
    label: truncate(clean(input.label), 80) || labelFromSource(source),
    topic,
    city: city || null,
    industries: JSON.stringify(industries),
    audiences: JSON.stringify(audiences),
    formats: JSON.stringify(formats),
    heat: clampHeat(Number(input.heat ?? 50)),
    evidence,
    opportunity: truncate(clean(input.opportunity), 500) || evidence,
    status: SIGNAL_STATUSES.has(status) ? status : "active",
    capturedAt,
  };
}

function topicSignalRowToRadarSignal(signal: TopicSignalRow): TopicRadarSignal {
  return {
    id: signal.externalId || signal.id,
    source: signal.source,
    label: signal.label,
    topic: signal.topic,
    city: signal.city || undefined,
    industries: parseJSON<string[]>(signal.industries, []),
    audiences: parseJSON<string[]>(signal.audiences, []),
    formats: parseJSON<string[]>(signal.formats, []),
    heat: clampHeat(signal.heat),
    evidence: signal.evidence,
    opportunity: signal.opportunity,
    updatedAt: signal.updatedAt.toISOString().slice(0, 10),
  };
}

function parseJSON<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseDate(value: string | undefined) {
  const raw = clean(value);
  if (!raw) return new Date();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new TopicSignalError(400, "invalid_date", "信号时间格式不正确");
  return date;
}

function labelFromSource(source: string) {
  if (source === "studio_live_feed") return "运营录入";
  return source.replace(/[_-]/g, " ");
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}

const BUILTIN_SIGNALS: TopicRadarSignal[] = [
  {
    id: "luma-ai-builders-agent",
    source: "public_event_sample",
    label: "公开活动样本",
    topic: "AI Agent builder meetup",
    city: "上海",
    industries: ["AI", "效率工具", "产品"],
    audiences: ["产品经理", "独立开发者", "创业者"],
    formats: ["工作坊", "沙龙"],
    heat: 88,
    evidence: "公开活动样本里 AI builder、Agent workflow、automation 主题持续出现。",
    opportunity: "把主题压到真实工作流和工具链，付费意愿更明确。",
    updatedAt: BUILTIN_SIGNAL_UPDATED_AT,
  },
  {
    id: "community-ai-pm-night",
    source: "community_observation",
    label: "社群观察",
    topic: "AI 产品转型与团队落地",
    city: "上海",
    industries: ["AI", "产品", "职场成长"],
    audiences: ["产品经理", "设计师", "运营"],
    formats: ["圆桌", "沙龙"],
    heat: 82,
    evidence: "产品/运营社群里围绕 AI 转型、组织落地和岗位变化的讨论密度高。",
    opportunity: "小规模闭门圆桌更容易沉淀同频关系和后续复邀。",
    updatedAt: BUILTIN_SIGNAL_UPDATED_AT,
  },
  {
    id: "crossborder-saas-growth",
    source: "industry_event_sample",
    label: "行业活动样本",
    topic: "跨境 SaaS 增长复盘",
    city: "深圳",
    industries: ["出海", "增长", "创业"],
    audiences: ["创业者", "增长负责人", "产品经理"],
    formats: ["案例复盘", "圆桌"],
    heat: 86,
    evidence: "出海和跨境 SaaS 活动更偏真实案例、增长路径和工具链拆解。",
    opportunity: "用闭门案例复盘承接高质量报名和赞助线索。",
    updatedAt: BUILTIN_SIGNAL_UPDATED_AT,
  },
  {
    id: "indie-maker-demo-night",
    source: "maker_community_sample",
    label: "开发者社区样本",
    topic: "独立开发者 demo night",
    city: "杭州",
    industries: ["独立开发", "AI", "创业"],
    audiences: ["独立开发者", "设计师", "产品经理"],
    formats: ["工作坊", "路演"],
    heat: 79,
    evidence: "maker 社区常见 demo night、side project 变现和工具互评主题。",
    opportunity: "低票价小规模连续活动适合做复购和项目展示。",
    updatedAt: BUILTIN_SIGNAL_UPDATED_AT,
  },
  {
    id: "xhs-local-growth",
    source: "content_platform_signal",
    label: "内容平台信号",
    topic: "小红书本地获客案例",
    city: "上海",
    industries: ["增长", "内容", "主理人"],
    audiences: ["主理人", "运营", "本地服务创业者"],
    formats: ["案例复盘", "工作坊"],
    heat: 84,
    evidence: "本地品牌、主理人和小红书获客案例天然贴近线下活动报名增长。",
    opportunity: "把内容案例拆成可复用模板，能服务活动获客和付费转化。",
    updatedAt: BUILTIN_SIGNAL_UPDATED_AT,
  },
  {
    id: "b2b-customer-discovery",
    source: "b2b_operator_signal",
    label: "B2B 运营信号",
    topic: "客户访谈与销售线索沉淀",
    city: "北京",
    industries: ["B2B", "产品", "销售"],
    audiences: ["产品经理", "销售负责人", "创业者"],
    formats: ["工作坊", "沙龙"],
    heat: 76,
    evidence: "B2B 团队反复需要客户发现、线索记录和产品销售协同方法。",
    opportunity: "用现场练习和模板资产提升客单价。",
    updatedAt: BUILTIN_SIGNAL_UPDATED_AT,
  },
  {
    id: "creator-private-domain",
    source: "creator_signal",
    label: "主理人信号",
    topic: "主理人私域成交",
    city: "成都",
    industries: ["主理人", "内容", "增长"],
    audiences: ["主理人", "自由职业者", "内容创作者"],
    formats: ["圆桌", "沙龙"],
    heat: 74,
    evidence: "主理人和自由职业者更关心稳定表达、私域转化和同行支持。",
    opportunity: "小规模圆桌更适合建立信任和连续主题。",
    updatedAt: BUILTIN_SIGNAL_UPDATED_AT,
  },
  {
    id: "startup-pitch-drill",
    source: "startup_ecosystem_signal",
    label: "创业生态信号",
    topic: "早期项目 pitch 训练",
    city: "北京",
    industries: ["创业", "融资", "产品"],
    audiences: ["创业者", "独立开发者", "产品负责人"],
    formats: ["路演", "工作坊"],
    heat: 81,
    evidence: "早期团队愿意为 pitch、财务模型和问答反馈付费。",
    opportunity: "路演演练能带来强参与感和后续服务机会。",
    updatedAt: BUILTIN_SIGNAL_UPDATED_AT,
  },
];
