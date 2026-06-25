const ATTRIBUTION_KEYS = [
  "source",
  "channel",
  "referrer",
  "from",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_id",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
  "utmId",
];

const CAMEL_TO_SNAKE = {
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmContent: "utm_content",
  utmTerm: "utm_term",
  utmId: "utm_id",
};

function cleanValue(value) {
  if (Array.isArray(value)) value = value[0];
  if (value === undefined || value === null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw.replace(/\+/g, "%20")).trim().slice(0, 120);
  } catch {
    return raw.slice(0, 120);
  }
}

function parseQueryText(value) {
  const text = cleanValue(value).replace(/^\?/, "");
  if (!text || text.indexOf("=") < 0) return {};
  return text.split(/[&;]/).reduce((acc, pair) => {
    const parts = pair.split("=");
    const key = cleanValue(parts.shift());
    const val = cleanValue(parts.join("="));
    if (key && val) acc[key] = val;
    return acc;
  }, {});
}

function withSceneParams(query) {
  const raw = query || {};
  return { ...parseQueryText(raw.scene), ...raw };
}

function pickAttribution(query) {
  const merged = withSceneParams(query);
  const picked = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = cleanValue(merged[key]);
    if (value) picked[CAMEL_TO_SNAKE[key] || key] = value;
  }
  const channel = cleanValue(picked.channel || picked.utm_source || picked.source || picked.from);
  if (channel && !picked.channel) picked.channel = channel;
  return picked;
}

function mergeAttribution(values, attribution) {
  const merged = { ...(values || {}) };
  const picked = pickAttribution(attribution);
  for (const key of Object.keys(picked)) {
    if (merged[key] === undefined || merged[key] === "") merged[key] = picked[key];
  }
  return merged;
}

function attributionQuery(attribution) {
  const picked = pickAttribution(attribution);
  return ATTRIBUTION_KEYS
    .map((key) => CAMEL_TO_SNAKE[key] || key)
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .filter((key) => picked[key])
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(picked[key])}`)
    .join("&");
}

function appendAttribution(path, attribution) {
  const query = attributionQuery(attribution);
  if (!query) return path;
  return path + (path.indexOf("?") >= 0 ? "&" : "?") + query;
}

function shareAttribution(attribution, source) {
  const picked = pickAttribution(attribution);
  if (!picked.utm_source && !picked.channel && !picked.source) picked.utm_source = source;
  if (!picked.utm_medium) picked.utm_medium = "mini_program";
  if (!picked.utm_campaign) picked.utm_campaign = "event_share";
  if (!picked.channel) picked.channel = picked.utm_source || source;
  return picked;
}

module.exports = {
  appendAttribution,
  attributionQuery,
  mergeAttribution,
  pickAttribution,
  shareAttribution,
  withSceneParams,
};
