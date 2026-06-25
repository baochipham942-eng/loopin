import { prisma } from "./db.js";
import { createEvent, createTicketTypeWithQuota, setEventForm, setEventPage, upsertUser } from "./services/catalog.js";
import { reserve, complete } from "./services/registration.js";
import { calcBudget, recommendFields, type BudgetInput } from "@loopin/core";

/** 重置并灌入一个 demo 活动（含盈亏快照 + 2 个已报名），三个视图都能直接看。
 *  pnpm --filter @loopin/api seed */
async function main() {
  // 清空（FK 顺序）
  await prisma.payment.deleteMany(); // Payment 外键引用 Order，必须先删（否则二次 seed 触发 FK 报错）
  await prisma.order.deleteMany();
  await prisma.checkIn.deleteMany();
  await prisma.notificationSubscription.deleteMany();
  await prisma.eventFeedback.deleteMany();
  await prisma.attributionEvent.deleteMany();
  await prisma.interestSubscription.deleteMany();
  await prisma.eventSocialProfile.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.budgetPlan.deleteMany();
  await prisma.sponsorPlan.deleteMany();
  await prisma.eventResource.deleteMany();
  await prisma.topicSignal.deleteMany();
  await prisma.registrationForm.deleteMany();
  await prisma.eventPage.deleteMany();
  await prisma.material.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.agentTask.deleteMany();
  await prisma.eventReview.deleteMany();
  await prisma.ticketTypeQuota.deleteMany();
  await prisma.ticketType.deleteMany();
  await prisma.quota.deleteMany();
  await prisma.event.deleteMany();
  await prisma.organizerMember.deleteMany();
  await prisma.hostProfile.deleteMany(); // HostProfile 外键引用 Organizer，必须先删
  await prisma.organizer.deleteMany();
  await prisma.user.deleteMany();

  const org = await prisma.organizer.create({
    data: {
      name: "Loopin × AI 产品社区",
      whitelisted: true,
      hostProfile: {
        create: {
          bio: "上海 AI 产品人的线下社区，每月一场深夜局，聚焦真实落地与同频连接。",
          links: JSON.stringify([
            { label: "公众号", url: "https://mp.weixin.qq.com/loopin" },
            { label: "小红书", url: "https://xiaohongshu.com/loopin" },
          ]),
        },
      },
    },
  });
  await prisma.organizerMember.create({
    data: {
      organizerId: org.id,
      name: "主办方管理员",
      email: "ops@loopin.local",
      role: "admin",
      permissions: JSON.stringify(["events:write", "registrations:write", "checkin:write", "exports:read", "team:write"]),
      status: "active",
    },
  });
  const event = await createEvent(prisma, {
    organizerId: org.id,
    title: "AI 产品人深夜局 · 上海",
    city: "上海",
    startAt: new Date("2026-06-14T19:00:00+08:00"),
    venue: "静安寺 · Loopin Space",
  });
  const { ticketType } = await createTicketTypeWithQuota(prisma, {
    eventId: event.id,
    name: "标准票",
    kind: "paid",
    priceCents: 19900,
    capacity: 50,
  });
  await setEventForm(prisma, event.id, { fields: recommendFields("ai_sharing") });
  await setEventPage(prisma, event.id, {
    template: "ai_designer",
    highlights: ["真实拆解 AI PM 工作流", "现场交流 Agent 落地坑", "认识同频产品和创业伙伴"],
    agenda: ["签到与破冰", "主题分享：Agent 如何重构 PM 工作流", "圆桌讨论：团队落地的坑", "自由交流与组队"],
    faq: [
      { q: "适合零基础吗？", a: "适合对 AI 产品和 Agent 工作流感兴趣的人，会从真实案例讲起。" },
      { q: "需要带电脑吗？", a: "不强制，想现场试工作流的同学可以带电脑。" },
      { q: "报名后怎么确认？", a: "完成报名后可在小程序我的活动里查看票夹状态。" },
    ],
  });
  await prisma.channel.createMany({
    data: [
      { eventId: event.id, name: "微信群", utm: "wechat_group" },
      { eventId: event.id, name: "朋友圈", utm: "moments" },
      { eventId: event.id, name: "小红书", utm: "xiaohongshu" },
    ],
  });
  await prisma.material.createMany({
    data: [
      { eventId: event.id, channel: "wechat_group", content: "微信群招募话术：AI 产品人深夜局，本周日静安寺见。" },
      { eventId: event.id, channel: "moments", content: "朋友圈文案：和同频 AI 产品人面对面聊 Agent 工作流。" },
      { eventId: event.id, channel: "xiaohongshu", content: "小红书笔记：上海 AI 产品人线下局，真实拆解工作流。" },
    ],
  });
  await prisma.eventResource.createMany({
    data: [
      {
        eventId: event.id,
        title: "会后重点笔记",
        type: "notes",
        url: "https://loopin.llmxy.xyz/demo/ai-pm-night-notes",
        description: "议程重点、现场问题和延伸阅读入口",
      },
      {
        eventId: event.id,
        title: "讲师演示文稿",
        type: "slides",
        url: "https://loopin.llmxy.xyz/demo/ai-pm-night-slides",
        description: "Agent 工作流案例拆解 slides",
      },
    ],
  });
  await prisma.eventSocialProfile.createMany({
    data: [
      {
        eventId: event.id,
        kind: "host",
        name: "林晨",
        headline: "Loopin 发起人 · AI 产品与增长 PM",
        bio: "长期研究 AI 产品、活动增长和同频社群，负责这场活动的议题设计和现场串联。",
        tags: JSON.stringify(["AI 产品", "增长", "活动主办"]),
        links: JSON.stringify([{ label: "Loopin", url: "https://loopin.llmxy.xyz" }]),
        visibility: "public",
        sortOrder: 1,
      },
      {
        eventId: event.id,
        kind: "speaker",
        name: "苏三",
        headline: "Agent 工作流实践者",
        bio: "分享从个人效率到团队流程的 Agent 落地经验，重点讲真实使用场景和踩坑。",
        tags: JSON.stringify(["Agent", "工作流", "效率工具"]),
        links: JSON.stringify([]),
        visibility: "public",
        sortOrder: 2,
      },
      {
        eventId: event.id,
        kind: "guest",
        name: "Laura",
        headline: "AI 产品设计与研究",
        bio: "关注 AI 原生产品的体验结构和用户研究方法。",
        tags: JSON.stringify(["产品设计", "用户研究", "AI 原生"]),
        links: JSON.stringify([]),
        visibility: "public",
        sortOrder: 3,
      },
    ],
  });
  await prisma.topicSignal.create({
    data: {
      source: "studio_live_feed",
      externalId: "seed-ai-agent-workflow-shanghai",
      label: "运营录入",
      topic: "AI Agent 工作流实战局",
      city: "上海",
      industries: JSON.stringify(["AI", "产品", "效率工具"]),
      audiences: JSON.stringify(["产品经理", "创业者"]),
      formats: JSON.stringify(["工作坊", "沙龙"]),
      heat: 94,
      evidence: "运营从社群报名意向里看到 AI Agent 工作流和自动化落地需求集中出现。",
      opportunity: "适合优先做小班实战局，用真实工作流案例验证付费意愿。",
    },
  });

  // 盈亏快照
  const budget: BudgetInput = {
    ticketPriceCents: 19900, targetAttendees: 50, showUpRate: 0.85,
    venueCostCents: 300000, materialsCostCents: 80000, speakerFeeCents: 200000,
    laborCostCents: 100000, marketingCostCents: 150000, cateringPerPersonCents: 6000, sponsorshipCents: 0,
  };
  await prisma.budgetPlan.create({ data: { eventId: event.id, input: JSON.stringify(budget), result: JSON.stringify(calcBudget(budget)) } });

  // 2 个已报名（reserve + complete）
  const demoUsers = [
    { name: "林晨", phone: "13800138001", profession: ["pm"], source: "wechat_group", showOnGuestList: "yes" },
    { name: "王小二", phone: "13800138002", profession: ["ai_founder"], source: "moments", showOnGuestList: "yes" },
  ];
  for (const u of demoUsers) {
    const user = await upsertUser(prisma, "u_" + u.phone);
    const r = await reserve(prisma, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: u });
    if (!r.orderId) throw new Error("Seed demo activity should not create waitlist entries");
    await complete(prisma, r.orderId);
  }

  console.log("Seed done:");
  console.log(JSON.stringify({ eventId: event.id, ticketTypeId: ticketType.id, capacity: 50, registrations: demoUsers.length }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
