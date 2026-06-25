import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useCurrentEvent } from "../event/EventContext.js";

/**
 * 主办方·已建活动列表（P2）。Studio 的管理入口：所有活动一览 + 进入管理。
 */

interface EventRow {
  id: string;
  title: string;
  city?: string;
  venue?: string | null;
  startAt?: string;
  minPriceCents?: number;
}

interface Stats {
  totalRegistrations: number;
  confirmed: number;
  capacity: number | null;
  breakEven: number | null;
  breakEvenProgress: number | null;
}

export function EventList() {
  const navigate = useNavigate();
  const { setCurrentEvent } = useCurrentEvent();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get("/events")
      .then(async (r) => {
        const rows: EventRow[] = r.events || [];
        setEvents(rows);
        const entries = await Promise.all(rows.map(async (e) => {
          const d = await api.get(`/events/${e.id}/dashboard`).catch(() => null);
          return [e.id, d] as const;
        }));
        const map: Record<string, Stats> = {};
        for (const [id, d] of entries) if (d) map[id] = d;
        setStats(map);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  function manage(id: string) {
    setCurrentEvent(id);
    navigate("/studio/operations");
  }

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <div>
            <h2>活动列表</h2>
            <p className="muted ops-intro">所有已建活动。点「管理」设为当前活动并进入运营台。</p>
          </div>
          <button className="mini-btn" onClick={() => navigate("/studio/create")}>+ 建活动</button>
        </div>

        {loading ? <div className="muted">加载活动中…</div> : events.length === 0 ? (
          <div className="el-empty">
            <p className="muted">还没有活动。</p>
            <button className="mini-btn" onClick={() => navigate("/studio/create")}>建第一场活动</button>
          </div>
        ) : (
          <div className="el-list">
            {events.map((e) => {
              const s = stats[e.id];
              const progress = s?.breakEvenProgress;
              return (
                <article className="el-row" key={e.id} onClick={() => manage(e.id)}>
                  <div className="el-main">
                    <b>{e.title}</b>
                    <span className="el-meta">{formatDate(e.startAt)} · {e.venue || e.city || "地点待定"} · {priceText(e.minPriceCents)}</span>
                  </div>
                  <div className="el-stats">
                    <Stat label="报名" value={s ? s.totalRegistrations : "—"} />
                    <Stat label="已确认" value={s ? s.confirmed : "—"} />
                    <Stat label="容量" value={s ? (s.capacity === null ? "∞" : s.capacity) : "—"} />
                  </div>
                  <div className="el-progress">
                    {progress !== null && progress !== undefined ? (
                      <>
                        <div className="el-progress-label">保本 {Math.round(progress * 100)}%</div>
                        <div className="dash-bar"><div className="dash-bar-fill" style={{ width: `${Math.min(100, progress * 100)}%` }} /></div>
                      </>
                    ) : <span className="muted">无盈亏测算</span>}
                  </div>
                  <button className="ghost-btn el-manage" onClick={(ev) => { ev.stopPropagation(); manage(e.id); }}>管理 →</button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ops-small">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function priceText(cents?: number) {
  if (!cents) return "免费";
  return `${cents / 100} 元起`;
}

function formatDate(iso?: string) {
  if (!iso) return "时间待定";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "时间待定";
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
