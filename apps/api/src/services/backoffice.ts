import { quotaAvailable, type FormField, type RegistrationFormSchema } from "@loopin/core";
import type { OrganizerMember, PrismaClient, Quota } from "@prisma/client";
import { buildBackofficeInviteUrl, createBackofficeToken, hashBackofficeToken } from "./backoffice-tokens.js";

export interface QuotaUpdateInput {
  name?: string;
  capacity?: number | null;
}

export interface OrganizerMemberInput {
  name?: string;
  email?: string;
  role?: string;
  permissions?: string[] | string;
  status?: string;
}

export interface OrganizerInvitationInput extends OrganizerMemberInput {
  inviteExpiresHours?: number;
}

export interface OrganizerInvitationAcceptInput {
  token?: string;
}

export class BackofficeError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export async function listEventQuotas(db: PrismaClient, eventId: string, now = new Date()) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true, title: true } });
  if (!event) throw new BackofficeError(404, "event_not_found", "活动不存在");

  const quotas = await db.quota.findMany({
    where: { eventId },
    orderBy: { name: "asc" },
    include: { ticketTypes: { include: { ticketType: true } } },
  });
  const rows = [];
  for (const quota of quotas) {
    rows.push(await publicQuota(db, quota, now));
  }
  return { event, quotas: rows };
}

export async function updateQuota(db: PrismaClient, quotaId: string, input: QuotaUpdateInput) {
  const existing = await db.quota.findUnique({ where: { id: quotaId } });
  if (!existing) throw new BackofficeError(404, "quota_not_found", "配额不存在");

  const data: { name?: string; capacity?: number | null } = {};
  const name = clean(input.name);
  if (name) data.name = truncate(name, 80);
  if (Object.prototype.hasOwnProperty.call(input, "capacity")) data.capacity = normalizeCapacity(input.capacity, existing.used);
  const quota = await db.quota.update({
    where: { id: quotaId },
    data,
    include: { ticketTypes: { include: { ticketType: true } } },
  });
  return { quota: await publicQuota(db, quota) };
}

export async function listEventExporters(db: PrismaClient, eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true, title: true } });
  if (!event) throw new BackofficeError(404, "event_not_found", "活动不存在");
  return {
    event,
    exporters: [
      {
        key: "registrations_csv",
        label: "报名名单 CSV",
        description: "按报名表字段导出报名、票种、订单、候补和核验码。",
        href: `/api/events/${eventId}/exports/registrations.csv`,
      },
      {
        key: "registrations_excel",
        label: "报名名单 Excel",
        description: "Excel 兼容格式，保留报名表自定义字段和选项展示名。",
        href: `/api/events/${eventId}/exports/registrations.xls`,
      },
      {
        key: "registrations_pdf",
        label: "报名名单 PDF",
        description: "按报名逐条生成 PDF 明细，适合现场核对和归档。",
        href: `/api/events/${eventId}/exports/registrations.pdf`,
      },
      {
        key: "waitlist_csv",
        label: "候补名单 CSV",
        description: "候补位次、状态、转正有效期和报名人信息。",
        href: `/api/events/${eventId}/exports/waitlist.csv`,
      },
      {
        key: "feedback_csv",
        label: "会后反馈 CSV",
        description: "评分、价值点、下一场话题、参与意愿和备注。",
        href: `/api/events/${eventId}/exports/feedback.csv`,
      },
      {
        key: "resources_csv",
        label: "资料包 CSV",
        description: "资料标题、类型、链接、说明和可见范围。",
        href: `/api/events/${eventId}/exports/resources.csv`,
      },
    ],
  };
}

export async function eventRegistrationsCsv(db: PrismaClient, eventId: string) {
  const data = await eventRegistrationsExportData(db, eventId);
  return {
    filename: `${safeFilename(data.event.title)}-registrations.csv`,
    csv: csv([data.headers, ...data.rows]),
  };
}

export async function eventRegistrationsExcel(db: PrismaClient, eventId: string) {
  const data = await eventRegistrationsExportData(db, eventId);
  return {
    filename: `${safeFilename(data.event.title)}-registrations.xls`,
    xml: spreadsheetXml("报名名单", data.headers, data.rows),
  };
}

export async function eventRegistrationsPdf(db: PrismaClient, eventId: string, now = new Date()) {
  const data = await eventRegistrationsExportData(db, eventId);
  return {
    filename: `${safeFilename(data.event.title)}-registrations.pdf`,
    pdf: registrationPdf(data.event.title, data.headers, data.rows, now),
  };
}

async function eventRegistrationsExportData(db: PrismaClient, eventId: string) {
  const event = await db.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, forms: { orderBy: { id: "desc" }, take: 1, select: { schema: true } } },
  });
  if (!event) throw new BackofficeError(404, "event_not_found", "活动不存在");
  const regs = await db.registration.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
    include: { ticketType: true, order: true, waitlistEntry: true },
  });
  const fields = exportFields(event.forms[0]?.schema, regs.map((reg) => parseJSON<Record<string, unknown>>(reg.formValues, {})));
  const rows = regs.map((reg) => {
    const form = parseJSON<Record<string, unknown>>(reg.formValues, {});
    return [
      reg.id,
      reg.ticketType.name,
      reg.status,
      reg.order?.lifecycle ?? "",
      reg.order?.payment_status ?? "",
      reg.waitlistEntry?.position ?? "",
      reg.checkinToken ?? "",
      reg.createdAt.toISOString(),
      ...fields.map((field) => fieldValue(form[field.key], field.field)),
    ];
  });
  return {
    event,
    headers: ["registrationId", "ticket", "status", "orderLifecycle", "paymentStatus", "waitlistPosition", "checkinToken", "createdAt", ...fields.map((field) => field.header)],
    rows,
  };
}

export async function eventWaitlistCsv(db: PrismaClient, eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true, title: true } });
  if (!event) throw new BackofficeError(404, "event_not_found", "活动不存在");
  const rows = await db.waitlistEntry.findMany({
    where: { eventId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { registration: { include: { ticketType: true } }, quota: true },
  });
  return {
    filename: `${safeFilename(event.title)}-waitlist.csv`,
    csv: csv([
      ["waitlistId", "registrationId", "position", "status", "offerExpiresAt", "name", "phone", "profession", "ticket", "quota", "createdAt", "updatedAt"],
      ...rows.map((row) => {
        const form = parseJSON<Record<string, unknown>>(row.registration.formValues, {});
        return [
          row.id,
          row.registrationId,
          row.position,
          row.status,
          row.offerExpiresAt?.toISOString() ?? "",
          text(form.name),
          text(form.phone),
          Array.isArray(form.profession) ? form.profession.join("/") : text(form.profession),
          row.registration.ticketType.name,
          row.quota?.name ?? "",
          row.createdAt.toISOString(),
          row.updatedAt.toISOString(),
        ];
      }),
    ]),
  };
}

export async function eventFeedbackCsv(db: PrismaClient, eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true, title: true } });
  if (!event) throw new BackofficeError(404, "event_not_found", "活动不存在");
  const rows = await db.eventFeedback.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
  });
  return {
    filename: `${safeFilename(event.title)}-feedback.csv`,
    csv: csv([
      ["feedbackId", "userId", "registrationId", "rating", "valuable", "nextTopic", "roleInterest", "note", "createdAt"],
      ...rows.map((row) => [
        row.id,
        row.userId ?? "",
        row.registrationId ?? "",
        row.rating ?? "",
        row.valuable,
        row.nextTopic,
        row.roleInterest,
        row.note ?? "",
        row.createdAt.toISOString(),
      ]),
    ]),
  };
}

export async function eventResourcesCsv(db: PrismaClient, eventId: string) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true, title: true } });
  if (!event) throw new BackofficeError(404, "event_not_found", "活动不存在");
  const rows = await db.eventResource.findMany({
    where: { eventId },
    orderBy: { createdAt: "desc" },
  });
  return {
    filename: `${safeFilename(event.title)}-resources.csv`,
    csv: csv([
      ["resourceId", "title", "type", "url", "description", "visibility", "createdAt"],
      ...rows.map((row) => [
        row.id,
        row.title,
        row.type,
        row.url,
        row.description ?? "",
        row.visibility,
        row.createdAt.toISOString(),
      ]),
    ]),
  };
}

export async function listOrganizers(db: PrismaClient) {
  const organizers = await db.organizer.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { events: true, members: true } } },
  });
  return {
    organizers: organizers.map((organizer) => ({
      id: organizer.id,
      name: organizer.name,
      whitelisted: organizer.whitelisted,
      eventCount: organizer._count.events,
      memberCount: organizer._count.members,
      createdAt: organizer.createdAt,
    })),
  };
}

export async function setOrganizerWhitelist(db: PrismaClient, organizerId: string, whitelisted: boolean) {
  const existing = await db.organizer.findUnique({ where: { id: organizerId }, select: { id: true } });
  if (!existing) throw new BackofficeError(404, "organizer_not_found", "主办方不存在");
  const organizer = await db.organizer.update({ where: { id: organizerId }, data: { whitelisted } });
  return { organizer: { id: organizer.id, name: organizer.name, whitelisted: organizer.whitelisted } };
}

export async function getPlatformOverview(db: PrismaClient) {
  const [orgTotal, orgWhitelisted, eventsByStatus, regsByStatus, gmvAgg] = await Promise.all([
    db.organizer.count(),
    db.organizer.count({ where: { whitelisted: true } }),
    db.event.groupBy({ by: ["status"], _count: { _all: true } }),
    db.registration.groupBy({ by: ["status"], _count: { _all: true } }),
    db.order.aggregate({ _sum: { amountCents: true, refundedAmountCents: true }, where: { payment_status: "paid" } }),
  ]);
  const eventCount = (status: string) => eventsByStatus.find((row) => row.status === status)?._count._all ?? 0;
  const regCount = (status: string) => regsByStatus.find((row) => row.status === status)?._count._all ?? 0;
  const eventsTotal = eventsByStatus.reduce((sum, row) => sum + row._count._all, 0);
  const regsTotal = regsByStatus.reduce((sum, row) => sum + row._count._all, 0);
  const submitted = regCount("submitted");
  const gmvCents = (gmvAgg._sum.amountCents ?? 0) - (gmvAgg._sum.refundedAmountCents ?? 0);
  return {
    organizers: { total: orgTotal, whitelisted: orgWhitelisted, pending: orgTotal - orgWhitelisted },
    events: {
      total: eventsTotal,
      draft: eventCount("draft"),
      published: eventCount("published"),
      closed: eventCount("closed"),
      completed: eventCount("completed"),
      cancelled: eventCount("cancelled"),
    },
    registrations: {
      total: regsTotal,
      submitted,
      approved: regCount("approved"),
      waitlisted: regCount("waitlisted"),
      checkedIn: regCount("checked_in"),
    },
    gmvCents,
    pending: { whitelist: orgTotal - orgWhitelisted, review: submitted },
  };
}

export async function listPlatformEvents(db: PrismaClient, now = new Date()) {
  const events = await db.event.findMany({
    orderBy: { startAt: "asc" },
    include: {
      organizer: { select: { name: true } },
      quotas: { select: { capacity: true } },
      registrations: { select: { status: true, order: { select: { lifecycle: true, payment_status: true } } } },
    },
  });
  return {
    events: events.map((event) => {
      const count = (status: string) => event.registrations.filter((reg) => reg.status === status).length;
      const approvedCount = count("approved") + count("checked_in");
      const submittedCount = count("submitted");
      const waitlistCount = count("waitlisted");
      const checkedInCount = count("checked_in");
      // 容量：任一配额不限量则整体不限量（null）
      const capacity = event.quotas.some((quota) => quota.capacity == null)
        ? null
        : event.quotas.reduce((sum, quota) => sum + (quota.capacity ?? 0), 0);
      const unpaidReserved = event.registrations.filter((reg) => reg.order && reg.order.lifecycle === "reserved" && reg.order.payment_status === "unpaid").length;
      const oversold = capacity != null && approvedCount > capacity;
      const ended = ["closed", "completed"].includes(event.status) || event.startAt < now;
      const noShow = ended && approvedCount > 0 ? approvedCount - checkedInCount : 0;
      const risks: string[] = [];
      if (oversold) risks.push("超卖");
      if (unpaidReserved > 0) risks.push(`待支付 ${unpaidReserved}`);
      if (submittedCount > 0) risks.push(`待审核 ${submittedCount}`);
      if (noShow > 0) risks.push(`缺席 ${noShow}`);
      return {
        id: event.id,
        title: event.title,
        organizerId: event.organizerId,
        organizer: event.organizer.name,
        status: event.status,
        startAt: event.startAt,
        city: event.city,
        registrationCount: event.registrations.length,
        approvedCount,
        submittedCount,
        waitlistCount,
        checkedInCount,
        capacity,
        oversold,
        risks,
      };
    }),
  };
}

export async function createOrganizer(db: PrismaClient, input: { name?: string; whitelisted?: boolean }) {
  const name = clean(input.name);
  if (!name) throw new BackofficeError(400, "invalid_organizer", "主办方名称不能为空");
  const organizer = await db.organizer.create({ data: { name: truncate(name, 80), whitelisted: input.whitelisted === true } });
  return {
    organizer: { id: organizer.id, name: organizer.name, whitelisted: organizer.whitelisted, eventCount: 0, memberCount: 0, createdAt: organizer.createdAt },
  };
}

export interface HostProfileInput {
  bio?: string | null;
  avatarUrl?: string | null;
  links?: unknown;
}

export async function upsertHostProfile(db: PrismaClient, organizerId: string, input: HostProfileInput) {
  const organizer = await db.organizer.findUnique({ where: { id: organizerId }, select: { id: true } });
  if (!organizer) throw new BackofficeError(404, "organizer_not_found", "主办方不存在");
  const bio = clean(input.bio) || null;
  const avatarUrl = clean(input.avatarUrl) || null;
  const links = input.links == null ? null : JSON.stringify(input.links);
  const profile = await db.hostProfile.upsert({
    where: { organizerId },
    create: { organizerId, bio, avatarUrl, links },
    update: { bio, avatarUrl, links },
  });
  return {
    hostProfile: { bio: profile.bio, avatarUrl: profile.avatarUrl, links: parseJSON<unknown>(profile.links, null) },
  };
}

export async function getOrganizerDetail(db: PrismaClient, organizerId: string) {
  const organizer = await db.organizer.findUnique({
    where: { id: organizerId },
    include: {
      hostProfile: true,
      events: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { registrations: true } }, ticketTypes: { select: { priceCents: true } } },
      },
      members: { orderBy: [{ status: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!organizer) throw new BackofficeError(404, "organizer_not_found", "主办方不存在");
  return {
    organizer: { id: organizer.id, name: organizer.name, whitelisted: organizer.whitelisted, createdAt: organizer.createdAt },
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
      status: event.status,
      startAt: event.startAt,
      city: event.city,
      minPriceCents: event.ticketTypes.length ? Math.min(...event.ticketTypes.map((ticket) => ticket.priceCents)) : 0,
      registrationCount: event._count.registrations,
    })),
    members: organizer.members.map(publicMember),
  };
}

export async function listOrganizerMembers(db: PrismaClient, organizerId: string) {
  const organizer = await db.organizer.findUnique({ where: { id: organizerId }, select: { id: true, name: true } });
  if (!organizer) throw new BackofficeError(404, "organizer_not_found", "主办方不存在");
  const members = await db.organizerMember.findMany({
    where: { organizerId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  return { organizer, members: members.map(publicMember) };
}

export async function createOrganizerMember(db: PrismaClient, organizerId: string, input: OrganizerMemberInput) {
  const organizer = await db.organizer.findUnique({ where: { id: organizerId }, select: { id: true } });
  if (!organizer) throw new BackofficeError(404, "organizer_not_found", "主办方不存在");
  const data = memberData(input);
  if (!data.name || !data.role || !data.permissions || !data.status) throw new BackofficeError(400, "invalid_member", "成员信息不完整");
  const createData = {
    organizerId,
    name: data.name,
    email: data.email ?? null,
    role: data.role,
    permissions: data.permissions,
    status: data.status,
  };
  const member = data.email
    ? await db.organizerMember.upsert({
        where: { organizerId_email: { organizerId, email: data.email } },
        create: createData,
        update: data,
      })
    : await db.organizerMember.create({ data: createData });
  return { member: publicMember(member) };
}

export async function createOrganizerInvitation(db: PrismaClient, organizerId: string, input: OrganizerInvitationInput, now = new Date()) {
  const organizer = await db.organizer.findUnique({ where: { id: organizerId }, select: { id: true } });
  if (!organizer) throw new BackofficeError(404, "organizer_not_found", "主办方不存在");
  const email = truncate(clean(input.email), 120);
  if (!email || !email.includes("@")) throw new BackofficeError(400, "invalid_member_email", "邀请成员需要填写有效邮箱");
  const data = memberData({ ...input, email, status: "invited" });
  if (!data.name || !data.role || !data.permissions) throw new BackofficeError(400, "invalid_member", "成员信息不完整");
  const memberFields = { name: data.name, email, role: data.role, permissions: data.permissions };
  const token = createBackofficeToken("lpi");
  const expiresAt = new Date(now.getTime() + normalizeInviteHours(input.inviteExpiresHours) * 60 * 60 * 1000);
  const tokenPatch = {
    status: "invited",
    inviteTokenHash: hashBackofficeToken(token),
    inviteExpiresAt: expiresAt,
    acceptedAt: null,
    accessTokenHash: null,
    lastLoginAt: null,
  };
  const member = await db.organizerMember.upsert({
    where: { organizerId_email: { organizerId, email } },
    create: { organizerId, ...memberFields, ...tokenPatch },
    update: { ...memberFields, ...tokenPatch },
  });
  return {
    member: publicMember(member),
    invitation: {
      token,
      url: buildBackofficeInviteUrl(token),
      expiresAt,
    },
  };
}

export async function acceptOrganizerInvitation(db: PrismaClient, input: OrganizerInvitationAcceptInput, now = new Date()) {
  const token = clean(input.token);
  if (!token) throw new BackofficeError(400, "invalid_invitation", "邀请链接无效");
  const member = await db.organizerMember.findUnique({ where: { inviteTokenHash: hashBackofficeToken(token) } });
  if (!member) throw new BackofficeError(400, "invalid_invitation", "邀请链接无效或已使用");
  if (member.status === "disabled") throw new BackofficeError(403, "member_disabled", "成员已停用");
  if (member.inviteExpiresAt && member.inviteExpiresAt.getTime() < now.getTime()) {
    throw new BackofficeError(410, "invitation_expired", "邀请已过期");
  }
  const memberToken = createBackofficeToken("lpm");
  const updated = await db.organizerMember.update({
    where: { id: member.id },
    data: {
      status: "active",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      acceptedAt: now,
      accessTokenHash: hashBackofficeToken(memberToken),
      lastLoginAt: now,
    },
  });
  return {
    member: publicMember(updated),
    memberToken,
  };
}

export async function updateOrganizerMember(db: PrismaClient, memberId: string, input: OrganizerMemberInput) {
  const existing = await db.organizerMember.findUnique({ where: { id: memberId } });
  if (!existing) throw new BackofficeError(404, "member_not_found", "成员不存在");
  const patch = memberData(input, true);
  const member = await db.organizerMember.update({ where: { id: memberId }, data: patch });
  return { member: publicMember(member) };
}

async function publicQuota(db: PrismaClient, quota: Quota & { ticketTypes?: { ticketType: { id: string; name: string; kind: string; priceCents: number } }[] }, now = new Date()) {
  const agg = await db.order.aggregate({
    where: { quotaId: quota.id, lifecycle: "reserved", reservedUntil: { gt: now } },
    _sum: { seats: true },
  });
  const reservedActive = agg._sum.seats ?? 0;
  return {
    id: quota.id,
    eventId: quota.eventId,
    name: quota.name,
    capacity: quota.capacity,
    used: quota.used,
    reservedActive,
    available: quotaAvailable({ capacity: quota.capacity, used: quota.used, reservedActive }),
    ticketTypes: (quota.ticketTypes ?? []).map((link) => ({
      id: link.ticketType.id,
      name: link.ticketType.name,
      kind: link.ticketType.kind,
      priceCents: link.ticketType.priceCents,
    })),
  };
}

function memberData(input: OrganizerMemberInput, partial = false) {
  const data: {
    name?: string;
    email?: string | null;
    role?: string;
    permissions?: string;
    status?: string;
  } = {};
  const name = truncate(clean(input.name), 80);
  if (name) data.name = name;
  else if (!partial) throw new BackofficeError(400, "invalid_member_name", "成员姓名不能为空");

  if (Object.prototype.hasOwnProperty.call(input, "email")) data.email = truncate(clean(input.email), 120) || null;
  const role = clean(input.role).toLowerCase();
  if (role) data.role = ["owner", "admin", "operator", "checkin", "viewer", "staff"].includes(role) ? role : "staff";
  else if (!partial) data.role = "staff";
  if (Object.prototype.hasOwnProperty.call(input, "permissions") || data.role || !partial) {
    data.permissions = JSON.stringify(normalizePermissions(input.permissions, data.role || "staff"));
  }
  const status = clean(input.status).toLowerCase();
  if (status) data.status = ["active", "invited", "disabled"].includes(status) ? status : "active";
  else if (!partial) data.status = "active";
  return data;
}

function normalizeCapacity(value: number | null | undefined, used: number) {
  if (value === null || value === undefined) return null;
  const next = Math.max(0, Math.round(Number(value)));
  if (!Number.isFinite(next)) return null;
  if (next < used) throw new BackofficeError(400, "capacity_below_used", "容量不能小于已占用名额");
  return next;
}

function normalizePermissions(value: string[] | string | undefined, role: string) {
  const explicit = Array.isArray(value)
    ? value.map(clean).filter(Boolean)
    : typeof value === "string"
      ? value.split(/[、,，/;\n]/).map(clean).filter(Boolean)
      : [];
  if (explicit.length) return Array.from(new Set(explicit)).slice(0, 12);
  if (role === "owner" || role === "admin") return ["events:write", "registrations:write", "checkin:write", "exports:read", "team:write"];
  if (role === "operator" || role === "staff") return ["events:read", "registrations:write", "checkin:write", "exports:read"];
  if (role === "checkin") return ["events:read", "checkin:write"];
  return ["events:read"];
}

function normalizeInviteHours(value: number | undefined) {
  const hours = Math.round(Number(value ?? 72));
  if (!Number.isFinite(hours)) return 72;
  return Math.min(24 * 14, Math.max(1, hours));
}

function publicMember(member: OrganizerMember) {
  return {
    id: member.id,
    organizerId: member.organizerId,
    name: member.name,
    email: member.email,
    role: member.role,
    permissions: parseJSON<string[]>(member.permissions, []),
    status: member.status,
    inviteExpiresAt: member.inviteExpiresAt,
    acceptedAt: member.acceptedAt,
    lastLoginAt: member.lastLoginAt,
    hasAccessToken: Boolean(member.accessTokenHash),
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

function exportFields(schemaValue: string | undefined, forms: Record<string, unknown>[]) {
  const schema = parseJSON<RegistrationFormSchema>(schemaValue, { fields: [] });
  const byKey = new Map<string, FormField | null>();
  for (const field of schema.fields) {
    const key = clean(field.key);
    if (key) byKey.set(key, field);
  }
  const fallbackKeys = Array.from(new Set(forms.flatMap((form) => Object.keys(form))))
    .filter((key) => clean(key) && !byKey.has(key))
    .sort((a, b) => a.localeCompare(b));
  for (const key of fallbackKeys) byKey.set(key, null);
  return Array.from(byKey.entries()).map(([key, field]) => ({
    key,
    field,
    header: field ? `${field.label || key}(${key})` : key,
  }));
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

function csv(rows: unknown[][]) {
  return rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

function spreadsheetXml(sheetName: string, headers: unknown[], rows: unknown[][]) {
  const tableRows = [headers, ...rows].map((row) =>
    `    <Row>${row.map((value) => `<Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`).join("")}</Row>`
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
    ' xmlns:o="urn:schemas-microsoft-com:office:office"',
    ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    `  <Worksheet ss:Name="${xmlAttr(sheetName)}">`,
    "  <Table>",
    ...tableRows,
    "  </Table>",
    "  </Worksheet>",
    "</Workbook>",
  ].join("\n");
}

interface PdfTextLine {
  text: string;
  size: number;
  leading: number;
  indent: number;
}

interface PdfPlacedLine extends PdfTextLine {
  x: number;
  y: number;
}

function registrationPdf(eventTitle: string, headers: unknown[], rows: unknown[][], now: Date) {
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 42;
  const textLines: PdfTextLine[] = [];
  const headerLabels = headers.map((header) => String(header ?? ""));

  pushWrapped(textLines, `报名名单 · ${eventTitle}`, 16, 24, 0, pageWidth, margin);
  pushWrapped(textLines, `生成时间：${formatLocalTime(now)} · 报名数：${rows.length}`, 9, 18, 0, pageWidth, margin);
  pushWrapped(textLines, " ", 6, 10, 0, pageWidth, margin);

  rows.forEach((row, index) => {
    const nameIndex = headerLabels.findIndex((header) => header === "姓名(name)" || header === "name");
    const phoneIndex = headerLabels.findIndex((header) => header === "手机号(phone)" || header === "phone");
    const name = nameIndex >= 0 ? text(row[nameIndex]) : "";
    const phone = phoneIndex >= 0 ? text(row[phoneIndex]) : "";
    const summary = [name, phone].filter(Boolean).join(" · ");
    pushWrapped(textLines, `#${index + 1}${summary ? ` · ${summary}` : ""}`, 12, 18, 0, pageWidth, margin);
    headerLabels.forEach((header, columnIndex) => {
      pushWrapped(textLines, `${header}: ${text(row[columnIndex])}`, 9, 13, 12, pageWidth, margin);
    });
    pushWrapped(textLines, " ", 6, 10, 0, pageWidth, margin);
  });

  if (!rows.length) pushWrapped(textLines, "暂无报名记录", 10, 14, 0, pageWidth, margin);

  const pages: PdfPlacedLine[][] = [];
  let current: PdfPlacedLine[] = [];
  let y = pageHeight - margin;
  for (const line of textLines) {
    if (current.length && y - line.leading < margin) {
      pages.push(current);
      current = [];
      y = pageHeight - margin;
    }
    current.push({ ...line, x: margin + line.indent, y });
    y -= line.leading;
  }
  if (current.length) pages.push(current);

  return buildPdf(pageWidth, pageHeight, pages.length ? pages : [[]]);
}

function pushWrapped(lines: PdfTextLine[], value: string, size: number, leading: number, indent: number, pageWidth: number, margin: number) {
  for (const line of wrapText(value, maxLineUnits(pageWidth, margin, indent, size))) {
    lines.push({ text: line, size, leading, indent });
  }
}

function maxLineUnits(pageWidth: number, margin: number, indent: number, size: number) {
  return Math.max(18, Math.floor((pageWidth - margin * 2 - indent) / size));
}

function wrapText(value: string, maxUnits: number) {
  const source = value || " ";
  const lines: string[] = [];
  let current = "";
  let units = 0;
  for (const char of Array.from(source)) {
    const nextUnits = displayUnits(char);
    if (current && units + nextUnits > maxUnits) {
      lines.push(current);
      current = char;
      units = nextUnits;
    } else {
      current += char;
      units += nextUnits;
    }
  }
  lines.push(current);
  return lines;
}

function displayUnits(value: string) {
  return value.charCodeAt(0) > 255 ? 1 : 0.55;
}

function buildPdf(pageWidth: number, pageHeight: number, pages: PdfPlacedLine[][]) {
  const objects: string[] = ["", ""];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = objects.push(
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>"
  );
  objects.push(
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor 5 0 R >>"
  );
  objects.push(
    "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-260 -249 1043 893] /ItalicAngle 0 /Ascent 752 /Descent -271 /CapHeight 737 /StemV 58 >>"
  );

  const pageIds: number[] = [];
  for (const page of pages) {
    const stream = pageContent(page);
    const contentId = objects.push(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    const pageId = objects.push(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  return pdfBuffer(objects);
}

function pageContent(lines: PdfPlacedLine[]) {
  return lines
    .filter((line) => line.text)
    .map((line) => `BT /F1 ${line.size} Tf ${line.x} ${line.y} Td <${utf16Hex(line.text)}> Tj ET`)
    .join("\n");
}

function pdfBuffer(objects: string[]) {
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = Buffer.byteLength(output, "utf8");
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "utf8");
}

function utf16Hex(value: string) {
  const hex: string[] = [];
  for (let i = 0; i < value.length; i += 1) hex.push(value.charCodeAt(i).toString(16).padStart(4, "0"));
  return hex.join("").toUpperCase();
}

function formatLocalTime(value: Date) {
  return value.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function xmlAttr(value: string) {
  return xmlEscape(value).replace(/"/g, "&quot;");
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) || "loopin-export";
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
