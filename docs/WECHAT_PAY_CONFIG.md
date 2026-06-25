# 微信支付 V3 配置与回归

当前代码层已接入 `wechatpay` PaymentProvider，生产默认仍是 `PAYMENT_PROVIDER=mock`。只有商户材料齐全并真机回归后，才切到 `wechatpay`。

## 需要的商户材料

| 配置项 | 环境变量 | 用途 |
| --- | --- | --- |
| 小程序 AppID | `WECHATPAY_APPID` 或 `WX_APPID` | JSAPI 下单、小程序调起支付 |
| 商户号 | `WECHATPAY_MCHID` | JSAPI 下单、签名 |
| 商户 API 证书序列号 | `WECHATPAY_MERCHANT_SERIAL_NO` | 请求微信支付 V3 API |
| 商户私钥 PEM | `WECHATPAY_MERCHANT_PRIVATE_KEY` | 签微信支付 V3 API 请求和小程序支付参数 |
| APIv3 key | `WECHATPAY_API_V3_KEY` | 解密支付回调 resource |
| 微信支付平台证书 PEM | `WECHATPAY_PLATFORM_CERT_PEM` | 验证支付回调签名 |
| 回调地址 | `WECHATPAY_NOTIFY_URL` | 微信支付通知地址 |

生产回调地址固定为：

```text
https://loopin.llmxy.xyz/api/payments/wechatpay/notify
```

PEM 可在 `.env.local` 或 FC 环境里写成带 `\n` 的单行字符串，不要提交到仓库。

## 配置顺序

1. 保持 `PAYMENT_PROVIDER=mock`。
2. 先补齐 `WECHATPAY_*` 参数和 `WECHATPAY_NOTIFY_URL`。
3. 本地先跑离线检查：

```bash
pnpm wechatpay:check
pnpm wechatpay:check -- --strict
pnpm wechatpay:check -- --json
pnpm wechatpay:check -- --markdown --output .artifacts/wechatpay-check.md
```

`wechatpay:check` 只读取 `.env.local` 和 `apps/api/.env`，不请求微信支付网络，也不打印商户号、私钥、APIv3 key 或证书内容。它会检查占位值、AppID/商户号/序列号格式、商户私钥能否签名、APIv3 key 是否 32 字节、平台证书/公钥能否解析、notify URL 是否为 HTTPS；Markdown 报告可用于交接缺项。

4. 跑 `pnpm production:readiness -- --json`，确认 `wechat_pay.detail` 里 `missing=none`、`canPrepare=true`、`canVerifyNotify=true`。
5. 在 Studio「运营台」支付配置卡确认 JSAPI 下单 readiness 和回调验签 readiness 都通过。
6. 再把 FC 环境变量 `PAYMENT_PROVIDER` 切为 `wechatpay`。
7. 用体验版真机报名一单付费票，走 `wx.requestPayment`。
8. 支付后确认订单状态变为已支付，报名状态仍正确，微信支付回调不报验签或金额错误。

## 回归点

- 真机用户必须先完成 `wx.login`，报名用户要有 openid；没有 openid 时后端会拒绝微信支付下单。
- `GET /api/payments/providers` 需要返回 `wechatpay.readiness.configured=true`。
- JSAPI 下单失败时先看 `WECHATPAY_MCHID`、商户证书序列号和商户私钥。
- 回调失败时先看 `WECHATPAY_API_V3_KEY`、`WECHATPAY_PLATFORM_CERT_PEM` 和 notify URL。
- 金额错误会拒绝确认订单，避免回调金额与本地订单金额不一致。
- 退款接口暂未接入，真实售票前需要单独补退款流程。
