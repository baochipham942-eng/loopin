import { prisma } from "./db.js";
import { createEvent, createTicketTypeWithQuota, setEventForm, upsertUser } from "./services/catalog.js";
import { reserve, complete } from "./services/registration.js";
import { calcBudget, recommendFields, type BudgetInput } from "@loopin/core";

/** 重置并灌入一个 demo 活动（含盈亏快照 + 2 个已报名），三个视图都能直接看。
 *  pnpm --filter @loopin/api seed */
async function main() {
  // 清空（FK 顺序）
  await prisma.order.deleteMany();
  await prisma.checkIn.deleteMany();
  await prisma.registration.deleteMany();
  await prisma.budgetPlan.deleteMany();
  await prisma.registrationForm.deleteMany();
  await prisma.ticketTypeQuota.deleteMany();
  await prisma.ticketType.deleteMany();
  await prisma.quota.deleteMany();
  await prisma.event.deleteMany();
  await prisma.organizer.deleteMany();
  await prisma.user.deleteMany();

  const org = await prisma.organizer.create({ data: { name: "Loopin × AI 产品社区", whitelisted: true } });
  const event = await createEvent(prisma, {
    organizerId: org.id,
    title: "AI 产品人深夜局 · 上海",
    city: "上海",
    startAt: new Date("2026-06-14T19:00:00.000Z"),
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

  // 盈亏快照
  const budget: BudgetInput = {
    ticketPriceCents: 19900, targetAttendees: 50, showUpRate: 0.85,
    venueCostCents: 300000, materialsCostCents: 80000, speakerFeeCents: 200000,
    laborCostCents: 100000, marketingCostCents: 150000, cateringPerPersonCents: 6000, sponsorshipCents: 0,
  };
  await prisma.budgetPlan.create({ data: { eventId: event.id, input: JSON.stringify(budget), result: JSON.stringify(calcBudget(budget)) } });

  // 2 个已报名（reserve + complete）
  const demoUsers = [
    { name: "林晨", phone: "13800138001", profession: ["pm"] },
    { name: "王小二", phone: "13800138002", profession: ["ai_founder"] },
  ];
  for (const u of demoUsers) {
    const user = await upsertUser(prisma, "u_" + u.phone);
    const r = await reserve(prisma, { eventId: event.id, ticketTypeId: ticketType.id, userId: user.id, formValues: u });
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
