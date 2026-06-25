const app = getApp();
const { appendAttribution, pickAttribution, withSceneParams } = require("../../utils/attribution");
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
  return "¥" + cents / 100;
}

function normalizeLinks(links) {
  if (Array.isArray(links)) {
    return links.filter((item) => item && item.url).map((item) => ({ label: item.label || item.url, url: item.url }));
  }
  if (links && typeof links === "object") {
    return Object.keys(links).map((label) => ({ label, url: String(links[label]) })).filter((item) => item.url);
  }
  return [];
}

Page({
  data: {
    loading: true,
    organizerId: "",
    organizer: null,
    hostProfile: null,
    links: [],
    events: [],
    attribution: {},
  },

  onLoad(query) {
    const attribution = pickAttribution(withSceneParams(query));
    const organizerId = query.organizerId || "";
    this.setData({ attribution, organizerId });
    if (organizerId) this.loadOrganizer(organizerId);
    else this.setData({ loading: false });
  },

  onPullDownRefresh() {
    if (this.data.organizerId) this.loadOrganizer(this.data.organizerId, () => wx.stopPullDownRefresh());
    else wx.stopPullDownRefresh();
  },

  loadOrganizer(id, done) {
    this.setData({ loading: true });
    wx.request({
      url: app.globalData.apiBase + "/organizers/" + id + "/public",
      success: (res) => {
        const d = res.data || {};
        if (!d.organizer) {
          this.setData({ loading: false });
          wx.showToast({ title: "主办方不存在", icon: "none" });
          return;
        }
        const hostProfile = d.hostProfile || null;
        const links = normalizeLinks(hostProfile && hostProfile.links);
        const events = (d.events || []).map((event) => ({
          ...event,
          dateText: fmtDate(event.startAt),
          timeText: fmtTime(event.startAt),
          priceText: fmtPrice(event.minPriceCents),
          placeText: event.venue || event.city || "地点待定",
        }));
        this.setData({ loading: false, organizer: d.organizer, hostProfile, links, events });
        wx.setNavigationBarTitle({ title: d.organizer.name });
        logAttributionEvent("organizer_view", {
          organizerId: id,
          path: "/pages/organizer/index",
          attribution: this.data.attribution,
        });
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

  copyLink(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({ data: url, success: () => wx.showToast({ title: "链接已复制", icon: "none" }) });
  },
});
