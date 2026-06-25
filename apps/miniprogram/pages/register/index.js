// 报名页（schema 驱动）：从后端拉表单 schema 动态渲染，
// 提交链路 = /api/form/validate（共享 core 校验）→ /api/register（预留/待审核）→ payment/prepare → mock complete / 微信支付回调确认。
const app = getApp();
const { mergeAttribution, pickAttribution, withSceneParams } = require("../../utils/attribution");
const { logAttributionEvent } = require("../../utils/tracking");

const MULTI_TYPES = ["multi_select", "profession_tag"];
const TEXT_TYPES = ["text", "company", "city", "wechat", "textarea"];
const IDENTITY_TYPES = ["profession_tag"];

Page({
  data: {
    eventId: "",
    ticketTypeId: "",
    schema: { fields: [] },
    values: {},
    labels: {}, // single_select 展示用
    ticketKind: "",
    submitting: false,
    loading: true,
    phoneFieldKey: "",
    authText: "正在准备微信登录…",
    attribution: {},
  },

  onLoad(query) {
    const resolvedQuery = withSceneParams(query);
    this.setData({
      eventId: resolvedQuery.eventId || "",
      ticketTypeId: resolvedQuery.ticketTypeId || "",
      attribution: pickAttribution(resolvedQuery),
    });
    app.loginWithWechat({ silent: true }).then(() => this.refreshAuthText());
    if (!resolvedQuery.eventId) { this.setData({ loading: false }); return; }
    wx.request({
      url: app.globalData.apiBase + "/events/" + resolvedQuery.eventId,
      success: (res) => {
        const d = res.data || {};
        // 给字段标注渲染分组，方便 wxml 用 boolean 分支
        const fields = ((d.formSchema && d.formSchema.fields) || []).map((f) => ({
          ...f,
          displayLabel: f.type === "profession_tag" ? "身份" : f.label,
          isText: TEXT_TYPES.indexOf(f.type) >= 0,
          isPhone: f.type === "phone",
          isNumber: f.type === "number",
          isSingle: f.type === "single_select",
          isIdentity: IDENTITY_TYPES.indexOf(f.type) >= 0,
          isMulti: MULTI_TYPES.indexOf(f.type) >= 0 && IDENTITY_TYPES.indexOf(f.type) < 0,
        }));
        const phoneField = fields.find((f) => f.type === "phone");
        const ticket = ((d.ticketTypes || []).find((t) => t.id === this.data.ticketTypeId)) || (d.ticketTypes || [])[0] || {};
        this.setData({ schema: { fields }, phoneFieldKey: phoneField ? phoneField.key : "", ticketKind: ticket.kind || "", loading: false });
        this.refreshAuthText();
      },
      fail: () => { this.setData({ loading: false }); wx.showToast({ title: "加载表单失败", icon: "none" }); },
    });
  },

  refreshAuthText() {
    const auth = app.globalData;
    const parts = [];
    parts.push(auth.openidBound ? "微信身份已绑定" : "开发期本地身份");
    if (auth.phoneBound && auth.maskedPhone) parts.push("手机号 " + auth.maskedPhone);
    this.setData({ authText: parts.join(" · ") });
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

  onSelectIdentity(e) {
    const { key, value } = e.currentTarget.dataset;
    this.setData({ values: { ...this.data.values, [key]: [value] } });
  },

  bindManualPhoneIfNeeded() {
    const phone = this.data.phoneFieldKey ? this.data.values[this.data.phoneFieldKey] : "";
    if (!phone || app.globalData.phoneBound) return Promise.resolve();
    return app.bindPhone({ phone }).then(() => this.refreshAuthText()).catch(() => undefined);
  },

  successUrl(status, extra = "") {
    const eventId = encodeURIComponent(this.data.eventId);
    return `/pages/register-success/index?status=${status}&eventId=${eventId}${extra}`;
  },

  completeMockPayment(base, orderId, request) {
    wx.request({
      url: base + "/orders/" + orderId + "/complete",
      method: "POST",
      data: { providerPayload: request },
      success: (cr) => {
        if (cr.statusCode === 409) {
          wx.showToast({ title: "手慢了，已售罄", icon: "none" });
          this.setData({ submitting: false });
          return;
        }
        const status = (cr.data && cr.data.registration && cr.data.registration.status) || "approved";
        wx.redirectTo({ url: this.successUrl(status) });
      },
      fail: () => this.fail(),
    });
  },

  waitPaymentStatus(base, orderId, attempt = 0) {
    wx.request({
      url: base + "/orders/" + orderId + "/payment/status",
      success: (res) => {
        const data = res.data || {};
        if (data.paymentStatus === "paid") {
          wx.redirectTo({ url: this.successUrl(data.registrationStatus || "approved") });
          return;
        }
        if (attempt < 5) {
          setTimeout(() => this.waitPaymentStatus(base, orderId, attempt + 1), 1200);
          return;
        }
        wx.redirectTo({ url: this.successUrl("paying") });
      },
      fail: () => wx.redirectTo({ url: this.successUrl("paying") }),
    });
  },

  requestWechatPayment(base, orderId, request) {
    wx.requestPayment({
      timeStamp: request.timeStamp,
      nonceStr: request.nonceStr,
      package: request.package,
      signType: request.signType || "RSA",
      paySign: request.paySign,
      success: () => this.waitPaymentStatus(base, orderId),
      fail: () => {
        wx.showToast({ title: "未完成支付", icon: "none" });
        this.setData({ submitting: false });
      },
    });
  },

  submit() {
    if (this.data.submitting) return;
    if (!this.data.eventId || !this.data.ticketTypeId) {
      wx.showToast({ title: "缺少活动信息", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    const base = app.globalData.apiBase;
    const values = mergeAttribution(this.data.values, this.data.attribution);
    logAttributionEvent("registration_submit", {
      eventId: this.data.eventId,
      path: "/pages/register/index",
      attribution: values,
      metadata: { ticketTypeId: this.data.ticketTypeId },
    });

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
        this.bindManualPhoneIfNeeded();
        // 2) 预留
        wx.request({
          url: base + "/register",
          method: "POST",
          data: { eventId: this.data.eventId, ticketTypeId: this.data.ticketTypeId, userId: app.ensureUserId(), formValues: values },
          success: (rr) => {
            if (rr.statusCode === 409) {
              wx.showToast({ title: "手慢了，已售罄", icon: "none" });
              this.setData({ submitting: false });
              return;
            }
            if (rr.data && rr.data.status === "waitlisted") {
              const position = rr.data.waitlist && rr.data.waitlist.position ? rr.data.waitlist.position : "";
              wx.redirectTo({ url: this.successUrl("waitlisted", "&position=" + position) });
              return;
            }
            const orderId = rr.data && rr.data.orderId;
            if (!orderId) { this.fail(); return; }
            if (rr.data && (rr.data.requiresApproval || this.data.ticketKind === "approval")) {
              wx.redirectTo({ url: this.successUrl("submitted") });
              return;
            }
            // 3) 支付准备：mock 直接 complete；微信支付由回调确认，客户端只负责调起支付和轮询状态。
            wx.request({
              url: base + "/orders/" + orderId + "/payment/prepare",
              method: "POST",
              data: {},
              success: (pr) => {
                if (pr.statusCode >= 400) { this.fail(); return; }
                const request = (pr.data && pr.data.request) || {};
                if (request.mode === "wechatpay") {
                  this.requestWechatPayment(base, orderId, request);
                  return;
                }
                this.completeMockPayment(base, orderId, request);
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
