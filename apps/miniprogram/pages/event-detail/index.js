// 活动详情页：从后端拉真实活动（无 eventId 则取最新一条）。
const app = getApp();

function fmtDate(iso) {
  const d = new Date(iso);
  const w = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${w} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

Page({
  data: {
    loading: true,
    event: null,
    ticketType: null,
    available: null,
    // EventPage（AI Designer）还没做，先用占位文案
    highlights: ["和同频的人面对面", "一线讲师真实分享", "现场组队 & 连接"],
  },

  onLoad(query) {
    if (query.eventId) {
      this.loadEvent(query.eventId);
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

  loadEvent(eventId) {
    wx.request({
      url: app.globalData.apiBase + "/events/" + eventId,
      success: (res) => {
        const d = res.data || {};
        if (!d.event) { this.setData({ loading: false }); return; }
        const ticket = (d.ticketTypes || [])[0] || null;
        const quotaId = ticket && d.availability ? Object.keys(d.availability)[0] : null;
        const available = quotaId ? d.availability[quotaId] : null;
        this.setData({
          loading: false,
          event: {
            id: d.event.id,
            title: d.event.title,
            startText: fmtDate(d.event.startAt),
            venue: d.event.venue || d.event.city,
            organizer: d.event.organizer,
            priceText: ticket ? (ticket.priceCents === 0 ? "免费" : "¥" + (ticket.priceCents / 100)) : "—",
          },
          ticketType: ticket,
          available,
        });
      },
      fail: () => this.fail(),
    });
  },

  fail() {
    this.setData({ loading: false });
    wx.showToast({ title: "加载失败，确认 API 已启动", icon: "none" });
  },

  goRegister() {
    if (!this.data.event || !this.data.ticketType) return;
    wx.navigateTo({
      url: `/pages/register/index?eventId=${this.data.event.id}&ticketTypeId=${this.data.ticketType.id}`,
    });
  },
});
