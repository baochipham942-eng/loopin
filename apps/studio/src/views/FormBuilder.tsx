import { useEffect, useState } from "react";
import {
  recommendFields,
  validateFormSchema,
  type FormField,
  type FieldType,
  type FieldVisibility,
} from "@loopin/core";
import { api } from "../api.js";
import { useCurrentEvent } from "../event/EventContext.js";

/**
 * 主办方·可配置报名表构建器（P2）。
 * 加载当前活动的报名表 schema → 字段编辑器 + 实时预览 → 保存到 PUT /events/:id/form。
 * 校验复用 core 的 validateFormSchema（前端预检 + 后端权威）。
 */

const TYPE_LABEL: Record<FieldType, string> = {
  text: "文本", phone: "手机号", single_select: "单选", multi_select: "多选",
  textarea: "长文本", profession_tag: "职业标签", city: "城市", company: "公司",
  wechat: "微信号", number: "数字", date: "日期",
};
const TYPE_OPTIONS = Object.keys(TYPE_LABEL) as FieldType[];

const VIS_LABEL: Record<FieldVisibility, string> = {
  public: "公开展示", organizer_only: "仅主办方", audit_reference: "审核参考",
};
const VIS_OPTIONS = Object.keys(VIS_LABEL) as FieldVisibility[];

const OPTION_TYPES: FieldType[] = ["single_select", "multi_select", "profession_tag"];

export function FormBuilder() {
  const { currentEventId, currentEvent } = useCurrentEvent();
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!currentEventId) { setFields([]); setLoading(false); return; }
    setLoading(true);
    api.get(`/events/${currentEventId}`)
      .then((e) => setFields(e.formSchema?.fields ?? []))
      .catch(() => setFields([]))
      .finally(() => setLoading(false));
  }, [currentEventId]);

  function patch(index: number, p: Partial<FormField>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...p } : f)));
  }

  function addField() {
    const n = fields.length + 1;
    setFields((prev) => [...prev, { key: `field_${n}`, label: `字段 ${n}`, type: "text", required: false, visibility: "organizer_only" }]);
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function move(index: number, dir: -1 | 1) {
    setFields((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j]!, next[index]!];
      return next;
    });
  }

  function applyRecommended() {
    setFields(recommendFields("ai_sharing"));
    setMessage("已套用推荐字段，可继续调整后保存");
    setErrors([]);
  }

  async function save() {
    const schema = { fields };
    const check = validateFormSchema(schema);
    if (!check.ok) { setErrors(check.errors); setMessage(""); return; }
    setErrors([]);
    setSaving(true);
    try {
      await putForm(currentEventId, schema);
      setMessage("报名表已保存");
    } catch (e) {
      const data = (e as { data?: { errors?: string[] } }).data;
      if (data?.errors) setErrors(data.errors);
      else setMessage((e as Error).message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (!currentEventId) {
    return <div className="single"><section className="card"><h2>报名表</h2><div className="muted">先在顶栏选择一个活动。</div></section></div>;
  }

  return (
    <div className="single">
      <section className="card">
        <div className="dash-head">
          <div>
            <h2>报名表</h2>
            <p className="muted ops-intro">为「{currentEvent?.title ?? "当前活动"}」配置报名表字段。建议精简到 5 个以内以提升完成率。</p>
          </div>
          <div className="actions">
            <button className="ghost-btn" onClick={applyRecommended}>套用推荐字段</button>
            <button className="mini-btn" onClick={save} disabled={saving || loading}>{saving ? "保存中" : "保存报名表"}</button>
          </div>
        </div>

        {message && <div className="reg-message">{message}</div>}
        {errors.length > 0 && (
          <div className="verdict warn" style={{ marginBottom: 12 }}>
            {errors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        {loading ? <div className="muted">加载报名表中…</div> : (
          <div className="fb-grid">
            <div className="fb-editor">
              {fields.length === 0 && <div className="muted">还没有字段。点「套用推荐字段」或「添加字段」开始。</div>}
              {fields.map((f, i) => (
                <FieldCard
                  key={i}
                  field={f}
                  index={i}
                  isFirst={i === 0}
                  isLast={i === fields.length - 1}
                  onPatch={(p) => patch(i, p)}
                  onRemove={() => removeField(i)}
                  onMove={(d) => move(i, d)}
                />
              ))}
              <button className="ghost-btn fb-add" onClick={addField}>+ 添加字段</button>
            </div>

            <div className="fb-preview">
              <div className="ops-agent-title">C 端预览</div>
              <div className="fb-preview-card">
                {fields.length === 0 ? <div className="muted">暂无字段</div> : fields.map((f, i) => (
                  <PreviewField key={i} field={f} />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function FieldCard({ field, index, isFirst, isLast, onPatch, onRemove, onMove }: {
  field: FormField; index: number; isFirst: boolean; isLast: boolean;
  onPatch: (p: Partial<FormField>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const showOptions = OPTION_TYPES.includes(field.type);
  return (
    <div className="fb-field">
      <div className="fb-field-head">
        <span className="fb-field-no">{index + 1}</span>
        <input className="fb-input fb-label" value={field.label} placeholder="字段标题" onChange={(e) => onPatch({ label: e.target.value })} />
        <div className="fb-field-ops">
          <button className="fb-iconbtn" disabled={isFirst} onClick={() => onMove(-1)} aria-label="上移">↑</button>
          <button className="fb-iconbtn" disabled={isLast} onClick={() => onMove(1)} aria-label="下移">↓</button>
          <button className="fb-iconbtn danger" onClick={onRemove} aria-label="删除">✕</button>
        </div>
      </div>

      <div className="fb-field-row">
        <label className="fb-mini">
          <span>标识 key</span>
          <input className="fb-input" value={field.key} onChange={(e) => onPatch({ key: e.target.value.trim() })} />
        </label>
        <label className="fb-mini">
          <span>类型</span>
          <select className="fb-input" value={field.type} onChange={(e) => onPatch({ type: e.target.value as FieldType })}>
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="fb-mini">
          <span>可见性</span>
          <select className="fb-input" value={field.visibility} onChange={(e) => onPatch({ visibility: e.target.value as FieldVisibility })}>
            {VIS_OPTIONS.map((v) => <option key={v} value={v}>{VIS_LABEL[v]}</option>)}
          </select>
        </label>
        <label className="fb-check">
          <input type="checkbox" checked={field.required} onChange={(e) => onPatch({ required: e.target.checked })} />
          <span>必填</span>
        </label>
      </div>

      {showOptions && <OptionsEditor field={field} onPatch={onPatch} />}
    </div>
  );
}

function OptionsEditor({ field, onPatch }: { field: FormField; onPatch: (p: Partial<FormField>) => void }) {
  const options = field.options ?? [];
  function update(i: number, patch: { value?: string; label?: string }) {
    onPatch({ options: options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)) });
  }
  function add() {
    const n = options.length + 1;
    onPatch({ options: [...options, { value: `opt_${n}`, label: `选项 ${n}` }] });
  }
  function remove(i: number) {
    onPatch({ options: options.filter((_, idx) => idx !== i) });
  }
  return (
    <div className="fb-options">
      <div className="fb-options-head">选项</div>
      {options.map((o, i) => (
        <div className="fb-option-row" key={i}>
          <input className="fb-input" value={o.label} placeholder="展示文案" onChange={(e) => update(i, { label: e.target.value })} />
          <input className="fb-input" value={o.value} placeholder="value（稳定标识）" onChange={(e) => update(i, { value: e.target.value.trim() })} />
          <button className="fb-iconbtn danger" onClick={() => remove(i)} aria-label="删除选项">✕</button>
        </div>
      ))}
      <button className="ghost-btn fb-add-opt" onClick={add}>+ 添加选项</button>
    </div>
  );
}

function PreviewField({ field }: { field: FormField }) {
  return (
    <label className="fb-pv-field">
      <span className="fb-pv-label">{field.label}{field.required && <em className="fb-pv-req">*</em>}</span>
      {field.type === "textarea" ? (
        <textarea className="fb-pv-input" disabled placeholder={field.placeholder || "（长文本）"} />
      ) : OPTION_TYPES.includes(field.type) ? (
        <div className="fb-pv-options">
          {(field.options ?? []).map((o) => <span className="fb-pv-chip" key={o.value}>{o.label}</span>)}
          {(field.options ?? []).length === 0 && <span className="muted">未配置选项</span>}
        </div>
      ) : (
        <input className="fb-pv-input" disabled placeholder={field.placeholder || TYPE_LABEL[field.type]} />
      )}
    </label>
  );
}

async function putForm(eventId: string, schema: { fields: FormField[] }) {
  const res = await fetch(`/api/events/${eventId}/form`, {
    method: "PUT",
    headers: buildHeaders(),
    body: JSON.stringify({ schema }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.message || "保存失败"), { status: res.status, data });
  return data;
}

function buildHeaders(): HeadersInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (typeof window !== "undefined") {
    const admin = window.localStorage.getItem("loopin.backofficeAdminToken")?.trim();
    const member = window.localStorage.getItem("loopin.backofficeMemberToken")?.trim();
    if (admin) headers["x-loopin-admin-token"] = admin;
    if (member) headers["x-loopin-member-token"] = member;
  }
  return headers;
}
