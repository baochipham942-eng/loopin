import { describe, it, expect } from "vitest";
import {
  validateForm,
  isFieldVisible,
  recommendFields,
  type RegistrationFormSchema,
} from "./form-schema.js";

const schema: RegistrationFormSchema = {
  fields: [
    { key: "name", label: "姓名", type: "text", required: true, visibility: "organizer_only" },
    { key: "phone", label: "手机号", type: "phone", required: true, visibility: "organizer_only" },
    {
      key: "profession",
      label: "职业",
      type: "single_select",
      required: false,
      visibility: "public",
      options: [
        { value: "pm", label: "产品经理" },
        { value: "vc", label: "投资人" },
      ],
    },
  ],
};

describe("validateForm — 基础", () => {
  it("合法填写通过（结构化 options 按 value）", () => {
    const r = validateForm(schema, { name: "林晨", phone: "13800138000", profession: "pm" });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual({});
  });

  it("缺必填报错", () => {
    const r = validateForm(schema, { phone: "13800138000" });
    expect(r.ok).toBe(false);
    expect(r.errors.name).toContain("必填");
  });

  it("手机号格式校验", () => {
    const r = validateForm(schema, { name: "x", phone: "123" });
    expect(r.ok).toBe(false);
    expect(r.errors.phone).toContain("有效的手机号");
  });

  it("单选无效 value 报错", () => {
    const r = validateForm(schema, { name: "x", phone: "13800138000", profession: "黑客" });
    expect(r.ok).toBe(false);
    expect(r.errors.profession).toContain("无效");
  });

  it("字段超 5 个给 warning 但不阻断", () => {
    const big: RegistrationFormSchema = {
      fields: Array.from({ length: 6 }, (_, i) => ({
        key: `f${i}`,
        label: `字段${i}`,
        type: "text" as const,
        required: false,
        visibility: "organizer_only" as const,
      })),
    };
    const r = validateForm(big, {});
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("依赖条件（dependsOn，用 option value 关联）", () => {
  const depSchema: RegistrationFormSchema = {
    fields: [
      {
        key: "need_invoice",
        label: "是否需要发票",
        type: "single_select",
        required: true,
        visibility: "organizer_only",
        options: [
          { value: "yes", label: "需要" },
          { value: "no", label: "不需要" },
        ],
      },
      {
        key: "invoice_title",
        label: "发票抬头",
        type: "text",
        required: true,
        visibility: "organizer_only",
        dependsOn: { field: "need_invoice", values: ["yes"] },
      },
    ],
  };

  it("依赖未满足时字段不可见", () => {
    const f = depSchema.fields[1]!;
    expect(isFieldVisible(f, { need_invoice: "no" })).toBe(false);
    expect(isFieldVisible(f, { need_invoice: "yes" })).toBe(true);
  });

  it("依赖未满足时必填也跳过校验", () => {
    const r = validateForm(depSchema, { need_invoice: "no" });
    expect(r.ok).toBe(true);
  });

  it("依赖满足时必填生效", () => {
    const r = validateForm(depSchema, { need_invoice: "yes" });
    expect(r.ok).toBe(false);
    expect(r.errors.invoice_title).toContain("必填");
  });
});

describe("askDuringCheckin（购票不问、核销才问）", () => {
  const checkinSchema: RegistrationFormSchema = {
    fields: [
      { key: "name", label: "姓名", type: "text", required: true, visibility: "organizer_only" },
      { key: "meal", label: "餐食", type: "text", required: true, visibility: "organizer_only", askDuringCheckin: true },
    ],
  };

  it("register 阶段跳过 askDuringCheckin 字段", () => {
    const r = validateForm(checkinSchema, { name: "林晨" }, { stage: "register" });
    expect(r.ok).toBe(true);
  });

  it("checkin 阶段校验 askDuringCheckin 字段", () => {
    const r = validateForm(checkinSchema, { name: "林晨" }, { stage: "checkin" });
    expect(r.ok).toBe(false);
    expect(r.errors.meal).toContain("必填");
  });
});

describe("number 类型 min/max 校验", () => {
  const numSchema: RegistrationFormSchema = {
    fields: [
      { key: "age", label: "年龄", type: "number", required: true, visibility: "organizer_only", validation: { min: 18, max: 60 } },
    ],
  };
  it("范围内通过", () => {
    expect(validateForm(numSchema, { age: "30" }).ok).toBe(true);
  });
  it("越界报错", () => {
    expect(validateForm(numSchema, { age: "12" }).ok).toBe(false);
    expect(validateForm(numSchema, { age: "99" }).ok).toBe(false);
  });
  it("非数字报错", () => {
    expect(validateForm(numSchema, { age: "abc" }).ok).toBe(false);
  });
});

describe("recommendFields", () => {
  it("AI 分享活动推荐含职业标签字段（结构化 options）", () => {
    const fields = recommendFields("ai_sharing");
    const prof = fields.find((f) => f.key === "profession");
    expect(prof).toBeTruthy();
    expect(prof!.options?.[0]).toHaveProperty("value");
    expect(fields.find((f) => f.key === "phone")?.required).toBe(true);
  });
});
