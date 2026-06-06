const BASE = "/api"; // vite 代理到 :8787

async function http(path: string, opts: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.message || res.statusText), { status: res.status, data });
  return data;
}

export const api = {
  get: (p: string) => http(p),
  post: (p: string, body: unknown) => http(p, { method: "POST", body: JSON.stringify(body) }),
};
