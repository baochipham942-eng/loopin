import { useEffect, useState } from "react";
import { api } from "../api.js";

interface EventLite { id: string; title: string }
interface Reg {
  id: string;
  status: string;
  formValues: Record<string, unknown>;
  ticketName: string;
}

const STATUS_LABEL: Record<string, string> = {
  submitted: "待确认", approved: "已通过", checked_in: "已签到",
  waitlisted: "候补", cancelled: "已取消",
};

export function CheckIn() {
  const [events, setEvents] = useState<EventLite[]>([]);
  const [selected, setSelected] = useState("");
  const [regs, setRegs] = useState<Reg[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    api.get("/events").then((r) => { setEvents(r.events); if (r.events[0]) setSelected(r.events[0].id); }).catch(() => {});
  }, []);

  function load(id: string) {
    api.get(`/events/${id}/registrations`).then((r) => setRegs(r.registrations)).catch(() => setRegs([]));
  }
  useEffect(() => { if (selected) load(selected); }, [selected]);

  async function checkin(reg: Reg) {
    try {
      await api.post(`/registrations/${reg.id}/checkin`, {});
      load(selected);
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const filtered = regs.filter((r) => {
    if (!q) return true;
    const s = JSON.stringify(r.formValues);
    return s.includes(q);
  });

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <h2>现场签到</h2>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="select">
            {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </div>

        <input className="search" placeholder="搜索姓名/手机号" value={q} onChange={(e) => setQ(e.target.value)} />

        <table className="scenarios checkin-table">
          <thead><tr><th>姓名</th><th>手机号</th><th>票种</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={5} className="muted">暂无报名</td></tr>}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{String(r.formValues.name ?? "—")}</td>
                <td>{String(r.formValues.phone ?? "—")}</td>
                <td>{r.ticketName}</td>
                <td className={r.status === "checked_in" ? "row-good" : ""}>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td>
                  {r.status === "approved" ? (
                    <button className="mini-btn" onClick={() => checkin(r)}>签到</button>
                  ) : r.status === "checked_in" ? "✅" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
