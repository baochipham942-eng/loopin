const app = getApp();

Page({
  data: {
    statusText: "报名已提交",
    eventId: "",
    notifyReady: false,
    notifySubscribing: false,
    notifyText: "",
  },
  onLoad(q) {
    const map = {
      submitted: "报名已提交，等待主办方确认",
      approved: "报名成功，已通过审核 🎉",
      paying: "支付已发起，等待微信确认",
      waitlisted: q.position ? `已加入候补名单，当前第 ${q.position} 位` : "已加入候补名单",
    };
    const eventId = q.eventId || "";
    this.setData({ statusText: map[q.status] || "报名已提交", eventId });
    app.loadNotificationConfig().then((config) => {
      const ready = !!(config && config.enabled && config.templates && config.templates.eventReminder);
      this.setData({
        notifyReady: ready,
        notifyText: ready ? "" : "活动提醒模板待配置",
      });
    });
  },
  backHome() {
    if (this.data.eventId) {
      wx.redirectTo({ url: "/pages/event-detail/index?eventId=" + this.data.eventId });
      return;
    }
    wx.switchTab({ url: "/pages/events/index" });
  },
  goMy() {
    wx.switchTab({ url: "/pages/my/index" });
  },
  subscribeReminder() {
    if (this.data.notifySubscribing) return;
    this.setData({ notifySubscribing: true, notifyText: "" });
    app.requestEventReminder(this.data.eventId)
      .then((result) => {
        if (!result.configured) {
          this.setData({ notifyReady: false, notifyText: "活动提醒模板待配置" });
          wx.showToast({ title: "通知模板待配置", icon: "none" });
          return;
        }
        if (!result.supported) {
          this.setData({ notifyText: "当前微信版本不支持订阅消息" });
          wx.showToast({ title: "当前微信版本不支持订阅", icon: "none" });
          return;
        }
        if (result.accepted) {
          this.setData({ notifyText: result.saved ? "已开启活动提醒" : "已授权，提醒状态稍后同步" });
          wx.showToast({ title: "已开启提醒", icon: "success" });
          return;
        }
        this.setData({ notifyText: "未开启活动提醒" });
        wx.showToast({ title: "未开启提醒", icon: "none" });
      })
      .catch(() => {
        this.setData({ notifyText: "提醒授权失败，请稍后再试" });
        wx.showToast({ title: "提醒授权失败", icon: "none" });
      })
      .finally(() => this.setData({ notifySubscribing: false }));
  },
});
