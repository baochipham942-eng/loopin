import { chatJSON } from "../llm.js";

/** AI 生成：活动页文案 + 多渠道推广物料（接 MiMo）。
 *  确定性系统（支付/库存/状态）不走这里；这里只产文案，主办方可改。 */

export interface EventPageInput {
  theme: string;
  audience?: string;
  style?: string;
  priceText?: string;
  speaker?: string;
  city?: string;
}

export interface GeneratedEventPage {
  title: string;
  tagline: string;
  highlights: string[];
  agenda: string[];
  forWho: string[];
  faq: { q: string; a: string }[];
  notes: string[];
}

const PAGE_SYS =
  "你是 Loopin 的活动页文案策划，Loopin 是面向年轻人的同频活动平台。文案要真诚、有吸引力、口语化，突出'能认识同频的人、值得来'，不要浮夸、不要空话套话、不要明显的 AI 腔。";

export async function generateEventPage(input: EventPageInput): Promise<GeneratedEventPage> {
  const user = `为下面这场线下活动生成活动页文案。输出 JSON，字段：
title(活动标题, ≤20字), tagline(一句话核心卖点, ≤25字), highlights(亮点, 3-4条, 每条≤20字), agenda(议程, 3-5条), forWho(适合谁, 3-4个人群标签), faq(常见问题, 3条, 每条为{q,a}), notes(报名须知, 2-3条)。

活动主题：${input.theme}
目标人群：${input.audience || "AI 产品/创业/增长方向的年轻从业者"}
风格基调：${input.style || "AI 科技感 + 城市沙龙"}
票价：${input.priceText || "待定"}
嘉宾：${input.speaker || "暂未确定"}
城市：${input.city || "上海"}`;
  const raw = await chatJSON<any>(PAGE_SYS, user, { maxTokens: 2000 });
  // LLM 输出形状不保证（概率性）：归一化到类型契约，避免前端崩
  return {
    title: str(raw?.title),
    tagline: str(raw?.tagline),
    highlights: arr(raw?.highlights),
    agenda: arr(raw?.agenda),
    forWho: arr(raw?.forWho),
    faq: faqArr(raw?.faq),
    notes: arr(raw?.notes),
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function arr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : str(x))).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}
function faqArr(v: unknown): { q: string; a: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => ({ q: str(x?.q), a: str(x?.a) }))
    .filter((x) => x.q || x.a);
}
function xhsArr(v: unknown): { title: string; body: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => (typeof x === "string" ? { title: "", body: x } : { title: str(x?.title), body: str(x?.body) }))
    .filter((x) => x.title || x.body);
}

export interface MaterialsInput {
  title: string;
  highlights?: string[];
  audience?: string;
  priceText?: string;
  timeText?: string;
  venue?: string;
  city?: string;
}

export interface GeneratedMaterials {
  moments: string[]; // 朋友圈
  wechatGroup: string[]; // 微信群话术
  xiaohongshu: { title: string; body: string }[]; // 小红书
  officialAccount: string[]; // 公众号导语
}

const MAT_SYS =
  "你是社媒推广文案专家，给面向年轻人的线下活动写各渠道推广文案。每个渠道语气不同：朋友圈口语化带情绪、微信群简短有行动号召、小红书有钩子标题和话题标签、公众号导语有信息量。不要浮夸、不要 AI 腔。";

export async function generateMaterials(input: MaterialsInput): Promise<GeneratedMaterials> {
  const user = `为下面这场活动生成多渠道推广文案。输出 JSON，字段：
moments(朋友圈文案, 2条, 口语化可带 emoji, 每条≤80字),
wechatGroup(微信群转发话术, 2条, 简短带报名号召),
xiaohongshu(小红书笔记, 2条, 每条{title(带emoji钩子, ≤20字), body(≤120字, 结尾带2-3个#话题标签)}),
officialAccount(公众号推文开头导语, 1条, ≤120字)。

活动标题：${input.title}
亮点：${(input.highlights || []).join("；") || "（见标题）"}
目标人群：${input.audience || "AI 产品/创业方向年轻人"}
时间：${input.timeText || "待定"}
地点：${input.venue || input.city || "上海"}
票价：${input.priceText || "待定"}`;
  const raw = await chatJSON<any>(MAT_SYS, user, { maxTokens: 2400 });
  return {
    moments: arr(raw?.moments),
    wechatGroup: arr(raw?.wechatGroup),
    xiaohongshu: xhsArr(raw?.xiaohongshu),
    officialAccount: arr(raw?.officialAccount),
  };
}
