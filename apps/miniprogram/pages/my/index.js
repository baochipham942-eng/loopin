const app = getApp();

function fmtDate(iso) {
  const d = new Date(iso);
  const w = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${w} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const STATUS = {
  submitted: "待确认",
  approved: "已报名",
  checked_in: "已签到",
  waitlisted: "候补中",
  rejected: "未通过",
  cancelled: "已取消",
};

Page({
  data: {
    loading: true,
    feedLoading: true,
    items: [],
    feed: { subscriptions: [], events: [], people: [] },
  },

  onShow() {
    this.syncTabBar();
    this.load();
    this.loadFeed();
  },

  syncTabBar() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
  },

  load() {
    const userId = app.ensureUserId();
    this.setData({ loading: true });
    wx.request({
      url: app.globalData.apiBase + "/users/" + userId + "/registrations",
      success: (res) => {
        const items = ((res.data && res.data.items) || []).map((item) => ({
          ...item,
          startText: fmtDate(item.startAt),
          statusText: item.status === "waitlisted" && item.waitlistPosition ? `候补中 · 第 ${item.waitlistPosition} 位` : STATUS[item.status] || item.status,
          priceText: item.amountCents === null ? "—" : item.amountCents === 0 ? "免费" : "¥" + (item.amountCents / 100),
          checkinShortCode: item.checkinToken ? item.checkinToken.slice(0, 8).toUpperCase() : "",
          reviewText: item.ended ? "看复盘" : "活动进度",
        }));
        this.setData({ loading: false, items });
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: "加载失败，确认 API 已启动", icon: "none" });
      },
    });
  },

  loadFeed() {
    const userId = app.ensureUserId();
    this.setData({ feedLoading: true });
    wx.request({
      url: app.globalData.apiBase + "/users/" + userId + "/interest-feed",
      success: (res) => {
        const feed = res.data || { subscriptions: [], events: [], people: [] };
        this.setData({
          feedLoading: false,
          feed: {
            subscriptions: feed.subscriptions || [],
            events: (feed.events || []).map((event) => ({
              ...event,
              startText: fmtDate(event.startAt),
              priceText: event.minPriceCents === 0 ? "免费" : "¥" + (event.minPriceCents / 100),
            })),
            people: feed.people || [],
          },
        });
      },
      fail: () => this.setData({ feedLoading: false, feed: { subscriptions: [], events: [], people: [] } }),
    });
  },

  openEvent(e) {
    wx.navigateTo({ url: "/pages/event-detail/index?eventId=" + e.currentTarget.dataset.eventId });
  },

  goEvents() {
    wx.switchTab({ url: "/pages/events/index" });
  },

  cancelRegistration(e) {
    const registrationId = e.currentTarget.dataset.registrationId;
    if (!registrationId) return;
    wx.showModal({
      title: "取消报名",
      content: "确认取消这次报名？",
      confirmText: "取消报名",
      confirmColor: "#e85d75",
      success: (modal) => {
        if (!modal.confirm) return;
        wx.request({
          url: app.globalData.apiBase + "/users/" + app.ensureUserId() + "/registrations/" + registrationId + "/cancel",
          method: "POST",
          success: (res) => {
            if (res.statusCode >= 400) {
              wx.showToast({ title: (res.data && res.data.message) || "取消失败", icon: "none" });
              return;
            }
            wx.showToast({ title: "已取消", icon: "none" });
            this.load();
          },
          fail: () => wx.showToast({ title: "取消失败", icon: "none" }),
        });
      },
    });
  },

  copyCheckin(e) {
    const payload = e.currentTarget.dataset.payload;
    if (!payload) return;
    wx.setClipboardData({
      data: payload,
      success: () => wx.showToast({ title: "核验码已复制", icon: "none" }),
    });
  },

  openReview(e) {
    const eventId = e.currentTarget.dataset.eventId;
    if (!eventId) return;
    wx.navigateTo({ url: "/pages/event-review/index?eventId=" + eventId });
  },
});
