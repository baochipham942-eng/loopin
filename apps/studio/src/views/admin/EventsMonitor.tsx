import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api.js";

/**
 * 平台端·全平台活动监控（P3，/admin/events）。
 * 跨主办方活动列表 + 风险预警（超卖 / 待支付 / 待审核 / 缺席）。
 */

interface MonitorEvent {
  id: string;
  title: string;
  organizerId: string;
  organizer: string;
  status: string;
  startAt: string;
  city: string;
  registrationCount: number;
  approvedCount: number;
  submittedCount: number;
  waitlistCount: number;
  checkedInCount: number;
  capacity: number | null;
  oversold: boolean;
  risks: string[];
}

type Filter = "all" | "risk" | "oversold";

const TOKEN_STORAGE_KEY = "loopin.backofficeAdminToken";

const EVENT_STATUS: Record<string, string> = {
  draft: "草稿",
  published: "进行中",
  closed: "已截止",
  completed: "已结束",
  cancelled: "已取消",
};

export function EventsMonitor() {
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [message, setMessage] = useState("");
  const [adminToken, setAdminToken] = useState(() => (typeof window === "undefined" ? "" : window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? ""));

  function load() {
    setLoading(true);
    api.get("/admin/events")
      .then((result) => setEvents(result.events || []))
      .catch((err) => {
        setEvents([]);
        const status = typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : 0;
        setMessage(status === 401 ? "管理员令牌缺失或无效，请先保存令牌" : err instanceof Error ? err.message : "活动监控加载失败");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function saveAdminToken() {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, adminToken.trim());
    setMessage(adminToken.trim() ? "管理员令牌已保存" : "管理员令牌已清空");
    load();
  }

  const stats = useMemo(() => ({
    total: events.length,
    risk: events.filter((e) => e.risks.length > 0).length,
    oversold: events.filter((e) => e.oversold).length,
  }), [events]);

  const visible = useMemo(() => events.filter((e) => (
    filter === "all" ? true : filter === "oversold" ? e.oversold : e.risks.length > 0
  )), [events, filter]);

  return (
    <div className="single">
      <section className="backoffice-shell">
        <div className="dash-head">
          <div>
            <h2>全平台活动监控</h2>
            <p className="muted ops-intro">跨主办方活动总览与风险预警：超卖 / 待支付 / 待审核 / 缺席。</p>
          </div>
          <button className="mini-btn ghost" onClick={load} disabled={loading}>{loading ? "刷新中" : "刷新"}</button>
        </div>

        <div className="backoffice-toolbar">
          <div className="backoffice-token">
            <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="管理员令牌" type="password" aria-label="管理员令牌" />
            <button className="mini-btn" onClick={saveAdminToken}>保存管理员</button>
          </div>
          <div className="reg-tabs">
            {([["all", "全部", stats.total], ["risk", "有风险", stats.risk], ["oversold", "超卖", stats.oversold]] as [Filter, string, number][]).map(([key, label, count]) => (
              <button key={key} type="button" className={`reg-tab ${filter === key ? "is-active" : ""}`} onClick={() => setFilter(key)}>
                {label}
                <span className="reg-tab-count">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {message && <div className="ops-message">{message}</div>}

        {loading ? (
          <div className="muted">加载活动监控中…</div>
        ) : visible.length === 0 ? (
          <div className="muted">{events.length === 0 ? "暂无活动，或令牌无效。" : "当前筛选下没有活动。"}</div>
        ) : (
          <div className="organizer-list">
            {visible.map((event) => (
              <article className={`organizer-row${event.oversold ? " row-danger" : ""}`} key={event.id}>
                <div className="organizer-main">
                  <div className="organizer-name">
                    <b>{event.title}</b>
                    <span className="org-badge">{EVENT_STATUS[event.status] ?? event.status}</span>
                    {event.risks.map((risk) => (
                      <span className={`risk-badge${risk === "超卖" ? " danger" : ""}`} key={risk}>{risk}</span>
                    ))}
                  </div>
                  <div className="organizer-meta">
                    <Link to="/admin/organizers" className="monitor-org">{event.organizer}</Link>
                    <span>{formatDate(event.startAt)}</span>
                    <span>{event.city || "地点待定"}</span>
                    <span>报名 {event.registrationCount}{event.capacity != null ? ` / 容量 ${event.capacity}` : " / 不限量"}</span>
                    <span>已确认 {event.approvedCount}</span>
                    {event.waitlistCount > 0 && <span>候补 {event.waitlistCount}</span>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "时间待定";
  return new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}
