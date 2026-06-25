import { useEffect, useMemo, useState } from "react";
import { api } from "../../api.js";

/**
 * 平台端·集成配置中心（P1 从主办方「运营台」拆出）。
 * 支付商户参数 readiness、活动提醒定时任务、微信真机联调诊断。主办方端不再出现这些。
 */

interface EventLite { id: string; title: string; startAt?: string }

interface NotificationConfig {
  enabled: boolean;
  configured?: { wechat?: boolean; eventReminder?: boolean };
  templates?: { eventReminder?: string };
}

interface ReminderRun { configured: boolean; checked: number; sent: number; skipped: number; failed: number }

interface PaymentReadiness {
  configured: boolean;
  canPrepare: boolean;
  canVerifyNotify: boolean;
  notifyUrl: string | null;
  missing: string[];
}

interface PaymentProviderInfo { identifier: string; mode: string; configured: boolean; readiness?: PaymentReadiness }
interface PaymentProvidersStatus { active: string; providers: PaymentProviderInfo[] }

interface DiagnosticUser {
  userId: string;
  mode: string;
  openidBound: boolean;
  phoneBound: boolean;
  maskedPhone: string | null;
  nickname: string | null;
  registrations?: { id: string; status: string }[];
}

interface DiagnosticSubscription {
  id: string;
  userId: string;
  eventId: string;
  type: string;
  status: string;
  reminderAt: string;
  sentAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

interface NotificationDiagnostics {
  event: { id: string; title: string; startAt: string };
  config: NotificationConfig;
  query: { userId: string | null };
  user: DiagnosticUser | null;
  subscription: DiagnosticSubscription | null;
  readiness: { canSend: boolean; missing: string[]; alreadySent: boolean };
  recentSubscriptions: Array<DiagnosticSubscription & { user: DiagnosticUser }>;
  recentRegistrations: Array<{ id: string; status: string; user: DiagnosticUser }>;
}

interface TestReminderResult {
  configured: boolean;
  userId: string | null;
  subscriptionId: string | null;
  readiness: NotificationDiagnostics["readiness"];
  sent: number;
  skipped: number;
  failed: number;
  page: string | null;
  error: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  submitted: "待确认", approved: "已通过", checked_in: "已签到",
  rejected: "已拒绝", waitlisted: "候补", cancelled: "已取消",
};

const TOKEN_STORAGE_KEY = "loopin.backofficeAdminToken";
const MEMBER_TOKEN_STORAGE_KEY = "loopin.backofficeMemberToken";

export function IntegrationsAdmin() {
  const [events, setEvents] = useState<EventLite[]>([]);
  const [notificationConfig, setNotificationConfig] = useState<NotificationConfig | null>(null);
  const [notificationLoading, setNotificationLoading] = useState(true);
  const [reminderRun, setReminderRun] = useState<ReminderRun | null>(null);
  const [paymentProviders, setPaymentProviders] = useState<PaymentProvidersStatus | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(true);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [message, setMessage] = useState("");
  const [diagnosticEventId, setDiagnosticEventId] = useState("");
  const [diagnosticUserId, setDiagnosticUserId] = useState("");
  const [diagnostics, setDiagnostics] = useState<NotificationDiagnostics | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [sendingTestReminder, setSendingTestReminder] = useState(false);
  const [testReminder, setTestReminder] = useState<TestReminderResult | null>(null);

  function loadEvents() {
    api.get("/events").then((r) => setEvents(r.events || [])).catch(() => setEvents([]));
  }

  function loadNotificationConfig() {
    setNotificationLoading(true);
    api.get("/notifications/config")
      .then((config) => setNotificationConfig(config))
      .catch(() => setNotificationConfig({ enabled: false, configured: { wechat: false, eventReminder: false }, templates: {} }))
      .finally(() => setNotificationLoading(false));
  }

  function loadPaymentProviders() {
    setPaymentLoading(true);
    api.get("/payments/providers")
      .then((status) => setPaymentProviders(status))
      .catch(() => setPaymentProviders({ active: "unknown", providers: [] }))
      .finally(() => setPaymentLoading(false));
  }

  useEffect(() => {
    loadEvents();
    loadNotificationConfig();
    loadPaymentProviders();
  }, []);

  async function triggerEventReminders() {
    setSendingReminders(true);
    try {
      const result = await api.post("/admin/send-event-reminders", {}, { headers: backofficeHeaders() });
      setReminderRun(result);
      setMessage(result.configured
        ? `提醒任务已执行：检查 ${result.checked} 条，发送 ${result.sent} 条`
        : "提醒任务已空跑：微信 AppSecret 或订阅模板 ID 缺失");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "提醒任务触发失败");
    } finally {
      setSendingReminders(false);
    }
  }

  async function loadNotificationDiagnostics(options: { quiet?: boolean; userId?: string; eventId?: string } = {}) {
    const eventId = options.eventId || diagnosticEventId || events[0]?.id;
    if (!eventId) {
      setMessage("暂无活动可诊断");
      return;
    }
    setDiagnosticLoading(true);
    try {
      const selectedUserId = options.userId ?? diagnosticUserId.trim();
      const query = selectedUserId ? `?userId=${encodeURIComponent(selectedUserId)}` : "";
      const result = await api.get(`/events/${eventId}/notification-diagnostics${query}`, { headers: backofficeHeaders() });
      setDiagnostics(result);
      if (!options.quiet) setTestReminder(null);
      if (!options.quiet) setMessage("微信联调诊断已更新");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "微信联调诊断读取失败");
    } finally {
      setDiagnosticLoading(false);
    }
  }

  function selectDiagnosticUser(userId: string) {
    setDiagnosticUserId(userId);
    setTestReminder(null);
    void loadNotificationDiagnostics({ userId, eventId: diagnostics?.event.id || diagnosticEventId || events[0]?.id });
  }

  async function sendTestReminder() {
    const eventId = diagnostics?.event.id || diagnosticEventId || events[0]?.id;
    const userId = diagnostics?.query.userId || diagnosticUserId.trim();
    if (!eventId || !userId) {
      setMessage("先读取某个 userId 的微信诊断");
      return;
    }
    setSendingTestReminder(true);
    try {
      const result = await api.post(`/events/${eventId}/notifications/test-reminder`, { userId }, { headers: backofficeHeaders() });
      setTestReminder(result);
      if (result.sent) setMessage("测试提醒已发送");
      else if (result.failed) setMessage(result.error || "测试提醒发送失败");
      else setMessage(`测试提醒未发送：${readinessLabel(result.readiness)}`);
      await loadNotificationDiagnostics({ quiet: true });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "测试提醒发送失败");
    } finally {
      setSendingTestReminder(false);
    }
  }

  const notificationState = getNotificationState(notificationConfig, notificationLoading);
  const paymentState = getPaymentState(paymentProviders, paymentLoading);
  const wechatPay = paymentProviders?.providers.find((provider) => provider.identifier === "wechatpay") || null;
  const tokenReady = useMemo(() => hasBackofficeToken(), []);

  return (
    <div className="single">
      <section className="ops-shell">
        <div className="dash-head">
          <div>
            <h2>集成配置中心</h2>
            <p className="muted ops-intro">支付商户参数、活动提醒定时任务、微信真机联调，集中在平台端维护。</p>
          </div>
          <button
            className="mini-btn"
            onClick={() => { loadEvents(); loadNotificationConfig(); loadPaymentProviders(); }}
            disabled={notificationLoading || paymentLoading}
          >
            {notificationLoading || paymentLoading ? "刷新中" : "刷新"}
          </button>
        </div>

        {!tokenReady && (
          <div className="verdict warn" style={{ marginBottom: 12 }}>未配置管理员令牌，提醒触发和真机诊断会被后端拒绝。先在「后台 IA」保存令牌。</div>
        )}

        <div className="ops-payment">
          <div className="ops-card-head">
            <div>
              <h3>支付配置</h3>
              <div className="ops-meta">mock 和微信支付商户参数 readiness。</div>
            </div>
            <span className={`ops-state ${paymentState.className}`}>{paymentState.label}</span>
          </div>
          <div className="ops-mini-metrics">
            <SmallMetric label="当前 Provider" value={paymentProviders?.active || "读取中"} />
            <SmallMetric label="微信支付" value={wechatPay ? configuredLabel(wechatPay.configured) : "未读取"} />
            <SmallMetric label="JSAPI 下单" value={configuredLabel(wechatPay?.readiness?.canPrepare)} />
            <SmallMetric label="回调验签" value={configuredLabel(wechatPay?.readiness?.canVerifyNotify)} />
          </div>
          <PaymentReadinessLine wechatPay={wechatPay} loading={paymentLoading} />
        </div>

        <div className="ops-notification">
          <div className="ops-card-head">
            <div>
              <h3>活动提醒</h3>
              <div className="ops-meta">订阅消息授权、FC 定时任务和手动补发状态。</div>
            </div>
            <span className={`ops-state ${notificationState.className}`}>{notificationState.label}</span>
          </div>
          <div className="ops-mini-metrics">
            <SmallMetric label="微信凭证" value={configuredLabel(notificationConfig?.configured?.wechat)} />
            <SmallMetric label="模板 ID" value={configuredLabel(notificationConfig?.configured?.eventReminder ?? Boolean(notificationConfig?.templates?.eventReminder))} />
            <SmallMetric label="最近检查" value={reminderRun ? reminderRun.checked : "—"} />
            <SmallMetric label="已发送" value={reminderRun ? reminderRun.sent : "—"} />
          </div>
          {reminderRun && (
            <div className="ops-status-line reminder-run">
              <span>跳过 {reminderRun.skipped}</span>
              <span>失败 {reminderRun.failed}</span>
              <span>{reminderRun.configured ? "发送配置可用" : "发送配置缺失"}</span>
            </div>
          )}
          <div className="ops-actions">
            <button className="mini-btn" onClick={triggerEventReminders} disabled={sendingReminders}>
              {sendingReminders ? "触发中" : "手动触发提醒"}
            </button>
          </div>
        </div>

        <div className="ops-diagnostics">
          <div className="ops-card-head">
            <div>
              <h3>微信联调诊断</h3>
              <div className="ops-meta">真机扫码后核对 openid 绑定、订阅授权和提醒发送条件。</div>
            </div>
            <span className={`ops-state ${diagnostics?.readiness.canSend ? "good" : diagnostics ? "warn" : ""}`}>
              {diagnostics ? readinessLabel(diagnostics.readiness) : "未读取"}
            </span>
          </div>
          <div className="ops-diagnostic-form">
            <select value={diagnosticEventId || events[0]?.id || ""} onChange={(event) => setDiagnosticEventId(event.target.value)}>
              {events.map((item) => (
                <option value={item.id} key={item.id}>{item.title}</option>
              ))}
            </select>
            <input value={diagnosticUserId} placeholder="userId，可留空看最近记录" onChange={(event) => setDiagnosticUserId(event.target.value)} />
            <button className="mini-btn" onClick={() => loadNotificationDiagnostics()} disabled={diagnosticLoading || events.length === 0}>
              {diagnosticLoading ? "读取中" : "读取诊断"}
            </button>
          </div>
          {diagnostics && (
            <NotificationDiagnosticsPanel
              diagnostics={diagnostics}
              testReminder={testReminder}
              sendingTestReminder={sendingTestReminder}
              onSendTest={sendTestReminder}
              onSelectUser={selectDiagnosticUser}
            />
          )}
        </div>

        {message && <div className="ops-message">{message}</div>}
      </section>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ops-small">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function PaymentReadinessLine({ wechatPay, loading }: { wechatPay: PaymentProviderInfo | null; loading: boolean }) {
  if (loading) return <div className="ops-status-line payment-run"><span>读取支付配置中</span></div>;
  const readiness = wechatPay?.readiness;
  if (!wechatPay || !readiness) return <div className="ops-status-line payment-run"><span>支付状态未返回</span></div>;
  if (readiness.configured) {
    return (
      <div className="ops-status-line payment-run">
        <span>微信支付参数完整</span>
        {readiness.notifyUrl && <span>{readiness.notifyUrl}</span>}
      </div>
    );
  }
  return (
    <div className="ops-status-line payment-run">
      {readiness.missing.map((item) => <span key={item}>{item}</span>)}
      {readiness.notifyUrl && <span>notify {readiness.notifyUrl}</span>}
    </div>
  );
}

function NotificationDiagnosticsPanel({
  diagnostics,
  testReminder,
  sendingTestReminder,
  onSendTest,
  onSelectUser,
}: {
  diagnostics: NotificationDiagnostics;
  testReminder: TestReminderResult | null;
  sendingTestReminder: boolean;
  onSendTest: () => void;
  onSelectUser: (userId: string) => void;
}) {
  const user = diagnostics.user;
  const subscription = diagnostics.subscription;
  const canSendTest = Boolean(user && diagnostics.query.userId && diagnostics.readiness.canSend);
  return (
    <div className="ops-diagnostic-result">
      <div className="ops-mini-metrics">
        <SmallMetric label="微信身份" value={user ? boundLabel(user.openidBound) : "未定位"} />
        <SmallMetric label="手机号" value={user ? boundLabel(user.phoneBound) : "未定位"} />
        <SmallMetric label="订阅授权" value={subscription ? subscriptionStatus(subscription.status) : "未记录"} />
        <SmallMetric label="发送条件" value={readinessLabel(diagnostics.readiness)} />
      </div>

      {subscription && (
        <div className="ops-status-line reminder-run">
          <span>提醒 {formatDate(subscription.reminderAt)}</span>
          <span>{subscription.sentAt ? `已发 ${formatDate(subscription.sentAt)}` : "未发送"}</span>
          {subscription.lastError && <span>错误 {subscription.lastError}</span>}
        </div>
      )}

      {user && (
        <div className="ops-test-reminder">
          <button className="mini-btn" onClick={onSendTest} disabled={!canSendTest || sendingTestReminder}>
            {sendingTestReminder ? "发送中" : "发送测试提醒"}
          </button>
          {testReminder && (
            <div className="ops-status-line reminder-run">
              <span>{testReminder.sent ? "已发送" : testReminder.failed ? "发送失败" : "已跳过"}</span>
              <span>{testReminder.page || readinessLabel(testReminder.readiness)}</span>
              {testReminder.error && <span>{testReminder.error}</span>}
            </div>
          )}
        </div>
      )}

      <div className="ops-diagnostic-columns">
        <div>
          <div className="ops-agent-title">最近订阅</div>
          {diagnostics.recentSubscriptions.length === 0 ? (
            <div className="ops-diagnostic-empty">暂无订阅记录</div>
          ) : diagnostics.recentSubscriptions.map((row) => (
            <div className="ops-diagnostic-row" key={row.id}>
              <b>{row.user.userId}</b>
              <span>{subscriptionStatus(row.status)} · {boundLabel(row.user.openidBound)} · {row.sentAt ? "已发送" : "未发送"}</span>
              <button className="ghost-btn compact-btn" onClick={() => onSelectUser(row.user.userId)}>诊断</button>
            </div>
          ))}
        </div>
        <div>
          <div className="ops-agent-title">最近报名</div>
          {diagnostics.recentRegistrations.length === 0 ? (
            <div className="ops-diagnostic-empty">暂无报名记录</div>
          ) : diagnostics.recentRegistrations.map((row) => (
            <div className="ops-diagnostic-row" key={row.id}>
              <b>{row.user.userId}</b>
              <span>{STATUS_LABEL[row.status] ?? row.status} · {boundLabel(row.user.openidBound)} · {row.user.maskedPhone || "未绑定手机号"}</span>
              <button className="ghost-btn compact-btn" onClick={() => onSelectUser(row.user.userId)}>诊断</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function backofficeHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const headers: Record<string, string> = {};
  const admin = window.localStorage.getItem(TOKEN_STORAGE_KEY)?.trim();
  const member = window.localStorage.getItem(MEMBER_TOKEN_STORAGE_KEY)?.trim();
  if (admin) headers["x-loopin-admin-token"] = admin;
  if (member) headers["x-loopin-member-token"] = member;
  return headers;
}

function hasBackofficeToken() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.localStorage.getItem(TOKEN_STORAGE_KEY)?.trim() ||
    window.localStorage.getItem(MEMBER_TOKEN_STORAGE_KEY)?.trim(),
  );
}

function getNotificationState(config: NotificationConfig | null, loading: boolean) {
  if (loading) return { label: "读取中", className: "" };
  if (config?.enabled) return { label: "已启用", className: "good" };
  return { label: "待配置", className: "warn" };
}

function getPaymentState(status: PaymentProvidersStatus | null, loading: boolean) {
  if (loading) return { label: "读取中", className: "" };
  const wechatPay = status?.providers.find((provider) => provider.identifier === "wechatpay");
  if (wechatPay?.configured) return { label: "微信可用", className: "good" };
  if (status?.active === "mock") return { label: "mock 中", className: "warn" };
  return { label: "待确认", className: "warn" };
}

function configuredLabel(value: boolean | undefined) {
  if (value === undefined) return "读取中";
  return value ? "已配置" : "缺失";
}

function boundLabel(value: boolean) {
  return value ? "已绑定" : "未绑定";
}

function subscriptionStatus(status: string) {
  if (status === "accepted") return "已授权";
  if (status === "declined") return "已拒绝";
  if (status === "cancelled") return "已取消";
  return status;
}

function readinessLabel(readiness: NotificationDiagnostics["readiness"]) {
  if (readiness.alreadySent) return "已发送";
  if (readiness.canSend) return "可发送";
  return readiness.missing.length ? readiness.missing.join(" / ") : "待发送";
}

function formatDate(iso?: string) {
  if (!iso) return "时间待定";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "时间待定";
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
