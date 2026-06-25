const LOCAL_API_BASE = "http://localhost:8787/api";
const PROD_API_BASE = "https://loopin.llmxy.xyz/api";

function resolveApiBase() {
  const override = wx.getStorageSync("loopinApiBase");
  if (override) return override;

  try {
    const envVersion = wx.getAccountInfoSync().miniProgram.envVersion;
    if (envVersion === "trial" || envVersion === "release") return PROD_API_BASE;
  } catch {
    // 开发者工具早期基础库可能拿不到 envVersion，默认走本地 API。
  }
  return LOCAL_API_BASE;
}

App({
  globalData: {
    apiBase: LOCAL_API_BASE,
    userId: "",
    authMode: "local",
    openidBound: false,
    phoneBound: false,
    maskedPhone: "",
    notificationConfig: null,
  },
  onLaunch() {
    this.globalData.apiBase = resolveApiBase();
    this.ensureUserId();
    this.loginWithWechat({ silent: true });
  },
  ensureUserId() {
    let userId = wx.getStorageSync("loopinUserId");
    if (!userId) {
      userId = "wx_local_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      wx.setStorageSync("loopinUserId", userId);
    }
    this.globalData.userId = userId;
    return userId;
  },
  setAuthState(auth) {
    if (!auth) return;
    if (auth.userId) {
      wx.setStorageSync("loopinUserId", auth.userId);
      this.globalData.userId = auth.userId;
    }
    this.globalData.authMode = auth.mode || this.globalData.authMode;
    this.globalData.openidBound = !!auth.openidBound;
    this.globalData.phoneBound = !!auth.phoneBound;
    this.globalData.maskedPhone = auth.maskedPhone || "";
  },
  post(path, data) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: this.globalData.apiBase + path,
        method: "POST",
        data,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data || {});
          } else {
            reject(res.data || { message: "请求失败" });
          }
        },
        fail: reject,
      });
    });
  },
  get(path) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: this.globalData.apiBase + path,
        method: "GET",
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data || {});
          } else {
            reject(res.data || { message: "请求失败" });
          }
        },
        fail: reject,
      });
    });
  },
  loadNotificationConfig() {
    if (this.globalData.notificationConfig) return Promise.resolve(this.globalData.notificationConfig);
    return this.get("/notifications/config")
      .then((config) => {
        this.globalData.notificationConfig = config;
        return config;
      })
      .catch(() => {
        const config = { enabled: false, templates: {} };
        this.globalData.notificationConfig = config;
        return config;
      });
  },
  requestEventReminder(eventId) {
    return this.loadNotificationConfig().then((config) => {
      const tmplId = config && config.templates && config.templates.eventReminder;
      if (!tmplId) return { configured: false };
      if (!wx.requestSubscribeMessage) return { configured: true, supported: false };
      const saveSubscription = (accepted) => {
        if (!eventId) return Promise.resolve({ saved: false });
        return this.post("/notifications/event-reminder/subscriptions", {
          userId: this.ensureUserId(),
          eventId,
          accepted,
        })
          .then(() => ({ saved: true }))
          .catch(() => ({ saved: false }));
      };
      return new Promise((resolve, reject) => {
        wx.requestSubscribeMessage({
          tmplIds: [tmplId],
          success: (res) => {
            const accepted = res[tmplId] === "accept";
            if (accepted && eventId) wx.setStorageSync("loopinReminder:" + eventId, true);
            saveSubscription(accepted).then((saved) => {
              resolve({ configured: true, supported: true, accepted, ...saved });
            });
          },
          fail: reject,
        });
      });
    });
  },
  loginWithWechat(options = {}) {
    const localUserId = this.ensureUserId();
    return new Promise((resolve) => {
      wx.login({
        success: (res) => {
          this.post("/auth/wechat/login", { code: res.code, localUserId })
            .then((auth) => {
              this.setAuthState(auth);
              resolve(auth);
            })
            .catch(() => {
              if (!options.silent) wx.showToast({ title: "微信登录失败，仍可继续填写", icon: "none" });
              resolve({ userId: localUserId, mode: "local" });
            });
        },
        fail: () => {
          if (!options.silent) wx.showToast({ title: "微信登录失败，仍可继续填写", icon: "none" });
          resolve({ userId: localUserId, mode: "local" });
        },
      });
    });
  },
  bindPhone(input) {
    const userId = this.ensureUserId();
    return this.post("/auth/wechat/phone", { userId, ...input }).then((auth) => {
      this.setAuthState(auth);
      return auth;
    });
  },
});
