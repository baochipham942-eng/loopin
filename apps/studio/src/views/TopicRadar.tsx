import { useEffect, useState } from "react";
import { centsToYuan, formatCNY, type BudgetInput, type BudgetResult } from "@loopin/core";
import { api } from "../api.js";
import type { CreateEventDraft, FormState } from "./CreateEvent.js";

/**
 * 主办方·选题雷达（P1 重构后聚焦版）。
 * 只做一件事：输入选题条件 → 给出可直接带入建活动的选题建议。
 * 信号录入 / 来源优先级 / 外部 feed 预检等运营能力已迁到平台端「选题信号源」。
 */

interface TopicRadarMarketSignal {
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

interface TopicRadarSuggestion {
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
  budgetResult: BudgetResult;
  marketSignals: TopicRadarMarketSignal[];
  sourceBreakdown: { source: string; label: string; heat: number; hits: number; evidence: string[] }[];
  confidence: number;
  eventPageSeed: { theme: string; audience: string; style: string };
  score: number;
  source: string;
}

interface TopicSignalCatalog {
  signals: (TopicRadarMarketSignal & { matchScore: number; matchedFields: string[] })[];
  sources: { source: string; label: string; count: number; maxHeat: number; latestUpdatedAt: string; topEvidence: string[] }[];
  facets: { cities: string[]; industries: string[]; audiences: string[]; formats: string[]; sources: string[] };
  updatedAt: string;
}

interface RadarForm {
  industry: string;
  city: string;
  audience: string;
  format: string;
}

const DEFAULT_FORM: RadarForm = {
  industry: "AI",
  city: "上海",
  audience: "产品经理、创业者",
  format: "工作坊",
};

export function TopicRadar({ onUseTopic }: { onUseTopic: (draft: CreateEventDraft) => void }) {
  const [form, setForm] = useState<RadarForm>(DEFAULT_FORM);
  const [suggestions, setSuggestions] = useState<TopicRadarSuggestion[]>([]);
  const [signalCatalog, setSignalCatalog] = useState<TopicSignalCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    generate(DEFAULT_FORM);
  }, []);

  async function generate(nextForm = form) {
    setLoading(true);
    setError("");
    try {
      const [data, catalog] = await Promise.all([
        api.post("/topic-radar/suggestions", { ...nextForm, limit: 6 }),
        api.get(signalCatalogPath(nextForm)),
      ]);
      setSuggestions(data.suggestions || []);
      setSignalCatalog(catalog);
    } catch (err) {
      setError(err instanceof Error ? err.message : "选题生成失败");
    } finally {
      setLoading(false);
    }
  }

  function set<K extends keyof RadarForm>(key: K, value: RadarForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const signalCount = signalCatalog?.signals.length ?? 0;

  return (
    <div className="single">
      <section className="radar-shell">
        <div className="dash-head">
          <div>
            <h2>选题雷达</h2>
            <p className="muted ops-intro">输入行业、城市、人群和形式，生成能直接带入盈亏测算的活动选题。</p>
          </div>
          <button className="mini-btn" onClick={() => generate()} disabled={loading}>
            {loading ? "生成中" : "刷新选题"}
          </button>
        </div>

        <div className="radar-form">
          <label className="field">
            <span>行业方向</span>
            <div className="input-wrap"><input value={form.industry} onChange={(e) => set("industry", e.target.value)} /></div>
          </label>
          <label className="field">
            <span>城市</span>
            <div className="input-wrap"><input value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
          </label>
          <label className="field">
            <span>目标人群</span>
            <div className="input-wrap"><input value={form.audience} onChange={(e) => set("audience", e.target.value)} /></div>
          </label>
          <label className="field">
            <span>活动形式</span>
            <select className="select full" value={form.format} onChange={(e) => set("format", e.target.value)}>
              <option value="工作坊">工作坊</option>
              <option value="沙龙">沙龙</option>
              <option value="圆桌">圆桌</option>
              <option value="案例复盘">案例复盘</option>
              <option value="路演">路演</option>
            </select>
          </label>
        </div>

        {error && <div className="verdict warn" style={{ marginTop: 12 }}>{error}</div>}

        {loading && suggestions.length === 0 ? (
          <div className="muted" style={{ marginTop: 16 }}>正在生成选题…</div>
        ) : (
          <div className="radar-grid">
            {suggestions.map((item) => (
              <article className="radar-card" key={item.id}>
                <div className="radar-head">
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.tagline}</p>
                  </div>
                  <span>{Math.round(item.score)} 分 · {item.confidence}%</span>
                </div>
                <p className="radar-reason">{item.recommendationReason}</p>

                <div className="radar-tags">
                  {item.targetAudience.map((audience) => <span key={audience}>{audience}</span>)}
                </div>

                <div className="radar-metrics">
                  <Small label="票价" value={formatCNY(item.suggestedPriceCents)} />
                  <Small label="规模" value={`${item.suggestedScale} 人`} />
                  <Small label="保本" value={item.budgetResult.breakEvenAttendees === null ? "—" : `${item.budgetResult.breakEvenAttendees} 人`} />
                  <Small label="利润" value={formatCNY(item.budgetResult.projectedProfitCents)} />
                </div>

                <RadarList title="参考" items={item.benchmarkReferences} />
                <RadarList title="嘉宾" items={item.potentialGuests} />
                <RadarList title="风险" items={item.risks} />

                <div className="radar-actions">
                  <button className="mini-btn" onClick={() => onUseTopic(topicDraft(item))}>带入建活动</button>
                </div>
              </article>
            ))}
          </div>
        )}

        {signalCount > 0 && (
          <div className="radar-evidence">
            <button className="ghost-btn" type="button" onClick={() => setShowEvidence((v) => !v)}>
              {showEvidence ? "收起" : "展开"}选题背后的市场信号（{signalCount}）
            </button>
            {showEvidence && <SignalPanel catalog={signalCatalog} />}
          </div>
        )}
      </section>
    </div>
  );
}

function signalCatalogPath(form: RadarForm) {
  const params = new URLSearchParams();
  params.set("limit", "8");
  for (const [key, value] of Object.entries(form)) {
    if (value.trim()) params.set(key, value.trim());
  }
  return `/topic-radar/signals?${params.toString()}`;
}

function topicDraft(item: TopicRadarSuggestion): CreateEventDraft {
  const preset = item.budgetPreset;
  return {
    title: `${item.title} · ${item.city}`,
    city: item.city,
    venue: `${item.city} · 待定场地`,
    capacity: item.suggestedScale,
    ticketKind: preset.ticketPriceCents > 0 ? "paid" : "free",
    aiTheme: item.eventPageSeed.theme,
    aiAudience: item.eventPageSeed.audience,
    form: budgetToForm(preset),
  };
}

function budgetToForm(input: BudgetInput): Partial<FormState> {
  return {
    ticketPrice: centsToYuan(input.ticketPriceCents),
    targetAttendees: input.targetAttendees,
    showUpRate: input.showUpRate,
    venueCost: centsToYuan(input.venueCostCents),
    materialsCost: centsToYuan(input.materialsCostCents),
    speakerFee: centsToYuan(input.speakerFeeCents),
    laborCost: centsToYuan(input.laborCostCents),
    marketingCost: centsToYuan(input.marketingCostCents),
    cateringPerPerson: centsToYuan(input.cateringPerPersonCents),
    sponsorship: centsToYuan(input.sponsorshipCents),
  };
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="ops-small">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function RadarList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="radar-list">
      <b>{title}</b>
      <span>{items.slice(0, 3).join(" / ")}</span>
    </div>
  );
}

function SignalPanel({ catalog }: { catalog: TopicSignalCatalog | null }) {
  if (!catalog) return null;
  const signals = catalog.signals ?? [];
  const sources = catalog.sources ?? [];
  return (
    <section className="radar-source-panel">
      <div className="radar-source-head">
        <div>
          <h3>信号来源</h3>
          <p>{signals.length} 条匹配信号 · {sources.length} 个来源 · 更新 {catalog.updatedAt || ""}</p>
        </div>
        <span>{catalog.facets.industries.slice(0, 4).join(" / ") || "市场信号"}</span>
      </div>

      <div className="radar-source-grid">
        {sources.slice(0, 4).map((source) => (
          <div className="radar-source-card" key={source.source}>
            <div>
              <b>{source.label}</b>
              <span>{source.count} 条 · 热度 {source.maxHeat}</span>
            </div>
            <p>{source.topEvidence[0]}</p>
          </div>
        ))}
      </div>

      <div className="signal-list">
        {signals.slice(0, 5).map((signal) => (
          <div className="signal-row" key={signal.id}>
            <div className="signal-main">
              <div className="signal-title">
                <b>{signal.topic}</b>
                <span>{signal.label}</span>
              </div>
              <p>{signal.evidence}</p>
              <div className="signal-meta">
                {[signal.city, ...signal.industries.slice(0, 2), ...signal.matchedFields].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="signal-heat">
              <b>{signal.matchScore}</b>
              <span>匹配分</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
