# 微信体验版真机联调 Checklist

这份 checklist 用来验 `wx.login`、openid 身份迁移、票夹保持和订阅消息测试发送。手机号组件暂不申请，体验版走报名表手填手机号。

## 前置状态

- 最新小程序开发版已上传：自定义 tabbar 版包体 `60.2 KB`
- 微信后台 request 合法域名已配置：`https://loopin.llmxy.xyz`
- 生产 `GET /api/notifications/config` 返回 `enabled=true`
- Studio 可用后台管理员令牌，能打开「运营台」里的微信联调诊断

## 设备口径

真机联调以手机微信扫码或体验版为准。Mac 微信直接打开小程序时，可能出现只有白窗、没有导航栏和页面内容的容器级白屏；这类白屏不能单独判定为小程序包失败。

微信开发者工具 GUI 白屏也不能直接判定为小程序包失败。2026-06-08 现场恢复过一次：白屏版本是 Nightly `2.02.2606042`，回退到 Stable `2.01.2510290` 后窗口恢复；若重建过 DevTools 用户数据，需要在 Settings → Security Settings 只开启 `Service Port`，否则 CLI 预览/上传会提示服务端口关闭或 `.ide` 端口超时。

需要重生成预览码时，用这条命令强制注入生产 API：

```bash
LOOPIN_MINI_API_BASE=https://loopin.llmxy.xyz/api WECHAT_CI_PREVIEW_PAGE=pages/events/index pnpm mini:preview
```

生成后扫码 `.artifacts/miniprogram/preview-qrcode.jpg`。

## 真机流程

1. 在微信小程序后台把最新开发版设为体验版，或扫码预览最新二维码。
2. 打开体验版，进入活动列表，确认能看到 `Loopin 体验测试局`。
3. 进入活动详情，点击报名。
4. 填写姓名、手机号、身份和公司；手机号用报名表手填。
5. 提交报名后进入报名成功页。
6. 点击「开启活动提醒」并授权订阅消息。
7. 进入「我的」，确认刚报名的活动仍在票夹里。

## 诊断和测试发送

1. 打开 Studio「运营台」。
2. 用最近报名或最近订阅的一键带入 userId。
3. 刷新微信联调诊断，确认：
   - `openid` 已绑定
   - 该 userId 有最近报名
   - 该 userId 有订阅授权
   - 订阅还没有被测试发送消耗
4. 可在 Studio 点击单用户测试发送，也可以用命令行发送。
5. 手机收到「活动开始通知」后，再刷新诊断，确认该订阅写入 `sentAt`。

也可以用命令行做只读核对，脚本会读取生产诊断接口，不打印后台令牌：

```bash
pnpm wechat:true-device:status -- --markdown
pnpm wechat:true-device:status -- --user-id <Studio 诊断里的 userId> --markdown
```

命令行发送前先 dry-run，确认 `Status` 为 `dry_run_ready` 后再去掉 `--dry-run`。测试发送会消耗一次订阅授权：

```bash
pnpm wechat:true-device:test-reminder -- --user-id <Studio 诊断里的 userId> --dry-run --markdown
pnpm wechat:true-device:test-reminder -- --user-id <Studio 诊断里的 userId> --markdown
```

当某个 userId 同时满足 openid 绑定、报名记录、订阅授权和测试提醒已发送时，报告会给出 `pnpm wechat:true-device:record ...` 建议命令。手机确实收到提醒后再执行记录命令；记录脚本默认会再次读取生产诊断，条件不满足时不会写入 readiness 标记。

## 验证标记

真机联调完成后，用脚本把三项标记写入 `.env.local`，再跑 `pnpm production:readiness -- --json`：

```bash
pnpm wechat:true-device:record -- \
  --user-id <Studio 诊断里的 userId> \
  --verified-at now \
  --reminder-sent-at now
```

脚本会先用后台令牌读取生产诊断，确认该 userId 已绑定 openid、有报名、有 accepted 订阅授权，并且测试提醒已发送或已被诊断标记为已发送；通过后才会更新 `WECHAT_TRUE_DEVICE_VERIFIED_AT`、`WECHAT_TRUE_DEVICE_VERIFIED_USER_ID`、`WECHAT_TRUE_DEVICE_TEST_REMINDER_SENT_AT`。输出只包含活动、userId 和布尔状态，不会打印后台令牌或密钥值。需要手动指定时间时，把 `now` 换成 `YYYY-MM-DDTHH:mm:ss+08:00`。

离线或紧急人工覆盖可加 `--skip-live-check`，但这只适合已经在 Studio 和手机上完成手验、生产诊断暂时不可读的情况。

`WECHAT_TRUE_DEVICE_VERIFIED_AT` 和 `WECHAT_TRUE_DEVICE_TEST_REMINDER_SENT_AT` 都填好后，readiness 里的真机体验版检查会从 `manual` 变成 `pass`。

## 常见失败信号

- Mac 微信打开是纯白窗：先用手机扫码 `.artifacts/miniprogram/preview-qrcode.jpg` 复验；手机能进活动列表时，按 Mac 微信容器问题处理。
- DevTools GUI 白屏：优先确认当前是否 Nightly；回退/重装 Stable 后开启 Security Settings 里的 `Service Port`，再重跑预览。脚本支持 `WECHAT_DEVTOOLS_DISABLE_GPU=1 pnpm mini:preview` 作为临时诊断，但最终以 Stable + Service Port 为准。
- 活动列表空：先查体验版是否走 `https://loopin.llmxy.xyz/api`，再查生产 `/api/events`。
- `request:fail url not in domain list`：微信后台只填域名 `https://loopin.llmxy.xyz`，不填 `/api`。
- Studio 诊断没有 openid：说明真机没有完成 `wx.login` 或身份迁移。
- Studio 有报名但没有订阅：说明报名成功页未授权订阅，或用户点了拒绝。
- 测试发送 dry-run 不是 `dry_run_ready`：先看输出里的缺项，通常是 openid、报名、订阅授权或已发送状态不满足。
- 测试发送后手机没收到：先看诊断里的模板配置、openid 和授权记录；测试发送会消耗一次订阅授权，已发送过的订阅不会重复发送。
