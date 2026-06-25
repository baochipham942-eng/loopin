import { useState } from "react";
import { api } from "../api.js";
import { useCurrentEvent } from "../event/EventContext.js";
import { buildMiniProgramEventPath, buildMiniProgramPathSheet, cleanUTMPart, findUTMChannel, UTM_CHANNELS, type MiniProgramPathOptions, type UTMChannel } from "../utm.js";

interface Materials {
  moments: string[];
  wechatGroup: string[];
  xiaohongshu: { title: string; body: string }[];
  officialAccount: string[];
}

function fmt(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function Materials() {
  const { currentEventId, currentEvent } = useCurrentEvent();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Materials | null>(null);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  async function generate() {
    if (!currentEventId) return;
    setLoading(true); setError(""); setCopyMessage(""); setData(null);
    try {
      // 拉当前活动详情用于文案上下文
      const ev = await api.get(`/events/${currentEventId}`).catch(() => null);
      const m = await api.post("/ai/materials", {
        title: ev?.title ?? currentEvent?.title,
        venue: ev?.venue,
        timeText: ev?.startAt ? fmt(ev.startAt) : undefined,
        priceText: ev?.ticketTypes?.length ? priceText(ev.ticketTypes) : "免费",
      });
      setData(m);
    } catch (e) {
      setError((e as Error).message || "生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string, channel?: UTMChannel) {
    const body = withMiniProgramPath(text, currentEventId, channel);
    try {
      await navigator.clipboard?.writeText(body);
      setCopyMessage(channel ? `${channel.label}文案已复制，含渠道路径` : "文案已复制");
    } catch {
      setCopyMessage(body);
    }
  }

  const momentsChannel = findUTMChannel("moments");
  const groupChannel = findUTMChannel("wechat_group");
  const xhsChannel = findUTMChannel("xiaohongshu");
  const officialChannel = findUTMChannel("official_account");

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <h2>分享素材</h2>
        </div>
        <p className="muted">为「{currentEvent?.title ?? "当前活动"}」生成朋友圈 / 微信群 / 小红书 / 公众号文案（MiMo，约 20-40 秒）。发布后可持续重新生成、按报名进度调整。</p>
        <button className="publish-btn" onClick={generate} disabled={loading || !currentEventId}>
          {loading ? "AI 生成中…（约 20-40 秒）" : "✨ 生成全套推广物料"}
        </button>
        {error && <div className="verdict warn" style={{ marginTop: 12 }}>{error}</div>}
        {copyMessage && <div className="mat-copy-state">{copyMessage}</div>}

        {data && (
          <div className="materials">
            <Channel title="朋友圈" items={data.moments} channel={momentsChannel} onCopy={copy} />
            <Channel title="微信群话术" items={data.wechatGroup} channel={groupChannel} onCopy={copy} />
            <div className="mat-block">
              <h3>小红书</h3>
              {(Array.isArray(data.xiaohongshu) ? data.xiaohongshu : []).map((x, i) => (
                <div className="mat-item" key={i}>
                  <div className="mat-text"><b>{x.title}</b><br />{x.body}</div>
                  <button className="mini-btn" onClick={() => copy(`${x.title}\n${x.body}`, xhsChannel)}>复制</button>
                </div>
              ))}
            </div>
            <Channel title="公众号导语" items={data.officialAccount} channel={officialChannel} onCopy={copy} />
          </div>
        )}

        {currentEventId && <SharePaths eventId={currentEventId} onCopyText={(t, m) => { void copyText(t, m); }} />}
      </section>
    </div>
  );

  async function copyText(text: string, msg: string) {
    try { await navigator.clipboard?.writeText(text); setCopyMessage(msg); } catch { setCopyMessage(text); }
  }
}

/** 引流路径（8 渠道 UTM 小程序路径，从运营台迁来；推广就在这里一站式完成）。 */
function SharePaths({ eventId, onCopyText }: { eventId: string; onCopyText: (text: string, msg: string) => void }) {
  const [content, setContent] = useState("xhs_note_01");
  const [referrer, setReferrer] = useState("studio_share");
  const options: MiniProgramPathOptions = { content: cleanUTMPart(content) || undefined, referrer: cleanUTMPart(referrer) || undefined };
  return (
    <div className="mat-share">
      <div className="mat-share-head">
        <div className="ops-agent-title">引流路径</div>
        <button className="ghost-btn" onClick={() => onCopyText(buildMiniProgramPathSheet(eventId, options), "全部渠道投放清单已复制")}>复制全部清单</button>
      </div>
      <div className="mat-share-controls">
        <label><span>投放位 content</span><input value={content} maxLength={64} onChange={(e) => setContent(e.target.value)} placeholder="xhs_note_01 / guest_lisa" /></label>
        <label><span>入口 referrer</span><input value={referrer} maxLength={64} onChange={(e) => setReferrer(e.target.value)} placeholder="studio_share" /></label>
      </div>
      <div className="mat-share-list">
        {UTM_CHANNELS.map((channel) => {
          const path = buildMiniProgramEventPath(eventId, channel, options);
          return (
            <div className="mat-share-channel" key={channel.key}>
              <div className="mat-share-meta"><b>{channel.label}</b><code>{path}</code></div>
              <button className="mini-btn" onClick={() => onCopyText(path, `${channel.label}路径已复制`)}>复制</button>
            </div>
          );
        })}
      </div>
      <div className="ops-share-hint muted">复制后发到对应渠道，报名会自动进入复盘的渠道归因。</div>
    </div>
  );
}

function Channel({
  title,
  items,
  channel,
  onCopy,
}: {
  title: string;
  items: string[];
  channel?: UTMChannel;
  onCopy: (text: string, channel?: UTMChannel) => void;
}) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div className="mat-block">
      <h3>{title}</h3>
      {list.map((t, i) => (
        <div className="mat-item" key={i}>
          <div className="mat-text">{t}</div>
          <button className="mini-btn" onClick={() => onCopy(t, channel)}>复制</button>
        </div>
      ))}
    </div>
  );
}

function priceText(ticketTypes: { priceCents: number }[]) {
  const prices = ticketTypes.map((t) => t.priceCents).filter((c) => c > 0);
  if (prices.length === 0) return "免费";
  return `${Math.min(...prices) / 100}元`;
}

function withMiniProgramPath(text: string, eventId: string, channel?: UTMChannel) {
  const clean = text.trim();
  if (!eventId || !channel) return clean;
  const path = buildMiniProgramEventPath(eventId, channel, {
    content: "ai_materials",
    referrer: "studio_materials",
  });
  return `${clean}\n\n报名入口：${path}`;
}
