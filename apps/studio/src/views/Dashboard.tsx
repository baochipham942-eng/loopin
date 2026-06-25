import { useEffect, useMemo, useState } from "react";
import { formatCNY } from "@loopin/core";
import { api } from "../api.js";
import { useCurrentEvent } from "../event/EventContext.js";

interface DashData {
  counts: Record<string, number>;
  totalRegistrations: number;
  confirmed: number;
  capacity: number | null;
  used: number;
  breakEven: number | null;
  breakEvenProgress: number | null;
  budget: { verdict: string; profitable: boolean; projectedProfitCents: number } | null;
}

interface Reg {
  id: string;
  status: string;
  formValues: Record<string, unknown>;
  ticketName: string;
  ticketKind: string;
}

interface ChannelRow {
  key: string;
  label: string;
  registrations: number;
  confirmed: number;
  showUpRate: number | null;
}

interface FunnelRow {
  detailViews: number;
  registrationIntents: number;
  registrationSubmits: number;
  registrationReservations: number;
}

interface ReviewData {
  growth?: {
    channelAttribution: { channels: ChannelRow[] };
    attributionFunnel?: { total: FunnelRow };
  };
}

const STATUS_LABEL: Record<string, string> = {
  submitted: "待确认", approved: "已通过", checked_in: "已签到",
  waitlisted: "候补", rejected: "已拒绝", cancelled: "已取消", draft: "草稿",
};

export function Dashboard() {
  const { currentEventId } = useCurrentEvent();
  const [data, setData] = useState<DashData | null>(null);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [review, setReview] = useState<ReviewData | null>(null);

  useEffect(() => {
    if (!currentEventId) { setData(null); setRegs([]); setReview(null); return; }
    api.get(`/events/${currentEventId}/dashboard`).then(setData).catch(() => setData(null));
    api.get(`/events/${currentEventId}/registrations`).then((r) => setRegs(r.registrations || [])).catch(() => setRegs([]));
    api.get(`/events/${currentEventId}/review`).then(setReview).catch(() => setReview(null));
  }, [currentEventId]);

  const ticketSales = useMemo(() => {
    const map = new Map<string, { total: number; confirmed: number }>();
    for (const r of regs) {
      const name = r.ticketKind === "approval" ? "审核票" : r.ticketName || "未命名票种";
      const row = map.get(name) ?? { total: 0, confirmed: 0 };
      row.total += 1;
      if (r.status === "approved" || r.status === "checked_in") row.confirmed += 1;
      map.set(name, row);
    }
    return [...map.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);
  }, [regs]);

  const audience = useMemo(() => buildAudience(regs), [regs]);
  const channels = (review?.growth?.channelAttribution.channels ?? []).filter((c) => c.registrations > 0);
  const funnel = review?.growth?.attributionFunnel?.total ?? null;

  const counts = data?.counts ?? {};
  const noShowRisk = counts.approved ?? 0; // 已通过未签到
  const actions = data ? buildActions(data, counts) : [];

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <h2>报名增长看板</h2>
        </div>

        {!data ? <div className="muted">暂无数据。先到「建活动」发布一场，再到 C 端报名。</div> : (
          <>
            {data.budget && (
              <div className={`verdict ${data.budget.profitable ? "good" : "warn"}`}>{data.budget.verdict}</div>
            )}

            <div className="metrics dash-metrics">
              <Metric label="总报名" value={`${data.totalRegistrations}`} />
              <Metric label="已确认" value={`${data.confirmed}`} accent="good" />
              <Metric label="待审核" value={`${counts.submitted ?? 0}`} />
              <Metric label="候补" value={`${counts.waitlisted ?? 0}`} />
              <Metric label="已售/容量" value={`${data.used} / ${data.capacity ?? "∞"}`} />
              <Metric label="保本人数" value={data.breakEven === null ? "—" : `${data.breakEven} 人`} />
              {data.budget && <Metric label="预计利润" value={formatCNY(data.budget.projectedProfitCents)} accent={data.budget.profitable ? "good" : "warn"} />}
            </div>

            {data.breakEvenProgress !== null && (
              <div className="progress-wrap">
                <div className="progress-label">保本进度 {Math.round(data.breakEvenProgress * 100)}%（已确认 {data.confirmed} / 保本 {data.breakEven}）</div>
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, data.breakEvenProgress * 100)}%` }} /></div>
              </div>
            )}

            {actions.length > 0 && (
              <div className="dash-actions">
                <div className="ops-agent-title">今日建议动作</div>
                {actions.map((a, i) => <div className="dash-action-row" key={i}><span className="dash-action-dot" />{a}</div>)}
              </div>
            )}

            <div className="dash-grid">
              <Panel title="票种销量">
                {ticketSales.length === 0 ? <Empty /> : ticketSales.map((t) => (
                  <div className="dash-bar-row" key={t.name}>
                    <div className="dash-bar-label"><span>{t.name}</span><b>{t.total}（确认 {t.confirmed}）</b></div>
                    <div className="dash-bar"><div className="dash-bar-fill" style={{ width: `${pct(t.total, regs.length)}%` }} /></div>
                  </div>
                ))}
              </Panel>

              <Panel title="报名画像">
                {audience.professions.length === 0 ? <Empty /> : (
                  <>
                    <div className="dash-sub">身份 / 职业 TOP</div>
                    {audience.professions.map((p) => (
                      <div className="dash-bar-row" key={p.label}>
                        <div className="dash-bar-label"><span>{p.label}</span><b>{p.count}</b></div>
                        <div className="dash-bar"><div className="dash-bar-fill" style={{ width: `${pct(p.count, regs.length)}%` }} /></div>
                      </div>
                    ))}
                    <div className="dash-fillrate">公司填写率 {audience.companyRate}% · 手机号 {audience.phoneRate}%</div>
                  </>
                )}
              </Panel>

              <Panel title="渠道来源">
                {channels.length === 0 ? <div className="muted">暂无渠道归因。到「运营台」复制带 UTM 的引流路径，报名会自动归因。</div> : channels.slice(0, 6).map((c) => (
                  <div className="dash-bar-row" key={c.key}>
                    <div className="dash-bar-label"><span>{c.label}</span><b>{c.registrations} 报名 · 确认 {c.confirmed}</b></div>
                    <div className="dash-bar"><div className="dash-bar-fill" style={{ width: `${pct(c.registrations, regs.length)}%` }} /></div>
                  </div>
                ))}
              </Panel>

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

              <Panel title="no-show 风险">
                <div className="dash-noshow">
                  <div className="dash-noshow-num">{noShowRisk}</div>
                  <div className="dash-noshow-text">已通过未签到。临近活动可发提醒，会后未到可进复邀分层。</div>
                </div>
              </Panel>

              <Panel title="报名状态分布">
                <table className="scenarios">
                  <tbody>
                    {Object.entries(counts).length === 0 && <tr><td colSpan={2} className="muted">暂无报名</td></tr>}
                    {Object.entries(counts).map(([k, v]) => (
                      <tr key={k}><td>{STATUS_LABEL[k] ?? k}</td><td>{v}</td></tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function buildAudience(regs: Reg[]) {
  const profCount = new Map<string, number>();
  let companyFilled = 0;
  let phoneFilled = 0;
  for (const r of regs) {
    const fv = r.formValues || {};
    const raw = fv.profession ?? fv.role;
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const v of values) {
      const label = String(v).trim();
      if (label) profCount.set(label, (profCount.get(label) ?? 0) + 1);
    }
    if (String(fv.company ?? "").trim()) companyFilled += 1;
    if (String(fv.phone ?? "").trim()) phoneFilled += 1;
  }
  const professions = [...profCount.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
  const total = regs.length || 1;
  return {
    professions,
    companyRate: Math.round((companyFilled / total) * 100),
    phoneRate: Math.round((phoneFilled / total) * 100),
  };
}

function buildActions(data: DashData, counts: Record<string, number>): string[] {
  const out: string[] = [];
  if ((counts.submitted ?? 0) > 0) out.push(`有 ${counts.submitted} 条待确认报名，去「报名审核」批量处理`);
  const availableSlots = data.capacity === null ? Infinity : data.capacity - data.used;
  if ((counts.waitlisted ?? 0) > 0 && availableSlots > 0) {
    out.push(`还有 ${availableSlots === Infinity ? "" : availableSlots + " 个"}空位，可放出候补 ${counts.waitlisted} 人转正`);
  }
  if (data.breakEven !== null && data.confirmed < data.breakEven) {
    out.push(`距保本还差 ${data.breakEven - data.confirmed} 人，到「AI 推广物料」补一轮渠道投放`);
  }
  if ((counts.approved ?? 0) > 0) out.push(`${counts.approved} 人已通过未签到，临近活动发一次订阅提醒`);
  if (out.length === 0) out.push("进展健康，保持当前投放节奏即可");
  return out.slice(0, 3);
}

function pct(value: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: "good" | "warn" }) {
  return (
    <div className="metric">
      <span className="m-label">{label}</span>
      <span className={`m-value ${accent ?? ""}`}>{value}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="dash-panel">
      <div className="ops-agent-title">{title}</div>
      {children}
    </div>
  );
}

function FunnelStep({ label, value, base }: { label: string; value: number; base: number }) {
  return (
    <div className="dash-funnel-step">
      <div className="dash-funnel-label"><span>{label}</span><b>{value}</b></div>
      <div className="dash-bar"><div className="dash-bar-fill" style={{ width: `${pct(value, base)}%` }} /></div>
    </div>
  );
}

function Empty() {
  return <div className="muted">暂无数据</div>;
}
