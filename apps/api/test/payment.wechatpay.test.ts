import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { prisma } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { createEvent, createTicketTypeWithQuota, upsertUser } from "../src/services/catalog.js";
import { reserve } from "../src/services/registration.js";
import {
  createWechatPayProvider,
  encryptWechatPayResourceForTest,
  paymentProviderStatus,
  wechatPayConfigured,
  wechatPayProvider,
} from "../src/services/payments.js";

const merchantKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platformKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const merchantPrivateKey = merchantKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const merchantPublicKey = merchantKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const platformPrivateKey = platformKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const platformPublicKey = platformKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const apiV3Key = "12345678901234567890123456789012";
const wechatPayEnvKeys = [
  "PAYMENT_PROVIDER",
  "WECHATPAY_APPID",
  "WX_APPID",
  "WECHAT_APPID",
  "WECHATPAY_MCHID",
  "WECHATPAY_MERCHANT_SERIAL_NO",
  "WECHATPAY_MERCHANT_PRIVATE_KEY",
  "WECHATPAY_API_V3_KEY",
  "WECHATPAY_PLATFORM_CERT_PEM",
  "WECHATPAY_NOTIFY_URL",
  "PUBLIC_BASE_URL",
] as const;
type WechatPayEnvKey = typeof wechatPayEnvKeys[number];
type WechatPayEnv = Partial<Record<WechatPayEnvKey, string | undefined>>;

async function clean() {
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.checkIn.deleteMany();
  await prisma.notificationSubscription.deleteMany();
  await prisma.interestSubscription.deleteMany();
  await prisma.eventFeedback.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.registrationForm.deleteMany();
  await prisma.eventPage.deleteMany();
  await prisma.eventResource.deleteMany();
  await prisma.budgetPlan.deleteMany();
  await prisma.sponsorPlan.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.material.deleteMany();
  await prisma.agentTask.deleteMany();
  await prisma.eventReview.deleteMany();
  await prisma.eventSocialProfile.deleteMany();
  await prisma.ticketTypeQuota.deleteMany();
  await prisma.ticketType.deleteMany();
  await prisma.quota.deleteMany();
  await prisma.event.deleteMany();
  await prisma.hostProfile.deleteMany();
  await prisma.organizerMember.deleteMany();
  await prisma.organizer.deleteMany();
  await prisma.user.deleteMany();
}

async function seedPaidOrder() {
  const org = await prisma.organizer.create({ data: { name: "微信支付测试主办方", whitelisted: true } });
  const event = await createEvent(prisma, {
    organizerId: org.id,
    title: "AI 创始人同频沙龙",
    city: "上海",
    startAt: new Date("2026-06-14T11:00:00.000Z"),
  });
  const { ticketType, quota } = await createTicketTypeWithQuota(prisma, {
    eventId: event.id,
    name: "标准票",
    kind: "paid",
    priceCents: 19900,
    capacity: 2,
  });
  const user = await upsertUser(prisma, "wechat_pay_user", { nickname: "微信支付用户" });
  await prisma.user.update({ where: { id: user.id }, data: { openid: "openid_for_jsapi" } });
  const registration = await reserve(prisma, {
    eventId: event.id,
    ticketTypeId: ticketType.id,
    userId: user.id,
    formValues: { name: "微信支付用户" },
  });
  const order = await prisma.order.findUniqueOrThrow({ where: { id: registration.orderId } });
  return { order, quota };
}

function snapshotWechatPayEnv(): WechatPayEnv {
  return Object.fromEntries(wechatPayEnvKeys.map((key) => [key, process.env[key]])) as WechatPayEnv;
}

function restoreWechatPayEnv(oldEnv: WechatPayEnv) {
  for (const key of wechatPayEnvKeys) {
    const value = oldEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function withoutWechatPayEnv() {
  const oldEnv = snapshotWechatPayEnv();
  for (const key of wechatPayEnvKeys) delete process.env[key];
  return () => restoreWechatPayEnv(oldEnv);
}

function withWechatPayEnv(overrides: WechatPayEnv = {}) {
  const restore = withoutWechatPayEnv();
  process.env.PAYMENT_PROVIDER = "wechatpay";
  process.env.WX_APPID = "wx_test_appid";
  process.env.WECHATPAY_MCHID = "1900000001";
  process.env.WECHATPAY_MERCHANT_SERIAL_NO = "merchant_serial";
  process.env.WECHATPAY_MERCHANT_PRIVATE_KEY = merchantPrivateKey;
  process.env.WECHATPAY_API_V3_KEY = apiV3Key;
  process.env.WECHATPAY_PLATFORM_CERT_PEM = platformPublicKey;
  process.env.WECHATPAY_NOTIFY_URL = "https://loopin.llmxy.xyz/api/payments/wechatpay/notify";
  for (const [key, value] of Object.entries(overrides) as Array<[WechatPayEnvKey, string | undefined]>) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    restore();
  };
}

function signWechatNotify(timestamp: string, nonce: string, body: string) {
  return createSign("RSA-SHA256")
    .update(`${timestamp}\n${nonce}\n${body}\n`)
    .sign(platformPrivateKey, "base64");
}

beforeEach(async () => {
  await clean();
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("微信支付 V3 Provider", () => {
  it("支付 Provider 状态会同时暴露 mock 和微信支付 readiness 缺项", async () => {
    const restore = withoutWechatPayEnv();
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/payments/providers" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        active: string;
        providers: Array<{ identifier: string; configured: boolean; readiness?: { missing: string[]; canPrepare: boolean; canVerifyNotify: boolean } }>;
      };
      expect(body.active).toBe("mock");
      expect(body.providers.map((provider) => provider.identifier)).toEqual(["mock", "wechatpay"]);
      const wechatpay = body.providers.find((provider) => provider.identifier === "wechatpay");
      expect(wechatpay?.configured).toBe(false);
      expect(wechatpay?.readiness?.canPrepare).toBe(false);
      expect(wechatpay?.readiness?.canVerifyNotify).toBe(false);
      expect(wechatpay?.readiness?.missing).toEqual([
        "WECHATPAY_APPID or WX_APPID",
        "WECHATPAY_MCHID",
        "WECHATPAY_MERCHANT_SERIAL_NO",
        "WECHATPAY_MERCHANT_PRIVATE_KEY",
        "WECHATPAY_API_V3_KEY",
        "WECHATPAY_PLATFORM_CERT_PEM",
        "WECHATPAY_NOTIFY_URL or PUBLIC_BASE_URL",
      ]);
    } finally {
      restore();
      await app.close();
    }
  });

  it("微信支付 readiness 会区分 JSAPI 下单配置和回调验签配置", async () => {
    const restore = withWechatPayEnv({ WECHATPAY_PLATFORM_CERT_PEM: "" });
    try {
      expect(wechatPayConfigured()).toBe(false);
      const status = paymentProviderStatus(wechatPayProvider);
      expect(status.configured).toBe(false);
      expect(status.readiness).toMatchObject({
        configured: false,
        canPrepare: true,
        canVerifyNotify: false,
        notifyUrl: "https://loopin.llmxy.xyz/api/payments/wechatpay/notify",
        missing: ["WECHATPAY_PLATFORM_CERT_PEM"],
      });
    } finally {
      restore();
    }
  });

  it("微信支付商户参数完整时 readiness 为可切换状态", async () => {
    const restore = withWechatPayEnv();
    try {
      expect(wechatPayConfigured()).toBe(true);
      const status = paymentProviderStatus(wechatPayProvider);
      expect(status).toMatchObject({
        identifier: "wechatpay",
        mode: "live",
        configured: true,
        readiness: {
          configured: true,
          canPrepare: true,
          canVerifyNotify: true,
          notifyUrl: "https://loopin.llmxy.xyz/api/payments/wechatpay/notify",
          missing: [],
        },
      });
    } finally {
      restore();
    }
  });

  it("JSAPI 下单会生成微信支付请求和小程序调起支付签名", async () => {
    const restore = withWechatPayEnv();
    try {
      const { order } = await seedPaidOrder();
      let requestedBody = "";
      let authorization = "";
      const provider = createWechatPayProvider({
        now: () => new Date("2026-06-08T02:00:00.000Z"),
        nonce: () => "nonce_for_test",
        fetcher: async (_url, init) => {
          requestedBody = init?.body || "";
          authorization = init?.headers?.Authorization || "";
          expect(init?.method).toBe("POST");
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ prepay_id: "wx_prepay_id" }),
          };
        },
      });

      const result = await provider.prepare(prisma, order);
      expect(JSON.parse(requestedBody)).toMatchObject({
        appid: "wx_test_appid",
        mchid: "1900000001",
        out_trade_no: order.id,
        amount: { total: 19900, currency: "CNY" },
        payer: { openid: "openid_for_jsapi" },
      });
      expect(authorization).toContain("WECHATPAY2-SHA256-RSA2048");
      expect(result.request).toMatchObject({
        mode: "wechatpay",
        appId: "wx_test_appid",
        timeStamp: "1780884000",
        nonceStr: "nonce_for_test",
        package: "prepay_id=wx_prepay_id",
        signType: "RSA",
      });

      const verifier = createVerify("RSA-SHA256");
      verifier.update("wx_test_appid\n1780884000\nnonce_for_test\nprepay_id=wx_prepay_id\n");
      expect(verifier.verify(merchantPublicKey, String(result.request.paySign), "base64")).toBe(true);
    } finally {
      restore();
    }
  });

  it("微信支付回调验签解密后确认订单并扣库存", async () => {
    const restore = withWechatPayEnv();
    const app = await buildApp();
    try {
      const { order, quota } = await seedPaidOrder();
      const resource = encryptWechatPayResourceForTest({
        out_trade_no: order.id,
        transaction_id: "wx_transaction_1",
        trade_state: "SUCCESS",
        success_time: "2026-06-08T02:10:00+08:00",
        amount: { total: 19900, payer_total: 19900 },
      }, apiV3Key, "notify_nonce_1");
      const body = JSON.stringify({
        id: "notify_1",
        create_time: "2026-06-08T02:10:00+08:00",
        event_type: "TRANSACTION.SUCCESS",
        resource_type: "encrypt-resource",
        resource,
      });
      const timestamp = "1780884600";
      const nonce = "notify_header_nonce";
      const res = await app.inject({
        method: "POST",
        url: "/api/payments/wechatpay/notify",
        headers: {
          "content-type": "application/json",
          "Wechatpay-Timestamp": timestamp,
          "Wechatpay-Nonce": nonce,
          "Wechatpay-Signature": signWechatNotify(timestamp, nonce, body),
          "Wechatpay-Serial": "platform_serial",
        },
        payload: body,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ provider: "wechatpay", status: "confirmed", orderId: order.id });

      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payment: true, registration: true } });
      expect(updatedOrder.lifecycle).toBe("completed");
      expect(updatedOrder.payment_status).toBe("paid");
      expect(updatedOrder.mock).toBe(false);
      expect(updatedOrder.payment).toMatchObject({ provider: "wechatpay", txnId: "wx_transaction_1" });
      expect(updatedOrder.registration.status).toBe("approved");
      await expect(prisma.quota.findUniqueOrThrow({ where: { id: quota.id } })).resolves.toMatchObject({ used: 1 });
    } finally {
      restore();
      await app.close();
    }
  });
});
