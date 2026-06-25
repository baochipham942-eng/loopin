import type { EventResource, PrismaClient } from "@prisma/client";

export interface EventResourceInput {
  title?: string;
  type?: string;
  url?: string;
  description?: string;
  visibility?: string;
}

export interface PublicEventResource {
  id: string;
  eventId: string;
  title: string;
  type: string;
  url: string;
  description: string | null;
  visibility: string;
  createdAt: Date;
}

const RESOURCE_TYPES = new Set(["link", "slides", "notes", "recording", "gallery"]);
const VISIBILITY = new Set(["attendee", "public", "organizer"]);

export class EventResourceError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export async function createEventResource(db: PrismaClient, eventId: string, input: EventResourceInput) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new EventResourceError(404, "event_not_found", "活动不存在");

  const data = resourceData(input);
  const resource = await db.eventResource.create({ data: { eventId, ...data } });
  return publicEventResource(resource);
}

export async function listEventResources(db: PrismaClient, eventId: string, limit = 20) {
  const take = Math.max(1, Math.min(50, limit));
  const resources = await db.eventResource.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return { resources: resources.map(publicEventResource) };
}

export function publicEventResource(resource: EventResource): PublicEventResource {
  return {
    id: resource.id,
    eventId: resource.eventId,
    title: resource.title,
    type: resource.type,
    url: resource.url,
    description: resource.description,
    visibility: resource.visibility,
    createdAt: resource.createdAt,
  };
}

function resourceData(input: EventResourceInput) {
  const url = normalizeUrl(input.url);
  const title = truncate(clean(input.title), 80) || titleFromUrl(url);
  const type = normalizeEnum(input.type, RESOURCE_TYPES, "link");
  const visibility = normalizeEnum(input.visibility, VISIBILITY, "attendee");
  const description = truncate(clean(input.description), 300);

  return {
    title,
    type,
    url,
    description: description || null,
    visibility,
  };
}

function normalizeUrl(value: unknown) {
  const raw = clean(value);
  if (!raw) throw new EventResourceError(400, "invalid_url", "资料链接不能为空");
  if (raw.length > 1000) throw new EventResourceError(400, "invalid_url", "资料链接过长");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new EventResourceError(400, "invalid_url", "资料链接格式不正确");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new EventResourceError(400, "invalid_url", "资料链接只支持 http/https");
  }
  return parsed.toString();
}

function titleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || "活动资料";
  } catch {
    return "活动资料";
  }
}

function normalizeEnum(value: unknown, allowed: Set<string>, fallback: string) {
  const key = clean(value).toLowerCase();
  return allowed.has(key) ? key : fallback;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}
