import { createHash, randomBytes } from "node:crypto";

export function createBackofficeToken(prefix: "lpi" | "lpm") {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function hashBackofficeToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function buildBackofficeInviteUrl(token: string) {
  const base = clean(process.env.BACKOFFICE_STUDIO_URL) || clean(process.env.PUBLIC_STUDIO_URL);
  const query = `view=backoffice&invite=${encodeURIComponent(token)}`;
  if (!base) return `?${query}`;
  return `${base.replace(/[?&]$/, "")}${base.includes("?") ? "&" : "?"}${query}`;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
