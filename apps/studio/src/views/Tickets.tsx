import { useEffect, useState } from "react";
import { formatCNY } from "@loopin/core";
import { api } from "../api.js";
import { useCurrentEvent } from "../event/EventContext.js";

/**
 * 主办方·票种与收款（P2）。当前活动维度：票种增删改停售（含早鸟价/邀请码）+ 手动退款。
 * 钱/库存/退款/早鸟定价由后端权威，前端只配置和触发。
 */

interface Ticket {
  id: string;
  name: string;
  kind: string;
  priceCents: number;
  status: string;
  earlyBirdPriceCents: number | null;
  earlyBirdUntil: string | null;
  inviteCode: string | null;
  capacity: number | null;
  used: number;
}

interface Reg {
  id: string;
  status: string;
  formValues: Record<string, unknown>;
  orderId: string | null;
  orderAmountCents: number | null;
  paymentStatus: string | null;
  refundStatus: string | null;
  refundedAmountCents: number;
}

interface Edit {
  name: string; price: string; capacity: string;
  earlyBird: string; earlyBirdUntil: string; inviteCode: string;
}

const KIND_LABEL: Record<string, string> = { free: "免费票", approval: "审核票", paid: "付费票" };
const KIND_OPTIONS = ["paid", "free", "approval"];

interface AddForm { name: string; kind: string; price: string; capacity: string; earlyBird: string; earlyBirdUntil: string; inviteCode: string }
const EMPTY_ADD: AddForm = { name: "", kind: "paid", price: "", capacity: "", earlyBird: "", earlyBirdUntil: "", inviteCode: "" };

export function Tickets() {
  const { currentEventId, currentEvent } = useCurrentEvent();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [regs, setRegs] = useState<Reg[]>([]);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [add, setAdd] = useState<AddForm>(EMPTY_ADD);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  function load(id: string) {
    if (!id) { setTickets([]); setRegs([]); return; }
    api.get(`/events/${id}/ticket-types`).then((r) => {
      setTickets(r.ticketTypes);
      setEdits(Object.fromEntries((r.ticketTypes as Ticket[]).map((t) => [t.id, {
        name: t.name, price: String(t.priceCents / 100), capacity: t.capacity === null ? "" : String(t.capacity),
        earlyBird: t.earlyBirdPriceCents != null ? String(t.earlyBirdPriceCents / 100) : "",
        earlyBirdUntil: isoToLocal(t.earlyBirdUntil), inviteCode: t.inviteCode ?? "",
      }])));
    }).catch(() => setTickets([]));
    api.get(`/events/${id}/registrations`).then((r) => setRegs(r.registrations)).catch(() => setRegs([]));
  }

  useEffect(() => { load(currentEventId); }, [currentEventId]);

  function priceCentsOf(kind: string, yuan: string) {
    return kind === "paid" ? Math.round(Number(yuan || 0) * 100) : 0;
  }

  async function addTicket() {
    if (!add.name.trim()) { setMessage("票种名称不能为空"); return; }
    setBusy("add");
    try {
      await api.post(`/events/${currentEventId}/ticket-types`, {
        name: add.name, kind: add.kind,
        priceCents: priceCentsOf(add.kind, add.price),
        capacity: add.capacity.trim() === "" ? null : Number(add.capacity),
        earlyBirdPriceCents: add.kind === "paid" && add.earlyBird.trim() !== "" ? Math.round(Number(add.earlyBird) * 100) : null,
        earlyBirdUntil: add.earlyBirdUntil || null,
        inviteCode: add.inviteCode.trim() || null,
      });
      setMessage(`票种「${add.name}」已添加`);
      setAdd(EMPTY_ADD);
      load(currentEventId);
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(""); }
  }

  async function saveTicket(t: Ticket) {
    const e = edits[t.id];
    if (!e) return;
    setBusy(t.id);
    try {
      await api.post(`/ticket-types/${t.id}/update`, {
        name: e.name,
        priceCents: priceCentsOf(t.kind, e.price),
        capacity: e.capacity.trim() === "" ? null : Number(e.capacity),
        earlyBirdPriceCents: t.kind === "paid" && e.earlyBird.trim() !== "" ? Math.round(Number(e.earlyBird) * 100) : null,
        earlyBirdUntil: e.earlyBirdUntil || null,
        inviteCode: e.inviteCode.trim() || null,
      });
      setMessage(`票种「${e.name}」已保存`);
      load(currentEventId);
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(""); }
  }

  async function toggleArchive(t: Ticket) {
    setBusy(t.id);
    try {
      await api.post(`/ticket-types/${t.id}/archive`, { status: t.status === "archived" ? "active" : "archived" });
      setMessage(`票种「${t.name}」已${t.status === "archived" ? "恢复" : "停售"}`);
      load(currentEventId);
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(""); }
  }

  async function refund(reg: Reg) {
    if (!reg.orderId) return;
    setBusy(reg.id);
    try {
      const r = await api.post(`/orders/${reg.orderId}/refund`, {});
      setMessage(`${name(reg)} 已${r.refundStatus === "full" ? "全额" : "部分"}退款 ${formatCNY(r.refundedAmountCents)}`);
      load(currentEventId);
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(""); }
  }

  function patchEdit(id: string, p: Partial<Edit>) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id]!, ...p } }));
  }

  const refundable = regs.filter((r) => r.paymentStatus === "paid" && r.refundStatus !== "full" && r.orderId);

  if (!currentEventId) {
    return <div className="single"><section className="card"><h2>票种与收款</h2><div className="muted">先在顶栏选择一个活动。</div></section></div>;
  }

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <div>
            <h2>票种与收款</h2>
            <p className="muted ops-intro">为「{currentEvent?.title ?? "当前活动"}」管理票种、早鸟价、邀请码、库存与退款。</p>
          </div>
        </div>

        {message && <div className="reg-message">{message}</div>}

        <div className="tk-section">
          <div className="ops-agent-title">票种</div>
          <div className="tk-list">
            {tickets.length === 0 && <div className="muted">暂无票种。</div>}
            {tickets.map((t) => {
              const e = edits[t.id];
              if (!e) return null;
              const archived = t.status === "archived";
              const paid = t.kind === "paid";
              return (
                <div className={`tk-card ${archived ? "is-archived" : ""}`} key={t.id}>
                  <div className="tk-row">
                    <span className={`tk-kind tk-kind-${t.kind}`}>{KIND_LABEL[t.kind] ?? t.kind}</span>
                    <input className="tk-input" value={e.name} onChange={(ev) => patchEdit(t.id, { name: ev.target.value })} aria-label="票种名称" />
                    <div className="tk-price"><input className="tk-input tk-num" inputMode="decimal" value={e.price} disabled={!paid} onChange={(ev) => patchEdit(t.id, { price: ev.target.value })} aria-label="价格" /><span>元</span></div>
                    <div className="tk-cap"><input className="tk-input tk-num" inputMode="numeric" placeholder="不限" value={e.capacity} onChange={(ev) => patchEdit(t.id, { capacity: ev.target.value })} aria-label="容量" /><span className="muted">已售 {t.used}</span></div>
                    <button className="mini-btn" disabled={busy === t.id} onClick={() => saveTicket(t)}>保存</button>
                    <button className="ghost-btn" disabled={busy === t.id} onClick={() => toggleArchive(t)}>{archived ? "恢复" : "停售"}</button>
                  </div>
                  <div className="tk-adv">
                    <label><span>早鸟价</span><div className="tk-price"><input className="tk-input tk-num" inputMode="decimal" placeholder="不设" value={e.earlyBird} disabled={!paid} onChange={(ev) => patchEdit(t.id, { earlyBird: ev.target.value })} /><span>元</span></div></label>
                    <label><span>早鸟截止</span><input className="tk-input" type="datetime-local" value={e.earlyBirdUntil} disabled={!paid} onChange={(ev) => patchEdit(t.id, { earlyBirdUntil: ev.target.value })} /></label>
                    <label><span>邀请码</span><input className="tk-input" placeholder="空=不需要" value={e.inviteCode} onChange={(ev) => patchEdit(t.id, { inviteCode: ev.target.value })} /></label>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="tk-add-card">
            <div className="tk-add">
              <input className="tk-input" placeholder="新票种名称（如 早鸟票）" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
              <select className="tk-input" value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value })}>
                {KIND_OPTIONS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <div className="tk-price"><input className="tk-input tk-num" inputMode="decimal" placeholder="价格" value={add.price} disabled={add.kind !== "paid"} onChange={(e) => setAdd({ ...add, price: e.target.value })} /><span>元</span></div>
              <input className="tk-input tk-num" inputMode="numeric" placeholder="容量（空=不限）" value={add.capacity} onChange={(e) => setAdd({ ...add, capacity: e.target.value })} />
              <button className="mini-btn" disabled={busy === "add"} onClick={addTicket}>+ 添加票种</button>
            </div>
            <div className="tk-adv">
              <label><span>早鸟价</span><div className="tk-price"><input className="tk-input tk-num" inputMode="decimal" placeholder="不设" value={add.earlyBird} disabled={add.kind !== "paid"} onChange={(e) => setAdd({ ...add, earlyBird: e.target.value })} /><span>元</span></div></label>
              <label><span>早鸟截止</span><input className="tk-input" type="datetime-local" value={add.earlyBirdUntil} disabled={add.kind !== "paid"} onChange={(e) => setAdd({ ...add, earlyBirdUntil: e.target.value })} /></label>
              <label><span>邀请码</span><input className="tk-input" placeholder="空=不需要" value={add.inviteCode} onChange={(e) => setAdd({ ...add, inviteCode: e.target.value })} /></label>
            </div>
          </div>
        </div>

        <div className="tk-section">
          <div className="ops-agent-title">手动退款</div>
          {refundable.length === 0 ? (
            <div className="muted">暂无可退款的已支付订单。</div>
          ) : (
            <table className="scenarios">
              <thead><tr><th>姓名</th><th>金额</th><th>已退</th><th>操作</th></tr></thead>
              <tbody>
                {refundable.map((r) => (
                  <tr key={r.id}>
                    <td>{name(r)}</td>
                    <td>{formatCNY(r.orderAmountCents ?? 0)}</td>
                    <td>{r.refundedAmountCents ? formatCNY(r.refundedAmountCents) : "—"}</td>
                    <td><button className="mini-btn danger" disabled={busy === r.id} onClick={() => refund(r)}>退款</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function name(reg: Reg) {
  return String(reg.formValues.name ?? "未填写姓名");
}

function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
