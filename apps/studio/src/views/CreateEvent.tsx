import { useMemo, useState } from "react";
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

/** 建活动：第一步算账（差异化），算清楚再填活动信息发布 → 喂给 C 端小程序。 */

interface FormState {
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

const DEFAULTS: FormState = {
  ticketPrice: 199, targetAttendees: 50, showUpRate: 0.85,
  venueCost: 3000, materialsCost: 800, speakerFee: 2000, laborCost: 1000,
  marketingCost: 1500, cateringPerPerson: 60, sponsorship: 0,
};

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

const FIELDS: { key: keyof FormState; label: string; step?: number; suffix?: string }[] = [
  { key: "ticketPrice", label: "票价", suffix: "元" },
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

export function CreateEvent() {
  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [title, setTitle] = useState("AI 产品人深夜局 · 上海");
  const [city, setCity] = useState("上海");
  const [venue, setVenue] = useState("静安寺 · Loopin Space");
  const [startAt, setStartAt] = useState("2026-06-14T19:00");
  const [capacity, setCapacity] = useState(60);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<{ eventId: string } | null>(null);
  const [error, setError] = useState("");

  // AI 生成活动页
  const [aiTheme, setAiTheme] = useState("AI 产品经理如何用 Agent 重构工作流");
  const [aiAudience, setAiAudience] = useState("AI 产品经理、转型中的传统 PM");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPage, setAiPage] = useState<null | {
    title: string; tagline: string; highlights: string[]; agenda: string[];
    forWho: string[]; faq: { q: string; a: string }[]; notes: string[];
  }>(null);

  async function genPage() {
    setAiLoading(true); setAiError("");
    try {
      const p = await api.post("/ai/event-page", {
        theme: aiTheme, audience: aiAudience,
        priceText: `${form.ticketPrice}元`, city,
      });
      setAiPage(p);
      if (p.title) setTitle(p.title);
    } catch (e) {
      setAiError((e as Error).message || "生成失败");
    } finally {
      setAiLoading(false);
    }
  }

  const input = useMemo(() => toInput(form), [form]);
  const result: BudgetResult = useMemo(() => calcBudget(input), [input]);
  const scenarios = useMemo(() => compareScenarios(input), [input]);
  const priceTip = useMemo(
    () => (form.ticketPrice > 0 ? suggestPrice(input, form.targetAttendees) : null),
    [input, form.ticketPrice, form.targetAttendees]
  );

  const set = (key: keyof FormState, v: number) => setForm((p) => ({ ...p, [key]: v }));

  async function publish() {
    setPublishing(true);
    setError("");
    try {
      const res = await api.post("/events", {
        title, city, venue,
        startAt: new Date(startAt).toISOString(),
        ticket: {
          name: "标准票",
          kind: form.ticketPrice > 0 ? "paid" : "free",
          priceCents: yuanToCents(form.ticketPrice),
          capacity,
        },
        formSchema: { fields: recommendFields("ai_sharing") },
        budget: input,
      });
      setPublished({ eventId: res.eventId });
    } catch (e) {
      setError((e as Error).message || "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="layout">
      <section className="card form">
        <h2>① 先算账</h2>
        <div className="grid">
          {FIELDS.map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <div className="input-wrap">
                <input type="number" step={f.step ?? 1} value={form[f.key]} onChange={(e) => set(f.key, Number(e.target.value))} />
                {f.suffix && <em>{f.suffix}</em>}
              </div>
            </label>
          ))}
        </div>

        <h2 style={{ marginTop: 22 }}>② AI 生成活动页</h2>
        <div className="grid">
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>活动主题</span>
            <div className="input-wrap"><input value={aiTheme} onChange={(e) => setAiTheme(e.target.value)} /></div>
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>目标人群</span>
            <div className="input-wrap"><input value={aiAudience} onChange={(e) => setAiAudience(e.target.value)} /></div>
          </label>
        </div>
        <button className="ai-btn" onClick={genPage} disabled={aiLoading}>
          {aiLoading ? "AI 生成中…（约 20-40 秒）" : "✨ 用 MiMo 生成活动页文案"}
        </button>
        {aiError && <div className="verdict warn" style={{ marginTop: 12 }}>{aiError}</div>}

        <h2 style={{ marginTop: 22 }}>③ 活动信息</h2>
        <div className="grid">
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>活动标题</span>
            <div className="input-wrap"><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          </label>
          <label className="field"><span>城市</span><div className="input-wrap"><input value={city} onChange={(e) => setCity(e.target.value)} /></div></label>
          <label className="field"><span>名额</span><div className="input-wrap"><input type="number" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /><em>人</em></div></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>地点</span><div className="input-wrap"><input value={venue} onChange={(e) => setVenue(e.target.value)} /></div></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>开始时间</span><div className="input-wrap"><input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></div></label>
        </div>

        <button className="publish-btn" onClick={publish} disabled={publishing}>
          {publishing ? "发布中…" : "④ 发布活动（C 端小程序即可报名）"}
        </button>
        {error && <div className="verdict warn" style={{ marginTop: 12 }}>{error}</div>}
        {published && (
          <div className="tip" style={{ marginTop: 12 }}>
            ✅ 已发布！eventId <b>{published.eventId}</b>。C 端小程序会自动读到这场活动。
          </div>
        )}
      </section>

      <section className="card result">
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
          <div className="tip">
            💡 想在 <b>{form.targetAttendees}</b> 人保本，票价定到 <b>{formatCNY(priceTip.suggestedPriceCents)}</b>，保本人数降到 <b>{priceTip.newBreakEvenAttendees}</b> 人。
          </div>
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

        {aiPage && (
          <div className="ai-preview">
            <h3>✨ AI 生成的活动页文案</h3>
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
