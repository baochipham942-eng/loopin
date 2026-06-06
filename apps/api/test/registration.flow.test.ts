import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { OversellError } from "@loopin/core";
import { createEvent, createTicketTypeWithQuota, upsertUser } from "../src/services/catalog.js";
import { reserve, complete, cancel, checkin, sweepExpired, SoldOutError } from "../src/services/registration.js";

const testDbUrl = `file:${fileURLToPath(new URL("../prisma/test.db", import.meta.url))}`;
const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

async function clean() {
  await db.payment.deleteMany();
  await db.order.deleteMany();
  await db.checkIn.deleteMany();
  await db.registration.deleteMany();
  await db.registrationForm.deleteMany();
  await db.budgetPlan.deleteMany();
  await db.sponsorPlan.deleteMany();
  await db.channel.deleteMany();
  await db.material.deleteMany();
  await db.agentTask.deleteMany();
  await db.eventReview.deleteMany();
  await db.ticketTypeQuota.deleteMany();
  await db.ticketType.deleteMany();
  await db.quota.deleteMany();
  await db.event.deleteMany();
  await db.hostProfile.deleteMany();
  await db.organizer.deleteMany();
  await db.user.deleteMany();
}

/** 建一个 capacity 名额的付费活动 + 一个用户 */
async function seed(capacity: number | null) {
  const org = await db.organizer.create({ data: { name: "Loopin 测试主办方", whitelisted: true } });
  const event = await createEvent(db, {
    organizerId: org.id,
    title: "AI 产品人深夜局",
    city: "上海",
    startAt: new Date("2026-06-14T19:00:00.000Z"),
  });
  const { ticketType, quota } = await createTicketTypeWithQuota(db, {
    eventId: event.id,
    name: "标准票",
    kind: "paid",
    priceCents: 19900,
    capacity,
  });
  const user = await upsertUser(db, "u_" + Math.random().toString(36).slice(2), { nickname: "测试用户" });
  return { event, ticketType, quota, user };
}

beforeAll(async () => {
  // 触发连接
  await db.$queryRaw`SELECT 1`;
});
beforeEach(clean);
afterAll(async () => {
  await clean();
  await db.$disconnect();
});

describe("报名闭环", () => {
  it("reserve → complete → checkin 全流程持久化正确", async () => {
    const { event, ticketType, user } = await seed(2);
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "林晨" } });

    let order = await db.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(order.lifecycle).toBe("reserved");
    expect(order.reservedUntil).toBeTruthy();

    await complete(db, r.orderId);
    order = await db.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(order.lifecycle).toBe("completed");
    expect(order.payment_status).toBe("paid");

    const quotaAfter = await db.quota.findFirstOrThrow();
    expect(quotaAfter.used).toBe(1);

    await checkin(db, r.registrationId);
    const reg = await db.registration.findUniqueOrThrow({ where: { id: r.registrationId } });
    expect(reg.status).toBe("checked_in");
  });
});

describe("防超卖（守住 Hi.Events 的坑）", () => {
  it("capacity=2 时第 3 个 complete 抛 OversellError，used 封顶在 2", async () => {
    const { event, ticketType, user } = await seed(2);
    const mk = () => reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {} });
    const o1 = await mk();
    const o2 = await mk();
    // 第 3 个预留软占已超：reserve 应被 SoldOutError 拦下
    await expect(mk()).rejects.toBeInstanceOf(SoldOutError);

    await complete(db, o1.orderId);
    await complete(db, o2.orderId);
    const quota = await db.quota.findFirstOrThrow();
    expect(quota.used).toBe(2);
  });

  it("绕过软预留直接 complete 超量时，DB 条件原子更新兜底抛 OversellError", async () => {
    const { event, ticketType, user } = await seed(1);
    // 手工塞两个 reserved 单（模拟并发软预留都通过的极端情况）
    const a = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {} });
    // 直接再建一个 reserved 单绕过 reserve 的软校验
    const reg = await db.registration.create({ data: { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, status: "submitted", formValues: "{}" } });
    const quota = await db.quota.findFirstOrThrow();
    const b = await db.order.create({ data: { registrationId: reg.id, amountCents: 19900, seats: 1, quotaId: quota.id, lifecycle: "reserved", reservedUntil: new Date(Date.now() + 600000) } });

    await complete(db, a.orderId); // used → 1
    await expect(complete(db, b.id)).rejects.toBeInstanceOf(OversellError); // 第 2 个被 DB 条件更新拦下
    const q = await db.quota.findFirstOrThrow();
    expect(q.used).toBe(1);
  });
});

describe("预留过期回收", () => {
  it("过期 reserved 单被 sweep 成 abandoned，名额释放后可再预留", async () => {
    const { event, ticketType, user } = await seed(1);
    const t0 = new Date("2026-06-06T00:00:00.000Z");
    await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {}, now: t0 });
    // 容量 1 已被软占，此刻不能再预留
    await expect(reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {}, now: t0 }))
      .rejects.toBeInstanceOf(SoldOutError);

    const t1 = new Date(t0.getTime() + 20 * 60000); // 20 分钟后，预留已过期
    const swept = await sweepExpired(db, t1);
    expect(swept).toBe(1);

    // 释放后可再预留
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {}, now: t1 });
    expect(r.orderId).toBeTruthy();
  });
});

describe("取消已成交回滚库存", () => {
  it("complete 后 cancel，used 回到 0，可再次售出", async () => {
    const { event, ticketType, user } = await seed(1);
    const a = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {} });
    await complete(db, a.orderId);
    expect((await db.quota.findFirstOrThrow()).used).toBe(1);

    await cancel(db, a.orderId);
    expect((await db.quota.findFirstOrThrow()).used).toBe(0);

    const b = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {} });
    await complete(db, b.orderId);
    expect((await db.quota.findFirstOrThrow()).used).toBe(1);
  });
});
