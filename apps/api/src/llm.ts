import { ProxyAgent } from "undici";
import { jsonrepair } from "jsonrepair";

/** OpenAI 兼容 LLM 客户端（默认接 MiMo / 小米）。海外端点经代理。
 *  配置走 .env：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / LLM_PROXY。 */

const BASE = process.env.LLM_BASE_URL ?? "";
const KEY = process.env.LLM_API_KEY ?? "";
const MODEL = process.env.LLM_MODEL ?? "mimo-v2.5-pro";
const PROXY = process.env.LLM_PROXY;
const dispatcher = PROXY ? new ProxyAgent(PROXY) : undefined;

export function llmConfigured(): boolean {
  return Boolean(BASE && KEY);
}

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(
  messages: ChatMsg[],
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  if (!llmConfigured()) throw new Error("LLM 未配置：请在 apps/api/.env 设置 LLM_BASE_URL / LLM_API_KEY");
  const init = {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 1600,
    }),
    dispatcher,
  };
  // undici@7 的 dispatcher 不在标准 RequestInit 里，且与 node 内置 undici-types 冲突，故 as any
  const res = await fetch(`${BASE}/chat/completions`, init as any);
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

/** 要求模型只输出 JSON，解析为 T；带去围栏/截取兜底。 */
export async function chatJSON<T>(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<T> {
  const messages: ChatMsg[] = [
    { role: "system", content: system + "\n\n严格只输出 JSON 对象，不要 markdown 代码块、不要任何解释文字、不要思考过程。" },
    { role: "user", content: user },
  ];
  const maxTokens = opts.maxTokens ?? 2500;
  // LLM 偶发返回不规整 JSON（概率性，非确定 bug）。先 extractJSON（含 jsonrepair 兜底），仍失败再重试。
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await chat(messages, { temperature: opts.temperature ?? 0.4, maxTokens });
    try {
      return extractJSON<T>(raw);
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error("LLM 返回的 JSON 解析失败（已重试）：" + (lastErr as Error)?.message);
}

/**
 * 从模型输出里提取并解析 JSON。
 * 1) 去 markdown 围栏；2) 截取最外层 {...} 或 [...]；3) 直接 parse；4) 失败则用 jsonrepair 修复后再 parse
 *    （修缺逗号/多余逗号/未转义换行/单引号等 LLM 常见瑕疵）。
 */
export function extractJSON<T>(raw: string): T {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  // 截取最外层 JSON 容器（对象或数组）
  const start = firstJsonStart(s);
  const end = lastJsonEnd(s);
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s) as T;
  } catch {
    // 兜底：修复后再 parse；修复仍失败则抛原始解析错误
    return JSON.parse(jsonrepair(s)) as T;
  }
}

function firstJsonStart(s: string): number {
  const obj = s.indexOf("{");
  const arr = s.indexOf("[");
  if (obj < 0) return arr;
  if (arr < 0) return obj;
  return Math.min(obj, arr);
}

function lastJsonEnd(s: string): number {
  return Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
}
