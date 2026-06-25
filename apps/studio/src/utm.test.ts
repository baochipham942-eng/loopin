import { describe, expect, it } from "vitest";
import { buildMiniProgramEventPath, buildMiniProgramPathSheet, cleanUTMPart, UTM_CHANNELS } from "./utm";

function parsePath(path: string) {
  return new URL(path, "https://loopin.test");
}

describe("Studio UTM paths", () => {
  it("generates a generic event path without attribution params", () => {
    const path = buildMiniProgramEventPath("event_1");
    const url = parsePath(path);

    expect(url.pathname).toBe("/pages/event-detail/index");
    expect(url.searchParams.get("eventId")).toBe("event_1");
    expect(url.searchParams.has("utm_source")).toBe(false);
  });

  it("generates tracked mini program paths for every ops channel", () => {
    const rows = buildMiniProgramPathSheet("event_1", { content: "guest lisa", referrer: "partner group" }).split("\n");

    expect(UTM_CHANNELS).toHaveLength(8);
    expect(rows).toHaveLength(UTM_CHANNELS.length + 1);
    expect(rows[0]!.split("\t")).toEqual(["渠道", "utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer", "小程序路径"]);
    expect(rows.some((row) => row.includes("活动行\thuodongxing\tmini_program\tevent_recruit\tguest_lisa\tpartner_group"))).toBe(true);
    expect(rows.some((row) => row.includes("嘉宾转发\tguest_share\tmini_program\tevent_recruit\tguest_lisa\tpartner_group"))).toBe(true);
    expect(rows.some((row) => row.includes("社群合作\tcommunity_partner\tmini_program\tevent_recruit\tguest_lisa\tpartner_group"))).toBe(true);
  });

  it("keeps channel, campaign, content and referrer query params parseable", () => {
    const channel = UTM_CHANNELS.find((item) => item.key === "huodongxing");
    expect(channel).toBeDefined();

    const url = parsePath(buildMiniProgramEventPath("event_1", channel, { content: "activity list 01", referrer: "partner group" }));

    expect(url.searchParams.get("utm_source")).toBe("huodongxing");
    expect(url.searchParams.get("utm_medium")).toBe("mini_program");
    expect(url.searchParams.get("utm_campaign")).toBe("event_recruit");
    expect(url.searchParams.get("utm_content")).toBe("activity_list_01");
    expect(url.searchParams.get("channel")).toBe("huodongxing");
    expect(url.searchParams.get("referrer")).toBe("partner_group");
  });

  it("falls back to defaults after cleaning blank content and referrer", () => {
    const channel = UTM_CHANNELS.find((item) => item.key === "xiaohongshu");
    expect(channel).toBeDefined();

    const url = parsePath(buildMiniProgramEventPath("event_1", channel, { content: "   ", referrer: "  " }));

    expect(url.searchParams.get("utm_content")).toBe("ops_link");
    expect(url.searchParams.get("referrer")).toBe("studio_operations");
  });

  it("normalizes UTM parts for copy-safe paths", () => {
    expect(cleanUTMPart("  xhs note 01  ")).toBe("xhs_note_01");
    expect(cleanUTMPart("a".repeat(80))).toHaveLength(64);
  });
});
