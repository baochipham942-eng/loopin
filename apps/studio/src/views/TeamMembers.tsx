import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

/**
 * 主办方·我的团队（P1 从「后台 IA」拆出）。
 * 团队成员/权限/邀请，以及活动页公开人物（同频社交）。配额/导出/管理员令牌已迁到平台端「后台数据」。
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

interface TeamMember {
  id: string;
  organizerId: string;
  name: string;
  email: string | null;
  role: string;
  permissions: string[];
  status: string;
  inviteExpiresAt?: string | null;
  acceptedAt?: string | null;
  lastLoginAt?: string | null;
  hasAccessToken?: boolean;
  createdAt: string;
}

interface SocialProfile {
  id: string;
  kind: string;
  name: string;
  headline: string;
  bio: string;
  tags: string[];
  visibility: string;
}

interface TeamForm {
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

interface SocialForm {
  name: string;
  kind: string;
  headline: string;
  bio: string;
  tags: string;
}

const PERMISSION_OPTIONS = [
  { key: "events:read", label: "活动查看" },
  { key: "events:write", label: "活动/配额管理" },
  { key: "registrations:write", label: "报名审核" },
  { key: "checkin:write", label: "签到核销" },
  { key: "exports:read", label: "数据导出" },
  { key: "team:write", label: "团队管理" },
];

const EMPTY_TEAM_FORM: TeamForm = { name: "", email: "", role: "operator", permissions: defaultPermissions("operator") };
const EMPTY_SOCIAL_FORM: SocialForm = { name: "", kind: "guest", headline: "", bio: "", tags: "" };
const MEMBER_TOKEN_STORAGE_KEY = "loopin.backofficeMemberToken";
const TOKEN_STORAGE_KEY = "loopin.backofficeAdminToken";

const ROLE_LABEL: Record<string, string> = {
  owner: "所有者", admin: "管理员", operator: "运营", checkin: "签到", viewer: "只读", staff: "工作人员",
};
const STATUS_LABEL: Record<string, string> = { active: "启用", invited: "已邀请", disabled: "停用" };
const SOCIAL_KIND_LABEL: Record<string, string> = { host: "主理人", speaker: "讲师", guest: "嘉宾", attendee: "参与者" };

export function TeamMembers() {
  const [events, setEvents] = useState<EventLite[]>([]);
  const [selected, setSelected] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [socialProfiles, setSocialProfiles] = useState<SocialProfile[]>([]);
  const [teamForm, setTeamForm] = useState<TeamForm>(EMPTY_TEAM_FORM);
  const [socialForm, setSocialForm] = useState<SocialForm>(EMPTY_SOCIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [savingMember, setSavingMember] = useState("");
  const [savingSocial, setSavingSocial] = useState(false);
  const [message, setMessage] = useState("");
  const [memberToken, setMemberToken] = useState(() => (typeof window === "undefined" ? "" : window.localStorage.getItem(MEMBER_TOKEN_STORAGE_KEY) ?? ""));
  const [inviteLink, setInviteLink] = useState("");
  const [preferredOrganizerId, setPreferredOrganizerId] = useState("");

  const selectedEvent = useMemo(() => events.find((event) => event.id === selected) ?? null, [events, selected]);

  function loadEvents(preferredOrganizer = preferredOrganizerId) {
    setLoading(true);
    api.get("/events")
      .then((result) => {
        const rows: EventLite[] = result.events || [];
        const preferred = preferredOrganizer ? rows.find((event) => event.organizerId === preferredOrganizer) : null;
        setEvents(rows);
        setSelected((current) => preferred?.id || current || rows[0]?.id || "");
      })
      .catch(() => { setEvents([]); setSelected(""); })
      .finally(() => setLoading(false));
  }

  function loadData(event: EventLite | null) {
    if (!event) {
      setMembers([]);
      setSocialProfiles([]);
      return;
    }
    setLoading(true);
    const headers = authHeaders();
    Promise.all([
      api.get(`/events/${event.id}/social-profiles`, { headers }).catch((err) => backofficeFallback(err, { profiles: [] })),
      event.organizerId
        ? api.get(`/organizers/${event.organizerId}/team-members`, { headers }).catch((err) => backofficeFallback(err, { members: [] }))
        : Promise.resolve({ members: [] }),
    ])
      .then(([socialResult, memberResult]) => {
        setSocialProfiles(socialResult.profiles || []);
        setMembers(memberResult.members || []);
      })
      .catch(() => { setSocialProfiles([]); setMembers([]); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadEvents(); }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = new URLSearchParams(window.location.search).get("invite");
    if (token) acceptInvitation(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadData(selectedEvent); }, [selectedEvent?.id]);

  function authHeaders(): HeadersInit {
    const headers: Record<string, string> = {};
    const admin = typeof window === "undefined" ? "" : window.localStorage.getItem(TOKEN_STORAGE_KEY)?.trim();
    const member = memberToken.trim();
    if (admin) headers["x-loopin-admin-token"] = admin;
    if (member) headers["x-loopin-member-token"] = member;
    return headers;
  }

  function saveMemberToken() {
    window.localStorage.setItem(MEMBER_TOKEN_STORAGE_KEY, memberToken.trim());
    setMessage(memberToken.trim() ? "成员令牌已保存" : "成员令牌已清空");
    loadData(selectedEvent);
  }

  function backofficeFallback<T>(err: unknown, fallback: T) {
    const status = typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : 0;
    if (status === 401) setMessage("成员令牌缺失或无效");
    else if (status === 403) setMessage("当前成员没有权限访问团队模块");
    else setMessage(err instanceof Error ? err.message : "团队数据加载失败");
    return fallback;
  }

  async function createMember() {
    if (!selectedEvent?.organizerId) { setMessage("当前活动缺少主办方信息"); return; }
    if (!teamForm.name.trim()) { setMessage("先填写成员姓名"); return; }
    setSavingMember("new");
    try {
      const body = { name: teamForm.name, email: teamForm.email, role: teamForm.role, permissions: teamForm.permissions };
      const result = await api.post(`/organizers/${selectedEvent.organizerId}/team-members`, body, { headers: authHeaders() });
      setMessage(`成员「${result.member.name}」已保存`);
      setTeamForm(EMPTY_TEAM_FORM);
      loadData(selectedEvent);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "成员保存失败");
    } finally {
      setSavingMember("");
    }
  }

  async function createInvitation() {
    if (!selectedEvent?.organizerId) { setMessage("当前活动缺少主办方信息"); return; }
    if (!teamForm.name.trim() || !teamForm.email.trim()) { setMessage("生成邀请需要姓名和邮箱"); return; }
    setSavingMember("invite");
    try {
      const body = { name: teamForm.name, email: teamForm.email, role: teamForm.role, permissions: teamForm.permissions };
      const result = await api.post(`/organizers/${selectedEvent.organizerId}/team-invitations`, body, { headers: authHeaders() });
      setInviteLink(absoluteInviteUrl(result.invitation.url));
      setMessage(`已为「${result.member.name}」生成邀请链接`);
      loadData(selectedEvent);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "邀请生成失败");
    } finally {
      setSavingMember("");
    }
  }

  async function createSocialProfile() {
    if (!selectedEvent) { setMessage("先选择活动"); return; }
    if (!socialForm.name.trim() || !socialForm.headline.trim()) { setMessage("人物姓名和介绍不能为空"); return; }
    setSavingSocial(true);
    try {
      const result = await api.post(`/events/${selectedEvent.id}/social-profiles`, {
        ...socialForm,
        tags: socialForm.tags.split(/[、,，/;\n]/).map((item) => item.trim()).filter(Boolean),
      }, { headers: authHeaders() });
      setMessage(`同频人物「${result.profile.name}」已添加`);
      setSocialForm(EMPTY_SOCIAL_FORM);
      loadData(selectedEvent);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "人物保存失败");
    } finally {
      setSavingSocial(false);
    }
  }

  async function acceptInvitation(token: string) {
    setSavingMember("accept-invite");
    try {
      const result = await api.post("/team-invitations/accept", { token });
      window.localStorage.setItem(MEMBER_TOKEN_STORAGE_KEY, result.memberToken);
      setMemberToken(result.memberToken);
      setPreferredOrganizerId(result.member.organizerId);
      setMessage(`已接受「${result.member.name}」的后台邀请`);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        window.history.replaceState(null, "", url.toString());
      }
      loadEvents(result.member.organizerId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "邀请接受失败");
    } finally {
      setSavingMember("");
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    await navigator.clipboard?.writeText(inviteLink);
    setMessage("邀请链接已复制");
  }

  async function updateMemberStatus(member: TeamMember, status: string) {
    setSavingMember(member.id);
    try {
      const result = await api.post(`/team-members/${member.id}/update`, { status }, { headers: authHeaders() });
      setMessage(`成员「${result.member.name}」已${status === "disabled" ? "停用" : "启用"}`);
      loadData(selectedEvent);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "成员状态更新失败");
    } finally {
      setSavingMember("");
    }
  }

  async function updateMemberPermissions(member: TeamMember, permissions: string[]) {
    setSavingMember(`${member.id}:permissions`);
    try {
      const result = await api.post(`/team-members/${member.id}/update`, { permissions }, { headers: authHeaders() });
      setMessage(`成员「${result.member.name}」权限已更新`);
      loadData(selectedEvent);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "成员权限更新失败");
    } finally {
      setSavingMember("");
    }
  }

  return (
    <div className="single">
      <section className="backoffice-shell">
        <div className="dash-head">
          <div>
            <h2>我的团队</h2>
            <p className="muted ops-intro">团队成员与权限、活动页公开人物。配额/导出在平台端「后台数据」。</p>
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
          <div className="muted">加载团队数据中…</div>
        ) : !selectedEvent ? (
          <div className="muted">暂无已发布活动。</div>
        ) : (
          <div className="backoffice-grid">
            <section className="backoffice-panel">
              <div className="panel-head">
                <div>
                  <h3>同频人物</h3>
                  <p>维护活动页公开展示的人物和嘉宾名单。</p>
                </div>
                <span>{socialProfiles.length} 人</span>
              </div>
              <div className="social-list">
                {socialProfiles.length === 0 && <div className="muted">暂无公开人物。</div>}
                {socialProfiles.map((profile) => (
                  <article className="social-row" key={profile.id}>
                    <b>{profile.name}</b>
                    <p>{profile.headline}</p>
                    <div className="team-tags">
                      <span>{SOCIAL_KIND_LABEL[profile.kind] ?? profile.kind}</span>
                      {profile.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  </article>
                ))}
              </div>
              <div className="social-form">
                <input value={socialForm.name} placeholder="姓名" onChange={(event) => setSocialForm({ ...socialForm, name: event.target.value })} />
                <select value={socialForm.kind} onChange={(event) => setSocialForm({ ...socialForm, kind: event.target.value })}>
                  <option value="host">主理人</option>
                  <option value="speaker">讲师</option>
                  <option value="guest">嘉宾</option>
                  <option value="attendee">参与者</option>
                </select>
                <input value={socialForm.headline} placeholder="一句话介绍" onChange={(event) => setSocialForm({ ...socialForm, headline: event.target.value })} />
                <input value={socialForm.tags} placeholder="标签，用逗号分隔" onChange={(event) => setSocialForm({ ...socialForm, tags: event.target.value })} />
                <textarea value={socialForm.bio} placeholder="简介" onChange={(event) => setSocialForm({ ...socialForm, bio: event.target.value })} />
                <button className="mini-btn" onClick={createSocialProfile} disabled={savingSocial}>
                  {savingSocial ? "保存中" : "添加人物"}
                </button>
              </div>
            </section>

            <section className="backoffice-panel">
              <div className="panel-head">
                <div>
                  <h3>团队成员</h3>
                  <p>成员、角色与权限；可生成邀请链接让协作者加入。</p>
                </div>
                <span>{members.length} 人</span>
              </div>
              <div className="team-list">
                {members.length === 0 && <div className="muted">暂无团队成员。</div>}
                {members.map((member) => (
                  <article className={`team-row ${member.status === "disabled" ? "disabled" : ""}`} key={member.id}>
                    <div>
                      <b>{member.name}</b>
                      <p>{member.email || "未填写邮箱"}</p>
                      <div className="team-tags">
                        <span>{ROLE_LABEL[member.role] ?? member.role}</span>
                        <span>{STATUS_LABEL[member.status] ?? member.status}</span>
                        {member.hasAccessToken && <span>令牌已开通</span>}
                        {member.inviteExpiresAt && <span>邀请至 {formatDate(member.inviteExpiresAt)}</span>}
                      </div>
                      <PermissionPicker
                        selected={member.permissions}
                        disabled={savingMember === `${member.id}:permissions`}
                        onToggle={(permission) => updateMemberPermissions(member, togglePermission(member.permissions, permission))}
                      />
                    </div>
                    <button
                      className={member.status === "disabled" ? "mini-btn" : "ghost-btn"}
                      onClick={() => updateMemberStatus(member, member.status === "disabled" ? "active" : "disabled")}
                      disabled={savingMember === member.id}
                    >
                      {member.status === "disabled" ? "启用" : "停用"}
                    </button>
                  </article>
                ))}
              </div>
              <div className="team-form">
                <input value={teamForm.name} placeholder="姓名" onChange={(event) => setTeamForm({ ...teamForm, name: event.target.value })} />
                <input value={teamForm.email} placeholder="邮箱" onChange={(event) => setTeamForm({ ...teamForm, email: event.target.value })} />
                <select value={teamForm.role} onChange={(event) => {
                  const role = event.target.value;
                  setTeamForm({ ...teamForm, role, permissions: defaultPermissions(role) });
                }}>
                  <option value="admin">管理员</option>
                  <option value="operator">运营</option>
                  <option value="checkin">签到</option>
                  <option value="viewer">只读</option>
                </select>
                <PermissionPicker
                  selected={teamForm.permissions}
                  onToggle={(permission) => setTeamForm({ ...teamForm, permissions: togglePermission(teamForm.permissions, permission) })}
                />
                <button className="mini-btn" onClick={createMember} disabled={savingMember === "new"}>
                  {savingMember === "new" ? "保存中" : "添加成员"}
                </button>
                <button className="ghost-btn" onClick={createInvitation} disabled={savingMember === "invite"}>
                  {savingMember === "invite" ? "生成中" : "生成邀请"}
                </button>
                {inviteLink && (
                  <div className="invite-link">
                    <button className="mini-btn" type="button" onClick={copyInviteLink}>复制邀请链接</button>
                    <span>{inviteLink}</span>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

function PermissionPicker({ selected, disabled, onToggle }: { selected: string[]; disabled?: boolean; onToggle: (permission: string) => void }) {
  return (
    <div className="permission-grid">
      {PERMISSION_OPTIONS.map((permission) => (
        <label key={permission.key} className={selected.includes(permission.key) ? "checked" : ""}>
          <input type="checkbox" checked={selected.includes(permission.key)} disabled={disabled} onChange={() => onToggle(permission.key)} />
          <span>{permission.label}</span>
        </label>
      ))}
    </div>
  );
}

function defaultPermissions(role: string) {
  if (role === "admin") return ["events:write", "registrations:write", "checkin:write", "exports:read", "team:write"];
  if (role === "operator" || role === "staff") return ["events:read", "registrations:write", "checkin:write", "exports:read"];
  if (role === "checkin") return ["events:read", "checkin:write"];
  return ["events:read"];
}

function togglePermission(current: string[], permission: string) {
  return current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission];
}

function absoluteInviteUrl(value: string) {
  if (!value || /^https?:\/\//i.test(value)) return value;
  if (typeof window === "undefined") return value;
  const path = value.startsWith("?") ? `${window.location.pathname}${value}` : value;
  return `${window.location.origin}${path}`;
}

function formatDate(value?: string) {
  if (!value) return "时间待定";
  return new Date(value).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}
