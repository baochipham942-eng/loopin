// 活动详情页：从后端拉真实活动（无 eventId 则取最新一条）。
const app = getApp();
const { appendAttribution, attributionQuery, pickAttribution, shareAttribution, withSceneParams } = require("../../utils/attribution");
const { logAttributionEvent } = require("../../utils/tracking");

function fmtDate(iso) {
  const d = new Date(iso);
  const w = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${w} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function listOr(value, fallback) {
  return Array.isArray(value) && value.length ? value : fallback;
}

const REGISTRATION_STATUS = {
  submitted: "待确认",
  approved: "已报名",
  checked_in: "已签到",
  waitlisted: "候补中",
  rejected: "未通过",
  cancelled: "已取消",
};

function registrationText(item) {
  if (!item) return "";
  if (item.status === "waitlisted" && item.waitlistPosition) return `候补中 · 第 ${item.waitlistPosition} 位`;
  return REGISTRATION_STATUS[item.status] || item.status;
}

function currentRegistration(items, eventId) {
  const matched = (items || []).filter((item) => item.eventId === eventId);
  return matched.find((item) => item.status !== "cancelled" && item.status !== "rejected") || matched[0] || null;
}

function registrationView(item) {
  if (!item) return null;
  return {
    ...item,
    statusText: registrationText(item),
    canRegister: item.status === "cancelled" || item.status === "rejected",
  };
}

Page({
  data: {
    loading: true,
    event: null,
    ticketType: null,
    available: null,
    highlights: ["和同频的人面对面", "一线讲师真实分享", "现场组队 & 连接"],
    agenda: [],
    faq: [],
    socialFeatured: [],
    socialAttendees: [],
    interestSeed: null,
    subscribing: false,
    subscriptionText: "",
    registration: null,
    cancelling: false,
    attribution: {},
  },

  onLoad(query) {
    const resolvedQuery = withSceneParams(query);
    const attribution = pickAttribution(resolvedQuery);
    this.setData({ attribution });
    if (resolvedQuery.eventId) {
      this.loadEvent(resolvedQuery.eventId);
    } else {
      wx.request({
        url: app.globalData.apiBase + "/events",
        success: (res) => {
          const list = (res.data && res.data.events) || [];
          if (!list.length) { this.setData({ loading: false }); return; }
          this.loadEvent(list[0].id);
        },
        fail: () => this.fail(),
      });
    }
  },

  onShow() {
    if (this.data.event && this.data.event.id) this.loadRegistrationStatus(this.data.event.id);
  },

  loadEvent(eventId) {
    wx.request({
      url: app.globalData.apiBase + "/events/" + eventId,
      success: (res) => {
        const d = res.data || {};
        if (!d.event) { this.setData({ loading: false }); return; }
        const ticket = (d.ticketTypes || [])[0] || null;
        const quotaId = ticket && d.availability ? Object.keys(d.availability)[0] : null;
        const available = quotaId ? d.availability[quotaId] : null;
        const page = d.page || {};
        this.setData({
          loading: false,
          event: {
            id: d.event.id,
            title: d.event.title,
            startText: fmtDate(d.event.startAt),
            city: d.event.city,
            venue: d.event.venue || d.event.city,
            organizer: d.event.organizer,
            organizerId: d.event.organizerId || "",
            hostBio: (d.event.hostProfile && d.event.hostProfile.bio) || "",
            priceText: ticket ? (ticket.kind === "approval" ? "审核票" : ticket.priceCents === 0 ? "免费" : "¥" + (ticket.priceCents / 100)) : "—",
            latitude: d.event.latitude || null,
            longitude: d.event.longitude || null,
          },
          ticketType: ticket,
          available,
          highlights: listOr(page.highlights, ["和同频的人面对面", "一线讲师真实分享", "现场组队 & 连接"]),
          agenda: listOr(page.agenda, []),
          faq: listOr(page.faq, []),
        });
        logAttributionEvent("event_detail_view", {
          eventId,
          path: "/pages/event-detail/index",
          attribution: this.data.attribution,
        });
        this.loadSocial(eventId);
        this.loadRegistrationStatus(eventId);
      },
      fail: () => this.fail(),
    });
  },

  loadRegistrationStatus(eventId) {
    const userId = app.ensureUserId();
    wx.request({
      url: app.globalData.apiBase + "/users/" + userId + "/registrations",
      success: (res) => {
        const item = currentRegistration((res.data && res.data.items) || [], eventId);
        this.setData({ registration: registrationView(item) });
      },
    });
  },

  loadSocial(eventId) {
    wx.request({
      url: app.globalData.apiBase + "/events/" + eventId + "/social",
      success: (res) => {
        const d = res.data || {};
        this.setData({
          socialFeatured: ((d.featured || [])).map((item) => ({ ...item, initial: (item.name || "?").slice(0, 1) })),
          socialAttendees: d.attendees || [],
          interestSeed: d.interestSeed || null,
        });
      },
    });
  },

  subscribeInterest() {
    if (!this.data.interestSeed || this.data.subscribing) return;
    this.setData({ subscribing: true });
    wx.request({
      url: app.globalData.apiBase + "/users/" + app.ensureUserId() + "/interest-subscriptions",
      method: "POST",
      data: { ...this.data.interestSeed, sourceEventId: this.data.event.id },
      success: (res) => {
        if (res.statusCode >= 400) {
          wx.showToast({ title: "订阅失败", icon: "none" });
          return;
        }
        this.setData({ subscriptionText: "已订阅" });
        wx.showToast({ title: "已订阅", icon: "none" });
      },
      fail: () => wx.showToast({ title: "订阅失败", icon: "none" }),
      complete: () => this.setData({ subscribing: false }),
    });
  },

  fail() {
    this.setData({ loading: false });
    wx.showToast({ title: "加载失败，确认 API 已启动", icon: "none" });
  },

  goRegister() {
    if (!this.data.event || !this.data.ticketType) return;
    if (this.data.registration && !this.data.registration.canRegister) {
      wx.showToast({ title: this.data.registration.statusText, icon: "none" });
      return;
    }
    logAttributionEvent("registration_intent", {
      eventId: this.data.event.id,
      path: "/pages/event-detail/index",
      attribution: this.data.attribution,
      metadata: { ticketTypeId: this.data.ticketType.id },
    });
    wx.navigateTo({
      url: appendAttribution(
        `/pages/register/index?eventId=${this.data.event.id}&ticketTypeId=${this.data.ticketType.id}`,
        this.data.attribution
      ),
    });
  },

  cancelRegistration() {
    const registration = this.data.registration;
    if (!registration || !registration.canCancel || this.data.cancelling) return;
    wx.showModal({
      title: "取消报名",
      content: "确认取消这次报名？",
      confirmText: "取消报名",
      confirmColor: "#e85d75",
      success: (modal) => {
        if (!modal.confirm) return;
        this.setData({ cancelling: true });
        wx.request({
          url: app.globalData.apiBase + "/users/" + app.ensureUserId() + "/registrations/" + registration.registrationId + "/cancel",
          method: "POST",
          success: (res) => {
            if (res.statusCode >= 400) {
              wx.showToast({ title: (res.data && res.data.message) || "取消失败", icon: "none" });
              return;
            }
            wx.showToast({ title: "已取消", icon: "none" });
            this.loadEvent(this.data.event.id);
          },
          fail: () => wx.showToast({ title: "取消失败", icon: "none" }),
          complete: () => this.setData({ cancelling: false }),
        });
      },
    });
  },

  openOrganizer() {
    const event = this.data.event || {};
    if (!event.organizerId) return;
    wx.navigateTo({
      url: appendAttribution("/pages/organizer/index?organizerId=" + event.organizerId, this.data.attribution),
    });
  },

  openLocation() {
    const event = this.data.event || {};
    const name = event.venue || event.city || "活动地点";
    const address = [event.city, event.venue].filter(Boolean).join(" · ") || name;
    const latitude = Number(event.latitude);
    const longitude = Number(event.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      wx.openLocation({ latitude, longitude, name, address, scale: 16 });
      return;
    }
    wx.setClipboardData({
      data: address,
      success: () => wx.showToast({ title: "地点已复制", icon: "none" }),
    });
  },
  onShareAppMessage() {
    const event = this.data.event || {};
    return {
      title: event.title || "Loopin 活动",
      path: appendAttribution(
        event.id ? "/pages/event-detail/index?eventId=" + event.id : "/pages/events/index",
        shareAttribution(this.data.attribution, "wechat_share")
      ),
    };
  },
  onShareTimeline() {
    const event = this.data.event || {};
    return {
      title: event.title || "Loopin 活动",
      query: attributionTimelineQuery(event.id, this.data.attribution),
    };
  },
});

function attributionTimelineQuery(eventId, attribution) {
  const base = eventId ? "eventId=" + encodeURIComponent(eventId) : "";
  const tracking = attributionQuery(shareAttribution(attribution, "wechat_timeline"));
  return [base, tracking].filter(Boolean).join("&");
}
