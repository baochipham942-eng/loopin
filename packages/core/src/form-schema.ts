/**
 * 可配置报名表 schema —— C 端按 schema 渲染，后端按 schema 校验，两端共享同一份。
 * 见 ADR-005 + docs/04 §3.1（Pretix/Hi.Events 印证）：
 * Question 一等公民，支持 belongsTo 粒度、条件依赖(identifier 关联)、购票/核销分阶段、分类型校验。
 */

export type FieldType =
  | "text"
  | "phone"
  | "single_select"
  | "multi_select"
  | "textarea"
  | "profession_tag"
  | "city"
  | "company"
  | "wechat"
  | "number"
  | "date";

/** 字段可见性：公开展示 / 仅主办方可见 / 审核参考 */
export type FieldVisibility = "public" | "organizer_only" | "audit_reference";

/** 字段归属粒度：整单问一次 / 每个参与人各问 */
export type FieldBelongsTo = "order" | "attendee";

/** 选项用 value(稳定标识) + label(展示)，依赖与外部映射都用 value，改文案不断链 */
export interface FormOption {
  value: string;
  label: string;
}

export interface FieldValidation {
  min?: number; // number 类型最小值
  max?: number; // number 类型最大值
  maxLength?: number; // 文本最大长度
}

/** 条件依赖：当 field 的值命中 values(option value) 之一时，本字段才可见 */
export interface FieldDependency {
  field: string;
  values: string[];
}

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  visibility: FieldVisibility;
  /** 归属粒度，默认 attendee */
  belongsTo?: FieldBelongsTo;
  /** single_select / multi_select / profession_tag 的可选项 */
  options?: FormOption[];
  /** 条件显示 */
  dependsOn?: FieldDependency;
  /** 购票时不问、核销时才问（如餐食选择） */
  askDuringCheckin?: boolean;
  validation?: FieldValidation;
  placeholder?: string;
}

export interface RegistrationFormSchema {
  fields: FormField[];
}

export type FormValues = Record<string, string | string[]>;

export type FormStage = "register" | "checkin";

export interface ValidationResult {
  ok: boolean;
  errors: Record<string, string>;
  /** 非阻断的建议（如字段数超过推荐值） */
  warnings: string[];
}

const PHONE_RE = /^1[3-9]\d{9}$/;
const SELECT_TYPES: FieldType[] = ["single_select"];
const MULTI_TYPES: FieldType[] = ["multi_select", "profession_tag"];

/** 体验原则：报名表默认不超过 5 个字段 */
export const RECOMMENDED_MAX_FIELDS = 5;

/** 字段在当前填写值下是否可见（无依赖恒可见；有依赖则被依赖字段值命中才可见） */
export function isFieldVisible(field: FormField, values: FormValues): boolean {
  if (!field.dependsOn) return true;
  const dep = values[field.dependsOn.field];
  if (dep === undefined) return false;
  const depValues = Array.isArray(dep) ? dep : [dep];
  return depValues.some((v) => field.dependsOn!.values.includes(v));
}

export interface ValidateOptions {
  /** register: 跳过 askDuringCheckin 字段（默认）；checkin: 校验这些字段 */
  stage?: FormStage;
}

export function validateForm(
  schema: RegistrationFormSchema,
  values: FormValues,
  opts: ValidateOptions = {}
): ValidationResult {
  const stage: FormStage = opts.stage ?? "register";
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  if (schema.fields.length > RECOMMENDED_MAX_FIELDS) {
    warnings.push(`报名表有 ${schema.fields.length} 个字段，建议精简到 ${RECOMMENDED_MAX_FIELDS} 个以内以提升完成率。`);
  }

  for (const field of schema.fields) {
    // 阶段过滤：register 阶段跳过"核销才问"的字段
    if (stage === "register" && field.askDuringCheckin) continue;
    // 依赖未满足 → 字段不可见，整条跳过（必填也不生效）
    if (!isFieldVisible(field, values)) continue;

    const raw = values[field.key];
    const isEmpty =
      raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0);

    if (isEmpty) {
      if (field.required) errors[field.key] = `${field.label}为必填项`;
      continue;
    }

    if (MULTI_TYPES.includes(field.type)) {
      if (!Array.isArray(raw)) {
        errors[field.key] = `${field.label}格式应为多选`;
        continue;
      }
      if (field.options) {
        const valid = new Set(field.options.map((o) => o.value));
        const invalid = raw.filter((v) => !valid.has(v));
        if (invalid.length) errors[field.key] = `${field.label}存在无效选项：${invalid.join("、")}`;
      }
      continue;
    }

    // 单值类型
    if (Array.isArray(raw)) {
      errors[field.key] = `${field.label}格式错误`;
      continue;
    }
    const value = raw;

    if (field.type === "phone" && !PHONE_RE.test(value)) {
      errors[field.key] = `请填写有效的手机号`;
      continue;
    }
    if (SELECT_TYPES.includes(field.type) && field.options) {
      const valid = new Set(field.options.map((o) => o.value));
      if (!valid.has(value)) {
        errors[field.key] = `${field.label}选项无效`;
        continue;
      }
    }
    if (field.type === "number") {
      const num = Number(value);
      if (!Number.isFinite(num) || value.trim() === "") {
        errors[field.key] = `${field.label}必须是数字`;
        continue;
      }
      if (field.validation?.min !== undefined && num < field.validation.min) {
        errors[field.key] = `${field.label}不能小于 ${field.validation.min}`;
        continue;
      }
      if (field.validation?.max !== undefined && num > field.validation.max) {
        errors[field.key] = `${field.label}不能大于 ${field.validation.max}`;
        continue;
      }
    }
    const maxLength = field.validation?.maxLength;
    if (maxLength !== undefined && value.length > maxLength) {
      errors[field.key] = `${field.label}不能超过 ${maxLength} 字`;
      continue;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, warnings };
}

/** 按活动类型推荐的默认字段（系统推荐，主办方可改） */
export function recommendFields(eventType: string): FormField[] {
  const base: FormField[] = [
    { key: "name", label: "姓名", type: "text", required: true, visibility: "organizer_only", validation: { maxLength: 20 } },
    { key: "phone", label: "手机号", type: "phone", required: true, visibility: "organizer_only" },
  ];
  if (eventType === "ai_sharing" || eventType === "industry_salon") {
    base.push(
      {
        key: "profession",
        label: "职业标签",
        type: "profession_tag",
        required: false,
        visibility: "public",
        options: [
          { value: "ai_founder", label: "AI 创业者" },
          { value: "pm", label: "产品经理" },
          { value: "ops", label: "运营" },
          { value: "indie_dev", label: "独立开发者" },
          { value: "investor", label: "投资人" },
          { value: "student", label: "学生" },
        ],
      },
      { key: "company", label: "公司/项目", type: "company", required: false, visibility: "public", validation: { maxLength: 30 } }
    );
  }
  return base;
}
