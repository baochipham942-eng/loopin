const BASE = "/api"; // vite 代理到 :8787
const TOKEN_STORAGE_KEY = "loopin.backofficeAdminToken";
const MEMBER_TOKEN_STORAGE_KEY = "loopin.backofficeMemberToken";
const ORGANIZER_STORAGE_KEY = "loopin.session.organizerId"; // 由 SessionContext 维护

async function http(path: string, opts: RequestInit = {}) {
  const { headers, ...rest } = opts;
  const mergedHeaders = new Headers(headers);
  if (!mergedHeaders.has("content-type")) mergedHeaders.set("content-type", "application/json");
  addBackofficeHeaders(mergedHeaders);
  const res = await fetch(BASE + path, {
    ...rest,
    headers: mergedHeaders,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.message || res.statusText), { status: res.status, data });
  return data;
}

export const api = {
  get: (p: string, opts?: RequestInit) => http(p, opts),
  post: (p: string, body: unknown, opts?: RequestInit) => http(p, { ...opts, method: "POST", body: JSON.stringify(body) }),
  put: (p: string, body: unknown, opts?: RequestInit) => http(p, { ...opts, method: "PUT", body: JSON.stringify(body) }),
};

function addBackofficeHeaders(headers: Headers) {
  if (typeof window === "undefined") return;
  const admin = window.localStorage.getItem(TOKEN_STORAGE_KEY)?.trim();
  const member = window.localStorage.getItem(MEMBER_TOKEN_STORAGE_KEY)?.trim();
  const organizer = window.localStorage.getItem(ORGANIZER_STORAGE_KEY)?.trim();
  if (admin && !headers.has("x-loopin-admin-token")) headers.set("x-loopin-admin-token", admin);
  if (member && !headers.has("x-loopin-member-token")) headers.set("x-loopin-member-token", member);
  // 组织上下文：非空时附带，后端可忽略，不影响现有鉴权（向后兼容）
  if (organizer && !headers.has("x-loopin-organizer-id")) headers.set("x-loopin-organizer-id", organizer);
}
