import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useCurrentEvent } from "../event/EventContext.js";

interface Reg {
  id: string;
  status: string;
  formValues: Record<string, unknown>;
  ticketName: string;
  ticketKind: string;
  checkinToken: string | null;
  checkinPayload: string | null;
  waitlistPosition: number | null;
  tag: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  submitted: "待确认", approved: "已通过", checked_in: "已签到",
  waitlisted: "候补", cancelled: "已取消",
};

// 现场重点标记（后端落库 Registration.tag）
type Tag = "" | "guest" | "vip" | "staff";
const TAG_LABEL: Record<Exclude<Tag, "">, string> = { guest: "嘉宾", vip: "VIP", staff: "工作人员" };
const TAG_OPTIONS: Tag[] = ["", "guest", "vip", "staff"];

const FILTERS: { key: string; label: string; statuses: string[] }[] = [
  { key: "unchecked", label: "未签到", statuses: ["approved"] },
  { key: "checked", label: "已签到", statuses: ["checked_in"] },
  { key: "waitlisted", label: "候补", statuses: ["waitlisted"] },
  { key: "submitted", label: "待确认", statuses: ["submitted"] },
];

export function CheckIn() {
  const { currentEventId } = useCurrentEvent();
  const [regs, setRegs] = useState<Reg[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("unchecked");
  const [scanValue, setScanValue] = useState("");
  const [scanMessage, setScanMessage] = useState("");
  const [scanGood, setScanGood] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [bigScreen, setBigScreen] = useState(false);

  function load(id: string) {
    if (!id) { setRegs([]); return; }
    api.get(`/events/${id}/registrations`).then((r) => setRegs(r.registrations)).catch(() => setRegs([]));
  }

  useEffect(() => {
    load(currentEventId);
  }, [currentEventId]);

  async function setTag(regId: string, tag: Tag) {
    // 乐观更新 + 落库
    setRegs((prev) => prev.map((r) => (r.id === regId ? { ...r, tag: tag || null } : r)));
    try {
      await api.post(`/registrations/${regId}/tag`, { tag: tag || null });
    } catch {
      load(currentEventId); // 失败回滚到服务端真值
    }
  }

  const stats = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of regs) c[r.status] = (c[r.status] ?? 0) + 1;
    const expected = (c.approved ?? 0) + (c.checked_in ?? 0); // 应到 = 已通过 + 已签到
    const checked = c.checked_in ?? 0;
    return {
      counts: c,
      expected,
      checked,
      rate: expected ? Math.round((checked / expected) * 100) : 0,
      waitlisted: c.waitlisted ?? 0,
      submitted: c.submitted ?? 0,
    };
  }, [regs]);

  const filterCount = (key: string) => {
    const f = FILTERS.find((x) => x.key === key);
    return f ? regs.filter((r) => f.statuses.includes(r.status)).length : 0;
  };

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]!;
    return regs.filter((r) => {
      if (!f.statuses.includes(r.status)) return false;
      if (!q) return true;
      return JSON.stringify(r.formValues).includes(q);
    });
  }, [regs, filter, q]);

  async function checkin(reg: Reg) {
    try {
      await api.post(`/registrations/${reg.id}/checkin`, {});
      flash(`${name(reg)} 已签到`, true);
      load(currentEventId);
    } catch (e) {
      flash((e as Error).message, false);
    }
  }

  async function approveAndCheckin(reg: Reg) {
    try {
      await api.post(`/registrations/${reg.id}/approve`, {});
      await api.post(`/registrations/${reg.id}/checkin`, {});
      flash(`${name(reg)} 已现场通过并签到`, true);
      load(currentEventId);
    } catch (e) {
      flash((e as Error).message, false);
    }
  }

  async function promote(reg: Reg) {
    try {
      await api.post(`/registrations/${reg.id}/promote`, {});
      flash(`${name(reg)} 候补已转正`, true);
      load(currentEventId);
    } catch (e) {
      flash((e as Error).message, false);
    }
  }

  async function scanCheckin() {
    const payload = scanValue.trim();
    if (!payload) { flash("请粘贴核验 payload", false); return; }
    try {
      setScanBusy(true);
      await api.post("/checkin/scan", { payload, by: "studio" });
      setScanValue("");
      flash("核销成功", true);
      load(currentEventId);
    } catch (e) {
      flash((e as Error).message, false);
    } finally {
      setScanBusy(false);
    }
  }

  function flash(msg: string, good: boolean) {
    setScanMessage(msg);
    setScanGood(good);
  }

  if (bigScreen) {
    return <BigScreen stats={stats} regs={regs} scanValue={scanValue} scanBusy={scanBusy}
      onScanChange={setScanValue} onScan={scanCheckin} scanMessage={scanMessage} scanGood={scanGood}
      onExit={() => setBigScreen(false)} />;
  }

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <h2>现场签到</h2>
          <button className="ghost-btn" onClick={() => setBigScreen(true)}>大屏模式</button>
        </div>

        <div className="checkin-stats">
          <BigStat label="已签到" value={stats.checked} accent="good" />
          <BigStat label="应到" value={stats.expected} />
          <BigStat label="签到率" value={`${stats.rate}%`} accent={stats.rate >= 60 ? "good" : "warn"} />
          <BigStat label="候补" value={stats.waitlisted} />
          <BigStat label="待确认" value={stats.submitted} />
        </div>

        <div className="scan-panel">
          <input
            className="search scan-input"
            placeholder="粘贴活动核验 payload，扫码枪回车可直接核销"
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") scanCheckin(); }}
          />
          <button className="mini-btn scan-btn" onClick={scanCheckin} disabled={scanBusy}>{scanBusy ? "核销中" : "核销"}</button>
        </div>
        {scanMessage && <div className={scanGood ? "scan-message good" : "scan-message"}>{scanMessage}</div>}

        <div className="reg-tabs">
          {FILTERS.map((f) => (
            <button key={f.key} className={`reg-tab ${filter === f.key ? "is-active" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label}<span className="reg-tab-count">{filterCount(f.key)}</span>
            </button>
          ))}
        </div>

        <input className="search" placeholder="搜索姓名/手机号" value={q} onChange={(e) => setQ(e.target.value)} />

        <table className="scenarios checkin-table">
          <thead><tr><th>姓名</th><th>手机号</th><th>票种</th><th>标记</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={6} className="muted">该分栏暂无人员</td></tr>}
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{name(r)}{r.tag && <span className={`checkin-tag tag-${r.tag}`}>{TAG_LABEL[r.tag as Exclude<Tag, "">]}</span>}</td>
                <td>{String(r.formValues.phone ?? "—")}</td>
                <td>{r.ticketKind === "approval" ? "审核票" : r.ticketName}</td>
                <td>
                  <select className="checkin-tag-select" value={r.tag ?? ""} onChange={(e) => setTag(r.id, e.target.value as Tag)} aria-label="重点标记">
                    {TAG_OPTIONS.map((t) => <option key={t} value={t}>{t ? TAG_LABEL[t as Exclude<Tag, "">] : "普通"}</option>)}
                  </select>
                </td>
                <td className={r.status === "checked_in" ? "row-good" : ""}>
                  {r.status === "waitlisted" && r.waitlistPosition ? `候补 #${r.waitlistPosition}` : STATUS_LABEL[r.status] ?? r.status}
                </td>
                <td>
                  {r.status === "approved" ? (
                    <button className="mini-btn" onClick={() => checkin(r)}>签到</button>
                  ) : r.status === "checked_in" ? "✅" : r.status === "waitlisted" ? (
                    <button className="mini-btn" onClick={() => promote(r)}>转正</button>
                  ) : r.status === "submitted" ? (
                    <button className="mini-btn" onClick={() => approveAndCheckin(r)}>通过并签到</button>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function BigScreen({ stats, regs, scanValue, scanBusy, onScanChange, onScan, scanMessage, scanGood, onExit }: {
  stats: { checked: number; expected: number; rate: number; waitlisted: number; submitted: number };
  regs: Reg[];
  scanValue: string;
  scanBusy: boolean;
  onScanChange: (v: string) => void;
  onScan: () => void;
  scanMessage: string;
  scanGood: boolean;
  onExit: () => void;
}) {
  const recent = regs.filter((r) => r.status === "checked_in").slice(0, 8);
  return (
    <div className="checkin-big">
      <div className="checkin-big-head">
        <h2>现场签到 · 大屏</h2>
        <button className="ghost-btn" onClick={onExit}>退出大屏</button>
      </div>
      <div className="checkin-big-main">
        <div className="checkin-big-rate">
          <div className="checkin-big-num">{stats.checked}<span> / {stats.expected}</span></div>
          <div className="checkin-big-label">已签到 / 应到</div>
          <div className="progress-bar checkin-big-bar"><div className="progress-fill" style={{ width: `${Math.min(100, stats.rate)}%` }} /></div>
          <div className="checkin-big-pct">{stats.rate}%</div>
        </div>
        <div className="checkin-big-side">
          <div className="scan-panel">
            <input className="search scan-input" placeholder="扫码枪回车直接核销" value={scanValue}
              onChange={(e) => onScanChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onScan(); }} autoFocus />
            <button className="mini-btn scan-btn" onClick={onScan} disabled={scanBusy}>{scanBusy ? "核销中" : "核销"}</button>
          </div>
          {scanMessage && <div className={scanGood ? "scan-message good" : "scan-message"}>{scanMessage}</div>}
          <div className="checkin-big-stats">
            <span>候补 {stats.waitlisted}</span>
            <span>待确认 {stats.submitted}</span>
          </div>
          <div className="checkin-big-recent">
            <div className="ops-agent-title">最近签到</div>
            {recent.length === 0 ? <div className="muted">还没有人签到</div> : recent.map((r) => (
              <div className="checkin-big-recent-row" key={r.id}>
                <b>{name(r)}</b>
                {r.tag && <span className={`checkin-tag tag-${r.tag}`}>{TAG_LABEL[r.tag as Exclude<Tag, "">]}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BigStat({ label, value, accent }: { label: string; value: string | number; accent?: "good" | "warn" }) {
  return (
    <div className="metric">
      <span className="m-label">{label}</span>
      <span className={`m-value ${accent ?? ""}`}>{value}</span>
    </div>
  );
}

function name(reg: Reg) {
  return String(reg.formValues.name ?? "未填写姓名");
}
