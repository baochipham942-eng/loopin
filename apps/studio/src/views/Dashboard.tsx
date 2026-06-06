import { useEffect, useState } from "react";
import { formatCNY } from "@loopin/core";
import { api } from "../api.js";

interface EventLite { id: string; title: string }
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

const STATUS_LABEL: Record<string, string> = {
  submitted: "待确认", approved: "已通过", checked_in: "已签到",
  waitlisted: "候补", rejected: "已拒绝", cancelled: "已取消", draft: "草稿",
};

export function Dashboard() {
  const [events, setEvents] = useState<EventLite[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [data, setData] = useState<DashData | null>(null);

  useEffect(() => {
    api.get("/events").then((r) => {
      setEvents(r.events);
      if (r.events[0]) setSelected(r.events[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) return;
    api.get(`/events/${selected}/dashboard`).then(setData).catch(() => setData(null));
  }, [selected]);

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <h2>报名增长看板</h2>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="select">
            {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </div>

        {!data ? <div className="muted">暂无数据。先到「建活动」发布一场，再到 C 端报名。</div> : (
          <>
            {data.budget && (
              <div className={`verdict ${data.budget.profitable ? "good" : "warn"}`}>{data.budget.verdict}</div>
            )}

            <div className="metrics">
              <Metric label="总报名" value={`${data.totalRegistrations}`} />
              <Metric label="已确认" value={`${data.confirmed}`} accent="good" />
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

            <h3>报名状态分布</h3>
            <table className="scenarios">
              <thead><tr><th>状态</th><th>人数</th></tr></thead>
              <tbody>
                {Object.entries(data.counts).length === 0 && <tr><td colSpan={2} className="muted">暂无报名</td></tr>}
                {Object.entries(data.counts).map(([k, v]) => (
                  <tr key={k}><td>{STATUS_LABEL[k] ?? k}</td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </>
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
