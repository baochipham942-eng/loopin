import type { PrismaClient, User } from "@prisma/client";

type FetchLike = typeof fetch;

interface Code2SessionResponse {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

interface PhoneNumberResponse {
  errcode?: number;
  errmsg?: string;
  phone_info?: {
    phoneNumber?: string;
    purePhoneNumber?: string;
    countryCode?: string;
  };
}

export class WechatAuthError extends Error {
  constructor(message: string, public statusCode = 502) {
    super(message);
    this.name = "WechatAuthError";
  }
}

export function wechatAppId() {
  return process.env.WX_APPID || process.env.WECHAT_APPID || "";
}

export function wechatAppSecret() {
  return process.env.WX_APPSECRET || process.env.WECHAT_APPSECRET || "";
}

export function wechatConfigured() {
  const secret = wechatAppSecret();
  return Boolean(wechatAppId() && secret && secret !== "__FILL_ME__");
}

function maskPhone(phone: string | null | undefined) {
  if (!phone) return null;
  return phone.replace(/^(\d{3})\d{4}(\d+)$/, "$1****$2");
}

function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, "");
}

function assertPhone(phone: string) {
  const normalized = normalizePhone(phone);
  if (!/^1\d{10}$/.test(normalized)) {
    throw new WechatAuthError("手机号格式不正确", 400);
  }
  return normalized;
}

async function code2Session(code: string, fetcher: FetchLike = fetch) {
  if (!wechatConfigured()) {
    throw new WechatAuthError("微信 AppSecret 未配置，无法换取 openid", 503);
  }

  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.searchParams.set("appid", wechatAppId());
  url.searchParams.set("secret", wechatAppSecret());
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const res = await fetcher(url);
  const data = (await res.json()) as Code2SessionResponse;
  if (!res.ok || data.errcode || !data.openid) {
    throw new WechatAuthError(data.errmsg || "微信登录失败", res.ok ? 401 : 502);
  }
  return data.openid;
}

export async function getWechatAccessToken(fetcher: FetchLike = fetch) {
  if (!wechatConfigured()) {
    throw new WechatAuthError("微信 AppSecret 未配置，无法获取 access_token", 503);
  }

  const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", wechatAppId());
  url.searchParams.set("secret", wechatAppSecret());

  const res = await fetcher(url);
  const data = (await res.json()) as AccessTokenResponse;
  if (!res.ok || data.errcode || !data.access_token) {
    throw new WechatAuthError(data.errmsg || "微信 access_token 获取失败", res.ok ? 401 : 502);
  }
  return data.access_token;
}

export async function exchangePhoneCode(code: string, fetcher: FetchLike = fetch) {
  const token = await getWechatAccessToken(fetcher);
  const url = new URL("https://api.weixin.qq.com/wxa/business/getuserphonenumber");
  url.searchParams.set("access_token", token);

  const res = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = (await res.json()) as PhoneNumberResponse;
  const phone = data.phone_info?.purePhoneNumber || data.phone_info?.phoneNumber;
  if (!res.ok || data.errcode || !phone) {
    throw new WechatAuthError(data.errmsg || "手机号授权失败", res.ok ? 401 : 502);
  }
  return assertPhone(phone);
}

async function mergeLocalUserIntoWechatUser(db: PrismaClient, localUserId: string, target: User) {
  if (localUserId === target.id) return target;

  const local = await db.user.findUnique({ where: { id: localUserId } });
  if (!local) return target;

  return db.$transaction(async (tx) => {
    await tx.registration.updateMany({ where: { userId: localUserId }, data: { userId: target.id } });
    await tx.checkIn.updateMany({ where: { userId: localUserId }, data: { userId: target.id } });

    const update: { phone?: string; nickname?: string } = {};
    if (!target.phone && local.phone) update.phone = local.phone;
    if (!target.nickname && local.nickname) update.nickname = local.nickname;

    const merged = Object.keys(update).length
      ? await tx.user.update({ where: { id: target.id }, data: update })
      : await tx.user.findUniqueOrThrow({ where: { id: target.id } });

    await tx.user.delete({ where: { id: localUserId } });
    return merged;
  });
}

export async function bindWechatOpenid(
  db: PrismaClient,
  input: { openid: string; localUserId?: string; nickname?: string }
) {
  const existing = await db.user.findUnique({ where: { openid: input.openid } });
  if (existing) {
    const updated = input.nickname
      ? await db.user.update({ where: { id: existing.id }, data: { nickname: input.nickname } })
      : existing;
    return input.localUserId ? mergeLocalUserIntoWechatUser(db, input.localUserId, updated) : updated;
  }

  if (input.localUserId) {
    const local = await db.user.findUnique({ where: { id: input.localUserId } });
    if (local) {
      return db.user.update({
        where: { id: input.localUserId },
        data: { openid: input.openid, nickname: input.nickname || local.nickname },
      });
    }
  }

  return db.user.create({ data: { openid: input.openid, nickname: input.nickname } });
}

export async function loginWithWechatCode(
  db: PrismaClient,
  input: { code?: string; localUserId?: string; nickname?: string; devOpenid?: string },
  fetcher: FetchLike = fetch
) {
  if (input.devOpenid && process.env.NODE_ENV !== "production") {
    const user = await bindWechatOpenid(db, {
      openid: input.devOpenid,
      localUserId: input.localUserId,
      nickname: input.nickname,
    });
    return { user, mode: "wechat" as const, openidBound: true };
  }

  if (!input.code || !wechatConfigured()) {
    const user = input.localUserId
      ? await db.user.upsert({
          where: { id: input.localUserId },
          create: { id: input.localUserId, nickname: input.nickname },
          update: input.nickname ? { nickname: input.nickname } : {},
        })
      : await db.user.create({ data: { nickname: input.nickname } });
    return { user, mode: "local" as const, openidBound: Boolean(user.openid) };
  }

  const openid = await code2Session(input.code, fetcher);
  const user = await bindWechatOpenid(db, { openid, localUserId: input.localUserId, nickname: input.nickname });
  return { user, mode: "wechat" as const, openidBound: true };
}

export async function bindUserPhone(db: PrismaClient, userId: string, phone: string) {
  const normalized = assertPhone(phone);
  const existing = await db.user.findUnique({ where: { id: userId } });
  const user = existing
    ? await db.user.update({ where: { id: userId }, data: { phone: normalized } })
    : await db.user.create({ data: { id: userId, phone: normalized } });
  return { user, maskedPhone: maskPhone(user.phone) };
}

export async function bindUserPhoneFromWechat(
  db: PrismaClient,
  input: { userId: string; code?: string; phone?: string },
  fetcher: FetchLike = fetch
) {
  const phone = input.code ? await exchangePhoneCode(input.code, fetcher) : input.phone;
  if (!phone) {
    throw new WechatAuthError("缺少手机号", 400);
  }
  return bindUserPhone(db, input.userId, phone);
}

export function publicUser(user: User, mode?: "wechat" | "local") {
  return {
    userId: user.id,
    mode: mode ?? (user.openid ? "wechat" : "local"),
    openidBound: Boolean(user.openid),
    phoneBound: Boolean(user.phone),
    maskedPhone: maskPhone(user.phone),
  };
}
