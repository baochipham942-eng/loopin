import type { AgentTask, PrismaClient } from "@prisma/client";

export type AgentTaskKind = "generation" | "decision" | "operator";
export type AgentTaskStatus = "suggested" | "accepted" | "dismissed" | "completed";

const ACTIVE_STATUSES: AgentTaskStatus[] = ["suggested", "accepted"];
const TASK_STATUSES: AgentTaskStatus[] = ["suggested", "accepted", "dismissed", "completed"];

interface Suggestion {
  kind: AgentTaskKind;
  title: string;
  detail: string;
  highRisk?: boolean;
}

export interface AgentTaskView {
  id: string;
  eventId: string;
  kind: string;
  title: string;
  detail: string | null;
  status: string;
  highRisk: boolean;
  createdAt: Date;
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function publicTask(task: AgentTask): AgentTaskView {
  return {
    id: task.id,
    eventId: task.eventId,
    kind: task.kind,
    title: task.title,
    detail: task.detail,
    status: task.status,
    highRisk: task.highRisk,
    createdAt: task.createdAt,
  };
}

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

export function isAgentTaskStatus(value: string): value is AgentTaskStatus {
  return TASK_STATUSES.includes(value as AgentTaskStatus);
}

export async function refreshEventAgentTasks(db: PrismaClient, eventId: string, now = new Date()) {
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: {
      registrations: { select: { status: true } },
      waitlistEntries: { select: { status: true } },
      quotas: { select: { capacity: true, used: true } },
      budgetPlan: true,
      materials: { select: { id: true } },
      notificationSubscriptions: { select: { status: true } },
    },
  });
  if (!event) return null;

  const suggestions = buildSuggestions({
    title: event.title,
    startAt: event.startAt,
    registrations: event.registrations.map((r) => r.status),
    waitlistStatuses: event.waitlistEntries.map((w) => w.status),
    quotaUsed: event.quotas.reduce((sum, quota) => sum + quota.used, 0),
    capacity: event.quotas.some((quota) => quota.capacity === null)
      ? null
      : event.quotas.reduce((sum, quota) => sum + (quota.capacity ?? 0), 0),
    budgetResult: parseJSON<{ breakEvenAttendees?: number }>(event.budgetPlan?.result, {}),
    materialCount: event.materials.length,
    reminderSubscriptions: event.notificationSubscriptions.filter((sub) => sub.status === "accepted").length,
    now,
  });

  const existing = await db.agentTask.findMany({ where: { eventId } });
  const existingKeys = new Set(existing.map((task) => taskKey(task.kind, task.title)));
  for (const suggestion of suggestions) {
    const key = taskKey(suggestion.kind, suggestion.title);
    if (existingKeys.has(key)) continue;
    await db.agentTask.create({
      data: {
        eventId,
        kind: suggestion.kind,
        title: suggestion.title,
        detail: suggestion.detail,
        highRisk: suggestion.highRisk ?? false,
      },
    });
    existingKeys.add(key);
  }

  const tasks = await listActiveAgentTasks(db, eventId);
  return { eventId, tasks };
}

export async function listActiveAgentTasks(db: PrismaClient, eventId: string) {
  const tasks = await db.agentTask.findMany({
    where: { eventId, status: { in: ACTIVE_STATUSES } },
    orderBy: [{ highRisk: "desc" }, { createdAt: "desc" }],
  });
  return tasks.map(publicTask);
}

export async function updateAgentTaskStatus(db: PrismaClient, taskId: string, status: AgentTaskStatus) {
  const existing = await db.agentTask.findUnique({ where: { id: taskId } });
  if (!existing) return null;
  const task = await db.agentTask.update({ where: { id: taskId }, data: { status } });
  return publicTask(task);
}

function buildSuggestions(input: {
  title: string;
  startAt: Date;
  registrations: string[];
  waitlistStatuses: string[];
  quotaUsed: number;
  capacity: number | null;
  budgetResult: { breakEvenAttendees?: number };
  materialCount: number;
  reminderSubscriptions: number;
  now: Date;
}): Suggestion[] {
  const counts = countBy(input.registrations);
  const submitted = counts.submitted ?? 0;
  const confirmed = (counts.approved ?? 0) + (counts.checked_in ?? 0);
  const checkedIn = counts.checked_in ?? 0;
  const waiting = input.waitlistStatuses.filter((status) => status === "waiting" || status === "offered").length;
  const breakEven = input.budgetResult.breakEvenAttendees ?? null;
  const hoursToStart = (input.startAt.getTime() - input.now.getTime()) / 36e5;
  const ended = hoursToStart < 0;
  const suggestions: Suggestion[] = [];

  if (submitted > 0) {
    suggestions.push({
      kind: "operator",
      title: "处理待审核报名",
      detail: `还有 ${submitted} 位报名待确认，先处理高意愿用户，避免报名热度掉下去。`,
    });
  }

  if (waiting > 0) {
    suggestions.push({
      kind: "operator",
      title: "处理候补名单",
      detail: `候补队列里还有 ${waiting} 位用户，确认是否有空位可转正，或先同步等待状态。`,
    });
  }

  if (!ended && breakEven && confirmed < breakEven) {
    suggestions.push({
      kind: "decision",
      title: "报名未达保本",
      detail: `已确认 ${confirmed} 人，距离保本 ${breakEven} 人还差 ${breakEven - confirmed} 人；优先补推广触达，再评估成本、票价或合作社群。`,
      highRisk: true,
    });
  }

  if (!ended && input.materialCount === 0) {
    suggestions.push({
      kind: "generation",
      title: "补推广物料",
      detail: `还没有推广物料记录，建议先生成朋友圈、微信群和小红书三版话术，围绕「${input.title}」拉第一波触达。`,
    });
  }

  if (!ended && hoursToStart <= 48 && hoursToStart >= 0 && confirmed > 0) {
    suggestions.push({
      kind: "operator",
      title: "检查活动提醒",
      detail: `活动将在 ${Math.ceil(hoursToStart)} 小时内开始，已有 ${confirmed} 位确认报名；当前 ${input.reminderSubscriptions} 位授权提醒，适合补一次订阅提醒和现场核验准备。`,
    });
  }

  if (ended && confirmed > 0) {
    suggestions.push({
      kind: "decision",
      title: "整理会后复盘",
      detail: `活动已结束，确认 ${confirmed} 人、签到 ${checkedIn} 人；可以整理高意愿参与者名单、活动反馈和下一场选题。`,
    });
  }

  if (!ended && input.capacity !== null && input.capacity > 0 && input.quotaUsed >= input.capacity && waiting === 0) {
    suggestions.push({
      kind: "operator",
      title: "开启候补观察",
      detail: `名额已经用满，建议关注新的报名请求并准备候补沟通，避免用户只看到售罄后流失。`,
    });
  }

  return suggestions;
}

function taskKey(kind: string, title: string) {
  return `${kind}::${title}`;
}
