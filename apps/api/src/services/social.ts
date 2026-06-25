import type { EventSocialProfile, PrismaClient } from "@prisma/client";
import type { FormField, RegistrationFormSchema } from "@loopin/core";

export interface EventSocialProfileInput {
  name?: string;
  kind?: string;
  headline?: string;
  bio?: string;
  avatarUrl?: string;
  tags?: string[] | string;
  links?: { label: string; url: string }[] | string;
  visibility?: string;
  sortOrder?: number;
}

export interface InterestSubscriptionInput {
  topic?: string;
  city?: string;
  industry?: string;
  format?: string;
  sourceEventId?: string;
}

export class SocialError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export async function getOrganizerPublic(db: PrismaClient, organizerId: string) {
  const organizer = await db.organizer.findUnique({
    where: { id: organizerId },
    include: {
      hostProfile: true,
      events: {
        where: { status: "published" },
        orderBy: { startAt: "asc" },
        include: { ticketTypes: { select: { priceCents: true } } },
      },
    },
  });
  if (!organizer) throw new SocialError(404, "organizer_not_found", "主办方不存在");
  return {
    organizer: { id: organizer.id, name: organizer.name },
    hostProfile: organizer.hostProfile
      ? {
          bio: organizer.hostProfile.bio,
          avatarUrl: organizer.hostProfile.avatarUrl,
          links: parseJSON<unknown>(organizer.hostProfile.links, null),
        }
      : null,
    events: organizer.events.map((event) => ({
      id: event.id,
      title: event.title,
      city: event.city,
      venue: event.venue,
      startAt: event.startAt,
      minPriceCents: event.ticketTypes.length ? Math.min(...event.ticketTypes.map((ticket) => ticket.priceCents)) : 0,
    })),
  };
}

export async function getEventSocial(db: PrismaClient, eventId: string) {
  const event = await db.event.findUnique({
    where: { id: eventId },
    include: {
      organizer: true,
      forms: { orderBy: { id: "desc" }, take: 1 },
    },
  });
  if (!event) throw new SocialError(404, "event_not_found", "活动不存在");

  const profiles = await db.eventSocialProfile.findMany({
    where: { eventId, visibility: { in: ["public", "attendee"] } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const registrations = await db.registration.findMany({
    where: { eventId, status: { in: ["approved", "checked_in"] } },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  const schema = parseJSON<RegistrationFormSchema>(event.forms[0]?.schema, { fields: [] });
  const attendeePreview = registrations
    .map((registration) => publicRegistrationProfile(registration.formValues, schema.fields))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 12);

  return {
    event: {
      id: event.id,
      title: event.title,
      city: event.city,
      venue: event.venue,
      organizer: event.organizer.name,
    },
    profiles: profiles.map(publicSocialProfile),
    featured: profiles.filter((profile) => profile.kind !== "attendee").map(publicSocialProfile),
    attendees: [
      ...profiles.filter((profile) => profile.kind === "attendee").map(publicSocialProfile),
      ...attendeePreview,
    ].slice(0, 18),
    interestSeed: {
      topic: event.title.replace(/[·｜|].*$/, "").trim() || event.title,
      city: event.city,
      industry: socialIndustry(schema.fields),
      format: "线下活动",
    },
  };
}

export async function createEventSocialProfile(db: PrismaClient, eventId: string, input: EventSocialProfileInput) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new SocialError(404, "event_not_found", "活动不存在");
  const data = socialProfileData(input);
  const profile = await db.eventSocialProfile.create({ data: { eventId, ...data } });
  return { profile: publicSocialProfile(profile) };
}

export async function listEventSocialProfiles(db: PrismaClient, eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new SocialError(404, "event_not_found", "活动不存在");
  const profiles = await db.eventSocialProfile.findMany({
    where: { eventId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return { profiles: profiles.map(publicSocialProfile) };
}

export async function subscribeUserInterest(db: PrismaClient, userId: string, input: InterestSubscriptionInput) {
  const normalized = await subscriptionData(db, input);
  await db.user.upsert({ where: { id: userId }, create: { id: userId }, update: {} });
  const subscription = await db.interestSubscription.upsert({
    where: { userId_subscriptionKey: { userId, subscriptionKey: normalized.subscriptionKey } },
    create: { userId, ...normalized, status: "active" },
    update: { ...normalized, status: "active" },
  });
  return { subscription: publicSubscription(subscription) };
}

export async function getUserInterestFeed(db: PrismaClient, userId: string) {
  const subscriptions = await db.interestSubscription.findMany({
    where: { userId, status: "active" },
    orderBy: { updatedAt: "desc" },
  });
  const events = await db.event.findMany({
    where: { status: "published" },
    orderBy: { startAt: "asc" },
    include: { organizer: true, ticketTypes: true, socialProfiles: { where: { visibility: "public" }, take: 3 } },
    take: 80,
  });
  const signals = await db.topicSignal.findMany({
    where: { status: "active" },
    orderBy: { heat: "desc" },
    take: 80,
  });

  const eventMatches = matchBySubscriptions(subscriptions, events.map((event) => ({
    id: event.id,
    title: event.title,
    city: event.city,
    venue: event.venue,
    startAt: event.startAt,
    organizer: event.organizer.name,
    minPriceCents: event.ticketTypes.length ? Math.min(...event.ticketTypes.map((ticket) => ticket.priceCents)) : 0,
    people: event.socialProfiles.map(publicSocialProfile),
    searchText: [event.title, event.city, event.venue, event.organizer.name, ...event.socialProfiles.flatMap((profile) => [profile.name, profile.headline, profile.tags])].join(" "),
  }))).slice(0, 12);

  const signalMatches = matchBySubscriptions(subscriptions, signals.map((signal) => ({
    id: signal.id,
    topic: signal.topic,
    city: signal.city,
    source: signal.source,
    heat: signal.heat,
    evidence: signal.evidence,
    opportunity: signal.opportunity,
    searchText: [signal.topic, signal.city, signal.industries, signal.audiences, signal.formats, signal.evidence].join(" "),
  }))).slice(0, 8);

  const people = await discoverPeople(db, {
    q: subscriptions.map((subscription) => subscription.topic).join(" "),
    city: subscriptions.find((subscription) => subscription.city)?.city ?? undefined,
    limit: 10,
  });

  return {
    subscriptions: subscriptions.map(publicSubscription),
    events: eventMatches.map(({ searchText: _searchText, ...event }) => event),
    signals: signalMatches.map(({ searchText: _searchText, ...signal }) => signal),
    people: people.people,
  };
}

export async function discoverPeople(db: PrismaClient, input: { q?: string; city?: string; tag?: string; limit?: number }) {
  const limit = Math.min(30, Math.max(1, Math.round(Number(input.limit ?? 12))));
  const profiles = await db.eventSocialProfile.findMany({
    where: { visibility: "public" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: { event: { include: { organizer: true } } },
    take: 120,
  });
  const terms = [input.q, input.tag].flatMap((item) => clean(item).split(/[、,，\s/]+/)).filter(Boolean);
  const city = clean(input.city);
  const people = profiles
    .filter((profile) => !city || profile.event.city === city)
    .filter((profile) => {
      if (!terms.length) return true;
      const haystack = [profile.name, profile.headline, profile.bio, profile.tags, profile.event.title, profile.event.city].join(" ").toLowerCase();
      return terms.some((term) => haystack.includes(term.toLowerCase()));
    })
    .slice(0, limit)
    .map((profile) => ({
      ...publicSocialProfile(profile),
      event: {
        id: profile.event.id,
        title: profile.event.title,
        city: profile.event.city,
        venue: profile.event.venue,
        organizer: profile.event.organizer.name,
      },
    }));
  return { people };
}

function socialProfileData(input: EventSocialProfileInput) {
  const name = truncate(clean(input.name), 80);
  const headline = truncate(clean(input.headline), 160);
  if (!name || !headline) throw new SocialError(400, "invalid_profile", "人物姓名和介绍不能为空");
  return {
    name,
    headline,
    kind: normalizeKind(input.kind),
    bio: truncate(clean(input.bio), 500) || null,
    avatarUrl: truncate(clean(input.avatarUrl), 500) || null,
    tags: JSON.stringify(normalizeList(input.tags).slice(0, 12)),
    links: JSON.stringify(normalizeLinks(input.links).slice(0, 6)),
    visibility: normalizeVisibility(input.visibility),
    sortOrder: normalizeSortOrder(input.sortOrder),
  };
}

async function subscriptionData(db: PrismaClient, input: InterestSubscriptionInput) {
  const sourceEvent = input.sourceEventId
    ? await db.event.findUnique({ where: { id: input.sourceEventId }, select: { id: true, title: true, city: true } })
    : null;
  const topic = truncate(clean(input.topic) || sourceEvent?.title || "", 80);
  if (!topic) throw new SocialError(400, "invalid_interest", "订阅话题不能为空");
  const city = truncate(clean(input.city) || sourceEvent?.city || "", 40) || null;
  const industry = truncate(clean(input.industry), 40) || null;
  const format = truncate(clean(input.format), 40) || null;
  return {
    topic,
    city,
    industry,
    format,
    sourceEventId: sourceEvent?.id ?? (truncate(clean(input.sourceEventId), 80) || null),
    subscriptionKey: [topic, city ?? "", industry ?? "", format ?? ""].map((item) => item.toLowerCase()).join("|"),
  };
}

function publicRegistrationProfile(formValues: string, fields: FormField[]) {
  const form = parseJSON<Record<string, unknown>>(formValues, {});
  const publicFlag = form.showOnGuestList ?? form.publicGuest ?? form.guestList;
  if (publicFlag !== true && publicFlag !== "yes" && publicFlag !== "public") return null;
  const name = text(form.name);
  if (!name) return null;
  const profession = fieldValue(form.profession, fields.find((field) => field.key === "profession") ?? null);
  const company = text(form.company);
  return {
    id: `registration:${name}:${profession}:${company}`,
    kind: "attendee",
    name,
    headline: [profession, company].filter(Boolean).join(" · ") || "活动参与者",
    bio: "",
    avatarUrl: "",
    tags: profession ? profession.split("/") : [],
    links: [],
    visibility: "public",
    sortOrder: 99,
  };
}

function publicSocialProfile(profile: EventSocialProfile) {
  return {
    id: profile.id,
    kind: profile.kind,
    name: profile.name,
    headline: profile.headline,
    bio: profile.bio ?? "",
    avatarUrl: profile.avatarUrl ?? "",
    tags: parseJSON<string[]>(profile.tags, []),
    links: parseJSON<{ label: string; url: string }[]>(profile.links, []),
    visibility: profile.visibility,
    sortOrder: profile.sortOrder,
  };
}

function publicSubscription(subscription: { id: string; topic: string; city: string | null; industry: string | null; format: string | null; sourceEventId: string | null; status: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: subscription.id,
    topic: subscription.topic,
    city: subscription.city,
    industry: subscription.industry,
    format: subscription.format,
    sourceEventId: subscription.sourceEventId,
    status: subscription.status,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

function matchBySubscriptions<T extends { searchText: string; city?: string | null }>(subscriptions: { topic: string; city: string | null; industry: string | null; format: string | null }[], rows: T[]) {
  if (!subscriptions.length) return rows.slice(0, 8);
  return rows
    .map((row) => ({
      row,
      score: subscriptions.reduce((score, subscription) => score + matchScore(subscription, row), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.row);
}

function matchScore(subscription: { topic: string; city: string | null; industry: string | null; format: string | null }, row: { searchText: string; city?: string | null }) {
  const haystack = row.searchText.toLowerCase();
  let score = 0;
  for (const term of [subscription.topic, subscription.industry, subscription.format].filter(Boolean) as string[]) {
    for (const piece of term.split(/[、,，\s/·]+/).filter(Boolean)) {
      if (haystack.includes(piece.toLowerCase())) score += 2;
    }
  }
  if (subscription.city && row.city === subscription.city) score += 2;
  return score;
}

function fieldValue(value: unknown, field: FormField | null) {
  if (Array.isArray(value)) return value.map((item) => optionLabel(String(item), field)).join("/");
  if (value === undefined || value === null) return "";
  return optionLabel(String(value), field);
}

function optionLabel(value: string, field: FormField | null) {
  const option = field?.options?.find((item) => item.value === value);
  return option ? option.label : value;
}

function socialIndustry(fields: FormField[]) {
  const profession = fields.find((field) => field.key === "profession");
  return profession?.options?.[0]?.label ?? "";
}

function normalizeKind(value: unknown) {
  const kind = clean(value).toLowerCase();
  return ["host", "speaker", "guest", "attendee"].includes(kind) ? kind : "guest";
}

function normalizeVisibility(value: unknown) {
  const visibility = clean(value).toLowerCase();
  return ["public", "attendee", "organizer"].includes(visibility) ? visibility : "public";
}

function normalizeSortOrder(value: unknown) {
  const num = Math.round(Number(value ?? 0));
  return Number.isFinite(num) ? num : 0;
}

function normalizeList(value: string[] | string | undefined) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[、,，/;\n]/) : [];
  return Array.from(new Set(list.map(clean).filter(Boolean).map((item) => truncate(item, 40))));
}

function normalizeLinks(value: { label: string; url: string }[] | string | undefined) {
  if (Array.isArray(value)) {
    return value
      .map((item) => ({ label: truncate(clean(item.label), 40), url: truncate(clean(item.url), 500) }))
      .filter((item) => item.label && /^https?:\/\//i.test(item.url));
  }
  const url = truncate(clean(value), 500);
  return /^https?:\/\//i.test(url) ? [{ label: "链接", url }] : [];
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value);
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value;
}
