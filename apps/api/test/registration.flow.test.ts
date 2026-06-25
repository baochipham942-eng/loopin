import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { OversellError } from "@loopin/core";
import { createEvent, createTicketTypeWithQuota, setEventPage, upsertUser } from "../src/services/catalog.js";
import {
  approveRegistration,
  reserve,
  complete,
  cancel,
  checkin,
  checkinByToken,
  buildCheckinPayload,
  DuplicateCheckinError,
  CheckinTokenError,
  promoteWaitlistRegistration,
  rejectRegistration,
  refundOrder,
  RefundError,
  InviteCodeError,
  setRegistrationTag,
  sweepExpired,
} from "../src/services/registration.js";
import { runMaintenanceTask } from "../src/services/maintenance.js";
import { listUserRegistrations } from "../src/services/users.js";
import { bindUserPhone, loginWithWechatCode } from "../src/services/auth.js";
import { saveEventReminderSubscription, sendDueEventReminders, sendEventReminderTest } from "../src/services/notifications.js";
import { getEventReview } from "../src/services/reviews.js";
import { refreshEventAgentTasks, updateAgentTaskStatus } from "../src/services/agent.js";
import { listEventFeedback, submitEventFeedback } from "../src/services/feedbacks.js";
import { createEventResource, listEventResources } from "../src/services/resources.js";
import { recordAttributionEvent } from "../src/services/attribution.js";

const testDbUrl = `file:${fileURLToPath(new URL("../prisma/test.db", import.meta.url))}`;
const db = new PrismaClient({ datasources: { db: { url: testDbUrl } } });

async function clean() {
  await db.payment.deleteMany();
  await db.order.deleteMany();
  await db.checkIn.deleteMany();
  await db.notificationSubscription.deleteMany();
  await db.interestSubscription.deleteMany();
  await db.eventFeedback.deleteMany();
  await db.attributionEvent.deleteMany();
  await db.waitlistEntry.deleteMany();
  await db.registration.deleteMany();
  await db.registrationForm.deleteMany();
  await db.eventPage.deleteMany();
  await db.eventResource.deleteMany();
  await db.budgetPlan.deleteMany();
  await db.sponsorPlan.deleteMany();
  await db.channel.deleteMany();
  await db.material.deleteMany();
  await db.agentTask.deleteMany();
  await db.eventReview.deleteMany();
  await db.eventSocialProfile.deleteMany();
  await db.ticketTypeQuota.deleteMany();
  await db.ticketType.deleteMany();
  await db.quota.deleteMany();
  await db.event.deleteMany();
  await db.hostProfile.deleteMany();
  await db.organizerMember.deleteMany();
  await db.organizer.deleteMany();
  await db.user.deleteMany();
}

/** 建一个 capacity 名额的活动 + 一个用户 */
async function seed(capacity: number | null, kind: "paid" | "free" | "approval" = "paid") {
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
    kind,
    priceCents: kind === "paid" ? 19900 : 0,
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
    const payment = await db.payment.findUniqueOrThrow({ where: { orderId: r.orderId } });
    expect(payment.provider).toBe("mock");
    expect(payment.txnId).toContain(`mock_${r.orderId}`);
    expect(payment.paidAt).toBeTruthy();

    const quotaAfter = await db.quota.findFirstOrThrow();
    expect(quotaAfter.used).toBe(1);

    const checked = await checkin(db, r.registrationId, "staff-1");
    expect(checked.registration.status).toBe("checked_in");
    expect(checked.checkIn.userId).toBe(user.id);
    expect(checked.checkIn.by).toBe("staff-1");
    const reg = await db.registration.findUniqueOrThrow({ where: { id: r.registrationId } });
    expect(reg.status).toBe("checked_in");
    await expect(checkin(db, r.registrationId)).rejects.toBeInstanceOf(DuplicateCheckinError);
  });

  it("全额退款：释放库存 + 取消报名", async () => {
    const { event, ticketType, user } = await seed(2);
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "林晨" } });
    await complete(db, r.orderId);
    expect((await db.quota.findFirstOrThrow()).used).toBe(1);

    const res = await refundOrder(db, r.orderId);
    expect(res.refundStatus).toBe("full");
    expect(res.refundedAmountCents).toBe(19900);

    const order = await db.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(order.refund_status).toBe("full");
    expect(order.refundedAmountCents).toBe(19900);
    expect((await db.quota.findFirstOrThrow()).used).toBe(0);
    expect((await db.registration.findUniqueOrThrow({ where: { id: r.registrationId } })).status).toBe("cancelled");
  });

  it("部分退款：记账但不释放库存，再退到全额会取消", async () => {
    const { event, ticketType, user } = await seed(2);
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "林晨" } });
    await complete(db, r.orderId);

    const partial = await refundOrder(db, r.orderId, { amountCents: 5000 });
    expect(partial.refundStatus).toBe("partial");
    let order = await db.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(order.refundedAmountCents).toBe(5000);
    expect((await db.quota.findFirstOrThrow()).used).toBe(1); // 未释放

    const rest = await refundOrder(db, r.orderId); // 退剩余
    expect(rest.refundStatus).toBe("full");
    order = await db.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(order.refundedAmountCents).toBe(19900);
    expect((await db.quota.findFirstOrThrow()).used).toBe(0);
  });

  it("未支付订单退款报错", async () => {
    const { event, ticketType, user } = await seed(2);
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "林晨" } });
    await expect(refundOrder(db, r.orderId)).rejects.toBeInstanceOf(RefundError);
  });

  it("早鸟价：截止前按早鸟价下单", async () => {
    const org = await db.organizer.create({ data: { name: "早鸟主办方", whitelisted: true } });
    const event = await createEvent(db, { organizerId: org.id, title: "早鸟局", city: "上海", startAt: new Date("2026-08-01T19:00:00Z") });
    const { ticketType } = await createTicketTypeWithQuota(db, {
      eventId: event.id, name: "早鸟票", kind: "paid", priceCents: 19900, capacity: 50,
      earlyBirdPriceCents: 9900, earlyBirdUntil: new Date("2026-07-01T00:00:00Z"),
    });
    const user = await upsertUser(db, "u_eb_" + Math.random().toString(36).slice(2));
    const r = await reserve(db, {
      eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "林晨" },
      now: new Date("2026-06-20T00:00:00Z"),
    });
    const order = await db.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(order.amountCents).toBe(9900);
  });

  it("邀请码票：无码/错码报错，对码放行", async () => {
    const org = await db.organizer.create({ data: { name: "邀请码主办方", whitelisted: true } });
    const event = await createEvent(db, { organizerId: org.id, title: "内部局", city: "上海", startAt: new Date("2026-08-01T19:00:00Z") });
    const { ticketType } = await createTicketTypeWithQuota(db, {
      eventId: event.id, name: "邀请票", kind: "paid", priceCents: 0, capacity: 50, inviteCode: "VIP2026",
    });
    const user = await upsertUser(db, "u_ic_" + Math.random().toString(36).slice(2));
    await expect(reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "A" } }))
      .rejects.toBeInstanceOf(InviteCodeError);
    await expect(reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "A" }, inviteCode: "wrong" }))
      .rejects.toBeInstanceOf(InviteCodeError);
    const ok = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "A" }, inviteCode: "VIP2026" });
    expect(ok.registrationId).toBeTruthy();
  });

  it("现场重点标记落库", async () => {
    const { event, ticketType, user } = await seed(2);
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "林晨" } });
    const tagged = await setRegistrationTag(db, r.registrationId, "vip");
    expect(tagged.tag).toBe("vip");
    const cleared = await setRegistrationTag(db, r.registrationId, "bogus");
    expect(cleared.tag).toBeNull(); // 非法值清空
  });

  it("用户票夹能列出自己的报名状态和订单状态", async () => {
    const { event, ticketType, user } = await seed(2);
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "林晨" } });
    await complete(db, r.orderId);

    const items = await listUserRegistrations(db, user.id);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      registrationId: r.registrationId,
      eventId: event.id,
      title: "AI 产品人深夜局",
      status: "approved",
      ticketName: "标准票",
      amountCents: 19900,
      orderLifecycle: "completed",
      paymentStatus: "paid",
    });
    expect(items[0].checkinToken).toMatch(/[0-9a-f-]{36}/);
    expect(JSON.parse(items[0].checkinPayload || "{}")).toMatchObject({
      type: "loopin.checkin",
      eventId: event.id,
      registrationId: r.registrationId,
      token: items[0].checkinToken,
    });
  });

  it("会后页复盘接口能派生活动指标和后续动作", async () => {
    const { event, ticketType, user } = await seed(3);
    const r = await reserve(db, {
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: user.id,
      formValues: { name: "林晨", role: "AI 产品负责人", company: "增长品牌实验室", source: "wechat_group", note: "可以分享真实案例，也愿意聊合作" },
    });
    await complete(db, r.orderId);
    await checkin(db, r.registrationId, "staff-1");
    await db.material.createMany({
      data: [
        { eventId: event.id, channel: "wechat_group", content: "微信群招募话术" },
        { eventId: event.id, channel: "xiaohongshu", content: "小红书招募笔记" },
      ],
    });
    await createEventResource(db, event.id, {
      title: "会后重点笔记",
      type: "notes",
      url: "https://loopin.llmxy.xyz/demo/notes",
      description: "现场问题和延伸阅读",
    });
    await createEventResource(db, event.id, {
      title: "组织者内部复盘",
      type: "link",
      url: "https://loopin.llmxy.xyz/demo/private",
      visibility: "organizer",
    });

    const review = await getEventReview(db, event.id, new Date("2026-06-15T00:00:00.000Z"));

    expect(review?.event.ended).toBe(true);
    expect(review?.metrics).toMatchObject({
      totalRegistrations: 1,
      confirmed: 1,
      checkedIn: 1,
      showUpRate: 100,
    });
    expect(review?.metrics.revenueCents).toBe(19900);
    expect(review?.audience.roles[0]).toMatchObject({ label: "AI 产品负责人", count: 1 });
    expect(review?.audience.segments.find((segment) => segment.key === "potential_guests")?.count).toBe(1);
    expect(review?.audience.segments.find((segment) => segment.key === "potential_sponsors")?.count).toBe(1);
    expect(review?.resourcePack[0]).toMatchObject({
      title: "会后重点笔记",
      status: "ready",
      url: "https://loopin.llmxy.xyz/demo/notes",
      detail: "现场问题和延伸阅读",
      source: "uploaded",
    });
    expect(review?.resourcePack.find((item) => item.title === "组织者内部复盘")).toBeUndefined();
    expect(review?.feedback.questions).toContain("你希望下一场继续聊什么？");
    expect(review?.nextTopics.length).toBeGreaterThan(0);
    expect(review?.growth.channelAttribution.channels[0]).toMatchObject({
      key: "wechat_group",
      label: "微信群",
      registrations: 1,
      confirmed: 1,
      checkedIn: 1,
      materialVersions: 1,
      conversionRate: 100,
      showUpRate: 100,
    });
    expect(review?.growth.channelAttribution.channels.find((channel) => channel.key === "xiaohongshu")).toMatchObject({
      registrations: 0,
      materialVersions: 1,
    });
    expect(review?.growth.reinviteScripts.find((script) => script.segmentKey === "high_intent")?.copy).toContain("优先名额");
    expect(review?.takeaways.length).toBeGreaterThan(0);
    expect(review?.nextActions).toContain("按渠道归因复投高转化入口");
  });

  it("会后复盘渠道归因优先使用 UTM 来源", async () => {
    const { event, ticketType, user } = await seed(3);
    const r = await reserve(db, {
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: user.id,
      formValues: {
        name: "林晨",
        source: "wechat_group",
        utm_source: "xiaohongshu",
        utm_medium: "mini_program",
        utm_campaign: "event_share",
        utm_content: "ai_materials",
        referrer: "studio_materials",
      },
    });
    await complete(db, r.orderId);

    const review = await getEventReview(db, event.id, new Date("2026-06-15T00:00:00.000Z"));

    expect(review?.growth.channelAttribution.channels[0]).toMatchObject({
      key: "xiaohongshu",
      label: "小红书",
      registrations: 1,
      confirmed: 1,
    });
    expect(review?.growth.channelAttribution.channels[0].contents?.[0]).toMatchObject({ label: "ai_materials", count: 1 });
    expect(review?.growth.channelAttribution.channels[0].referrers?.[0]).toMatchObject({ label: "studio_materials", count: 1 });
    expect(review?.growth.channelAttribution.channels[0].insight).toContain("主要入口 studio_materials");
  });

  it("会后复盘能展示 UTM 引流漏斗", async () => {
    const { event, ticketType, user } = await seed(3);
    await recordAttributionEvent(db, {
      type: "event_detail_view",
      eventId: event.id,
      userId: user.id,
      path: "/pages/event-detail/index",
      attribution: {
        utm_source: "xiaohongshu",
        utm_medium: "mini_program",
        utm_campaign: "event_recruit",
        utm_content: "ops_link",
        referrer: "studio_operations",
      },
    });
    await recordAttributionEvent(db, {
      type: "registration_intent",
      eventId: event.id,
      userId: user.id,
      path: "/pages/event-detail/index",
      attribution: { utm_source: "xiaohongshu", utm_campaign: "event_recruit" },
    });
    await recordAttributionEvent(db, {
      type: "registration_submit",
      eventId: event.id,
      userId: user.id,
      path: "/pages/register/index",
      attribution: { utm_source: "xiaohongshu", utm_campaign: "event_recruit" },
    });
    const r = await reserve(db, {
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: user.id,
      formValues: {
        name: "林晨",
        utm_source: "xiaohongshu",
        utm_campaign: "event_recruit",
      },
    });
    await recordAttributionEvent(db, {
      type: "registration_reserved",
      eventId: event.id,
      registrationId: r.registrationId,
      userId: user.id,
      attribution: { utm_source: "xiaohongshu", utm_campaign: "event_recruit" },
    });

    const review = await getEventReview(db, event.id, new Date("2026-06-15T00:00:00.000Z"));

    expect(review?.growth.attributionFunnel.total).toMatchObject({
      detailViews: 1,
      registrationIntents: 1,
      registrationSubmits: 1,
      registrationReservations: 1,
      detailToIntentRate: 100,
      intentToSubmitRate: 100,
      submitToReservedRate: 100,
    });
    expect(review?.growth.attributionFunnel.channels[0]).toMatchObject({
      key: "xiaohongshu",
      label: "小红书",
      detailViews: 1,
      registrationReservations: 1,
    });
  });

  it("会后复盘能把活动平台和合作转发渠道显示成中文", async () => {
    const { event, user } = await seed(3);
    for (const source of ["huodongxing", "guest_share", "community_partner"]) {
      await recordAttributionEvent(db, {
        type: "event_detail_view",
        eventId: event.id,
        userId: user.id,
        path: "/pages/event-detail/index",
        attribution: { utm_source: source, utm_campaign: "event_recruit" },
      });
    }

    const review = await getEventReview(db, event.id, new Date("2026-06-15T00:00:00.000Z"));

    expect(review?.growth.attributionFunnel.channels.find((channel) => channel.key === "huodongxing")).toMatchObject({ label: "活动行", detailViews: 1 });
    expect(review?.growth.attributionFunnel.channels.find((channel) => channel.key === "guest_share")).toMatchObject({ label: "嘉宾转发", detailViews: 1 });
    expect(review?.growth.attributionFunnel.channels.find((channel) => channel.key === "community_partner")).toMatchObject({ label: "社群合作", detailViews: 1 });
  });

  it("活动资料链接可落库并用于会后资料包", async () => {
    const { event } = await seed(3);

    const resource = await createEventResource(db, event.id, {
      title: "活动回放",
      type: "recording",
      url: "https://loopin.llmxy.xyz/demo/replay",
      description: "60 分钟现场回放",
    });

    expect(resource).toMatchObject({
      title: "活动回放",
      type: "recording",
      visibility: "attendee",
    });

    const listed = await listEventResources(db, event.id);
    expect(listed.resources[0]).toMatchObject({ title: "活动回放", url: "https://loopin.llmxy.xyz/demo/replay" });

    const review = await getEventReview(db, event.id, new Date("2026-06-15T00:00:00.000Z"));
    expect(review?.resourcePack[0]).toMatchObject({
      title: "活动回放",
      type: "recording",
      status: "ready",
      source: "uploaded",
    });
    expect(review?.takeaways).toContain("已补 1 个会后资料入口，可直接给参与者同步。");
  });

  it("活动反馈提交后会进入复盘摘要", async () => {
    const { event, ticketType, user } = await seed(3);
    const r = await reserve(db, {
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: user.id,
      formValues: { name: "林晨", role: "AI 产品负责人" },
    });
    await complete(db, r.orderId);

    const feedback = await submitEventFeedback(db, event.id, {
      userId: user.id,
      registrationId: r.registrationId,
      rating: 5,
      valuable: "真实案例和现场拆解最有价值",
      nextTopic: "AI Agent 商业化复盘",
      roleInterest: "愿意作为嘉宾",
      note: "下一场可以多留一点互动时间",
    });

    expect(feedback.rating).toBe(5);
    expect(feedback.registrationId).toBe(r.registrationId);

    const listed = await listEventFeedback(db, event.id);
    expect(listed.summary).toMatchObject({
      total: 1,
      averageRating: 5,
    });
    expect(listed.summary.nextTopics[0]).toMatchObject({ label: "AI Agent 商业化复盘", count: 1 });

    const review = await getEventReview(db, event.id, new Date("2026-06-15T00:00:00.000Z"));
    expect(review?.feedback.total).toBe(1);
    expect(review?.feedback.averageRating).toBe(5);
    expect(review?.feedback.recent[0]).toMatchObject({
      valuable: "真实案例和现场拆解最有价值",
      roleInterest: "愿意作为嘉宾",
    });
  });

  it("Agent 运营建议会按活动进度生成任务并支持状态流转", async () => {
    const { event, ticketType, user } = await seed(1);
    await db.budgetPlan.create({
      data: {
        eventId: event.id,
        input: "{}",
        result: JSON.stringify({ breakEvenAttendees: 3 }),
      },
    });
    const first = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "先到" } });
    await complete(db, first.orderId);
    const waitUser = await upsertUser(db, "u_agent_waitlist");
    await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: waitUser.id, formValues: { name: "候补" } });

    const result = await refreshEventAgentTasks(db, event.id, new Date("2026-06-13T18:00:00.000Z"));

    const titles = result?.tasks.map((task) => task.title) ?? [];
    expect(titles).toContain("处理候补名单");
    expect(titles).toContain("报名未达保本");
    expect(titles).toContain("补推广物料");
    expect(titles).toContain("检查活动提醒");
    expect(result?.tasks.find((task) => task.title === "报名未达保本")?.highRisk).toBe(true);

    await refreshEventAgentTasks(db, event.id, new Date("2026-06-13T18:00:00.000Z"));
    expect(await db.agentTask.count({ where: { eventId: event.id } })).toBe(result?.tasks.length);

    const waitlistTask = result?.tasks.find((task) => task.title === "处理候补名单");
    expect(waitlistTask).toBeTruthy();
    const updated = await updateAgentTaskStatus(db, waitlistTask!.id, "accepted");
    expect(updated?.status).toBe("accepted");
  });

  it("结构化核验 payload 可签到，错 token 和重复扫会被拦住", async () => {
    const { event, ticketType, user } = await seed(3);
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "扫码用户" } });
    await complete(db, r.orderId);
    const reg = await db.registration.findUniqueOrThrow({ where: { id: r.registrationId } });

    const urlPayload = `loopin://checkin?eventId=${event.id}&registrationId=${r.registrationId}&token=${reg.checkinToken}`;
    const checked = await checkinByToken(db, { payload: urlPayload, by: "scanner-1" });

    expect(checked.registration.status).toBe("checked_in");
    expect(checked.checkIn.by).toBe("scanner-1");
    await expect(checkinByToken(db, { payload: urlPayload })).rejects.toBeInstanceOf(DuplicateCheckinError);

    const r2 = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "错码用户" } });
    await complete(db, r2.orderId);
    const badPayload = buildCheckinPayload(event.id, r2.registrationId, "wrong-token");

    await expect(checkinByToken(db, { payload: badPayload || "" })).rejects.toBeInstanceOf(CheckinTokenError);
  });

  it("微信登录后合并本地临时用户，票夹不丢", async () => {
    const { event, ticketType } = await seed(2);
    const localUser = await db.user.create({ data: { id: "wx_local_test_merge", nickname: "本地用户" } });
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: localUser.id, formValues: { name: "林晨" } });
    await complete(db, r.orderId);

    const login = await loginWithWechatCode(db, {
      localUserId: localUser.id,
      devOpenid: "openid_test_merge",
      nickname: "微信用户",
    });

    expect(login.mode).toBe("wechat");
    expect(login.user.openid).toBe("openid_test_merge");
    expect(login.user.id).toBe(localUser.id);
    const items = await listUserRegistrations(db, login.user.id);
    expect(items).toHaveLength(1);
    expect(items[0].registrationId).toBe(r.registrationId);
  });

  it("已有 openid 用户再次登录时，临时用户报名迁移到该用户", async () => {
    const { event, ticketType } = await seed(2);
    const wechatUser = await db.user.create({ data: { openid: "openid_existing", nickname: "老用户" } });
    const localUser = await db.user.create({ data: { id: "wx_local_existing_merge" } });
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: localUser.id, formValues: { name: "林晨" } });

    const login = await loginWithWechatCode(db, { localUserId: localUser.id, devOpenid: "openid_existing" });

    expect(login.user.id).toBe(wechatUser.id);
    expect(await db.user.findUnique({ where: { id: localUser.id } })).toBeNull();
    const items = await listUserRegistrations(db, wechatUser.id);
    expect(items[0].registrationId).toBe(r.registrationId);
  });

  it("手机号授权后绑定到当前用户，票夹接口可继续按 userId 查询", async () => {
    const { user } = await seed(2);

    const result = await bindUserPhone(db, user.id, "13800138000");

    expect(result.maskedPhone).toBe("138****8000");
    const saved = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(saved.phone).toBe("13800138000");
  });

  it("先授权手机号时会创建本地用户，避免前端时序导致 500", async () => {
    const result = await bindUserPhone(db, "wx_local_phone_first", "13800138000");

    expect(result.user.id).toBe("wx_local_phone_first");
    expect(result.user.phone).toBe("13800138000");
  });

  it("AI Designer 活动页文案会持久化到 EventPage", async () => {
    const { event } = await seed(2);

    await setEventPage(db, event.id, {
      highlights: ["真实拆解工作流", "现场交流落地坑"],
      agenda: ["签到与破冰", "主题分享", "自由交流"],
      faq: [{ q: "适合谁？", a: "适合 AI 产品经理。" }],
    });

    const saved = await db.event.findUniqueOrThrow({
      where: { id: event.id },
      include: { page: true },
    });

    expect(saved.page?.template).toBe("ai_designer");
    expect(JSON.parse(saved.page?.highlights || "[]")).toEqual(["真实拆解工作流", "现场交流落地坑"]);
    expect(JSON.parse(saved.page?.agenda || "[]")).toEqual(["签到与破冰", "主题分享", "自由交流"]);
    expect(JSON.parse(saved.page?.faq || "[]")).toEqual([{ q: "适合谁？", a: "适合 AI 产品经理。" }]);
  });

  it("审核票报名先保持待确认，通过后才确认并占用名额", async () => {
    const { event, ticketType, user } = await seed(1, "approval");

    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "林晨" } });

    expect(r.requiresApproval).toBe(true);
    expect(r.reservedUntil).toBeNull();
    let reg = await db.registration.findUniqueOrThrow({ where: { id: r.registrationId } });
    expect(reg.status).toBe("submitted");
    expect((await db.quota.findFirstOrThrow()).used).toBe(0);

    const approved = await approveRegistration(db, r.registrationId);

    expect(approved.registration.status).toBe("approved");
    expect(approved.order?.lifecycle).toBe("completed");
    expect(approved.order?.payment_status).toBe("paid");
    expect(approved.payment?.provider).toBe("mock");
    expect((await db.quota.findFirstOrThrow()).used).toBe(1);
  });

  it("审核票拒绝后不占用库存，订单进入取消态", async () => {
    const { event, ticketType, user } = await seed(1, "approval");
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "林晨" } });

    const rejected = await rejectRegistration(db, r.registrationId);

    expect(rejected.status).toBe("rejected");
    const order = await db.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(order.lifecycle).toBe("cancelled");
    expect((await db.quota.findFirstOrThrow()).used).toBe(0);
  });
});

describe("防超卖（守住 Hi.Events 的坑）", () => {
  it("capacity=2 时第 3 个报名进入候补，不抢占库存", async () => {
    const { event, ticketType, user } = await seed(2);
    const mk = () => reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {} });
    const o1 = await mk();
    const o2 = await mk();
    const w = await mk();

    expect(w.status).toBe("waitlisted");
    expect(w.orderId).toBeNull();
    expect(w.waitlist?.position).toBe(1);

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

describe("订阅提醒", () => {
  it("未配置微信模板或 AppSecret 时，定时任务安全跳过待发提醒", async () => {
    const oldTemplate = process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
    const oldSecret = process.env.WX_APPSECRET;
    delete process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
    delete process.env.WX_APPSECRET;
    try {
      const { event, user } = await seed(2);
      await saveEventReminderSubscription(db, { userId: user.id, eventId: event.id, accepted: true });

      const result = await sendDueEventReminders(db, { now: new Date("2026-06-13T20:00:00.000Z") });

      expect(result).toMatchObject({ ok: true, task: "sendEventReminders", configured: false, checked: 1, skipped: 1, sent: 0 });
      const sub = await db.notificationSubscription.findFirstOrThrow();
      expect(sub.sentAt).toBeNull();
    } finally {
      if (oldTemplate === undefined) delete process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
      else process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID = oldTemplate;
      if (oldSecret === undefined) delete process.env.WX_APPSECRET;
      else process.env.WX_APPSECRET = oldSecret;
    }
  });

  it("到期提醒会调用微信订阅消息接口并标记已发送", async () => {
    const oldTemplate = process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
    const oldAppId = process.env.WX_APPID;
    const oldSecret = process.env.WX_APPSECRET;
    process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID = "tmpl_event_reminder";
    process.env.WX_APPID = "wx_test_appid";
    process.env.WX_APPSECRET = "wx_test_secret";
    try {
      const { event, user } = await seed(2);
      await db.user.update({ where: { id: user.id }, data: { openid: "openid_event_reminder" } });
      await saveEventReminderSubscription(db, { userId: user.id, eventId: event.id, accepted: true });

      const calls: { url: string; body: unknown }[] = [];
      const fakeFetch = async (url: URL | RequestInfo, init?: RequestInit) => {
        const textUrl = String(url);
        calls.push({ url: textUrl, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (textUrl.includes("/cgi-bin/token")) {
          return new Response(JSON.stringify({ access_token: "access_token_test", expires_in: 7200 }), { status: 200 });
        }
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 });
      };

      const result = await sendDueEventReminders(db, { now: new Date("2026-06-13T20:00:00.000Z"), fetcher: fakeFetch as typeof fetch });

      expect(result).toMatchObject({ configured: true, checked: 1, sent: 1, failed: 0 });
      expect(calls[1].url).toContain("/cgi-bin/message/subscribe/send");
      expect(calls[1].body).toMatchObject({
        touser: "openid_event_reminder",
        template_id: "tmpl_event_reminder",
        page: `pages/event-detail/index?eventId=${event.id}`,
      });
      const sub = await db.notificationSubscription.findFirstOrThrow();
      expect(sub.sentAt?.toISOString()).toBe("2026-06-13T20:00:00.000Z");
    } finally {
      if (oldTemplate === undefined) delete process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
      else process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID = oldTemplate;
      if (oldAppId === undefined) delete process.env.WX_APPID;
      else process.env.WX_APPID = oldAppId;
      if (oldSecret === undefined) delete process.env.WX_APPSECRET;
      else process.env.WX_APPSECRET = oldSecret;
    }
  });

  it("后台可对单个用户发送测试提醒并标记订阅已发送", async () => {
    const oldTemplate = process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
    const oldAppId = process.env.WX_APPID;
    const oldSecret = process.env.WX_APPSECRET;
    process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID = "tmpl_event_reminder";
    process.env.WX_APPID = "wx_test_appid";
    process.env.WX_APPSECRET = "wx_test_secret";
    try {
      const { event, user } = await seed(2);
      await db.user.update({ where: { id: user.id }, data: { openid: "openid_test_reminder" } });
      const subscription = await saveEventReminderSubscription(db, { userId: user.id, eventId: event.id, accepted: true });

      const calls: { url: string; body: unknown }[] = [];
      const fakeFetch = async (url: URL | RequestInfo, init?: RequestInit) => {
        const textUrl = String(url);
        calls.push({ url: textUrl, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (textUrl.includes("/cgi-bin/token")) {
          return new Response(JSON.stringify({ access_token: "access_token_test", expires_in: 7200 }), { status: 200 });
        }
        return new Response(JSON.stringify({ errcode: 0, errmsg: "ok" }), { status: 200 });
      };

      const result = await sendEventReminderTest(db, {
        eventId: event.id,
        userId: user.id,
        now: new Date("2026-06-12T10:00:00.000Z"),
        fetcher: fakeFetch as typeof fetch,
      });

      expect(result).toMatchObject({
        task: "sendEventReminderTest",
        configured: true,
        userId: user.id,
        subscriptionId: subscription.id,
        readiness: { canSend: true, missing: [], alreadySent: false },
        sent: 1,
        skipped: 0,
        failed: 0,
        page: `pages/event-detail/index?eventId=${event.id}`,
      });
      expect(calls[1].body).toMatchObject({
        touser: "openid_test_reminder",
        template_id: "tmpl_event_reminder",
        page: `pages/event-detail/index?eventId=${event.id}`,
      });
      const updated = await db.notificationSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
      expect(updated.sentAt?.toISOString()).toBe("2026-06-12T10:00:00.000Z");
    } finally {
      if (oldTemplate === undefined) delete process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
      else process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID = oldTemplate;
      if (oldAppId === undefined) delete process.env.WX_APPID;
      else process.env.WX_APPID = oldAppId;
      if (oldSecret === undefined) delete process.env.WX_APPSECRET;
      else process.env.WX_APPSECRET = oldSecret;
    }
  });
});

describe("预留过期回收", () => {
  it("过期 reserved 单被 sweep 成 abandoned，名额释放后可再预留", async () => {
    const { event, ticketType, user } = await seed(1);
    const t0 = new Date("2026-06-06T00:00:00.000Z");
    await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {}, now: t0 });
    // 容量 1 已被软占，此刻再报进入候补
    const waitlisted = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {}, now: t0 });
    expect(waitlisted.status).toBe("waitlisted");

    const t1 = new Date(t0.getTime() + 20 * 60000); // 20 分钟后，预留已过期
    const swept = await sweepExpired(db, t1);
    expect(swept).toBe(1);

    // 释放后可再预留
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {}, now: t1 });
    expect(r.orderId).toBeTruthy();
  });

  it("maintenance task 复用 sweepExpired，可给 FC timer 或本地 CLI 调用", async () => {
    const { event, ticketType, user } = await seed(1);
    const t0 = new Date("2026-06-06T00:00:00.000Z");
    const r = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: {}, now: t0 });
    await db.order.update({ where: { id: r.orderId }, data: { reservedUntil: new Date("2026-06-05T23:59:00.000Z") } });

    const result = await runMaintenanceTask(db, Buffer.from(JSON.stringify({ task: "sweepExpired" })));

    expect(result).toEqual({ ok: true, task: "sweepExpired", swept: 1 });
    const order = await db.order.findUniqueOrThrow({ where: { id: r.orderId } });
    expect(order.lifecycle).toBe("abandoned");
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

describe("候补放票", () => {
  it("满额后报名进入候补，写入 position / offerToken / expiry", async () => {
    const { event, ticketType, user } = await seed(1);
    const first = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "先到" } });
    await complete(db, first.orderId);

    const secondUser = await upsertUser(db, "u_waitlist_1");
    const waitlisted = await reserve(db, {
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: secondUser.id,
      formValues: { name: "候补" },
      now: new Date("2026-06-06T00:00:00.000Z"),
    });

    expect(waitlisted.status).toBe("waitlisted");
    expect(waitlisted.orderId).toBeNull();
    expect(waitlisted.waitlist?.position).toBe(1);
    expect(waitlisted.waitlist?.offerToken).toMatch(/[0-9a-f-]{36}/);
    expect(waitlisted.waitlist?.offerExpiresAt?.toISOString()).toBe("2026-06-07T00:00:00.000Z");

    const items = await listUserRegistrations(db, secondUser.id);
    expect(items[0]).toMatchObject({
      status: "waitlisted",
      waitlistPosition: 1,
      waitlistStatus: "waiting",
      orderLifecycle: null,
      paymentStatus: null,
    });
  });

  it("释放名额后，候补可转正并生成 completed mock 订单", async () => {
    const { event, ticketType, user } = await seed(1);
    const first = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "先到" } });
    await complete(db, first.orderId);
    const waitUser = await upsertUser(db, "u_waitlist_2");
    const waitlisted = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: waitUser.id, formValues: { name: "候补" } });

    await cancel(db, first.orderId);
    expect((await db.quota.findFirstOrThrow()).used).toBe(0);

    const promoted = await promoteWaitlistRegistration(db, waitlisted.registrationId);

    expect(promoted.registration.status).toBe("approved");
    expect(promoted.order.lifecycle).toBe("completed");
    expect(promoted.order.payment_status).toBe("paid");
    expect(promoted.payment.provider).toBe("mock");
    expect(promoted.payment.txnId).toContain(`mock_${promoted.order.id}`);
    expect(promoted.waitlistEntry.status).toBe("promoted");
    expect((await db.quota.findFirstOrThrow()).used).toBe(1);
  });

  it("没有空位时，候补转正仍被 DB 条件更新拦住", async () => {
    const { event, ticketType, user } = await seed(1);
    const first = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: { name: "先到" } });
    await complete(db, first.orderId);
    const waitUser = await upsertUser(db, "u_waitlist_3");
    const waitlisted = await reserve(db, { eventId: event.id, ticketTypeId: ticketType.id, userId: waitUser.id, formValues: { name: "候补" } });

    await expect(promoteWaitlistRegistration(db, waitlisted.registrationId)).rejects.toBeInstanceOf(OversellError);
    expect((await db.quota.findFirstOrThrow()).used).toBe(1);
  });
});
