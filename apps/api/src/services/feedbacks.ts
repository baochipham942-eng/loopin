import type { EventFeedback, PrismaClient } from "@prisma/client";
import { upsertUser } from "./catalog.js";

export interface EventFeedbackInput {
  userId?: string;
  registrationId?: string;
  rating?: number;
  valuable?: string;
  nextTopic?: string;
  roleInterest?: string;
  note?: string;
  answers?: Record<string, unknown>;
}

export interface EventFeedbackSummary {
  total: number;
  averageRating: number | null;
  roleInterest: { label: string; count: number }[];
  nextTopics: { label: string; count: number }[];
  recent: PublicEventFeedback[];
}

export interface PublicEventFeedback {
  id: string;
  eventId: string;
  userId: string | null;
  registrationId: string | null;
  rating: number | null;
  valuable: string;
  nextTopic: string;
  roleInterest: string;
  note: string | null;
  answers: Record<string, unknown>;
  createdAt: Date;
}

export class EventFeedbackError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export async function submitEventFeedback(db: PrismaClient, eventId: string, input: EventFeedbackInput) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new EventFeedbackError(404, "event_not_found", "活动不存在");

  const userId = clean(input.userId);
  if (userId) await upsertUser(db, userId);

  const registrationId = await validRegistrationId(db, eventId, clean(input.registrationId), userId);
  const data = feedbackData({ ...input, userId, registrationId });

  if (userId) {
    const existing = await db.eventFeedback.findFirst({ where: { eventId, userId } });
    if (existing) {
      const feedback = await db.eventFeedback.update({ where: { id: existing.id }, data });
      return publicFeedback(feedback);
    }
  }

  const feedback = await db.eventFeedback.create({ data: { eventId, ...data } });
  return publicFeedback(feedback);
}

export async function listEventFeedback(db: PrismaClient, eventId: string, limit = 20) {
  const take = Math.max(1, Math.min(50, limit));
  const feedbacks = await db.eventFeedback.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    take,
  });
  const total = await db.eventFeedback.count({ where: { eventId } });
  return {
    total,
    feedbacks: feedbacks.map(publicFeedback),
    summary: summarizeFeedback(feedbacks, total),
  };
}

export function summarizeFeedback(feedbacks: EventFeedback[], total = feedbacks.length): EventFeedbackSummary {
  const ratings = feedbacks.map((feedback) => feedback.rating).filter((rating): rating is number => typeof rating === "number");
  return {
    total,
    averageRating: ratings.length ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10 : null,
    roleInterest: topValues(feedbacks.map((feedback) => feedback.roleInterest)),
    nextTopics: topValues(feedbacks.map((feedback) => feedback.nextTopic)),
    recent: feedbacks.slice(0, 5).map(publicFeedback),
  };
}

function feedbackData(input: Omit<EventFeedbackInput, "userId" | "registrationId"> & { userId?: string; registrationId?: string | null }) {
  const valuable = truncate(clean(input.valuable), 500);
  const nextTopic = truncate(clean(input.nextTopic), 180);
  const roleInterest = truncate(clean(input.roleInterest), 80);
  if (!valuable && !nextTopic && !roleInterest && input.rating === undefined) {
    throw new EventFeedbackError(400, "empty_feedback", "反馈内容不能为空");
  }

  return {
    userId: input.userId || null,
    registrationId: input.registrationId || null,
    rating: normalizeRating(input.rating),
    valuable,
    nextTopic,
    roleInterest,
    note: truncate(clean(input.note), 500) || null,
    answers: JSON.stringify({
      valuable,
      nextTopic,
      roleInterest,
      note: truncate(clean(input.note), 500),
      rating: normalizeRating(input.rating),
      ...(isPlainObject(input.answers) ? input.answers : {}),
    }),
  };
}

async function validRegistrationId(db: PrismaClient, eventId: string, registrationId: string, userId: string) {
  if (!registrationId) return null;
  const registration = await db.registration.findFirst({
    where: {
      id: registrationId,
      eventId,
      ...(userId ? { userId } : {}),
    },
    select: { id: true },
  });
  return registration?.id ?? null;
}

function normalizeRating(value: number | undefined) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function publicFeedback(feedback: EventFeedback): PublicEventFeedback {
  return {
    id: feedback.id,
    eventId: feedback.eventId,
    userId: feedback.userId,
    registrationId: feedback.registrationId,
    rating: feedback.rating,
    valuable: feedback.valuable,
    nextTopic: feedback.nextTopic,
    roleInterest: feedback.roleInterest,
    note: feedback.note,
    answers: parseJSON<Record<string, unknown>>(feedback.answers, {}),
    createdAt: feedback.createdAt,
  };
}

function topValues(values: string[], limit = 5) {
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    const key = clean(value);
    if (!key) return acc;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}
