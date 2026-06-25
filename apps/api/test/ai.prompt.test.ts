import { describe, expect, it } from "vitest";
import { buildEventPagePrompt, buildMaterialsPrompt } from "../src/services/ai.js";

describe("AI prompt 事实约束", () => {
  it("活动页生成明确禁止补时间地点，并保留给定事实", () => {
    const prompt = buildEventPagePrompt({
      theme: "Agent 工作流沙龙",
      timeText: "2026-06-14 19:00",
      venue: "静安寺 · Loopin Space",
      city: "上海",
      priceText: "199元",
    });

    expect(prompt).toContain("不得自行补具体日期、时段、地址、嘉宾名");
    expect(prompt).toContain("2026-06-14 19:00");
    expect(prompt).toContain("静安寺 · Loopin Space");
  });

  it("推广物料生成在缺少地点时保持待定，不默认编上海", () => {
    const prompt = buildMaterialsPrompt({ title: "Agent 工作流沙龙", timeText: "待定" });

    expect(prompt).toContain("字段为“待定”时，只能写待定");
    expect(prompt).toContain("地点：待定");
    expect(prompt).toContain("城市：待定");
  });
});
