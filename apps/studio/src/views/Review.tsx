import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useCurrentEvent } from "../event/EventContext.js";

interface Reg {
  id: string;
  status: string;
  formValues: Record<string, unknown>;
  ticketName: string;
  ticketKind: string;
  orderLifecycle: string | null;
  paymentStatus: string | null;
  waitlistPosition: number | null;
  waitlistStatus: string | null;
  createdAt?: string;
}

const STATUS_LABEL: Record<string, string> = {
  submitted: "待确认",
  approved: "已通过",
  checked_in: "已签到",
  rejected: "已拒绝",
  waitlisted: "候补",
  cancelled: "已取消",
};

// 筛选 tab 顺序（生命周期：待处理优先）
const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "submitted", label: "待确认" },
  { key: "waitlisted", label: "候补" },
  { key: "approved", label: "已通过" },
  { key: "checked_in", label: "已签到" },
  { key: "rejected", label: "已拒绝" },
];

type Action = "approve" | "reject" | "promote";

export function Review() {
  const { currentEventId } = useCurrentEvent();
  const [regs, setRegs] = useState<Reg[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("submitted");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Reg | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function load(id: string) {
    if (!id) { setRegs([]); return; }
    api.get(`/events/${id}/registrations`)
      .then((r) => setRegs(r.registrations))
      .catch(() => setRegs([]));
  }

  useEffect(() => {
    setSelectedIds(new Set());
    setDetail(null);
    load(currentEventId);
  }, [currentEventId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of regs) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [regs]);

  const filtered = useMemo(() => regs.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (!q) return true;
    return JSON.stringify(r.formValues).includes(q);
  }), [regs, filter, q]);

  // 当前筛选视图里被选中的行
  const selectedRows = useMemo(() => filtered.filter((r) => selectedIds.has(r.id)), [filtered, selectedIds]);
  const eligibleSubmitted = selectedRows.filter((r) => r.status === "submitted");
  const eligibleWaitlisted = selectedRows.filter((r) => r.status === "waitlisted");
  const allChecked = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      if (filtered.every((r) => prev.has(r.id))) {
        const next = new Set(prev);
        filtered.forEach((r) => next.delete(r.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((r) => next.add(r.id));
      return next;
    });
  }

  async function act(reg: Reg, action: Action) {
    try {
      await api.post(`/registrations/${reg.id}/${action}`, {});
      setMessage(`${displayName(reg)} 已${actionLabel(action)}`);
      load(currentEventId);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function batch(action: Action, rows: Reg[]) {
    if (rows.length === 0) return;
    setBusy(true);
    setMessage("");
    const results = await Promise.allSettled(rows.map((r) => api.post(`/registrations/${r.id}/${action}`, {})));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    setBusy(false);
    setMessage(`批量${actionLabel(action)}：成功 ${ok} 条${failed ? `，失败 ${failed} 条` : ""}`);
    setSelectedIds(new Set());
    load(currentEventId);
  }

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <h2>报名审核</h2>
          <input className="search reg-search" placeholder="搜索姓名/手机号/公司" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="reg-tabs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`reg-tab ${filter === f.key ? "is-active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="reg-tab-count">{f.key === "all" ? regs.length : counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>

        {message && <div className="reg-message">{message}</div>}

        {selectedRows.length > 0 && (
          <div className="reg-batchbar">
            <span>已选 {selectedRows.length} 条</span>
            <div className="reg-batch-actions">
              <button className="mini-btn" disabled={busy || eligibleSubmitted.length === 0} onClick={() => batch("approve", eligibleSubmitted)}>
                批量通过{eligibleSubmitted.length ? `（${eligibleSubmitted.length}）` : ""}
              </button>
              <button className="mini-btn danger" disabled={busy || eligibleSubmitted.length === 0} onClick={() => batch("reject", eligibleSubmitted)}>
                批量拒绝{eligibleSubmitted.length ? `（${eligibleSubmitted.length}）` : ""}
              </button>
              <button className="mini-btn" disabled={busy || eligibleWaitlisted.length === 0} onClick={() => batch("promote", eligibleWaitlisted)}>
                批量转正{eligibleWaitlisted.length ? `（${eligibleWaitlisted.length}）` : ""}
              </button>
              <button className="ghost-btn" disabled={busy} onClick={() => setSelectedIds(new Set())}>清空选择</button>
            </div>
          </div>
        )}

        <table className="scenarios checkin-table reg-table">
          <thead>
            <tr>
              <th className="reg-check-col"><input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="全选" /></th>
              <th>姓名</th><th>手机号</th><th>身份</th><th>票种</th><th>状态</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={7} className="muted">该筛选下暂无报名</td></tr>}
            {filtered.map((r) => (
              <tr key={r.id} className={selectedIds.has(r.id) ? "reg-row-selected" : ""}>
                <td className="reg-check-col">
                  <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggle(r.id)} aria-label="选择该行" />
                </td>
                <td><button className="reg-name-btn" onClick={() => setDetail(r)}>{displayName(r)}</button></td>
                <td>{String(r.formValues.phone ?? "—")}</td>
                <td>{professionText(r.formValues)}</td>
                <td>{r.ticketKind === "approval" ? "审核票" : r.ticketName}</td>
                <td>{r.status === "waitlisted" && r.waitlistPosition ? `候补 #${r.waitlistPosition}` : STATUS_LABEL[r.status] ?? r.status}</td>
                <td>
                  {r.status === "submitted" ? (
                    <div className="actions">
                      <button className="mini-btn" onClick={() => act(r, "approve")}>通过</button>
                      <button className="mini-btn danger" onClick={() => act(r, "reject")}>拒绝</button>
                    </div>
                  ) : r.status === "waitlisted" ? (
                    <button className="mini-btn" onClick={() => act(r, "promote")}>转正</button>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {detail && <RegistrationDrawer reg={detail} onClose={() => setDetail(null)} onAct={act} />}
    </div>
  );
}

function RegistrationDrawer({ reg, onClose, onAct }: { reg: Reg; onClose: () => void; onAct: (reg: Reg, action: Action) => void }) {
  const entries = Object.entries(reg.formValues);
  return (
    <div className="reg-drawer-backdrop" onClick={onClose}>
      <aside className="reg-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="reg-drawer-head">
          <div>
            <h3>{displayName(reg)}</h3>
            <span className="reg-drawer-status">{STATUS_LABEL[reg.status] ?? reg.status}</span>
          </div>
          <button className="ghost-btn" onClick={onClose}>关闭</button>
        </div>

        <div className="reg-drawer-meta">
          <Meta label="票种" value={reg.ticketKind === "approval" ? "审核票" : reg.ticketName} />
          <Meta label="订单" value={reg.orderLifecycle ?? "—"} />
          <Meta label="支付" value={reg.paymentStatus ?? "—"} />
          {reg.waitlistPosition !== null && <Meta label="候补位次" value={`#${reg.waitlistPosition}`} />}
          {reg.createdAt && <Meta label="报名时间" value={formatDate(reg.createdAt)} />}
        </div>

        <div className="reg-drawer-fields">
          <div className="ops-agent-title">报名表字段</div>
          {entries.length === 0 && <div className="muted">无表单字段</div>}
          {entries.map(([key, value]) => (
            <div className="reg-field-row" key={key}>
              <span>{key}</span>
              <b>{Array.isArray(value) ? value.join(" / ") : String(value ?? "—")}</b>
            </div>
          ))}
        </div>

        {(reg.status === "submitted" || reg.status === "waitlisted") && (
          <div className="reg-drawer-actions">
            {reg.status === "submitted" && (
              <>
                <button className="mini-btn" onClick={() => { onAct(reg, "approve"); onClose(); }}>通过</button>
                <button className="mini-btn danger" onClick={() => { onAct(reg, "reject"); onClose(); }}>拒绝</button>
              </>
            )}
            {reg.status === "waitlisted" && (
              <button className="mini-btn" onClick={() => { onAct(reg, "promote"); onClose(); }}>转正</button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="ops-small">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function displayName(reg: Reg) {
  return String(reg.formValues.name ?? "未填写姓名");
}

function professionText(formValues: Record<string, unknown>) {
  const p = formValues.profession ?? formValues.role;
  return Array.isArray(p) ? p.join(" / ") : String(p ?? "—");
}

function actionLabel(action: Action) {
  return action === "approve" ? "通过" : action === "reject" ? "拒绝" : "转正";
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
