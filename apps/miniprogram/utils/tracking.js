const { pickAttribution } = require("./attribution");

function logAttributionEvent(type, options = {}) {
  const app = getApp();
  const apiBase = app && app.globalData && app.globalData.apiBase;
  if (!apiBase || !type) return;
  const attribution = pickAttribution(options.attribution || {});
  wx.request({
    url: apiBase + "/attribution/events",
    method: "POST",
    data: {
      type,
      eventId: options.eventId || "",
      registrationId: options.registrationId || "",
      userId: typeof app.ensureUserId === "function" ? app.ensureUserId() : "",
      path: options.path || "",
      attribution,
      metadata: options.metadata || {},
    },
    fail: () => undefined,
  });
}

module.exports = {
  logAttributionEvent,
};
