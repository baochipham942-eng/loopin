import { useEffect, useState } from "react";
import { api } from "../../api.js";

/**
 * 平台端·选题信号源管理（P1 从主办方「选题雷达」拆出）。
 * 运营录入实时信号、维护外部来源优先级、预检外部 feed。主办方端不再出现这些。
 */

interface SignalForm {
  source: string;
  label: string;
  topic: string;
  city: string;
  industries: string;
  audiences: string;
  formats: string;
  heat: string;
  evidence: string;
  opportunity: string;
}

interface FeedPreviewSignal {
  id: string;
  source: string;
  label: string;
  topic: string;
  city?: string;
  heat?: number;
}

interface FeedPreviewResult {
  configured: boolean;
  feeds: number;
  ok: number;
  failed: number;
  previews: {
    url: string;
    source: string;
    label: string;
    ok: boolean;
    count: number;
    sample: FeedPreviewSignal[];
    error?: string;
  }[];
}

interface FeedStatusResult {
  configured: boolean;
  feeds: number;
  valid: number;
  invalid: number;
  authRequired: number;
  authReady: number;
  missingAuthEnv: string[];
  errors: string[];
  recommendations: string[];
  feedStatuses: {
    url: string;
    host: string;
    source: string;
    label: string;
    method: string;
    valid: boolean;
    error?: string;
    auth: { required: boolean; ready: boolean; env?: string; envPresent?: boolean; inlineToken: boolean };
    headers: { total: number; envRefs: string[]; missingEnvRefs: string[] };
    itemsPath?: string;
    fieldMap: string[];
  }[];
}

const DEFAULT_SIGNAL_FORM: SignalForm = {
  source: "studio_live_feed",
  label: "运营录入",
  topic: "AI Agent 工作流实战局",
  city: "上海",
  industries: "AI、产品",
  audiences: "产品经理、创业者",
  formats: "工作坊",
  heat: "90",
  evidence: "",
  opportunity: "",
};

const SOURCE_PLAYBOOK = [
  { tier: "P0", name: "自有反馈", sources: "报名画像 / 候补 / 兴趣订阅 / 会后反馈", action: "优先录入，直接代表 Loopin 人群需求" },
  { tier: "P1", name: "活动平台", sources: "活动行 / 活动家 / Luma / Eventbrite / Meetup", action: "拿 API 或导出样本后走 feed 预检" },
  { tier: "P1", name: "合作方活动库", sources: "孵化器 / 联合办公 / 社群 / VC 活动日历", action: "用合作方令牌接 descriptor，按 source 幂等同步" },
  { tier: "P2", name: "内容趋势", sources: "小红书 / 公众号 / 即刻 / 知乎 / 掘金 / B 站", action: "只筛高质量样本，先运营录入再考虑自动化" },
];

const EVENT_PLATFORM_FEED_RAW = JSON.stringify({
  feeds: [{
    url: "https://partner.example.com/huodongxing/events",
    source: "huodongxing_partner_api",
    label: "活动行活动 API",
    auth: { type: "apiKey", env: "HUODONGXING_TOPIC_API_KEY" },
    headers: { "X-Partner": "env:HUODONGXING_TOPIC_PARTNER_ID" },
    itemsPath: "data.events",
    fieldMap: {
      externalId: ["uid", "id", "eventId"],
      topic: ["name", "title"],
      city: ["location.city", "cityName", "city"],
      industries: ["category", "categoryName", "tags"],
      audiences: ["targetAudience", "audience"],
      formats: ["eventType", "typeName", "format"],
      heat: ["stats.popularity", "stats.registrations", "registrations", "views"],
      evidence: ["intro", "summary", "description"],
      opportunity: ["insight", "recommendation"],
      capturedAt: ["updatedAt", "startAt"],
    },
  }],
}, null, 2);

const PARTNER_FEED_RAW = JSON.stringify({
  feeds: [{
    url: "https://partner.example.com/api/events",
    source: "partner_events_api",
    label: "合作方活动库",
    auth: { type: "bearer", env: "PARTNER_TOPIC_TOKEN" },
    itemsPath: "data.events",
    fieldMap: {
      externalId: "uid", topic: "name", city: "location.city", industries: "category",
      audiences: "targetAudience", formats: "eventType", heat: "stats.popularity",
      evidence: "intro", opportunity: "insight", capturedAt: "updatedAt",
    },
  }],
}, null, 2);

const PUBLIC_SAMPLE_FEED_RAW = JSON.stringify({
  feeds: [{
    url: "https://public.example.com/topic-signals.json",
    source: "public_topic_feed",
    label: "公开活动样本",
    itemsPath: "signals",
    fieldMap: {
      externalId: "id", topic: "title", city: "city", industries: "industries",
      audiences: "audiences", formats: "formats", heat: "heat",
      evidence: "summary", opportunity: "recommendation", capturedAt: "updatedAt",
    },
  }],
}, null, 2);

const FEED_PRESETS = [
  { key: "event_platform", label: "活动平台", raw: EVENT_PLATFORM_FEED_RAW },
  { key: "partner_api", label: "合作方 API", raw: PARTNER_FEED_RAW },
  { key: "public_sample", label: "公开样本", raw: PUBLIC_SAMPLE_FEED_RAW },
];

const TOKEN_STORAGE_KEY = "loopin.backofficeAdminToken";
const MEMBER_TOKEN_STORAGE_KEY = "loopin.backofficeMemberToken";

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

export function TopicSignalsAdmin() {
  const [signalForm, setSignalForm] = useState<SignalForm>(DEFAULT_SIGNAL_FORM);
  const [feedRaw, setFeedRaw] = useState(EVENT_PLATFORM_FEED_RAW);
  const [feedPreview, setFeedPreview] = useState<FeedPreviewResult | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatusResult | null>(null);
  const [savingSignal, setSavingSignal] = useState(false);
  const [previewingFeed, setPreviewingFeed] = useState(false);
  const [loadingFeedStatus, setLoadingFeedStatus] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadFeedStatus();
  }, []);

  function setSignal<K extends keyof SignalForm>(key: K, value: SignalForm[K]) {
    setSignalForm((prev) => ({ ...prev, [key]: value }));
  }

  async function saveSignal() {
    setSavingSignal(true);
    setError("");
    setMessage("");
    try {
      const payload = { ...signalForm, heat: Number(signalForm.heat) };
      const data = await api.post("/topic-radar/signals", payload);
      const topic = data.signal?.topic || signalForm.topic;
      setMessage(`${topic} 已加入信号源`);
      setSignalForm((prev) => ({ ...prev, topic: "", evidence: "", opportunity: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "信号保存失败");
    } finally {
      setSavingSignal(false);
    }
  }

  async function previewFeed() {
    setPreviewingFeed(true);
    setError("");
    setMessage("");
    try {
      const result = await api.post("/admin/topic-signal-feeds/preview", { raw: feedRaw, sampleSize: 3 }, { headers: backofficeHeaders() });
      setFeedPreview(result);
      setMessage(result.failed ? `预检完成：${result.ok}/${result.feeds} 个来源可用` : `预检通过：${result.ok} 个来源可用`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "feed 预检失败");
    } finally {
      setPreviewingFeed(false);
    }
  }

  async function loadFeedStatus() {
    if (!hasBackofficeToken()) return;
    setLoadingFeedStatus(true);
    try {
      const result = await api.get("/admin/topic-signal-feeds/status", { headers: backofficeHeaders() });
      setFeedStatus(result);
    } catch {
      setFeedStatus(null);
    } finally {
      setLoadingFeedStatus(false);
    }
  }

  return (
    <div className="single">
      <section className="radar-shell">
        <div className="dash-head">
          <div>
            <h2>选题信号源</h2>
            <p className="muted ops-intro">运营录入实时信号、维护来源优先级、预检外部 feed。这些数据喂给主办方端的选题雷达。</p>
          </div>
        </div>

        {!hasBackofficeToken() && (
          <div className="verdict warn" style={{ marginTop: 12 }}>未配置管理员令牌，feed 状态/预检不可用。先在「后台 IA」保存令牌。</div>
        )}

        <div className="radar-signal-form">
          <div className="radar-signal-title">
            <div>
              <h3>新增实时信号</h3>
              <p>社群观察、合作方反馈、公开活动样本都可以先录进来。</p>
            </div>
            <button className="mini-btn" onClick={saveSignal} disabled={savingSignal}>
              {savingSignal ? "保存中" : "保存信号"}
            </button>
          </div>
          <div className="radar-signal-grid">
            <Field label="来源" value={signalForm.source} onChange={(v) => setSignal("source", v)} />
            <Field label="来源名称" value={signalForm.label} onChange={(v) => setSignal("label", v)} />
            <Field label="主题" value={signalForm.topic} onChange={(v) => setSignal("topic", v)} />
            <Field label="热度" value={signalForm.heat} onChange={(v) => setSignal("heat", v)} />
            <Field label="城市" value={signalForm.city} onChange={(v) => setSignal("city", v)} />
            <Field label="行业" value={signalForm.industries} onChange={(v) => setSignal("industries", v)} />
            <Field label="人群" value={signalForm.audiences} onChange={(v) => setSignal("audiences", v)} />
            <Field label="形式" value={signalForm.formats} onChange={(v) => setSignal("formats", v)} />
            <Field label="证据" span value={signalForm.evidence} onChange={(v) => setSignal("evidence", v)} />
            <Field label="机会判断" span value={signalForm.opportunity} onChange={(v) => setSignal("opportunity", v)} />
          </div>
        </div>

        <SourcePlaybookPanel />

        <div className="radar-feed-preview">
          <div className="radar-signal-title">
            <div>
              <h3>外部 feed 预检</h3>
              <p>真实 URL、鉴权和字段映射先在这里试通。</p>
            </div>
            <div className="radar-feed-actions">
              <button className="mini-btn" onClick={loadFeedStatus} disabled={loadingFeedStatus}>
                {loadingFeedStatus ? "读取中" : "读取状态"}
              </button>
              <button className="mini-btn" onClick={previewFeed} disabled={previewingFeed}>
                {previewingFeed ? "预检中" : "预检 feed"}
              </button>
            </div>
          </div>
          <FeedStatusPanel result={feedStatus} loading={loadingFeedStatus} />
          <div className="radar-feed-presets">
            {FEED_PRESETS.map((preset) => (
              <button className={feedRaw === preset.raw ? "active" : ""} key={preset.key} onClick={() => setFeedRaw(preset.raw)} type="button">
                {preset.label}
              </button>
            ))}
          </div>
          <textarea value={feedRaw} onChange={(e) => setFeedRaw(e.target.value)} spellCheck={false} />
          {feedPreview && <FeedPreviewPanel result={feedPreview} />}
        </div>

        {error && <div className="verdict warn" style={{ marginTop: 12 }}>{error}</div>}
        {message && <div className="verdict good" style={{ marginTop: 12 }}>{message}</div>}
      </section>
    </div>
  );
}

function Field({ label, value, onChange, span }: { label: string; value: string; onChange: (v: string) => void; span?: boolean }) {
  return (
    <label className={`field ${span ? "span-2" : ""}`}>
      <span>{label}</span>
      <div className="input-wrap"><input value={value} onChange={(e) => onChange(e.target.value)} /></div>
    </label>
  );
}

function SourcePlaybookPanel() {
  return (
    <section className="radar-source-playbook">
      <div className="radar-source-head">
        <div>
          <h3>外部来源优先级</h3>
          <p>先接能证明活动需求和同城供给的来源，公开内容只当补充证据。</p>
        </div>
        <span>活动行优先走活动平台 API，不先做网页抓取</span>
      </div>
      <div className="radar-source-grid">
        {SOURCE_PLAYBOOK.map((item) => (
          <div className="radar-source-card" key={item.name}>
            <div>
              <b>{item.tier} · {item.name}</b>
              <span>{item.sources}</span>
            </div>
            <p>{item.action}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function FeedStatusPanel({ result, loading }: { result: FeedStatusResult | null; loading: boolean }) {
  if (loading && !result) {
    return <div className="radar-feed-status"><div className="radar-feed-summary"><span>读取中</span></div></div>;
  }
  if (!result) {
    return (
      <div className="radar-feed-status">
        <div className="radar-feed-summary">
          <span>状态未读取</span>
          <span>需要后台令牌</span>
        </div>
      </div>
    );
  }
  return (
    <div className="radar-feed-status">
      <div className="radar-feed-summary">
        <span>{result.configured ? "环境已配置" : "环境未配置"}</span>
        <span>{result.valid}/{result.feeds} 可解析</span>
        <span>{result.authRequired ? `鉴权 ${result.authReady}/${result.authRequired}` : "无需鉴权"}</span>
      </div>
      {result.missingAuthEnv.length > 0 && <p className="radar-feed-warning">缺少 {result.missingAuthEnv.join("、")}</p>}
      {result.feedStatuses.slice(0, 3).map((feed) => (
        <div className="radar-feed-status-row" key={`${feed.source}-${feed.url}`}>
          <div>
            <b>{feed.label}</b>
            <span>{feed.source} · {feed.method} · {feed.host || feed.url}</span>
          </div>
          <div className="radar-feed-badges">
            <span className={feed.valid ? "ok" : "warn"}>{feed.valid ? "URL OK" : "URL ERR"}</span>
            <span className={feed.auth.required || feed.headers.envRefs.length ? (feed.auth.ready && !feed.headers.missingEnvRefs.length ? "ok" : "warn") : "idle"}>
              {feed.auth.required || feed.headers.envRefs.length ? "鉴权" : "公开"}
            </span>
          </div>
          {feed.error && <p>{feed.error}</p>}
        </div>
      ))}
      {result.recommendations[0] && <p className="radar-feed-hint">{result.recommendations[0]}</p>}
    </div>
  );
}

function FeedPreviewPanel({ result }: { result: FeedPreviewResult }) {
  return (
    <div className="radar-feed-result">
      <div className="radar-feed-summary">
        <span>{result.feeds} 个来源</span>
        <span>{result.ok} 可用</span>
        <span>{result.failed} 失败</span>
      </div>
      <div className="signal-list">
        {result.previews.map((preview) => (
          <div className="signal-row" key={preview.url}>
            <div className="signal-main">
              <div className="signal-title">
                <b>{preview.label}</b>
                <span>{preview.ok ? `${preview.count} 条` : "失败"}</span>
              </div>
              {preview.error ? (
                <p>{preview.error}</p>
              ) : (
                preview.sample.slice(0, 3).map((signal) => (
                  <p key={signal.id}>{signal.topic || signal.id} · {signal.city || "城市待定"} · 热度 {signal.heat ?? "—"}</p>
                ))
              )}
              <div className="signal-meta">{preview.source} · {preview.url}</div>
            </div>
            <div className={`signal-heat ${preview.ok ? "" : "warn"}`}>
              <b>{preview.ok ? "OK" : "ERR"}</b>
              <span>预检</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
