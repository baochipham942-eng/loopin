const app = getApp();
const { appendAttribution, attributionQuery, pickAttribution, shareAttribution, withSceneParams } = require("../../utils/attribution");
const { logAttributionEvent } = require("../../utils/tracking");

function fmtDate(iso) {
  const d = new Date(iso);
  const w = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${w}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtPrice(cents) {
  if (cents === 0) return "免费";
  if (typeof cents !== "number") return "—";
  return "¥" + (cents / 100);
}

Page({
  data: {
    loading: true,
    events: [],
    attribution: {},
  },

  onLoad(query) {
    const attribution = pickAttribution(withSceneParams(query));
    this.setData({ attribution });
    logAttributionEvent("event_list_view", {
      path: "/pages/events/index",
      attribution,
    });
  },

  onShow() {
    this.syncTabBar();
    this.loadEvents();
  },

  syncTabBar() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 });
    }
  },

  onPullDownRefresh() {
    this.loadEvents(() => wx.stopPullDownRefresh());
  },

  loadEvents(done) {
    this.setData({ loading: true });
    wx.request({
      url: app.globalData.apiBase + "/events",
      success: (res) => {
        const events = ((res.data && res.data.events) || []).map((event) => ({
          ...event,
          dateText: fmtDate(event.startAt),
          timeText: fmtTime(event.startAt),
          priceText: fmtPrice(event.minPriceCents),
          placeText: event.venue || event.city || "地点待定",
        }));
        this.setData({ loading: false, events });
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: "加载失败，确认 API 已启动", icon: "none" });
      },
      complete: () => {
        if (typeof done === "function") done();
      },
    });
  },

  openEvent(e) {
    wx.navigateTo({
      url: appendAttribution("/pages/event-detail/index?eventId=" + e.currentTarget.dataset.eventId, this.data.attribution),
    });
  },

  onShareAppMessage() {
    return {
      title: "Loopin 活动",
      path: appendAttribution("/pages/events/index", shareAttribution(this.data.attribution, "wechat_share")),
    };
  },
  onShareTimeline() {
    return {
      title: "Loopin 活动",
      query: attributionQuery(shareAttribution(this.data.attribution, "wechat_timeline")),
    };
  },
});
