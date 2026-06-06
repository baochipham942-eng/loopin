import { useEffect, useState } from "react";
import { api } from "../api.js";

interface EventLite { id: string; title: string; venue?: string; startAt: string; minPriceCents: number }
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
  const [events, setEvents] = useState<EventLite[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Materials | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/events").then((r) => { setEvents(r.events); if (r.events[0]) setSelected(r.events[0].id); }).catch(() => {});
  }, []);

  async function generate() {
    const ev = events.find((e) => e.id === selected);
    if (!ev) return;
    setLoading(true); setError(""); setData(null);
    try {
      const m = await api.post("/ai/materials", {
        title: ev.title,
        venue: ev.venue,
        timeText: fmt(ev.startAt),
        priceText: ev.minPriceCents ? `${ev.minPriceCents / 100}元` : "免费",
      });
      setData(m);
    } catch (e) {
      setError((e as Error).message || "生成失败");
    } finally {
      setLoading(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text);
  }

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <h2>AI 推广物料</h2>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="select">
            {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
        </div>
        <p className="muted">一键生成朋友圈 / 微信群 / 小红书 / 公众号文案（MiMo 生成，约 20-40 秒）。</p>
        <button className="publish-btn" onClick={generate} disabled={loading || !selected}>
          {loading ? "AI 生成中…（约 20-40 秒）" : "✨ 生成全套推广物料"}
        </button>
        {error && <div className="verdict warn" style={{ marginTop: 12 }}>{error}</div>}

        {data && (
          <div className="materials">
            <Channel title="朋友圈" items={data.moments} onCopy={copy} />
            <Channel title="微信群话术" items={data.wechatGroup} onCopy={copy} />
            <div className="mat-block">
              <h3>小红书</h3>
              {(Array.isArray(data.xiaohongshu) ? data.xiaohongshu : []).map((x, i) => (
                <div className="mat-item" key={i}>
                  <div className="mat-text"><b>{x.title}</b><br />{x.body}</div>
                  <button className="mini-btn" onClick={() => copy(`${x.title}\n${x.body}`)}>复制</button>
                </div>
              ))}
            </div>
            <Channel title="公众号导语" items={data.officialAccount} onCopy={copy} />
          </div>
        )}
      </section>
    </div>
  );
}

function Channel({ title, items, onCopy }: { title: string; items: string[]; onCopy: (t: string) => void }) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div className="mat-block">
      <h3>{title}</h3>
      {list.map((t, i) => (
        <div className="mat-item" key={i}>
          <div className="mat-text">{t}</div>
          <button className="mini-btn" onClick={() => onCopy(t)}>复制</button>
        </div>
      ))}
    </div>
  );
}
