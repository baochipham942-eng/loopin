export interface UTMChannel {
  key: string;
  label: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
}

export interface MiniProgramPathOptions {
  content?: string;
  referrer?: string;
}

export const UTM_CHANNELS: UTMChannel[] = [
  { key: "wechat_group", label: "微信群", source: "wechat_group", medium: "mini_program", campaign: "event_recruit", content: "ops_link" },
  { key: "moments", label: "朋友圈", source: "moments", medium: "mini_program", campaign: "event_recruit", content: "ops_link" },
  { key: "xiaohongshu", label: "小红书", source: "xiaohongshu", medium: "mini_program", campaign: "event_recruit", content: "ops_link" },
  { key: "official_account", label: "公众号", source: "official_account", medium: "mini_program", campaign: "event_recruit", content: "ops_link" },
  { key: "huodongxing", label: "活动行", source: "huodongxing", medium: "mini_program", campaign: "event_recruit", content: "ops_link" },
  { key: "guest_share", label: "嘉宾转发", source: "guest_share", medium: "mini_program", campaign: "event_recruit", content: "ops_link" },
  { key: "community_partner", label: "社群合作", source: "community_partner", medium: "mini_program", campaign: "event_recruit", content: "ops_link" },
  { key: "partner", label: "合作方", source: "partner", medium: "mini_program", campaign: "event_recruit", content: "ops_link" },
];

export function buildMiniProgramEventPath(eventId: string, channel?: UTMChannel, options: MiniProgramPathOptions = {}) {
  const params = new URLSearchParams({ eventId });
  if (channel) {
    const content = utmPartOr(options.content, channel.content);
    const referrer = utmPartOr(options.referrer, "studio_operations");
    params.set("utm_source", channel.source);
    params.set("utm_medium", channel.medium);
    params.set("utm_campaign", channel.campaign);
    params.set("utm_content", content);
    params.set("channel", channel.source);
    params.set("referrer", referrer);
  }
  return `/pages/event-detail/index?${params.toString()}`;
}

export function findUTMChannel(key: string) {
  return UTM_CHANNELS.find((channel) => channel.key === key);
}

export function buildMiniProgramPathSheet(eventId: string, options: MiniProgramPathOptions = {}) {
  const referrer = utmPartOr(options.referrer, "studio_operations");
  const rows = [
    ["渠道", "utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer", "小程序路径"],
    ...UTM_CHANNELS.map((channel) => {
      const content = utmPartOr(options.content, channel.content);
      return [
        channel.label,
        channel.source,
        channel.medium,
        channel.campaign,
        content,
        referrer,
        buildMiniProgramEventPath(eventId, channel, { content, referrer }),
      ];
    }),
  ];
  return rows.map((row) => row.join("\t")).join("\n");
}

export function cleanUTMPart(value = "") {
  return value.trim().replace(/\s+/g, "_").slice(0, 64);
}

function utmPartOr(value: string | undefined, fallback: string) {
  return cleanUTMPart(value || "") || cleanUTMPart(fallback);
}
