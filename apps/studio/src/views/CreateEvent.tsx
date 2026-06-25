import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  calcBudget,
  compareScenarios,
  suggestPrice,
  recommendFields,
  yuanToCents,
  formatCNY,
  type BudgetInput,
  type BudgetResult,
} from "@loopin/core";
import { api } from "../api.js";
import { useCurrentEvent } from "../event/EventContext.js";

/**
 * 建活动·分步向导（P2 重构）。
 * ①活动信息 → ②盈亏测算 → ③配置落地页(AI) → ④发布。
 * 信息在前、测算在后（测算要用票价/人数）；分享素材是发布后的持续行为，不在向导里（见「分享素材」）。
 */

export interface FormState {
  ticketPrice: number;
  targetAttendees: number;
  showUpRate: number;
  venueCost: number;
  materialsCost: number;
  speakerFee: number;
  laborCost: number;
  marketingCost: number;
  cateringPerPerson: number;
  sponsorship: number;
}

export interface CreateEventDraft {
  title?: string;
  city?: string;
  venue?: string;
  capacity?: number;
  ticketKind?: "paid" | "free" | "approval";
  aiTheme?: string;
  aiAudience?: string;
  form?: Partial<FormState>;
}

const DEFAULTS: FormState = {
  ticketPrice: 199, targetAttendees: 50, showUpRate: 0.85,
  venueCost: 3000, materialsCost: 800, speakerFee: 2000, laborCost: 1000,
  marketingCost: 1500, cateringPerPerson: 60, sponsorship: 0,
};

const STEPS = ["活动信息", "盈亏测算", "配置落地页", "发布"];

const BUDGET_FIELDS: { key: keyof FormState; label: string; step?: number; suffix?: string }[] = [
  { key: "targetAttendees", label: "目标人数", suffix: "人" },
  { key: "showUpRate", label: "到场率", step: 0.05 },
  { key: "venueCost", label: "场地费", suffix: "元" },
  { key: "cateringPerPerson", label: "茶歇/人", suffix: "元" },
  { key: "materialsCost", label: "物料费", suffix: "元" },
  { key: "speakerFee", label: "嘉宾费", suffix: "元" },
  { key: "laborCost", label: "人力成本", suffix: "元" },
  { key: "marketingCost", label: "推广费", suffix: "元" },
  { key: "sponsorship", label: "赞助收入", suffix: "元" },
];

function toInput(f: FormState): BudgetInput {
  return {
    ticketPriceCents: yuanToCents(f.ticketPrice),
    targetAttendees: f.targetAttendees,
    showUpRate: f.showUpRate,
    venueCostCents: yuanToCents(f.venueCost),
    materialsCostCents: yuanToCents(f.materialsCost),
    speakerFeeCents: yuanToCents(f.speakerFee),
    laborCostCents: yuanToCents(f.laborCost),
    marketingCostCents: yuanToCents(f.marketingCost),
    cateringPerPersonCents: yuanToCents(f.cateringPerPerson),
    sponsorshipCents: yuanToCents(f.sponsorship),
  };
}

function fmtLocalTime(value: string) {
  return value ? value.replace("T", " ") : "待定";
}

const KIND_LABEL: Record<string, string> = { paid: "付费票", free: "免费票", approval: "审核票" };

export function CreateEvent({ initialDraft }: { initialDraft?: CreateEventDraft | null }) {
  const navigate = useNavigate();
  const { setCurrentEvent, refresh } = useCurrentEvent();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [title, setTitle] = useState("AI 产品人深夜局 · 上海");
  const [city, setCity] = useState("上海");
  const [venue, setVenue] = useState("静安寺 · Loopin Space");
  const [startAt, setStartAt] = useState("2026-06-14T19:00");
  const [capacity, setCapacity] = useState(60);
  const [ticketKind, setTicketKind] = useState<"paid" | "free" | "approval">("paid");
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ eventId: string } | null>(null);
  const [error, setError] = useState("");

  const [aiTheme, setAiTheme] = useState("AI 产品经理如何用 Agent 重构工作流");
  const [aiAudience, setAiAudience] = useState("AI 产品经理、转型中的传统 PM");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPage, setAiPage] = useState<null | {
    title: string; tagline: string; highlights: string[]; agenda: string[];
    forWho: string[]; faq: { q: string; a: string }[]; notes: string[];
  }>(null);

  useEffect(() => {
    if (!initialDraft) return;
    if (initialDraft.form) setForm((prev) => ({ ...prev, ...initialDraft.form }));
    if (initialDraft.title) setTitle(initialDraft.title);
    if (initialDraft.city) setCity(initialDraft.city);
    if (initialDraft.venue) setVenue(initialDraft.venue);
    if (initialDraft.capacity) setCapacity(initialDraft.capacity);
    if (initialDraft.ticketKind) setTicketKind(initialDraft.ticketKind);
    if (initialDraft.aiTheme) setAiTheme(initialDraft.aiTheme);
    if (initialDraft.aiAudience) setAiAudience(initialDraft.aiAudience);
    setPublished(null);
    setAiPage(null);
    setStep(0);
  }, [initialDraft]);

  const input = useMemo(() => toInput(form), [form]);
  const result: BudgetResult = useMemo(() => calcBudget(input), [input]);
  const scenarios = useMemo(() => compareScenarios(input), [input]);
  const priceTip = useMemo(
    () => (form.ticketPrice > 0 ? suggestPrice(input, form.targetAttendees) : null),
    [input, form.ticketPrice, form.targetAttendees],
  );

  const set = (key: keyof FormState, v: number) => setForm((p) => ({ ...p, [key]: v }));

  async function genPage() {
    setAiLoading(true); setAiError("");
    try {
      const p = await api.post("/ai/event-page", {
        theme: aiTheme, audience: aiAudience,
        priceText: `${form.ticketPrice}元`, city, venue,
        timeText: fmtLocalTime(startAt),
      });
      setAiPage(p);
      if (p.title && !initialDraft?.title) setTitle(p.title);
    } catch (e) {
      setAiError((e as Error).message || "生成失败");
    } finally {
      setAiLoading(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setError("");
    try {
      const res = await api.post("/events", {
        title, city, venue,
        startAt: new Date(startAt).toISOString(),
        ticket: {
          name: "标准票",
          kind: ticketKind,
          priceCents: ticketKind === "paid" ? yuanToCents(form.ticketPrice) : 0,
          capacity,
        },
        formSchema: { fields: recommendFields("ai_sharing") },
        page: aiPage ? { template: "ai_designer", highlights: aiPage.highlights, agenda: aiPage.agenda, faq: aiPage.faq } : undefined,
        budget: input,
      });
      setPublished({ eventId: res.eventId });
      setCurrentEvent(res.eventId);
      refresh();
    } catch (e) {
      setError((e as Error).message || "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  const canNext = step === 0 ? title.trim().length > 0 : true;

  return (
    <div className="single">
      <section className="card wizard">
        <div className="wz-head">
          <h2>建活动</h2>
          <div className="wz-steps">
            {STEPS.map((label, i) => (
              <button
                key={label}
                className={`wz-step ${i === step ? "is-active" : ""} ${i < step ? "is-done" : ""}`}
                onClick={() => { if (i <= step || published) setStep(i); }}
              >
                <span className="wz-step-no">{i < step ? "✓" : i + 1}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {step === 0 && (
          <div className="wz-body">
            <div className="grid">
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span>活动标题</span>
                <div className="input-wrap"><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              </label>
              <label className="field"><span>城市</span><div className="input-wrap"><input value={city} onChange={(e) => setCity(e.target.value)} /></div></label>
              <label className="field"><span>名额</span><div className="input-wrap"><input type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /><em>人</em></div></label>
              <label className="field">
                <span>票种类型</span>
                <select value={ticketKind} onChange={(e) => setTicketKind(e.target.value as "paid" | "free" | "approval")} className="select full">
                  <option value="paid">付费票</option>
                  <option value="free">免费票</option>
                  <option value="approval">审核票</option>
                </select>
              </label>
              <label className="field">
                <span>票价</span>
                <div className="input-wrap">
                  <input type="number" value={form.ticketPrice} disabled={ticketKind !== "paid"} onChange={(e) => set("ticketPrice", Number(e.target.value))} /><em>元</em>
                </div>
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}><span>地点</span><div className="input-wrap"><input value={venue} onChange={(e) => setVenue(e.target.value)} /></div></label>
              <label className="field" style={{ gridColumn: "1 / -1" }}><span>开始时间</span><div className="input-wrap"><input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></div></label>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="wz-body wz-budget">
            <div className="wz-budget-form">
              <p className="muted">票价 {form.ticketPrice} 元（来自上一步），填成本和到场预期，实时算盈亏。</p>
              <div className="grid">
                {BUDGET_FIELDS.map((f) => (
                  <label key={f.key} className="field">
                    <span>{f.label}</span>
                    <div className="input-wrap">
                      <input type="number" step={f.step ?? 1} value={form[f.key]} onChange={(e) => set(f.key, Number(e.target.value))} />
                      {f.suffix && <em>{f.suffix}</em>}
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="wz-budget-result">
              <div className={`verdict ${result.profitable ? "good" : "warn"}`}>{result.verdict}</div>
              <div className="metrics">
                <Metric label="保本人数" value={result.breakEvenAttendees === null ? "—" : `${result.breakEvenAttendees} 人`} />
                <Metric label="预计利润" value={formatCNY(result.projectedProfitCents)} accent={result.profitable ? "good" : "warn"} />
                <Metric label="预计收入" value={formatCNY(result.projectedRevenueCents)} />
                <Metric label="固定成本" value={formatCNY(result.fixedCostCents)} />
                <Metric label="每报名贡献" value={formatCNY(result.contributionPerRegCents)} />
                <Metric label="利润率" value={result.profitMargin === null ? "—" : `${(result.profitMargin * 100).toFixed(1)}%`} />
              </div>
              {priceTip && priceTip.newBreakEvenAttendees !== null && (
                <div className="tip">💡 想在 <b>{form.targetAttendees}</b> 人保本，票价定到 <b>{formatCNY(priceTip.suggestedPriceCents)}</b>，保本人数降到 <b>{priceTip.newBreakEvenAttendees}</b> 人。</div>
              )}
              <h3>规模方案对比</h3>
              <table className="scenarios">
                <thead><tr><th>人数</th><th>收入</th><th>利润</th><th>结论</th></tr></thead>
                <tbody>
                  {scenarios.map((s) => (
                    <tr key={s.registrations} className={s.profitable ? "row-good" : "row-warn"}>
                      <td>{s.registrations} 人</td><td>{formatCNY(s.revenueCents)}</td><td>{formatCNY(s.profitCents)}</td><td>{s.profitable ? "盈利" : "亏损"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wz-body">
            <p className="muted">用 AI 生成活动页文案（标题/卖点/议程/FAQ/须知），可在发布后继续编辑。</p>
            <div className="grid">
              <label className="field" style={{ gridColumn: "1 / -1" }}><span>活动主题</span><div className="input-wrap"><input value={aiTheme} onChange={(e) => setAiTheme(e.target.value)} /></div></label>
              <label className="field" style={{ gridColumn: "1 / -1" }}><span>目标人群</span><div className="input-wrap"><input value={aiAudience} onChange={(e) => setAiAudience(e.target.value)} /></div></label>
            </div>
            <button className="ai-btn" onClick={genPage} disabled={aiLoading}>
              {aiLoading ? "AI 生成中…（约 20-40 秒）" : "✨ 用 MiMo 生成活动页文案"}
            </button>
            {aiError && <div className="verdict warn" style={{ marginTop: 12 }}>{aiError}</div>}
            {aiPage && (
              <div className="ai-preview">
                <div className="ai-title">{aiPage.title}</div>
                <div className="ai-tagline">{aiPage.tagline}</div>
                <div className="ai-sub">亮点</div>
                <ul>{aiPage.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
                <div className="ai-sub">议程</div>
                <ul>{aiPage.agenda.map((a, i) => <li key={i}>{a}</li>)}</ul>
                <div className="ai-sub">适合谁</div>
                <div className="tags">{aiPage.forWho.map((w, i) => <span className="ai-tag" key={i}>{w}</span>)}</div>
                <div className="ai-sub">FAQ</div>
                {aiPage.faq.map((f, i) => <div key={i} className="ai-faq"><b>Q：{f.q}</b><br />A：{f.a}</div>)}
                <div className="ai-sub">报名须知</div>
                <ul>{aiPage.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="wz-body">
            {!published ? (
              <>
                <div className="wz-summary">
                  <SummaryRow label="活动" value={title} />
                  <SummaryRow label="时间地点" value={`${fmtLocalTime(startAt)} · ${venue || city}`} />
                  <SummaryRow label="票种" value={`${KIND_LABEL[ticketKind]}${ticketKind === "paid" ? ` · ${form.ticketPrice} 元` : ""} · ${capacity} 名额`} />
                  <SummaryRow label="盈亏" value={`${result.verdict}`} accent={result.profitable ? "good" : "warn"} />
                  <SummaryRow label="活动页" value={aiPage ? "已生成 AI 文案" : "未配置（可发布后补）"} />
                </div>
                <button className="publish-btn" onClick={publish} disabled={publishing}>
                  {publishing ? "发布中…" : "发布活动（C 端小程序即可报名）"}
                </button>
                {error && <div className="verdict warn" style={{ marginTop: 12 }}>{error}</div>}
              </>
            ) : (
              <div className="wz-done">
                <div className="wz-done-badge">✅ 已发布</div>
                <p className="muted">eventId <b>{published.eventId}</b>。C 端小程序会自动读到这场活动{aiPage ? "和 AI 活动页文案" : ""}。发布后即可持续做推广分享。</p>
                <div className="actions">
                  <button className="mini-btn" onClick={() => navigate("/studio/materials")}>去配置分享素材</button>
                  <button className="ghost-btn" onClick={() => navigate("/studio/events")}>返回活动列表</button>
                </div>
              </div>
            )}
          </div>
        )}

        {!published && (
          <div className="wz-nav">
            <button className="ghost-btn" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>上一步</button>
            {step < STEPS.length - 1 && (
              <button className="mini-btn" disabled={!canNext} onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>下一步</button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: "good" | "warn" }) {
  return (
    <div className="metric">
      <span className="m-label">{label}</span>
      <span className={`m-value ${accent ?? ""}`}>{value}</span>
    </div>
  );
}

function SummaryRow({ label, value, accent }: { label: string; value: string; accent?: "good" | "warn" }) {
  return (
    <div className="wz-summary-row">
      <span>{label}</span>
      <b className={accent ?? ""}>{value}</b>
    </div>
  );
}
