import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useCurrentEvent } from "../event/EventContext.js";

/**
 * 主办方·复盘（P2 重构：从运营台拆出，补上缺失的生命周期末段）。
 * 当前活动维度：复盘增长（渠道/漏斗）+ 会后反馈 + 资料包 + 复邀话术。
 */

interface ChannelAttributionRow {
  key: string; label: string; registrations: number; confirmed: number; checkedIn: number;
  materialVersions: number; showUpRate: number | null;
  referrers?: { label: string; count: number }[];
  campaigns?: { label: string; count: number }[];
  contents?: { label: string; count: number }[];
}
interface AttributionFunnelRow {
  detailViews: number; registrationIntents: number; registrationSubmits: number; registrationReservations: number;
  detailToIntentRate: number | null; intentToSubmitRate: number | null; submitToReservedRate: number | null;
}
interface ReinviteScript { segmentKey: string; label: string; count: number; copy: string }
interface ReviewGrowth {
  channelAttribution: { channels: ChannelAttributionRow[] };
  attributionFunnel?: { total: AttributionFunnelRow };
  reinviteScripts: ReinviteScript[];
}
interface EventFeedback { id: string; rating: number | null; valuable: string; nextTopic: string; roleInterest: string }
interface FeedbackSummary { total: number; averageRating: number | null; nextTopics: { label: string; count: number }[] }
interface EventResource { id: string; title: string; type: string; url: string; description: string | null }
interface ResourceForm { title: string; type: string; url: string; description: string }

const RESOURCE_TYPE_LABEL: Record<string, string> = { link: "链接", slides: "演示文稿", notes: "活动笔记", recording: "回放", gallery: "照片" };
const EMPTY_RESOURCE: ResourceForm = { title: "", type: "link", url: "", description: "" };

export function Recap() {
  const { currentEventId, currentEvent } = useCurrentEvent();
  const [growth, setGrowth] = useState<ReviewGrowth | null>(null);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [feedbacks, setFeedbacks] = useState<EventFeedback[]>([]);
  const [resources, setResources] = useState<EventResource[]>([]);
  const [form, setForm] = useState<ResourceForm>(EMPTY_RESOURCE);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  function load(id: string) {
    if (!id) { setGrowth(null); setSummary(null); setFeedbacks([]); setResources([]); return; }
    api.get(`/events/${id}/review`).then((r) => setGrowth(r?.growth ?? null)).catch(() => setGrowth(null));
    api.get(`/events/${id}/feedback?limit=8`).then((r) => { setSummary(r.summary || null); setFeedbacks(r.feedbacks || []); }).catch(() => { setSummary(null); setFeedbacks([]); });
    api.get(`/events/${id}/resources?limit=20`).then((r) => setResources(r.resources || [])).catch(() => setResources([]));
  }

  useEffect(() => { load(currentEventId); }, [currentEventId]);

  async function addResource() {
    if (!form.url.trim()) { setMessage("先填资料链接"); return; }
    setSaving(true);
    try {
      const r = await api.post(`/events/${currentEventId}/resources`, form);
      setMessage(`资料「${r.resource?.title ?? (form.title || "活动资料")}」已添加`);
      setForm(EMPTY_RESOURCE);
      load(currentEventId);
    } catch (e) { setMessage((e as Error).message); } finally { setSaving(false); }
  }

  if (!currentEventId) {
    return <div className="single"><section className="card"><h2>复盘</h2><div className="muted">先在顶栏选择一个活动。</div></section></div>;
  }

  const channels = (growth?.channelAttribution.channels ?? []).filter((c) => c.registrations > 0 || c.materialVersions > 0);
  const funnel = growth?.attributionFunnel?.total ?? null;
  const scripts = growth?.reinviteScripts ?? [];

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <div>
            <h2>复盘</h2>
            <p className="muted ops-intro">「{currentEvent?.title ?? "当前活动"}」的渠道复盘、会后反馈、资料包与复邀话术。</p>
          </div>
        </div>

        {message && <div className="reg-message">{message}</div>}

        <div className="dash-grid">
          <Panel title="引流漏斗">
            {!funnel || funnel.detailViews === 0 ? <div className="muted">暂无漏斗数据。</div> : (
              <div className="dash-funnel">
                <FunnelStep label="详情浏览" value={funnel.detailViews} base={funnel.detailViews} />
                <FunnelStep label="点击报名" value={funnel.registrationIntents} base={funnel.detailViews} />
                <FunnelStep label="提交报名" value={funnel.registrationSubmits} base={funnel.detailViews} />
                <FunnelStep label="成单" value={funnel.registrationReservations} base={funnel.detailViews} />
              </div>
            )}
          </Panel>

          <Panel title="渠道复盘">
            {channels.length === 0 ? <div className="muted">暂无渠道归因。</div> : channels.slice(0, 6).map((c) => (
              <div className="dash-bar-row" key={c.key}>
                <div className="dash-bar-label"><span>{c.label}</span><b>{c.registrations} 报名 · 到场 {rateText(c.showUpRate)}</b></div>
                <div className="dash-bar"><div className="dash-bar-fill" style={{ width: `${pct(c.registrations, channels[0]!.registrations)}%` }} /></div>
              </div>
            ))}
          </Panel>

          <Panel title="会后反馈">
            {!summary || summary.total === 0 ? <div className="muted">暂无会后反馈。</div> : (
              <>
                <div className="rc-feedback-meta">
                  <span>{summary.total} 条</span>
                  <span>平均 {summary.averageRating ?? "—"} 分</span>
                  {summary.nextTopics[0] && <span>想聊 {summary.nextTopics[0].label}</span>}
                </div>
                {feedbacks.slice(0, 3).map((f) => (
                  <div className="rc-feedback-row" key={f.id}>
                    <b>{f.valuable || f.nextTopic || "已提交反馈"}</b>
                    <p>{[f.nextTopic, f.roleInterest].filter(Boolean).join(" · ")}</p>
                  </div>
                ))}
              </>
            )}
          </Panel>

          <Panel title="复邀话术">
            {scripts.length === 0 ? <div className="muted">暂无复邀话术。</div> : scripts.slice(0, 3).map((s) => (
              <div className="rc-script" key={s.segmentKey}>
                <b>{s.label} · {s.count} 人</b>
                <p>{s.copy}</p>
              </div>
            ))}
          </Panel>
        </div>

        <div className="rc-resources">
          <div className="ops-agent-title">资料包</div>
          {resources.length === 0 ? <div className="muted">暂无资料链接。</div> : (
            <div className="rc-resource-list">
              {resources.map((r) => (
                <a className="rc-resource-row" href={r.url} target="_blank" rel="noreferrer" key={r.id}>
                  <b>{r.title}</b>
                  <span>{RESOURCE_TYPE_LABEL[r.type] ?? r.type}{r.description ? ` · ${r.description}` : ""}</span>
                </a>
              ))}
            </div>
          )}
          <div className="rc-resource-form">
            <input value={form.title} placeholder="资料标题" onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="link">链接</option>
              <option value="slides">演示文稿</option>
              <option value="notes">活动笔记</option>
              <option value="recording">回放</option>
              <option value="gallery">照片</option>
            </select>
            <input value={form.url} placeholder="https://..." onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <input value={form.description} placeholder="说明" onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <button className="mini-btn" onClick={addResource} disabled={saving}>{saving ? "保存中" : "添加资料"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="dash-panel"><div className="ops-agent-title">{title}</div>{children}</div>;
}

function FunnelStep({ label, value, base }: { label: string; value: number; base: number }) {
  return (
    <div className="dash-funnel-step">
      <div className="dash-funnel-label"><span>{label}</span><b>{value}</b></div>
      <div className="dash-bar"><div className="dash-bar-fill" style={{ width: `${pct(value, base)}%` }} /></div>
    </div>
  );
}

function pct(value: number, total: number) { return total ? Math.min(100, Math.round((value / total) * 100)) : 0; }
function rateText(value: number | null) { return value === null || value === undefined ? "—" : `${value}%`; }
