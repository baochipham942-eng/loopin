import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createTopicSignal, type TopicSignalInput } from "./topic-radar.js";

interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal; method?: string; headers?: Record<string, string> }) => Promise<FetchResponseLike>;

export interface TopicSignalFeedConfig {
  url: string;
  source?: string;
  label?: string;
  method?: string;
  headers?: Record<string, string>;
  auth?: {
    type?: string;
    token?: string;
    env?: string;
    header?: string;
    prefix?: string;
  };
  itemsPath?: string;
  fieldMap?: Record<string, string | string[]>;
}

export interface TopicSignalSyncOptions {
  urls?: string[];
  feeds?: TopicSignalFeedConfig[];
  fetcher?: FetchLike;
  timeoutMs?: number;
}

export interface TopicSignalSyncResult {
  configured: boolean;
  feeds: number;
  synced: number;
  failed: number;
  errors: string[];
}

export interface TopicSignalFeedPreviewOptions {
  raw?: string;
  feeds?: TopicSignalFeedConfig[];
  fetcher?: FetchLike;
  timeoutMs?: number;
  sampleSize?: number;
}

export interface TopicSignalFeedPreviewResult {
  configured: boolean;
  feeds: number;
  ok: number;
  failed: number;
  previews: {
    url: string;
    source: string;
    label: string;
    ok: boolean;
    status?: number;
    count: number;
    sample: TopicSignalInput[];
    error?: string;
  }[];
}

export interface TopicSignalFeedStatusResult {
  configured: boolean;
  envVar: string;
  feeds: number;
  valid: number;
  invalid: number;
  authRequired: number;
  authReady: number;
  missingAuthEnv: string[];
  errors: string[];
  feedStatuses: {
    url: string;
    host: string;
    source: string;
    label: string;
    method: string;
    valid: boolean;
    error?: string;
    auth: {
      required: boolean;
      ready: boolean;
      type?: string;
      header?: string;
      env?: string;
      envPresent?: boolean;
      inlineToken: boolean;
    };
    headers: {
      total: number;
      envRefs: string[];
      missingEnvRefs: string[];
    };
    itemsPath?: string;
    fieldMap: string[];
  }[];
  recommendations: string[];
}

export async function syncTopicSignalsFromFeeds(db: PrismaClient, options: TopicSignalSyncOptions = {}): Promise<TopicSignalSyncResult> {
  const feeds = options.feeds ?? (options.urls ? options.urls.map((url) => ({ url })) : topicSignalFeedSources());
  if (!feeds.length) return { configured: false, feeds: 0, synced: 0, failed: 0, errors: [] };

  const fetcher = options.fetcher ?? globalThis.fetch;
  const result: TopicSignalSyncResult = { configured: true, feeds: feeds.length, synced: 0, failed: 0, errors: [] };

  for (const feed of feeds) {
    try {
      assertFeedUrl(feed.url);
      const text = await fetchWithTimeout(fetcher, feed, options.timeoutMs ?? 12000);
      const signals = normalizeFeedSignals(feed, JSON.parse(text));
      for (const signal of signals) {
        await createTopicSignal(db, signal);
        result.synced += 1;
      }
    } catch (err) {
      result.failed += 1;
      result.errors.push(`${feedLabel(feed.url)}: ${err instanceof Error ? err.message : "同步失败"}`);
    }
  }

  return result;
}

export async function previewTopicSignalFeeds(options: TopicSignalFeedPreviewOptions = {}): Promise<TopicSignalFeedPreviewResult> {
  const feeds = options.feeds ?? topicSignalFeedSources(options.raw);
  if (!feeds.length) return { configured: false, feeds: 0, ok: 0, failed: 0, previews: [] };

  const fetcher = options.fetcher ?? globalThis.fetch;
  const sampleSize = Math.max(1, Math.min(options.sampleSize ?? 3, 10));
  const result: TopicSignalFeedPreviewResult = { configured: true, feeds: feeds.length, ok: 0, failed: 0, previews: [] };

  for (const feed of feeds) {
    const source = clean(feed.source) || safeSourceFromUrl(feed.url);
    const label = clean(feed.label) || safeLabelFromUrl(feed.url);
    try {
      assertFeedUrl(feed.url);
      const text = await fetchWithTimeout(fetcher, feed, options.timeoutMs ?? 12000);
      const signals = normalizeFeedSignals(feed, JSON.parse(text));
      result.ok += 1;
      result.previews.push({
        url: feed.url,
        source,
        label,
        ok: true,
        count: signals.length,
        sample: signals.slice(0, sampleSize),
      });
    } catch (err) {
      result.failed += 1;
      result.previews.push({
        url: feed.url,
        source,
        label,
        ok: false,
        count: 0,
        sample: [],
        error: err instanceof Error ? err.message : "预检失败",
      });
    }
  }

  return result;
}

export function topicSignalFeedUrls(raw = process.env.TOPIC_SIGNAL_FEED_URLS) {
  return topicSignalFeedSources(raw).map((feed) => feed.url);
}

export function topicSignalFeedSources(raw = process.env.TOPIC_SIGNAL_FEED_URLS): TopicSignalFeedConfig[] {
  return parseFeedConfig(raw).slice(0, 10);
}

export function topicSignalFeedStatus(raw = process.env.TOPIC_SIGNAL_FEED_URLS): TopicSignalFeedStatusResult {
  const envVar = "TOPIC_SIGNAL_FEED_URLS";
  const value = clean(raw);
  if (!value) {
    return {
      configured: false,
      envVar,
      feeds: 0,
      valid: 0,
      invalid: 0,
      authRequired: 0,
      authReady: 0,
      missingAuthEnv: [],
      errors: [],
      feedStatuses: [],
      recommendations: ["配置 TOPIC_SIGNAL_FEED_URLS 后，外部来源才会进入定时同步。"],
    };
  }

  let feeds: TopicSignalFeedConfig[];
  try {
    feeds = topicSignalFeedSources(value);
  } catch (err) {
    return {
      configured: false,
      envVar,
      feeds: 0,
      valid: 0,
      invalid: 1,
      authRequired: 0,
      authReady: 0,
      missingAuthEnv: [],
      errors: [`${envVar}: ${err instanceof Error ? err.message : "配置解析失败"}`],
      feedStatuses: [],
      recommendations: ["修正 TOPIC_SIGNAL_FEED_URLS 的 JSON 或 URL 列表格式。"],
    };
  }

  const feedStatuses = feeds.map(feedStatus);
  const missingAuthEnv = unique(feedStatuses.flatMap((feed) => [
    ...(feed.auth.env && !feed.auth.envPresent ? [feed.auth.env] : []),
    ...feed.headers.missingEnvRefs,
  ]));
  const authFeeds = feedStatuses.filter((feed) => feed.auth.required || feed.headers.envRefs.length > 0);
  const authReady = authFeeds.filter((feed) => feed.auth.ready && feed.headers.missingEnvRefs.length === 0).length;
  const invalid = feedStatuses.filter((feed) => !feed.valid).length;
  const valid = feedStatuses.length - invalid;

  return {
    configured: feedStatuses.length > 0,
    envVar,
    feeds: feedStatuses.length,
    valid,
    invalid,
    authRequired: authFeeds.length,
    authReady,
    missingAuthEnv,
    errors: feedStatuses.filter((feed) => feed.error).map((feed) => `${feed.label}: ${feed.error}`),
    feedStatuses,
    recommendations: feedStatusRecommendations(feedStatuses.length, invalid, missingAuthEnv),
  };
}

async function fetchWithTimeout(fetcher: FetchLike, feed: TopicSignalFeedConfig, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(feed.url, {
      signal: controller.signal,
      method: normalizeMethod(feed.method),
      headers: feedHeaders(feed),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeFeedSignals(feed: TopicSignalFeedConfig, payload: unknown): TopicSignalInput[] {
  const items = feedItems(payload, feed.itemsPath);
  const source = clean(feed.source) || sourceFromUrl(feed.url);
  const label = clean(feed.label) || labelFromUrl(feed.url);
  return items.map((item, index) => {
    const signal = isRecord(item) ? item : {};
    return {
      id: mappedClean(signal, feed, "externalId", ["externalId", "id", "eventId", "url"]) || fallbackExternalId(feed.url, signal, index),
      source: mappedClean(signal, feed, "source", ["source"]) || source,
      label: mappedClean(signal, feed, "label", ["label"]) || label,
      topic: mappedClean(signal, feed, "topic", ["topic", "title", "name", "eventName", "subject"]),
      city: mappedClean(signal, feed, "city", ["city", "venue.city", "location.city", "address.city"]),
      industries: mappedList(signal, feed, "industries", ["industries", "industry", "categories", "category"]),
      audiences: mappedList(signal, feed, "audiences", ["audiences", "audience", "targetAudience", "target"]),
      formats: mappedList(signal, feed, "formats", ["formats", "format", "eventType", "type"]),
      heat: numberValue(mappedValue(signal, feed, "heat", ["heat", "score", "popularity", "stats.popularity", "registrations", "attendees"])),
      evidence: mappedClean(signal, feed, "evidence", ["evidence", "summary", "description", "intro", "content"]),
      opportunity: mappedClean(signal, feed, "opportunity", ["opportunity", "recommendation", "insight"]),
      capturedAt: mappedClean(signal, feed, "capturedAt", ["capturedAt", "updatedAt", "startAt", "date"]),
    };
  });
}

function parseFeedConfig(raw = ""): TopicSignalFeedConfig[] {
  const value = raw.trim();
  if (!value) return [];

  if (value.startsWith("[") || value.startsWith("{")) {
    const parsed = JSON.parse(value) as unknown;
    const feeds = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.feeds) ? parsed.feeds : [parsed];
    return feeds
      .map((feed) => typeof feed === "string" ? { url: feed } : isRecord(feed) ? feedConfig(feed) : null)
      .filter((feed): feed is TopicSignalFeedConfig => Boolean(feed?.url));
  }

  return value
    .split(/[\n,]/)
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
}

function feedConfig(feed: Record<string, unknown>): TopicSignalFeedConfig {
  return {
    url: clean(feed.url),
    source: clean(feed.source) || undefined,
    label: clean(feed.label) || undefined,
    method: clean(feed.method) || undefined,
    headers: recordOfStrings(feed.headers),
    auth: isRecord(feed.auth) ? {
      type: clean(feed.auth.type) || undefined,
      token: clean(feed.auth.token) || undefined,
      env: clean(feed.auth.env) || undefined,
      header: clean(feed.auth.header) || undefined,
      prefix: clean(feed.auth.prefix) || undefined,
    } : undefined,
    itemsPath: clean(feed.itemsPath) || undefined,
    fieldMap: fieldMap(feed.fieldMap),
  };
}

function feedItems(payload: unknown, itemsPath?: string): unknown[] {
  const mapped = itemsPath ? getPath(payload, itemsPath) : undefined;
  if (Array.isArray(mapped)) return mapped;
  if (isRecord(mapped)) return [mapped];
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  const candidates = [payload.signals, payload.items, payload.data, payload.results, payload.events];
  const list = candidates.find(Array.isArray);
  if (Array.isArray(list)) return list;
  return isRecord(payload.signal) ? [payload.signal] : [];
}

function mappedValue(signal: Record<string, unknown>, feed: TopicSignalFeedConfig, target: string, aliases: string[]) {
  const paths = normalizePaths(feed.fieldMap?.[target]);
  for (const path of [...paths, ...aliases]) {
    const value = getPath(signal, path);
    if (hasValue(value)) return value;
  }
  return undefined;
}

function mappedClean(signal: Record<string, unknown>, feed: TopicSignalFeedConfig, target: string, aliases: string[]) {
  return clean(mappedValue(signal, feed, target, aliases));
}

function mappedList(signal: Record<string, unknown>, feed: TopicSignalFeedConfig, target: string, aliases: string[]) {
  return listValue(mappedValue(signal, feed, target, aliases));
}

function listValue(value: unknown) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value);
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return undefined;
}

function assertFeedUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("feed URL 格式不正确");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("feed URL 只支持 http/https");
}

function normalizeMethod(method?: string) {
  const value = clean(method).toUpperCase();
  return value && ["GET", "POST"].includes(value) ? value : "GET";
}

function feedHeaders(feed: TopicSignalFeedConfig) {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(feed.headers ?? {})) {
    const headerValue = secretValue(value);
    if (key && headerValue) headers[key] = headerValue;
  }
  const auth = feed.auth;
  if (auth) {
    const token = secretValue(auth.token) || (auth.env ? clean(process.env[auth.env]) : "");
    if (token) {
      const header = auth.header || (auth.type === "apiKey" ? "X-API-Key" : "Authorization");
      const prefix = auth.prefix ?? (auth.type === "apiKey" ? "" : "Bearer ");
      headers[header] = `${prefix}${token}`;
    }
  }
  return headers;
}

function secretValue(value: unknown) {
  const text = clean(value);
  if (!text) return "";
  if (text.startsWith("env:")) return clean(process.env[text.slice(4)]);
  return text;
}

function sourceFromUrl(value: string) {
  const url = new URL(value);
  return `feed_${url.hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`.slice(0, 80);
}

function safeSourceFromUrl(value: string) {
  try {
    return sourceFromUrl(value);
  } catch {
    return "feed_invalid";
  }
}

function labelFromUrl(value: string) {
  const url = new URL(value);
  return url.hostname.replace(/^www\./, "") || "外部信号源";
}

function safeLabelFromUrl(value: string) {
  try {
    return labelFromUrl(value);
  } catch {
    return value || "外部信号源";
  }
}

function fallbackExternalId(url: string, signal: Record<string, unknown>, index: number) {
  const hash = createHash("sha1")
    .update(url)
    .update(String(index))
    .update(clean(signal.topic) || clean(signal.title))
    .update(clean(signal.evidence) || clean(signal.summary))
    .digest("hex")
    .slice(0, 16);
  return `feed_${hash}`;
}

function feedLabel(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function feedStatus(feed: TopicSignalFeedConfig): TopicSignalFeedStatusResult["feedStatuses"][number] {
  let valid = true;
  let error: string | undefined;
  try {
    assertFeedUrl(feed.url);
  } catch (err) {
    valid = false;
    error = err instanceof Error ? err.message : "feed URL 不可用";
  }

  const authEnv = authEnvName(feed.auth);
  const authInline = Boolean(clean(feed.auth?.token) && !clean(feed.auth?.token).startsWith("env:"));
  const authEnvPresent = authEnv ? Boolean(clean(process.env[authEnv])) : undefined;
  const authRequired = Boolean(feed.auth);
  const headerEnvRefs = unique(Object.values(feed.headers ?? {}).map(headerEnvName).filter(Boolean));
  const missingHeaderEnv = headerEnvRefs.filter((env) => !clean(process.env[env]));

  return {
    url: safeFeedUrl(feed.url),
    host: safeFeedHost(feed.url),
    source: clean(feed.source) || safeSourceFromUrl(feed.url),
    label: clean(feed.label) || safeLabelFromUrl(feed.url),
    method: normalizeMethod(feed.method),
    valid,
    ...(error ? { error } : {}),
    auth: {
      required: authRequired,
      ready: !authRequired || authInline || Boolean(authEnvPresent),
      type: clean(feed.auth?.type) || undefined,
      header: clean(feed.auth?.header) || (feed.auth?.type === "apiKey" ? "X-API-Key" : authRequired ? "Authorization" : undefined),
      env: authEnv || undefined,
      envPresent: authEnv ? Boolean(authEnvPresent) : undefined,
      inlineToken: authInline,
    },
    headers: {
      total: Object.keys(feed.headers ?? {}).length,
      envRefs: headerEnvRefs,
      missingEnvRefs: missingHeaderEnv,
    },
    itemsPath: clean(feed.itemsPath) || undefined,
    fieldMap: Object.keys(feed.fieldMap ?? {}),
  };
}

function feedStatusRecommendations(feedCount: number, invalid: number, missingEnv: string[]) {
  const recommendations: string[] = [];
  if (!feedCount) recommendations.push("配置 TOPIC_SIGNAL_FEED_URLS 后，外部来源才会进入定时同步。");
  if (invalid) recommendations.push("修正无效 feed URL 或描述符格式。");
  if (missingEnv.length) recommendations.push(`补齐鉴权环境变量：${missingEnv.join("、")}`);
  if (feedCount && !invalid && !missingEnv.length) recommendations.push("配置可被同步器读取，建议用预检确认返回样本。");
  return recommendations;
}

function authEnvName(auth: TopicSignalFeedConfig["auth"]) {
  if (!auth) return "";
  const env = clean(auth.env);
  if (env) return env;
  return headerEnvName(auth.token);
}

function headerEnvName(value: unknown) {
  const text = clean(value);
  return text.startsWith("env:") ? clean(text.slice(4)) : "";
}

function safeFeedUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, "***");
    }
    return url.toString();
  } catch {
    return clean(value).slice(0, 120);
  }
}

function safeFeedHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values.map(clean).filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordOfStrings(value: unknown) {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, item]) => [key.trim(), clean(item)] as const)
    .filter(([key, item]) => key && item);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function fieldMap(value: unknown) {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value)
    .map(([key, item]) => [key.trim(), Array.isArray(item) ? item.map(clean).filter(Boolean) : clean(item)] as const)
    .filter(([key, item]) => key && (Array.isArray(item) ? item.length : item));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizePaths(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const path = clean(value);
  return path ? [path] : [];
}

function getPath(value: unknown, path: string) {
  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  let current = value;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function hasValue(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return clean(value).length > 0;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
