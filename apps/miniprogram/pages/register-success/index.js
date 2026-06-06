Page({
  data: { statusText: "报名已提交" },
  onLoad(q) {
    const map = {
      submitted: "报名已提交，等待主办方确认",
      approved: "报名成功，已通过审核 🎉",
      waitlisted: "已加入候补名单",
    };
    this.setData({ statusText: map[q.status] || "报名已提交" });
  },
  backHome() {
    wx.navigateBack({ delta: 2 });
  },
});
