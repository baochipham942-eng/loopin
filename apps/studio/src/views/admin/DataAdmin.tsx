import { useEffect, useMemo, useState } from "react";
import { formatCNY } from "@loopin/core";
import { api } from "../../api.js";

/**
 * 平台端·后台数据（P1 从「后台 IA」拆出）。
 * 管理员/成员令牌、配额池、数据导出器。主办方团队成员/权限/同频人物已迁到 Studio「我的·团队」。
 */

interface EventLite {
  id: string;
  title: string;
  city?: string;
  venue?: string | null;
  startAt?: string;
  organizerId?: string;
  organizer?: string;
}

interface QuotaRow {
  id: string;
  name: string;
  capacity: number | null;
  used: number;
  reservedActive: number;
  available: number | null;
  ticketTypes: { id: string; name: string; kind: string; priceCents: number }[];
}

interface ExporterRow {
  key: string;
  label: string;
  description: string;
  href: string;
}

interface QuotaForm {
  name: string;
  capacity: string;
}

const TOKEN_STORAGE_KEY = "loopin.backofficeAdminToken";
const MEMBER_TOKEN_STORAGE_KEY = "loopin.backofficeMemberToken";

export function DataAdmin() {
  const [events, setEvents] = useState<EventLite[]>([]);
  const [selected, setSelected] = useState("");
  const [quotas, setQuotas] = useState<QuotaRow[]>([]);
  const [exporters, setExporters] = useState<ExporterRow[]>([]);
  const [quotaForms, setQuotaForms] = useState<Record<string, QuotaForm>>({});
  const [loading, setLoading] = useState(true);
  const [savingQuota, setSavingQuota] = useState("");
  const [downloadingExporter, setDownloadingExporter] = useState("");
  const [message, setMessage] = useState("");
  const [adminToken, setAdminToken] = useState(() => (typeof window === "undefined" ? "" : window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? ""));
  const [memberToken, setMemberToken] = useState(() => (typeof window === "undefined" ? "" : window.localStorage.getItem(MEMBER_TOKEN_STORAGE_KEY) ?? ""));

  const selectedEvent = useMemo(() => events.find((event) => event.id === selected) ?? null, [events, selected]);

  function loadEvents() {
    setLoading(true);
    api.get("/events")
      .then((result) => {
        const rows: EventLite[] = result.events || [];
        setEvents(rows);
        setSelected((current) => current || rows[0]?.id || "");
      })
      .catch(() => { setEvents([]); setSelected(""); })
      .finally(() => setLoading(false));
  }

  function loadData(event: EventLite | null) {
    if (!event) {
      setQuotas([]);
      setExporters([]);
      setQuotaForms({});
      return;
    }
    setLoading(true);
    const headers = authHeaders();
    Promise.all([
      api.get(`/events/${event.id}/quotas`, { headers }).catch((err) => backofficeFallback(err, { quotas: [] })),
      api.get(`/events/${event.id}/exports`, { headers }).catch((err) => backofficeFallback(err, { exporters: [] })),
    ])
      .then(([quotaResult, exporterResult]) => {
        const nextQuotas: QuotaRow[] = quotaResult.quotas || [];
        setQuotas(nextQuotas);
        setExporters(exporterResult.exporters || []);
        setQuotaForms(Object.fromEntries(nextQuotas.map((quota) => [
          quota.id,
          { name: quota.name, capacity: quota.capacity === null ? "" : String(quota.capacity) },
        ])));
      })
      .catch(() => { setQuotas([]); setExporters([]); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadEvents(); }, []);
  useEffect(() => { loadData(selectedEvent); }, [selectedEvent?.id]);

  function authHeaders(): HeadersInit {
    const headers: Record<string, string> = {};
    const admin = adminToken.trim();
    const member = memberToken.trim();
    if (admin) headers["x-loopin-admin-token"] = admin;
    if (member) headers["x-loopin-member-token"] = member;
    return headers;
  }

  function saveAdminToken() {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, adminToken.trim());
    setMessage(adminToken.trim() ? "管理员令牌已保存" : "管理员令牌已清空");
    loadData(selectedEvent);
  }

  function saveMemberToken() {
    window.localStorage.setItem(MEMBER_TOKEN_STORAGE_KEY, memberToken.trim());
    setMessage(memberToken.trim() ? "成员令牌已保存" : "成员令牌已清空");
    loadData(selectedEvent);
  }

  function backofficeFallback<T>(err: unknown, fallback: T) {
    const status = typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : 0;
    if (status === 401) setMessage("后台令牌缺失或无效");
    else if (status === 403) setMessage("当前成员没有权限访问这个后台模块");
    else setMessage(err instanceof Error ? err.message : "后台数据加载失败");
    return fallback;
  }

  function updateQuotaForm(quotaId: string, patch: Partial<QuotaForm>) {
    setQuotaForms((forms) => ({ ...forms, [quotaId]: { ...(forms[quotaId] ?? { name: "", capacity: "" }), ...patch } }));
  }

  async function saveQuota(quota: QuotaRow) {
    const form = quotaForms[quota.id] ?? { name: quota.name, capacity: quota.capacity === null ? "" : String(quota.capacity) };
    const rawCapacity = form.capacity.trim();
    const capacity = rawCapacity === "" ? null : Number(rawCapacity);
    if (rawCapacity !== "" && !Number.isFinite(capacity)) {
      setMessage("配额容量需要是数字");
      return;
    }
    setSavingQuota(quota.id);
    try {
      const result = await api.post(`/quotas/${quota.id}/update`, { name: form.name, capacity }, { headers: authHeaders() });
      setMessage(`配额「${result.quota.name}」已更新`);
      loadData(selectedEvent);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "配额更新失败");
    } finally {
      setSavingQuota("");
    }
  }

  async function downloadExporter(exporter: ExporterRow) {
    setDownloadingExporter(exporter.key);
    try {
      const res = await fetch(exporter.href, { headers: authHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw Object.assign(new Error(data?.message || res.statusText), { status: res.status, data });
      }
      const blobUrl = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filenameFromDisposition(res.headers.get("content-disposition")) || `${selectedEvent?.title || "loopin"}-${exporter.key}${extensionFromHref(exporter.href)}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
      setMessage(`已下载「${exporter.label}」`);
    } catch (err) {
      backofficeFallback(err, null);
    } finally {
      setDownloadingExporter("");
    }
  }

  return (
    <div className="single">
      <section className="backoffice-shell">
        <div className="dash-head">
          <div>
            <h2>后台数据</h2>
            <p className="muted ops-intro">管理员令牌、配额池和数据导出器，平台端集中维护。</p>
          </div>
          <button className="mini-btn" onClick={() => { loadEvents(); loadData(selectedEvent); }} disabled={loading}>
            {loading ? "刷新中" : "刷新"}
          </button>
        </div>

        <div className="backoffice-toolbar">
          <select value={selected} onChange={(event) => setSelected(event.target.value)} className="select full">
            {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
          </select>
          <div className="backoffice-token">
            <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="管理员令牌" type="password" aria-label="管理员令牌" />
            <button className="mini-btn" onClick={saveAdminToken}>保存管理员</button>
            <input value={memberToken} onChange={(event) => setMemberToken(event.target.value)} placeholder="成员令牌" type="password" aria-label="成员令牌" />
            <button className="mini-btn" onClick={saveMemberToken}>保存成员</button>
          </div>
          {selectedEvent && (
            <div className="backoffice-event-meta">
              <span>{selectedEvent.organizer || "主办方待定"}</span>
              <span>{formatDate(selectedEvent.startAt)} · {selectedEvent.venue || selectedEvent.city || "地点待定"}</span>
            </div>
          )}
        </div>

        {message && <div className="ops-message">{message}</div>}

        {loading && !selectedEvent ? (
          <div className="muted">加载后台数据中…</div>
        ) : !selectedEvent ? (
          <div className="muted">暂无已发布活动。</div>
        ) : (
          <div className="backoffice-grid">
            <section className="backoffice-panel backoffice-wide">
              <div className="panel-head">
                <div>
                  <h3>Quotas</h3>
                  <p>独立配额池，可承载多票种共享名额、总量封顶和现场容量调整。</p>
                </div>
                <span>{quotas.length} 个配额</span>
              </div>
              <div className="quota-list">
                {quotas.length === 0 && <div className="muted">暂无配额。</div>}
                {quotas.map((quota) => {
                  const form = quotaForms[quota.id] ?? { name: quota.name, capacity: quota.capacity === null ? "" : String(quota.capacity) };
                  return (
                    <article className="quota-row" key={quota.id}>
                      <div className="quota-main">
                        <input value={form.name} onChange={(event) => updateQuotaForm(quota.id, { name: event.target.value })} aria-label="配额名称" />
                        <div className="quota-ticket-types">
                          {quota.ticketTypes.map((ticket) => (
                            <span key={ticket.id}>{ticket.name} · {ticket.kind} · {formatCNY(ticket.priceCents)}</span>
                          ))}
                          {quota.ticketTypes.length === 0 && <span>未绑定票种</span>}
                        </div>
                      </div>
                      <div className="quota-metrics">
                        <SmallMetric label="已成交" value={quota.used} />
                        <SmallMetric label="预留中" value={quota.reservedActive} />
                        <SmallMetric label="可售" value={quota.available === null ? "∞" : quota.available} />
                      </div>
                      <div className="quota-edit">
                        <input value={form.capacity} onChange={(event) => updateQuotaForm(quota.id, { capacity: event.target.value })} inputMode="numeric" placeholder="不限量" aria-label="配额容量" />
                        <button className="mini-btn" onClick={() => saveQuota(quota)} disabled={savingQuota === quota.id}>
                          {savingQuota === quota.id ? "保存中" : "保存"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="backoffice-panel">
              <div className="panel-head">
                <div>
                  <h3>Exporters</h3>
                  <p>报名名单、候补、反馈、资源等服务端导出。</p>
                </div>
                <span>{exporters.length} 个</span>
              </div>
              <div className="exporter-list">
                {exporters.length === 0 && <div className="muted">暂无导出器。</div>}
                {exporters.map((exporter) => (
                  <button className="exporter-row" type="button" onClick={() => downloadExporter(exporter)} disabled={downloadingExporter === exporter.key} key={exporter.key}>
                    <b>{exporter.label}</b>
                    <span>{downloadingExporter === exporter.key ? "下载中" : exporter.description}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="backoffice-small">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function filenameFromDisposition(value: string | null) {
  if (!value) return "";
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  return value.match(/filename="([^"]+)"/i)?.[1] ?? "";
}

function extensionFromHref(value: string) {
  if (value.endsWith(".xls")) return ".xls";
  if (value.endsWith(".pdf")) return ".pdf";
  return ".csv";
}

function formatDate(value?: string) {
  if (!value) return "时间待定";
  return new Date(value).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
