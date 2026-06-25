import { useEffect, useState } from "react";
import { api } from "../api.js";
import { useCurrentEvent } from "../event/EventContext.js";

/**
 * 主办方·运营台（P2 重构：当前活动的运营指挥台）。
 * 只放跨阶段的"现在该干什么"：关键提醒 + 今日动作 + Agent 运营建议 + 快捷入口。
 * 统计→报名看板；引流路径→分享素材；复盘/反馈/资料→复盘。各页单一职责不重叠。
 */

type View = "create" | "dashboard" | "review" | "checkin" | "materials";

interface DashData {
  counts: Record<string, number>;
  totalRegistrations: number;
  confirmed: number;
  capacity: number | null;
  used: number;
  breakEven: number | null;
  breakEvenProgress: number | null;
}

interface AgentTask {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  status: string;
  highRisk: boolean;
}

const TASK_KIND_LABEL: Record<string, string> = { generation: "生成", decision: "决策", operator: "执行" };
const TASK_STATUS_LABEL: Record<string, string> = { suggested: "待处理", accepted: "已接受", dismissed: "已忽略", completed: "已完成" };

export function Operations({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { currentEventId, currentEvent } = useCurrentEvent();
  const [dash, setDash] = useState<DashData | null>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingTask, setUpdatingTask] = useState("");
  const [message, setMessage] = useState("");

  function load(id: string) {
    if (!id) { setDash(null); setTasks([]); setLoading(false); return; }
    setLoading(true);
    Promise.all([
      api.get(`/events/${id}/dashboard`).catch(() => null),
      api.get(`/events/${id}/agent-tasks`).catch(() => ({ tasks: [] })),
    ]).then(([d, a]) => { setDash(d); setTasks(a.tasks || []); }).finally(() => setLoading(false));
  }

  useEffect(() => { load(currentEventId); }, [currentEventId]);

  async function updateTask(taskId: string, status: string) {
    setUpdatingTask(taskId);
    try {
      const r = await api.post(`/agent-tasks/${taskId}/status`, { status });
      setMessage(`运营建议已更新为「${TASK_STATUS_LABEL[r.task?.status] ?? status}」`);
      load(currentEventId);
    } catch (e) { setMessage((e as Error).message); } finally { setUpdatingTask(""); }
  }

  if (!currentEventId) {
    return <div className="single"><section className="card"><h2>运营台</h2><div className="muted">先在「活动列表」选一场活动。</div></section></div>;
  }

  const counts = dash?.counts ?? {};
  const alerts = dash ? buildAlerts(dash, counts) : [];
  const actions = dash ? buildActions(dash, counts) : [];

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <div>
            <h2>运营台</h2>
            <p className="muted ops-intro">「{currentEvent?.title ?? "当前活动"}」现在该干什么。完整数据看「报名看板」，复盘看「复盘」。</p>
          </div>
          <button className="mini-btn" onClick={() => load(currentEventId)} disabled={loading}>{loading ? "刷新中" : "刷新"}</button>
        </div>

        {message && <div className="reg-message">{message}</div>}

        <div className="op-alerts">
          {alerts.map((a) => (
            <div className={`op-alert ${a.tone}`} key={a.label}>
              <span className="op-alert-num">{a.value}</span>
              <span className="op-alert-label">{a.label}</span>
            </div>
          ))}
        </div>

        <div className="op-block">
          <div className="ops-agent-title">今日动作</div>
          {actions.length === 0 ? <div className="muted">{loading ? "加载中…" : "进展健康，保持当前节奏。"}</div> : (
            <div className="dash-actions">
              {actions.map((a, i) => (
                <div className="dash-action-row" key={i}>
                  <span className="dash-action-dot" />
                  <span className="op-action-text">{a.text}</span>
                  {a.view && <button className="ghost-btn op-action-btn" onClick={() => onNavigate(a.view!)}>{a.cta}</button>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="op-block">
          <div className="ops-agent-title">Agent 运营建议</div>
          {tasks.length === 0 ? <div className="muted">暂无 Agent 运营建议。</div> : (
            <div className="ops-agent">
              {tasks.map((task) => (
                <div className={`ops-agent-task ${task.highRisk ? "risk" : ""}`} key={task.id}>
                  <div className="ops-agent-main">
                    <div className="ops-agent-row">
                      <span className="ops-agent-kind">{TASK_KIND_LABEL[task.kind] ?? task.kind}</span>
                      {task.highRisk && <span className="ops-agent-risk">需确认</span>}
                      <span className="ops-agent-status">{TASK_STATUS_LABEL[task.status] ?? task.status}</span>
                    </div>
                    <b>{task.title}</b>
                    {task.detail && <p>{task.detail}</p>}
                  </div>
                  <div className="ops-agent-actions">
                    {task.status === "suggested" && <button className="mini-btn" onClick={() => updateTask(task.id, "accepted")} disabled={updatingTask === task.id}>接受</button>}
                    {task.status === "accepted" && <button className="mini-btn" onClick={() => updateTask(task.id, "completed")} disabled={updatingTask === task.id}>完成</button>}
                    <button className="ghost-btn" onClick={() => updateTask(task.id, "dismissed")} disabled={updatingTask === task.id}>忽略</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="op-quick">
          <button className="ghost-btn" onClick={() => onNavigate("dashboard")}>报名看板</button>
          <button className="ghost-btn" onClick={() => onNavigate("review")}>报名审核</button>
          <button className="ghost-btn" onClick={() => onNavigate("checkin")}>现场签到</button>
          <button className="ghost-btn" onClick={() => onNavigate("materials")}>分享素材</button>
        </div>
      </section>
    </div>
  );
}

function buildAlerts(dash: DashData, counts: Record<string, number>) {
  const list: { label: string; value: number | string; tone: string }[] = [
    { label: "待审核", value: counts.submitted ?? 0, tone: (counts.submitted ?? 0) > 0 ? "warn" : "" },
    { label: "候补", value: counts.waitlisted ?? 0, tone: (counts.waitlisted ?? 0) > 0 ? "info" : "" },
    { label: "待签到", value: counts.approved ?? 0, tone: "" },
    {
      label: "保本进度",
      value: dash.breakEvenProgress === null ? "—" : `${Math.round(dash.breakEvenProgress * 100)}%`,
      tone: dash.breakEvenProgress !== null && dash.breakEvenProgress < 1 ? "warn" : "good",
    },
  ];
  return list;
}

interface ActionItem { text: string; view?: View; cta?: string }
function buildActions(dash: DashData, counts: Record<string, number>): ActionItem[] {
  const out: ActionItem[] = [];
  if ((counts.submitted ?? 0) > 0) out.push({ text: `有 ${counts.submitted} 条待确认报名`, view: "review", cta: "去审核" });
  const slots = dash.capacity === null ? Infinity : dash.capacity - dash.used;
  if ((counts.waitlisted ?? 0) > 0 && slots > 0) out.push({ text: `还有空位，可放候补 ${counts.waitlisted} 人转正`, view: "review", cta: "去处理" });
  if (dash.breakEven !== null && dash.confirmed < dash.breakEven) out.push({ text: `距保本还差 ${dash.breakEven - dash.confirmed} 人，加推一轮渠道`, view: "materials", cta: "去推广" });
  if ((counts.approved ?? 0) > 0) out.push({ text: `${counts.approved} 人已通过未签到，临近活动发提醒`, view: "checkin", cta: "去签到" });
  return out.slice(0, 4);
}
