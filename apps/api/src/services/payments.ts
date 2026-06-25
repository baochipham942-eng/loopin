import { createCipheriv, createDecipheriv, randomBytes, sign as rsaSign, verify as rsaVerify } from "node:crypto";
import type { Order, Payment, PrismaClient } from "@prisma/client";
import { nextOrderLifecycle, nextPaymentStatus, nextRegistrationStatus, OversellError } from "@loopin/core";

export interface PaymentPrepareResult {
  provider: string;
  orderId: string;
  amountCents: number;
  request: Record<string, unknown>;
}

export interface PaymentConfirmInput {
  now?: Date;
  payload?: unknown;
}

export interface PaymentConfirmResult {
  provider: string;
  txnId: string;
  paidAt: Date;
  payment: Payment;
}

export interface PaymentRefundInput {
  amountCents: number;
  reason?: string;
}

export interface PaymentRefundResult {
  provider: string;
  refundedAmountCents: number;
  txnId: string;
}

export interface PaymentWebhookResult {
  provider: string;
  status: "ignored" | "confirmed" | "refunded";
  orderId?: string;
}

export interface PaymentProvider {
  identifier: string;
  mode?: "mock" | "live";
  configured?(): boolean;
  prepare(db: PrismaClient, order: Order): Promise<PaymentPrepareResult>;
  confirm(db: PrismaClient, order: Order, input?: PaymentConfirmInput): Promise<PaymentConfirmResult>;
  refund(db: PrismaClient, order: Order, input: PaymentRefundInput): Promise<PaymentRefundResult>;
  webhook(db: PrismaClient, payload: unknown): Promise<PaymentWebhookResult>;
}

export interface PaymentProviderReadiness {
  configured: boolean;
  canPrepare: boolean;
  canVerifyNotify: boolean;
  notifyUrl: string | null;
  missing: string[];
  requirements: Array<{
    key: string;
    env: string;
    configured: boolean;
    usedFor: Array<"prepare" | "notify">;
  }>;
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

interface WechatPayProviderOptions {
  fetcher?: FetchLike;
  now?: () => Date;
  nonce?: () => string;
}

interface WechatNotifyPayload {
  headers?: Record<string, string | string[] | undefined>;
  rawBody?: string | Buffer;
  body?: unknown;
}

interface WechatTransaction {
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  success_time?: string;
  amount?: {
    total?: number;
    payer_total?: number;
  };
}

export class PaymentError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

function mockTxnId(orderId: string, now: Date) {
  return `mock_${orderId}_${now.getTime()}`;
}

export const mockPaymentProvider: PaymentProvider = {
  identifier: "mock",
  mode: "mock",
  configured: () => true,

  async prepare(_db, order) {
    return {
      provider: this.identifier,
      orderId: order.id,
      amountCents: order.amountCents,
      request: {
        mode: "mock",
        action: "confirm",
      },
    };
  },

  async confirm(db, order, input = {}) {
    const paidAt = input.now ?? new Date();
    const txnId = mockTxnId(order.id, paidAt);
    const payment = await db.payment.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        provider: this.identifier,
        txnId,
        paidAt,
      },
      update: {
        provider: this.identifier,
        txnId,
        paidAt,
      },
    });
    return {
      provider: this.identifier,
      txnId,
      paidAt,
      payment,
    };
  },

  async refund(_db, order, input) {
    return {
      provider: this.identifier,
      refundedAmountCents: Math.min(input.amountCents, order.amountCents),
      txnId: `mock_refund_${order.id}`,
    };
  },

  async webhook() {
    return {
      provider: this.identifier,
      status: "ignored",
    };
  },
};

export function createWechatPayProvider(options: WechatPayProviderOptions = {}): PaymentProvider {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const nonce = options.nonce ?? randomNonce;

  return {
    identifier: "wechatpay",
    mode: "live",
    configured: wechatPayConfigured,

    async prepare(db, order) {
      assertWechatPayConfigured();
      if (order.amountCents <= 0) throw new PaymentError(400, "invalid_amount", "微信支付订单金额必须大于 0");

      const orderWithUser = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { registration: { include: { user: true, event: true } } },
      });
      const openid = orderWithUser.registration.user.openid;
      if (!openid) throw new PaymentError(400, "missing_openid", "微信支付需要先绑定 openid");

      const body = {
        appid: wechatPayAppId(),
        mchid: wechatPayMchid(),
        description: truncate(orderWithUser.registration.event.title || "Loopin 活动报名", 120),
        out_trade_no: order.id,
        notify_url: wechatPayNotifyUrl(),
        amount: { total: order.amountCents, currency: "CNY" },
        payer: { openid },
      };
      const bodyText = JSON.stringify(body);
      const path = "/v3/pay/transactions/jsapi";
      const res = await fetcher(`https://api.mch.weixin.qq.com${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: wechatPayAuthorization("POST", path, bodyText, now(), nonce()),
        },
        body: bodyText,
      });
      const text = await res.text();
      const data = parseJSON<Record<string, unknown>>(text, {});
      if (!res.ok || !clean(data.prepay_id)) {
        throw new PaymentError(res.ok ? 502 : res.status, "wechatpay_prepare_failed", clean(data.message) || clean(data.code) || "微信支付下单失败");
      }

      const payParams = wechatPayMiniProgramParams(clean(data.prepay_id), now(), nonce());
      return {
        provider: this.identifier,
        orderId: order.id,
        amountCents: order.amountCents,
        request: {
          mode: "wechatpay",
          ...payParams,
        },
      };
    },

    async confirm(db, order, input = {}) {
      const transaction = transactionFromPayload(input.payload);
      if (!transaction?.transaction_id || transaction.out_trade_no !== order.id || transaction.trade_state !== "SUCCESS") {
        throw new PaymentError(409, "wechatpay_waiting_webhook", "微信支付需等待回调确认");
      }
      const paidAt = transaction.success_time ? new Date(transaction.success_time) : (input.now ?? new Date());
      const payment = await db.payment.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, provider: this.identifier, txnId: transaction.transaction_id, paidAt },
        update: { provider: this.identifier, txnId: transaction.transaction_id, paidAt },
      });
      return { provider: this.identifier, txnId: transaction.transaction_id, paidAt, payment };
    },

    async refund(_db, _order, _input) {
      throw new PaymentError(501, "wechatpay_refund_not_implemented", "微信支付退款接口暂未接入");
    },

    async webhook(db, payload) {
      assertWechatPayConfigured();
      const notify = notifyPayload(payload);
      const rawBody = rawBodyText(notify);
      verifyWechatPayNotify(notify.headers ?? {}, rawBody);
      const body = parseJSON<Record<string, unknown>>(rawBody, {});
      const resource = isRecord(body.resource) ? body.resource : null;
      if (!resource) throw new PaymentError(400, "invalid_notify", "微信支付回调缺少 resource");

      const transaction = decryptWechatPayResource(resource);
      if (transaction.trade_state !== "SUCCESS") return { provider: this.identifier, status: "ignored" };
      if (!transaction.out_trade_no || !transaction.transaction_id) throw new PaymentError(400, "invalid_notify", "微信支付回调缺少订单号或交易号");

      await confirmWechatPayOrder(db, this, transaction);
      return { provider: this.identifier, status: "confirmed", orderId: transaction.out_trade_no };
    },
  };
}

export const wechatPayProvider = createWechatPayProvider();

export function activePaymentProvider(): PaymentProvider {
  return process.env.PAYMENT_PROVIDER === "wechatpay" ? wechatPayProvider : mockPaymentProvider;
}

export function paymentProviderStatus(provider = activePaymentProvider()) {
  const status: {
    identifier: string;
    mode: "mock" | "live";
    configured: boolean;
    readiness?: PaymentProviderReadiness;
  } = {
    identifier: provider.identifier,
    mode: provider.mode ?? (provider.identifier === "mock" ? "mock" : "live"),
    configured: provider.configured ? provider.configured() : true,
  };
  if (provider.identifier === wechatPayProvider.identifier) {
    status.readiness = wechatPayReadiness();
  }
  return status;
}

export function paymentProviderStatuses() {
  return [mockPaymentProvider, wechatPayProvider].map((provider) => paymentProviderStatus(provider));
}

export function wechatPayReadiness(): PaymentProviderReadiness {
  const notifyUrl = wechatPayNotifyUrl();
  const requirements: PaymentProviderReadiness["requirements"] = [
    {
      key: "appid",
      env: "WECHATPAY_APPID or WX_APPID",
      configured: Boolean(wechatPayAppId()),
      usedFor: ["prepare"],
    },
    {
      key: "mchid",
      env: "WECHATPAY_MCHID",
      configured: Boolean(wechatPayMchid()),
      usedFor: ["prepare"],
    },
    {
      key: "merchantSerialNo",
      env: "WECHATPAY_MERCHANT_SERIAL_NO",
      configured: Boolean(wechatPayMerchantSerialNo()),
      usedFor: ["prepare"],
    },
    {
      key: "merchantPrivateKey",
      env: "WECHATPAY_MERCHANT_PRIVATE_KEY",
      configured: Boolean(wechatPayMerchantPrivateKey()),
      usedFor: ["prepare"],
    },
    {
      key: "apiV3Key",
      env: "WECHATPAY_API_V3_KEY",
      configured: Boolean(wechatPayApiV3Key()),
      usedFor: ["notify"],
    },
    {
      key: "platformCert",
      env: "WECHATPAY_PLATFORM_CERT_PEM",
      configured: Boolean(wechatPayPlatformCert()),
      usedFor: ["notify"],
    },
    {
      key: "notifyUrl",
      env: "WECHATPAY_NOTIFY_URL or PUBLIC_BASE_URL",
      configured: Boolean(notifyUrl),
      usedFor: ["prepare"],
    },
  ];
  const missing = requirements.filter((item) => !item.configured).map((item) => item.env);
  const missingPrepare = requirements.some((item) => item.usedFor.includes("prepare") && !item.configured);
  const missingNotify = requirements.some((item) => item.usedFor.includes("notify") && !item.configured);
  return {
    configured: missing.length === 0,
    canPrepare: !missingPrepare,
    canVerifyNotify: !missingNotify,
    notifyUrl: notifyUrl || null,
    missing,
    requirements,
  };
}

export function wechatPayConfigured() {
  return wechatPayReadiness().configured;
}

async function confirmWechatPayOrder(db: PrismaClient, provider: PaymentProvider, transaction: WechatTransaction) {
  const orderId = transaction.out_trade_no || "";
  await db.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { registration: true } });
    const paidTotal = transaction.amount?.payer_total ?? transaction.amount?.total;
    if (paidTotal !== order.amountCents) {
      throw new PaymentError(400, "amount_mismatch", "微信支付回调金额与订单金额不一致");
    }

    if (order.payment_status !== "paid") {
      if (order.quotaId) {
        const affected = await tx.$executeRaw`
          UPDATE "Quota" SET "used" = "used" + ${order.seats}
          WHERE "id" = ${order.quotaId}
            AND ("capacity" IS NULL OR "used" + ${order.seats} <= "capacity")`;
        if (affected === 0) {
          const quota = await tx.quota.findUnique({ where: { id: order.quotaId } });
          throw new OversellError(quota?.capacity ?? 0, (quota?.used ?? 0) + order.seats);
        }
      }
      await tx.order.update({
        where: { id: order.id },
        data: {
          lifecycle: nextOrderLifecycle(order.lifecycle as any, "complete"),
          payment_status: nextPaymentStatus(order.payment_status as any, "pay"),
          mock: false,
        },
      });
      if (order.registration.status === "submitted") {
        await tx.registration.update({
          where: { id: order.registrationId },
          data: { status: nextRegistrationStatus(order.registration.status as any, "approve") },
        });
      }
    }

    await provider.confirm(tx as PrismaClient, order, { payload: transaction });
  });
}

function assertWechatPayConfigured() {
  if (!wechatPayConfigured()) {
    throw new PaymentError(503, "wechatpay_not_configured", "微信支付商户参数未配置完整");
  }
}

function wechatPayAppId() {
  return process.env.WECHATPAY_APPID || process.env.WX_APPID || process.env.WECHAT_APPID || "";
}

function wechatPayMchid() {
  return process.env.WECHATPAY_MCHID || "";
}

function wechatPayMerchantSerialNo() {
  return process.env.WECHATPAY_MERCHANT_SERIAL_NO || "";
}

function wechatPayMerchantPrivateKey() {
  return normalizePem(process.env.WECHATPAY_MERCHANT_PRIVATE_KEY || "");
}

function wechatPayApiV3Key() {
  return process.env.WECHATPAY_API_V3_KEY || "";
}

function wechatPayPlatformCert() {
  return normalizePem(process.env.WECHATPAY_PLATFORM_CERT_PEM || "");
}

function wechatPayNotifyUrl() {
  if (process.env.WECHATPAY_NOTIFY_URL) return process.env.WECHATPAY_NOTIFY_URL;
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}/api/payments/wechatpay/notify` : "";
}

function wechatPayAuthorization(method: string, path: string, body: string, time: Date, nonce: string) {
  const timestamp = timestampSeconds(time);
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = signMessage(message, wechatPayMerchantPrivateKey());
  return [
    "WECHATPAY2-SHA256-RSA2048",
    `mchid="${wechatPayMchid()}"`,
    `nonce_str="${nonce}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${wechatPayMerchantSerialNo()}"`,
    `signature="${signature}"`,
  ].join(" ");
}

function wechatPayMiniProgramParams(prepayId: string, time: Date, nonceStr: string) {
  const timeStamp = String(timestampSeconds(time));
  const pkg = `prepay_id=${prepayId}`;
  const message = `${wechatPayAppId()}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
  return {
    appId: wechatPayAppId(),
    timeStamp,
    nonceStr,
    package: pkg,
    signType: "RSA",
    paySign: signMessage(message, wechatPayMerchantPrivateKey()),
  };
}

function verifyWechatPayNotify(headers: Record<string, string | string[] | undefined>, rawBody: string) {
  const timestamp = firstHeader(headers, "Wechatpay-Timestamp");
  const nonce = firstHeader(headers, "Wechatpay-Nonce");
  const signature = firstHeader(headers, "Wechatpay-Signature");
  const cert = wechatPayPlatformCert();
  if (!timestamp || !nonce || !signature) throw new PaymentError(400, "invalid_notify_signature", "微信支付回调签名头缺失");
  if (!cert) throw new PaymentError(503, "wechatpay_platform_cert_missing", "微信支付平台证书未配置");
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const ok = rsaVerify("RSA-SHA256", Buffer.from(message), cert, Buffer.from(signature, "base64"));
  if (!ok) throw new PaymentError(401, "invalid_notify_signature", "微信支付回调签名校验失败");
}

function decryptWechatPayResource(resource: Record<string, unknown>): WechatTransaction {
  const ciphertext = clean(resource.ciphertext);
  const nonce = clean(resource.nonce);
  const associatedData = clean(resource.associated_data);
  if (!ciphertext || !nonce) throw new PaymentError(400, "invalid_notify_resource", "微信支付回调密文缺失");

  const encrypted = Buffer.from(ciphertext, "base64");
  const authTag = encrypted.subarray(encrypted.length - 16);
  const data = encrypted.subarray(0, encrypted.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(wechatPayApiV3Key(), "utf8"), Buffer.from(nonce, "utf8"));
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return parseJSON<WechatTransaction>(plaintext, {});
}

export function encryptWechatPayResourceForTest(resource: unknown, apiV3Key: string, nonce: string, associatedData = "transaction") {
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(nonce, "utf8"));
  if (associatedData) cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(resource), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algorithm: "AEAD_AES_256_GCM",
    nonce,
    associated_data: associatedData,
    ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
  };
}

function transactionFromPayload(payload: unknown): WechatTransaction | null {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.transaction)) return payload.transaction as WechatTransaction;
  return payload as WechatTransaction;
}

function notifyPayload(payload: unknown): WechatNotifyPayload {
  return isRecord(payload) ? payload as WechatNotifyPayload : {};
}

function rawBodyText(payload: WechatNotifyPayload) {
  if (Buffer.isBuffer(payload.rawBody)) return payload.rawBody.toString("utf8");
  if (typeof payload.rawBody === "string") return payload.rawBody;
  return JSON.stringify(payload.body ?? {});
}

function firstHeader(headers: Record<string, string | string[] | undefined>, key: string) {
  const found = Object.entries(headers).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
  return Array.isArray(found) ? found[0] : found;
}

function signMessage(message: string, privateKey: string) {
  return rsaSign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64");
}

function timestampSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function randomNonce() {
  return randomBytes(16).toString("hex");
}

function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}

function parseJSON<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
