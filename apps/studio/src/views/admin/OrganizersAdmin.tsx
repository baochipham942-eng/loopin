import { useEffect, useMemo, useState } from "react";
import { formatCNY } from "@loopin/core";
import { api } from "../../api.js";

/**
 * 平台端·主办方与白名单（P3）。
 * 列表：全部主办方（活动/成员计数）+ 白名单审核开关。
 * 钻取：单个主办方详情——资料 + 旗下活动（带报名数）+ 成员。HostProfile 编辑、新建主办方放后续。
 * 付费票/审核链路依赖 whitelisted。
 */

interface OrganizerRow {
  id: string;
  name: string;
  whitelisted: boolean;
  eventCount: number;
  memberCount: number;
  createdAt: string;
}

interface HostProfileLite {
  bio: string | null;
  avatarUrl: string | null;
  links: unknown;
}

interface DetailEvent {
  id: string;
  title: string;
  status: string;
  startAt: string;
  city: string;
  minPriceCents: number;
  registrationCount: number;
}

interface DetailMember {
  id: string;
  name: string;
  email: string | null;
  role: string;
  status: string;
}

interface OrganizerDetail {
  organizer: { id: string; name: string; whitelisted: boolean; createdAt: string };
  hostProfile: HostProfileLite | null;
  events: DetailEvent[];
  members: DetailMember[];
}

type Filter = "all" | "whitelisted" | "pending";

const TOKEN_STORAGE_KEY = "loopin.backofficeAdminToken"; // 与「后台数据」共用同一管理员令牌

const EVENT_STATUS: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  closed: "已截止",
  completed: "已结束",
  cancelled: "已取消",
};

const MEMBER_STATUS: Record<string, string> = {
  active: "已启用",
  invited: "待接受",
  disabled: "已停用",
};

export function OrganizersAdmin() {
  const [organizers, setOrganizers] = useState<OrganizerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [message, setMessage] = useState("");
  const [adminToken, setAdminToken] = useState(() => (typeof window === "undefined" ? "" : window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? ""));
  const [detailId, setDetailId] = useState("");
  const [detail, setDetail] = useState<OrganizerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWhitelisted, setNewWhitelisted] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ bio: "", avatarUrl: "", linksText: "" });
  const [savingProfile, setSavingProfile] = useState(false);

  function load() {
    setLoading(true);
    api.get("/admin/organizers")
      .then((result) => setOrganizers(result.organizers || []))
      .catch((err) => {
        setOrganizers([]);
        setMessage(authMessage(err, "主办方列表加载失败"));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    setEditingProfile(false);
    if (!detailId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    setDetail(null);
    api.get(`/admin/organizers/${detailId}`)
      .then((result) => { if (!cancelled) setDetail(result as OrganizerDetail); })
      .catch((err) => { if (!cancelled) { setMessage(authMessage(err, "主办方详情加载失败")); setDetailId(""); } })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [detailId]);

  function saveAdminToken() {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, adminToken.trim());
    setMessage(adminToken.trim() ? "管理员令牌已保存" : "管理员令牌已清空");
    load();
    if (detailId) refreshDetail();
  }

  function refreshDetail() {
    if (!detailId) return;
    setDetailLoading(true);
    api.get(`/admin/organizers/${detailId}`)
      .then((result) => setDetail(result as OrganizerDetail))
      .catch((err) => setMessage(authMessage(err, "主办方详情加载失败")))
      .finally(() => setDetailLoading(false));
  }

  async function toggleWhitelist(id: string, name: string, current: boolean) {
    const next = !current;
    setTogglingId(id);
    try {
      const result = await api.post(`/organizers/${id}/whitelist`, { whitelisted: next });
      const updated: boolean = result.organizer.whitelisted;
      setOrganizers((rows) => rows.map((row) => (row.id === id ? { ...row, whitelisted: updated } : row)));
      setDetail((d) => (d && d.organizer.id === id ? { ...d, organizer: { ...d.organizer, whitelisted: updated } } : d));
      setMessage(`「${name}」${updated ? "已加入白名单" : "已移出白名单"}`);
    } catch (err) {
      setMessage(authMessage(err, "白名单更新失败"));
    } finally {
      setTogglingId("");
    }
  }

  async function submitNewOrganizer() {
    const name = newName.trim();
    if (!name) { setMessage("主办方名称不能为空"); return; }
    setSavingNew(true);
    try {
      const result = await api.post("/admin/organizers", { name, whitelisted: newWhitelisted });
      setOrganizers((rows) => [result.organizer as OrganizerRow, ...rows]);
      setMessage(`已创建主办方「${result.organizer.name}」`);
      setCreating(false);
      setNewName("");
      setNewWhitelisted(false);
    } catch (err) {
      setMessage(authMessage(err, "创建主办方失败"));
    } finally {
      setSavingNew(false);
    }
  }

  function startEditProfile() {
    const profile = detail?.hostProfile;
    setProfileForm({
      bio: profile?.bio ?? "",
      avatarUrl: profile?.avatarUrl ?? "",
      linksText: linksToText(profile?.links),
    });
    setMessage("");
    setEditingProfile(true);
  }

  async function saveProfile() {
    if (!detail) return;
    setSavingProfile(true);
    try {
      const result = await api.put(`/organizers/${detail.organizer.id}/host-profile`, {
        bio: profileForm.bio.trim() || null,
        avatarUrl: profileForm.avatarUrl.trim() || null,
        links: textToLinks(profileForm.linksText),
      });
      setDetail((d) => (d ? { ...d, hostProfile: result.hostProfile } : d));
      setMessage("主办方资料已保存");
      setEditingProfile(false);
    } catch (err) {
      setMessage(authMessage(err, "主办方资料保存失败"));
    } finally {
      setSavingProfile(false);
    }
  }

  const stats = useMemo(() => {
    const whitelisted = organizers.filter((o) => o.whitelisted).length;
    return { total: organizers.length, whitelisted, pending: organizers.length - whitelisted };
  }, [organizers]);

  const visible = useMemo(() => organizers.filter((o) => (
    filter === "all" ? true : filter === "whitelisted" ? o.whitelisted : !o.whitelisted
  )), [organizers, filter]);

  // ===== 详情视图 =====
  if (detailId) {
    return (
      <div className="single">
        <section className="backoffice-shell">
          <div className="dash-head">
            <div>
              <button className="mini-btn ghost" onClick={() => { setMessage(""); setDetailId(""); }}>← 返回列表</button>
              <h2 style={{ marginTop: 10 }}>{detail?.organizer.name ?? "主办方详情"}</h2>
              {detail && (
                <p className="muted ops-intro">
                  入驻 {formatDate(detail.organizer.createdAt)} · {detail.events.length} 场活动 · {detail.members.length} 名成员
                </p>
              )}
            </div>
            {detail && (
              <button
                className={`mini-btn${detail.organizer.whitelisted ? " ghost" : ""}`}
                onClick={() => toggleWhitelist(detail.organizer.id, detail.organizer.name, detail.organizer.whitelisted)}
                disabled={togglingId === detail.organizer.id}
              >
                {togglingId === detail.organizer.id ? "处理中" : detail.organizer.whitelisted ? "撤销白名单" : "通过审核"}
              </button>
            )}
          </div>

          {message && <div className="ops-message">{message}</div>}

          {detailLoading || !detail ? (
            <div className="muted">加载主办方详情中…</div>
          ) : (
            <div className="organizer-detail">
              <section className="backoffice-panel">
                <div className="panel-head">
                  <div><h3>主办方资料</h3><p>HostProfile（简介、头像、链接），主办方对外展示。</p></div>
                  {editingProfile ? (
                    <span className="org-badge">编辑中</span>
                  ) : (
                    <button className="mini-btn ghost" onClick={startEditProfile}>{detail.hostProfile ? "编辑" : "完善资料"}</button>
                  )}
                </div>
                {editingProfile ? (
                  <div className="host-form">
                    <label>简介
                      <textarea value={profileForm.bio} onChange={(e) => setProfileForm((f) => ({ ...f, bio: e.target.value }))} rows={3} placeholder="一句话介绍这个主办方" />
                    </label>
                    <label>头像 URL
                      <input value={profileForm.avatarUrl} onChange={(e) => setProfileForm((f) => ({ ...f, avatarUrl: e.target.value }))} placeholder="https://…" />
                    </label>
                    <label>链接（每行一条，格式「标签|网址」）
                      <textarea value={profileForm.linksText} onChange={(e) => setProfileForm((f) => ({ ...f, linksText: e.target.value }))} rows={3} placeholder={"官网|https://example.com\n小红书|https://xiaohongshu.com/…"} />
                    </label>
                    <div className="host-form-actions">
                      <button className="mini-btn" onClick={saveProfile} disabled={savingProfile}>{savingProfile ? "保存中" : "保存"}</button>
                      <button className="mini-btn ghost" onClick={() => setEditingProfile(false)} disabled={savingProfile}>取消</button>
                    </div>
                  </div>
                ) : detail.hostProfile ? (
                  <div className="host-profile">
                    <p>{detail.hostProfile.bio || <span className="muted">未填写简介</span>}</p>
                    <ProfileLinks links={detail.hostProfile.links} />
                  </div>
                ) : (
                  <div className="muted">尚未创建主办方资料。</div>
                )}
              </section>

              <section className="backoffice-panel backoffice-wide">
                <div className="panel-head">
                  <div><h3>旗下活动</h3><p>含草稿与已结束，按创建时间倒序。</p></div>
                  <span>{detail.events.length} 场</span>
                </div>
                <div className="organizer-list">
                  {detail.events.length === 0 && <div className="muted">还没有创建活动。</div>}
                  {detail.events.map((event) => (
                    <article className="organizer-row" key={event.id}>
                      <div className="organizer-main">
                        <div className="organizer-name">
                          <b>{event.title}</b>
                          <span className="org-badge">{EVENT_STATUS[event.status] ?? event.status}</span>
                        </div>
                        <div className="organizer-meta">
                          <span>{formatDate(event.startAt)}</span>
                          <span>{event.city || "地点待定"}</span>
                          <span>{event.registrationCount} 人报名</span>
                          <span>{event.minPriceCents > 0 ? `最低 ${formatCNY(event.minPriceCents)}` : "免费"}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="backoffice-panel backoffice-wide">
                <div className="panel-head">
                  <div><h3>团队成员</h3><p>角色 / 权限状态。成员邀请与编辑在主办方端「我的团队」。</p></div>
                  <span>{detail.members.length} 人</span>
                </div>
                <div className="organizer-list">
                  {detail.members.length === 0 && <div className="muted">还没有成员。</div>}
                  {detail.members.map((member) => (
                    <article className="organizer-row" key={member.id}>
                      <div className="organizer-main">
                        <div className="organizer-name">
                          <b>{member.name}</b>
                          <span className="org-badge">{member.role}</span>
                          <span className={`org-badge${member.status === "active" ? " ok" : " pending"}`}>
                            {MEMBER_STATUS[member.status] ?? member.status}
                          </span>
                        </div>
                        <div className="organizer-meta">
                          <span>{member.email || "未填邮箱"}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          )}
        </section>
      </div>
    );
  }

  // ===== 列表视图 =====
  return (
    <div className="single">
      <section className="backoffice-shell">
        <div className="dash-head">
          <div>
            <h2>主办方与白名单</h2>
            <p className="muted ops-intro">平台准入审核：通过白名单的主办方才能开放付费票与正式报名。点主办方查看详情。</p>
          </div>
          <div className="actions">
            <button className="mini-btn" onClick={() => { setMessage(""); setCreating((v) => !v); }}>{creating ? "收起" : "新建主办方"}</button>
            <button className="mini-btn ghost" onClick={load} disabled={loading}>{loading ? "刷新中" : "刷新"}</button>
          </div>
        </div>

        {creating && (
          <div className="organizer-create">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="主办方名称"
              aria-label="主办方名称"
              onKeyDown={(e) => { if (e.key === "Enter") submitNewOrganizer(); }}
            />
            <label className="create-check">
              <input type="checkbox" checked={newWhitelisted} onChange={(e) => setNewWhitelisted(e.target.checked)} />
              直接加入白名单
            </label>
            <button className="mini-btn" onClick={submitNewOrganizer} disabled={savingNew}>{savingNew ? "创建中" : "创建"}</button>
          </div>
        )}

        <div className="backoffice-toolbar">
          <div className="backoffice-token">
            <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="管理员令牌" type="password" aria-label="管理员令牌" />
            <button className="mini-btn" onClick={saveAdminToken}>保存管理员</button>
          </div>
          <div className="reg-tabs">
            {([["all", "全部", stats.total], ["whitelisted", "已通过", stats.whitelisted], ["pending", "待审核", stats.pending]] as [Filter, string, number][]).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={`reg-tab ${filter === key ? "is-active" : ""}`}
                onClick={() => setFilter(key)}
              >
                {label}
                <span className="reg-tab-count">{count}</span>
              </button>
            ))}
          </div>
        </div>

        {message && <div className="ops-message">{message}</div>}

        {loading ? (
          <div className="muted">加载主办方列表中…</div>
        ) : visible.length === 0 ? (
          <div className="muted">{organizers.length === 0 ? "暂无主办方，或令牌无效。" : "当前筛选下没有主办方。"}</div>
        ) : (
          <div className="organizer-list">
            {visible.map((organizer) => (
              <article className="organizer-row organizer-row-link" key={organizer.id}>
                <button className="organizer-main organizer-open" type="button" onClick={() => { setMessage(""); setDetailId(organizer.id); }} aria-label={`查看 ${organizer.name} 详情`}>
                  <div className="organizer-name">
                    <b>{organizer.name}</b>
                    <span className={`org-badge${organizer.whitelisted ? " ok" : " pending"}`}>
                      {organizer.whitelisted ? "已通过" : "待审核"}
                    </span>
                  </div>
                  <div className="organizer-meta">
                    <span>{organizer.eventCount} 场活动</span>
                    <span>{organizer.memberCount} 名成员</span>
                    <span>入驻 {formatDate(organizer.createdAt)}</span>
                  </div>
                </button>
                <button
                  className={`mini-btn${organizer.whitelisted ? " ghost" : ""}`}
                  onClick={() => toggleWhitelist(organizer.id, organizer.name, organizer.whitelisted)}
                  disabled={togglingId === organizer.id}
                >
                  {togglingId === organizer.id ? "处理中" : organizer.whitelisted ? "撤销白名单" : "通过审核"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProfileLinks({ links }: { links: unknown }) {
  const items = normalizeLinks(links);
  if (items.length === 0) return null;
  return (
    <div className="host-links">
      {items.map((link, index) => (
        <a key={index} href={link.url} target="_blank" rel="noreferrer">{link.label || link.url}</a>
      ))}
    </div>
  );
}

function normalizeLinks(links: unknown): { label: string; url: string }[] {
  if (Array.isArray(links)) {
    return links
      .map((item) => (typeof item === "object" && item ? { label: String((item as Record<string, unknown>).label ?? ""), url: String((item as Record<string, unknown>).url ?? "") } : null))
      .filter((item): item is { label: string; url: string } => Boolean(item && item.url));
  }
  if (links && typeof links === "object") {
    return Object.entries(links as Record<string, unknown>).map(([label, url]) => ({ label, url: String(url) })).filter((item) => item.url);
  }
  return [];
}

// 链接编辑：每行一条「标签|url」（标签可省，省略时退化为纯 url）。
function linksToText(links: unknown): string {
  return normalizeLinks(links).map((link) => (link.label ? `${link.label}|${link.url}` : link.url)).join("\n");
}

function textToLinks(text: string): { label: string; url: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf("|");
      if (sep === -1) return { label: "", url: line };
      return { label: line.slice(0, sep).trim(), url: line.slice(sep + 1).trim() };
    })
    .filter((link) => link.url);
}

function authMessage(err: unknown, fallback: string) {
  const status = typeof err === "object" && err && "status" in err ? Number((err as { status?: number }).status) : 0;
  if (status === 401) return "管理员令牌缺失或无效，请先保存令牌";
  if (status === 403) return "当前令牌没有平台管理权限";
  return err instanceof Error ? err.message : fallback;
}

function formatDate(value?: string) {
  if (!value) return "时间待定";
  return new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}
