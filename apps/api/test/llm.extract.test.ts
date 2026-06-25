import { describe, it, expect } from "vitest";
import { extractJSON } from "../src/llm.js";

describe("extractJSON", () => {
  it("解析规整 JSON", () => {
    expect(extractJSON('{"a":1,"b":[1,2]}')).toEqual({ a: 1, b: [1, 2] });
  });

  it("去掉 markdown 围栏", () => {
    expect(extractJSON('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("截取前后多余文字里的 JSON", () => {
    expect(extractJSON('好的，这是结果：{"x":"y"} 以上。')).toEqual({ x: "y" });
  });

  it("修复数组元素间缺逗号（截图里的报错形态）", () => {
    // 两个数组元素之间漏了逗号
    const broken = '{"moments":["第一条文案" "第二条文案"]}';
    expect(extractJSON(broken)).toEqual({ moments: ["第一条文案", "第二条文案"] });
  });

  it("修复对象尾随逗号", () => {
    expect(extractJSON('{"a":1,"b":2,}')).toEqual({ a: 1, b: 2 });
  });

  it("修复对象成员间缺逗号", () => {
    expect(extractJSON('{"a":1 "b":2}')).toEqual({ a: 1, b: 2 });
  });

  it("解析顶层数组", () => {
    expect(extractJSON('[{"a":1} {"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
