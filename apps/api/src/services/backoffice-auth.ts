import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { BackofficeError } from "./backoffice.js";
import { hashBackofficeToken } from "./backoffice-tokens.js";

export type BackofficePermission =
  | "events:read"
  | "events:write"
  | "registrations:read"
  | "registrations:write"
  | "checkin:write"
  | "exports:read"
  | "team:read"
  | "team:write";

export interface BackofficeScope {
  permission: BackofficePermission;
  eventId?: string;
  quotaId?: string;
  organizerId?: string;
  memberId?: string;
}

export async function requireBackofficeAccess(db: PrismaClient, req: FastifyRequest, scope: BackofficeScope) {
  const expectedToken = clean(process.env.BACKOFFICE_ADMIN_TOKEN);
  const adminToken = bearerOrHeader(req, "x-loopin-admin-token");
  if (expectedToken && adminToken && safeEqual(adminToken, expectedToken)) {
    const operatorMemberId = header(req, "x-loopin-member-id");
    if (!operatorMemberId) return;
    const member = await db.organizerMember.findUnique({ where: { id: operatorMemberId } });
    return assertMemberAccess(db, member, scope);
  }

  const memberToken = bearerOrHeader(req, "x-loopin-member-token");
  if (memberToken) {
    const member = await db.organizerMember.findUnique({ where: { accessTokenHash: hashBackofficeToken(memberToken) } });
    await assertMemberAccess(db, member, scope);
    if (member) await db.organizerMember.update({ where: { id: member.id }, data: { lastLoginAt: new Date() } });
    return;
  }

  if (!expectedToken) return;

  throw new BackofficeError(401, "backoffice_unauthorized", "后台令牌或成员令牌缺失或无效");
}

async function assertMemberAccess(db: PrismaClient, member: { id: string; organizerId: string; status: string; permissions: string } | null, scope: BackofficeScope) {
  const organizerId = await resolveOrganizerId(db, scope);
  if (!member || member.status !== "active") {
    throw new BackofficeError(403, "backoffice_member_inactive", "成员不存在或未启用");
  }
  if (organizerId && member.organizerId !== organizerId) {
    throw new BackofficeError(403, "backoffice_scope_forbidden", "成员无权访问该主办方活动");
  }
  if (!hasPermission(parseJSON<string[]>(member.permissions, []), scope.permission)) {
    throw new BackofficeError(403, "backoffice_permission_forbidden", "成员权限不足");
  }
}

async function resolveOrganizerId(db: PrismaClient, scope: BackofficeScope) {
  if (scope.organizerId) return scope.organizerId;
  if (scope.eventId) {
    const event = await db.event.findUnique({ where: { id: scope.eventId }, select: { organizerId: true } });
    if (!event) throw new BackofficeError(404, "event_not_found", "活动不存在");
    return event.organizerId;
  }
  if (scope.quotaId) {
    const quota = await db.quota.findUnique({
      where: { id: scope.quotaId },
      select: { event: { select: { organizerId: true } } },
    });
    if (!quota) throw new BackofficeError(404, "quota_not_found", "配额不存在");
    return quota.event.organizerId;
  }
  if (scope.memberId) {
    const member = await db.organizerMember.findUnique({ where: { id: scope.memberId }, select: { organizerId: true } });
    if (!member) throw new BackofficeError(404, "member_not_found", "成员不存在");
    return member.organizerId;
  }
  return null;
}

function hasPermission(permissions: string[], required: BackofficePermission) {
  const granted = new Set(permissions);
  if (granted.has(required) || granted.has("*")) return true;
  if (required.endsWith(":read") && granted.has(required.replace(":read", ":write"))) return true;
  if (required === "team:read" && granted.has("team:write")) return true;
  return false;
}

function bearerOrHeader(req: FastifyRequest, name: string) {
  const explicit = header(req, name);
  if (explicit) return explicit;
  const authorization = header(req, "authorization");
  const match = authorization.match(/^bearer\s+(.+)$/i);
  return clean(match?.[1]);
}

function header(req: FastifyRequest, name: string) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? clean(value[0]) : clean(value);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseJSON<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
