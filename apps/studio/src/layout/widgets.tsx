import { useSession, type Role } from "../session/SessionContext.js";
import { useCurrentEvent } from "../event/EventContext.js";

/** 顶栏角色切换器（P0 过渡期：手动切换模拟真实分流；接入登录后由会话决定）。 */
export function RoleSwitcher() {
  const { role, setRole, canBeAdmin } = useSession();
  return (
    <label className="shell-switch">
      <span className="shell-switch-label">身份</span>
      <select
        className="shell-select"
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        title={canBeAdmin ? "" : "未检测到管理员令牌，平台端功能将受限"}
      >
        <option value="organizer">主办方</option>
        <option value="platform_admin">平台管理员</option>
      </select>
    </label>
  );
}

/** 顶栏全局活动切换器（Studio 端）。 */
export function EventSwitcher() {
  const { events, currentEventId, setCurrentEvent, loading } = useCurrentEvent();
  if (loading && events.length === 0) {
    return <span className="shell-switch-muted">活动加载中…</span>;
  }
  if (events.length === 0) {
    return <span className="shell-switch-muted">暂无活动</span>;
  }
  return (
    <label className="shell-switch">
      <span className="shell-switch-label">当前活动</span>
      <select className="shell-select" value={currentEventId} onChange={(e) => setCurrentEvent(e.target.value)}>
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 账号占位（P0 不接真实登录）。 */
export function AccountChip() {
  return (
    <div className="shell-account" title="P0 未接入真实登录">
      <span className="shell-account-dot" />
      <span>未登录</span>
    </div>
  );
}
