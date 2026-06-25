Component({
  data: {
    selected: 0,
    tabs: [
      { key: "events", text: "活动", pagePath: "/pages/events/index" },
      { key: "my", text: "我的", pagePath: "/pages/my/index" },
    ],
  },
  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.tabs[index];
      if (!item || index === this.data.selected) return;
      wx.switchTab({ url: item.pagePath });
    },
  },
});
