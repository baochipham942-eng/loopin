import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatCNY } from "@loopin/core";
import { api } from "../../api.js";

/**
 * 平台端·平台总览（P3，/admin 落地页）。
 * 跨主办方的 KPI 仪表盘：主办方 / 活动 / 报名 / GMV 聚合 + 待办 + 快捷入口。
 */

interface Overview {
  organizers: { total: number; whitelisted: number; pending: number };
  events: { total: number; draft: number; published: number; closed: number; completed: number; cancelled: number };
  registrations: { total: number; submitted: number; approved: number; waitlisted: number; checkedIn: number };
  gmvCents: number;
  pending: { whitelist: number; review: number };
}

const TOKEN_STORAGE_KEY = "loopin.backofficeAdminToken";

export function PlatformOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [adminToken, setAdminToken] = useState(() => (typeof window === "undefined" ? "" : window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? ""));

  function load() {
    setLoading(true);
    api.get("/admin/overview")
      .then((result) => setData(result as Overview))
      .catch((err) => {
        setData(null);
        const status = typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : 0;
        setMessage(status === 401 ? "管理员令牌缺失或无效，请先保存令牌" : err instanceof Error ? err.message : "平台总览加载失败");
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function saveAdminToken() {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, adminToken.trim());
    setMessage(adminToken.trim() ? "管理员令牌已保存" : "管理员令牌已清空");
    load();
  }

  return (
    <div className="single">
      <section className="backoffice-shell">
        <div className="dash-head">
          <div>
            <h2>平台总览</h2>
            <p className="muted ops-intro">跨主办方的平台级指标，平台管理员的落地视图。</p>
          </div>
          <button className="mini-btn ghost" onClick={load} disabled={loading}>{loading ? "刷新中" : "刷新"}</button>
        </div>

        <div className="backoffice-toolbar">
          <div className="backoffice-token">
            <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="管理员令牌" type="password" aria-label="管理员令牌" />
            <button className="mini-btn" onClick={saveAdminToken}>保存管理员</button>
          </div>
        </div>

        {message && <div className="ops-message">{message}</div>}

        {loading || !data ? (
          <div className="muted">加载平台总览中…</div>
        ) : (
          <>
            <div className="metrics dash-metrics">
              <Metric label="主办方" value={String(data.organizers.total)} sub={`${data.organizers.whitelisted} 已通过 · ${data.organizers.pending} 待审核`} accent={data.organizers.pending > 0 ? "warn" : undefined} />
              <Metric label="活动总数" value={String(data.events.total)} sub={`${data.events.published} 进行中 · ${data.events.draft} 草稿`} />
              <Metric label="报名总数" value={String(data.registrations.total)} sub={`${data.registrations.approved} 已确认 · ${data.registrations.submitted} 待审核`} />
              <Metric label="GMV（已支付）" value={formatCNY(data.gmvCents)} accent="good" />
            </div>

            <div className="dash-grid">
              <section className="card">
                <h2>待办</h2>
                <ul className="overview-todo">
                  <li>
                    <span>待审核主办方</span>
                    <Link to="/admin/organizers" className={`overview-pill${data.pending.whitelist > 0 ? " warn" : ""}`}>{data.pending.whitelist}</Link>
                  </li>
                  <li>
                    <span>待审核报名</span>
                    <Link to="/admin/events" className={`overview-pill${data.pending.review > 0 ? " warn" : ""}`}>{data.pending.review}</Link>
                  </li>
                </ul>
              </section>

              <section className="card">
                <h2>活动状态分布</h2>
                <div className="overview-status">
                  <StatusRow label="草稿" value={data.events.draft} />
                  <StatusRow label="进行中" value={data.events.published} />
                  <StatusRow label="已截止" value={data.events.closed} />
                  <StatusRow label="已结束" value={data.events.completed} />
                  <StatusRow label="已取消" value={data.events.cancelled} />
                </div>
              </section>
            </div>

            <section className="card">
              <h2>快捷入口</h2>
              <div className="overview-links">
                <Link className="mini-btn ghost" to="/admin/organizers">主办方与白名单</Link>
                <Link className="mini-btn ghost" to="/admin/events">全平台活动监控</Link>
                <Link className="mini-btn ghost" to="/admin/integrations">集成配置中心</Link>
                <Link className="mini-btn ghost" to="/admin/backoffice">后台数据</Link>
              </div>
            </section>
          </>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "good" | "warn" }) {
  return (
    <div className="metric">
      <span className="m-label">{label}</span>
      <span className={`m-value ${accent ?? ""}`}>{value}</span>
      {sub && <span className="m-sub">{sub}</span>}
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="overview-status-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
