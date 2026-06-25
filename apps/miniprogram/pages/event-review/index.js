const app = getApp();

function fmtDate(iso) {
  const d = new Date(iso);
  const w = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${w} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function yuan(cents) {
  if (cents === null || cents === undefined) return "—";
  const sign = cents < 0 ? "-¥" : "¥";
  return sign + Math.abs(cents / 100).toFixed(0);
}

Page({
  data: {
    loading: true,
    eventId: "",
    event: null,
    metrics: null,
    takeaways: [],
    nextActions: [],
    audience: null,
    growth: null,
    resourcePack: [],
    feedback: null,
    feedbackForm: {
      rating: 5,
      valuable: "",
      nextTopic: "",
      roleInterest: "愿意继续参加",
      note: "",
    },
    roleOptions: ["愿意继续参加", "愿意作为嘉宾", "愿意成为赞助/合作方", "愿意做志愿者", "暂时只看复盘"],
    ratingOptions: [1, 2, 3, 4, 5],
    feedbackSubmitting: false,
    feedbackSubmitted: false,
    nextTopics: [],
  },

  onLoad(query) {
    const eventId = query.eventId || "";
    this.setData({ eventId });
    if (!eventId) {
      this.setData({ loading: false });
      return;
    }
    this.load();
  },

  load() {
    wx.request({
      url: app.globalData.apiBase + "/events/" + this.data.eventId + "/review",
      success: (res) => {
        const data = res.data || {};
        const metrics = data.metrics || {};
        this.setData({
          loading: false,
          event: data.event ? { ...data.event, startText: fmtDate(data.event.startAt) } : null,
          metrics: {
            ...metrics,
            showUpText: metrics.showUpRate === null || metrics.showUpRate === undefined ? "—" : metrics.showUpRate + "%",
            conversionText: metrics.conversionRate === null || metrics.conversionRate === undefined ? "—" : metrics.conversionRate + "%",
            profitText: yuan(metrics.estimatedProfitCents),
            revenueText: yuan(metrics.revenueCents),
          },
          takeaways: data.takeaways || [],
          nextActions: data.nextActions || [],
          audience: data.audience || null,
          growth: data.growth || null,
          resourcePack: data.resourcePack || [],
          feedback: data.feedback || null,
          nextTopics: (data.nextTopics || []).map((topic) => ({
            ...topic,
            priceText: yuan(topic.suggestedPriceCents),
            breakEvenText: topic.breakEvenAttendees === null || topic.breakEvenAttendees === undefined ? "—" : topic.breakEvenAttendees + " 人",
          })),
        });
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: "复盘加载失败", icon: "none" });
      },
    });
  },

  setRating(e) {
    const rating = Number(e.currentTarget.dataset.rating || 5);
    this.setData({ "feedbackForm.rating": rating });
  },

  onFeedbackInput(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    this.setData({ ["feedbackForm." + key]: e.detail.value });
  },

  onRoleChange(e) {
    const index = Number(e.detail.value || 0);
    const roleInterest = this.data.roleOptions[index] || this.data.roleOptions[0];
    this.setData({ "feedbackForm.roleInterest": roleInterest });
  },

  submitFeedback() {
    if (this.data.feedbackSubmitting || !this.data.eventId) return;
    const form = this.data.feedbackForm;
    if (!form.valuable && !form.nextTopic && !form.roleInterest) {
      wx.showToast({ title: "先写一点反馈", icon: "none" });
      return;
    }
    this.setData({ feedbackSubmitting: true });
    app.post("/events/" + this.data.eventId + "/feedback", {
      userId: app.ensureUserId(),
      rating: form.rating,
      valuable: form.valuable,
      nextTopic: form.nextTopic,
      roleInterest: form.roleInterest,
      note: form.note,
    })
      .then(() => {
        wx.showToast({ title: "已提交", icon: "success" });
        this.setData({ feedbackSubmitting: false, feedbackSubmitted: true });
        this.load();
      })
      .catch(() => {
        this.setData({ feedbackSubmitting: false });
        wx.showToast({ title: "反馈提交失败", icon: "none" });
      });
  },

  openEvent() {
    if (!this.data.eventId) return;
    wx.navigateTo({ url: "/pages/event-detail/index?eventId=" + this.data.eventId });
  },

  goMy() {
    wx.switchTab({ url: "/pages/my/index" });
  },

  copyScript(e) {
    const text = e.currentTarget.dataset.copy || "";
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: "话术已复制", icon: "success" }),
    });
  },

  copyResource(e) {
    const url = e.currentTarget.dataset.url || "";
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: "资料链接已复制", icon: "success" }),
    });
  },
});
