// 报名页（schema 驱动）：从后端拉表单 schema 动态渲染，
// 提交链路 = /api/form/validate（共享 core 校验）→ /api/register（预留）→ /api/orders/:id/complete（mock 成交）。
const app = getApp();

const MULTI_TYPES = ["multi_select", "profession_tag"];
const TEXT_TYPES = ["text", "company", "city", "wechat", "textarea"];

Page({
  data: {
    eventId: "",
    ticketTypeId: "",
    schema: { fields: [] },
    values: {},
    labels: {}, // single_select 展示用
    submitting: false,
    loading: true,
  },

  onLoad(query) {
    this.setData({ eventId: query.eventId || "", ticketTypeId: query.ticketTypeId || "" });
    if (!query.eventId) { this.setData({ loading: false }); return; }
    wx.request({
      url: app.globalData.apiBase + "/events/" + query.eventId,
      success: (res) => {
        const d = res.data || {};
        // 给字段标注渲染分组，方便 wxml 用 boolean 分支
        const fields = ((d.formSchema && d.formSchema.fields) || []).map((f) => ({
          ...f,
          isText: TEXT_TYPES.indexOf(f.type) >= 0,
          isPhone: f.type === "phone",
          isNumber: f.type === "number",
          isSingle: f.type === "single_select",
          isMulti: MULTI_TYPES.indexOf(f.type) >= 0,
        }));
        this.setData({ schema: { fields }, loading: false });
      },
      fail: () => { this.setData({ loading: false }); wx.showToast({ title: "加载表单失败", icon: "none" }); },
    });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ values: { ...this.data.values, [key]: e.detail.value } });
  },
  onPick(e) {
    const key = e.currentTarget.dataset.key;
    const field = this.data.schema.fields.find((f) => f.key === key);
    const opt = field.options[e.detail.value];
    this.setData({
      values: { ...this.data.values, [key]: opt.value },
      labels: { ...this.data.labels, [key]: opt.label },
    });
  },
  // 多选 chip 切换
  onToggle(e) {
    const { key, value } = e.currentTarget.dataset;
    const cur = Array.isArray(this.data.values[key]) ? this.data.values[key].slice() : [];
    const i = cur.indexOf(value);
    if (i >= 0) cur.splice(i, 1); else cur.push(value);
    this.setData({ values: { ...this.data.values, [key]: cur } });
  },

  submit() {
    if (this.data.submitting) return;
    if (!this.data.eventId || !this.data.ticketTypeId) {
      wx.showToast({ title: "缺少活动信息", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    const base = app.globalData.apiBase;
    const values = this.data.values;

    // 1) 校验（共享 core）
    wx.request({
      url: base + "/form/validate",
      method: "POST",
      data: { schema: this.data.schema, values },
      success: (res) => {
        const r = res.data || {};
        if (!r.ok) {
          const first = r.errors ? Object.values(r.errors)[0] : "请检查填写";
          wx.showToast({ title: first, icon: "none" });
          this.setData({ submitting: false });
          return;
        }
        // 2) 预留
        wx.request({
          url: base + "/register",
          method: "POST",
          data: { eventId: this.data.eventId, ticketTypeId: this.data.ticketTypeId, formValues: values },
          success: (rr) => {
            if (rr.statusCode === 409) {
              wx.showToast({ title: "手慢了，已售罄", icon: "none" });
              this.setData({ submitting: false });
              return;
            }
            const orderId = rr.data && rr.data.orderId;
            if (!orderId) { this.fail(); return; }
            // 3) 成交（MVP mock 付款）
            wx.request({
              url: base + "/orders/" + orderId + "/complete",
              method: "POST",
              success: (cr) => {
                if (cr.statusCode === 409) {
                  wx.showToast({ title: "手慢了，已售罄", icon: "none" });
                  this.setData({ submitting: false });
                  return;
                }
                const status = (cr.data && cr.data.registration && cr.data.registration.status) || "approved";
                wx.redirectTo({ url: "/pages/register-success/index?status=" + status });
              },
              fail: () => this.fail(),
            });
          },
          fail: () => this.fail(),
        });
      },
      fail: () => this.fail(),
    });
  },

  fail() {
    wx.showToast({ title: "网络异常，确认 API 已启动", icon: "none" });
    this.setData({ submitting: false });
  },
});
