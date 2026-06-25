import { createPrivateKey, createPublicKey, createSign, createVerify, X509Certificate } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { wechatPayReadiness } from "./services/payments.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config({ path: path.join(repoRoot, "apps/api/.env") });

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const report = buildReport();
const output = args.json ? JSON.stringify(report, null, 2) : args.markdown ? formatMarkdown(report) : formatText(report);

if (args.output) writeOutput(args.output, output);
console.log(output);
if (args.strict && !report.ready) process.exitCode = 1;

interface CliArgs {
  json: boolean;
  markdown: boolean;
  strict: boolean;
  output?: string;
  help: boolean;
}

interface CheckItem {
  key: string;
  env: string;
  ok: boolean;
  message: string;
  severity: "required" | "warning";
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { json: false, markdown: false, strict: false, help: false };
  const filtered = argv.filter((item) => item !== "--");
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index] ?? "";
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--json" || arg === "--format=json") out.json = true;
    else if (arg === "--markdown" || arg === "--md" || arg === "--format=markdown") out.markdown = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--output" || arg === "--out") out.output = filtered[index += 1] ?? "";
    else if (arg.startsWith("--output=")) out.output = arg.slice("--output=".length);
    else if (arg.startsWith("--out=")) out.output = arg.slice("--out=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function buildReport() {
  const readiness = wechatPayReadiness();
  const checks = [
    appIdCheck(),
    mchidCheck(),
    serialNoCheck(),
    privateKeyCheck(),
    apiV3KeyCheck(),
    platformCertCheck(),
    notifyUrlCheck(),
    paymentProviderCheck(readiness.configured),
  ];
  const requiredFailures = checks.filter((item) => item.severity === "required" && !item.ok);
  const warnings = checks.filter((item) => item.severity === "warning" && !item.ok);
  const cryptoReady = ["merchantPrivateKey", "apiV3Key", "platformCert"].every((key) => checks.find((item) => item.key === key)?.ok);
  const configured = requiredFailures.length === 0;
  const ready = configured && cryptoReady;
  return {
    ok: ready,
    ready,
    configured,
    cryptoReady,
    activeProvider: filled(process.env.PAYMENT_PROVIDER) || "mock",
    notifyUrl: readiness.notifyUrl,
    readiness: {
      configured: readiness.configured,
      canPrepare: readiness.canPrepare,
      canVerifyNotify: readiness.canVerifyNotify,
      missing: strictMissing(readiness.missing),
    },
    checks,
    failures: requiredFailures.map(({ key, env, message }) => ({ key, env, message })),
    warnings: warnings.map(({ key, env, message }) => ({ key, env, message })),
  };
}

function appIdCheck(): CheckItem {
  const value = firstFilled(["WECHATPAY_APPID", "WX_APPID", "WECHAT_APPID"]);
  if (!value) return required("appid", "WECHATPAY_APPID or WX_APPID", false, "缺少小程序 AppID");
  if (!/^wx[0-9a-f]{16}$/i.test(value)) return required("appid", "WECHATPAY_APPID or WX_APPID", false, "AppID 格式不像微信小程序 AppID");
  return required("appid", "WECHATPAY_APPID or WX_APPID", true, "AppID 已配置");
}

function mchidCheck(): CheckItem {
  const value = filled(process.env.WECHATPAY_MCHID);
  if (!value) return required("mchid", "WECHATPAY_MCHID", false, "缺少商户号");
  if (!/^\d{8,20}$/.test(value)) return required("mchid", "WECHATPAY_MCHID", false, "商户号应为 8-20 位数字");
  return required("mchid", "WECHATPAY_MCHID", true, "商户号已配置");
}

function serialNoCheck(): CheckItem {
  const value = filled(process.env.WECHATPAY_MERCHANT_SERIAL_NO);
  if (!value) return required("merchantSerialNo", "WECHATPAY_MERCHANT_SERIAL_NO", false, "缺少商户 API 证书序列号");
  if (!/^[0-9a-f]{20,64}$/i.test(value)) return required("merchantSerialNo", "WECHATPAY_MERCHANT_SERIAL_NO", false, "证书序列号应为十六进制字符串");
  return required("merchantSerialNo", "WECHATPAY_MERCHANT_SERIAL_NO", true, "商户 API 证书序列号已配置");
}

function privateKeyCheck(): CheckItem {
  const value = normalizePem(process.env.WECHATPAY_MERCHANT_PRIVATE_KEY);
  if (!value) return required("merchantPrivateKey", "WECHATPAY_MERCHANT_PRIVATE_KEY", false, "缺少商户私钥 PEM");
  try {
    const privateKey = createPrivateKey(value);
    const publicKey = createPublicKey(privateKey);
    const message = "loopin-wechat-pay-config-check";
    const signature = createSign("RSA-SHA256").update(message).sign(privateKey);
    const ok = createVerify("RSA-SHA256").update(message).verify(publicKey, signature);
    return required("merchantPrivateKey", "WECHATPAY_MERCHANT_PRIVATE_KEY", ok, ok ? "商户私钥可签名" : "商户私钥无法完成签名自检");
  } catch {
    return required("merchantPrivateKey", "WECHATPAY_MERCHANT_PRIVATE_KEY", false, "商户私钥 PEM 无法被解析");
  }
}

function apiV3KeyCheck(): CheckItem {
  const value = filled(process.env.WECHATPAY_API_V3_KEY);
  if (!value) return required("apiV3Key", "WECHATPAY_API_V3_KEY", false, "缺少 APIv3 key");
  if (Buffer.byteLength(value, "utf8") !== 32) return required("apiV3Key", "WECHATPAY_API_V3_KEY", false, "APIv3 key 必须是 32 字节");
  return required("apiV3Key", "WECHATPAY_API_V3_KEY", true, "APIv3 key 长度可用于 AES-256-GCM");
}

function platformCertCheck(): CheckItem {
  const value = normalizePem(process.env.WECHATPAY_PLATFORM_CERT_PEM);
  if (!value) return required("platformCert", "WECHATPAY_PLATFORM_CERT_PEM", false, "缺少微信支付平台证书 PEM");
  try {
    publicKeyFromPem(value);
    return required("platformCert", "WECHATPAY_PLATFORM_CERT_PEM", true, "平台证书/公钥可用于验签");
  } catch {
    return required("platformCert", "WECHATPAY_PLATFORM_CERT_PEM", false, "平台证书 PEM 无法被解析为证书或公钥");
  }
}

function notifyUrlCheck(): CheckItem {
  const explicit = filled(process.env.WECHATPAY_NOTIFY_URL);
  const base = filled(process.env.PUBLIC_BASE_URL);
  const value = explicit || (base ? `${base.replace(/\/$/, "")}/api/payments/wechatpay/notify` : "");
  if (!value) return required("notifyUrl", "WECHATPAY_NOTIFY_URL or PUBLIC_BASE_URL", false, "缺少支付回调地址");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return required("notifyUrl", "WECHATPAY_NOTIFY_URL or PUBLIC_BASE_URL", false, "支付回调地址必须是 https");
    if (!url.pathname.endsWith("/api/payments/wechatpay/notify")) {
      return warning("notifyUrlPath", "WECHATPAY_NOTIFY_URL", false, "回调路径不是 /api/payments/wechatpay/notify，请确认代码路由一致");
    }
    return required("notifyUrl", "WECHATPAY_NOTIFY_URL or PUBLIC_BASE_URL", true, "支付回调地址已配置");
  } catch {
    return required("notifyUrl", "WECHATPAY_NOTIFY_URL or PUBLIC_BASE_URL", false, "支付回调地址不是有效 URL");
  }
}

function paymentProviderCheck(configured: boolean): CheckItem {
  const provider = filled(process.env.PAYMENT_PROVIDER) || "mock";
  if (provider === "wechatpay" && !configured) {
    return required("paymentProvider", "PAYMENT_PROVIDER", false, "已切到 wechatpay，但商户参数未完整");
  }
  if (provider !== "mock" && provider !== "wechatpay") {
    return required("paymentProvider", "PAYMENT_PROVIDER", false, "PAYMENT_PROVIDER 只能是 mock 或 wechatpay");
  }
  if (provider === "wechatpay") return warning("paymentProvider", "PAYMENT_PROVIDER", true, "已切到 wechatpay");
  return warning("paymentProvider", "PAYMENT_PROVIDER", true, "当前仍是 mock，真机支付回归前保持 mock 是安全状态");
}

function publicKeyFromPem(value: string) {
  if (value.includes("BEGIN CERTIFICATE")) {
    return new X509Certificate(value).publicKey;
  }
  return createPublicKey(value);
}

function strictMissing(missing: string[]) {
  const missingSet = new Set(missing);
  if (!firstFilled(["WECHATPAY_APPID", "WX_APPID", "WECHAT_APPID"])) missingSet.add("WECHATPAY_APPID or WX_APPID");
  if (!filled(process.env.WECHATPAY_MCHID)) missingSet.add("WECHATPAY_MCHID");
  if (!filled(process.env.WECHATPAY_MERCHANT_SERIAL_NO)) missingSet.add("WECHATPAY_MERCHANT_SERIAL_NO");
  if (!normalizePem(process.env.WECHATPAY_MERCHANT_PRIVATE_KEY)) missingSet.add("WECHATPAY_MERCHANT_PRIVATE_KEY");
  if (!filled(process.env.WECHATPAY_API_V3_KEY)) missingSet.add("WECHATPAY_API_V3_KEY");
  if (!normalizePem(process.env.WECHATPAY_PLATFORM_CERT_PEM)) missingSet.add("WECHATPAY_PLATFORM_CERT_PEM");
  if (!filled(process.env.WECHATPAY_NOTIFY_URL) && !filled(process.env.PUBLIC_BASE_URL)) missingSet.add("WECHATPAY_NOTIFY_URL or PUBLIC_BASE_URL");
  return Array.from(missingSet);
}

function required(key: string, env: string, ok: boolean, message: string): CheckItem {
  return { key, env, ok, message, severity: "required" };
}

function warning(key: string, env: string, ok: boolean, message: string): CheckItem {
  return { key, env, ok, message, severity: "warning" };
}

function firstFilled(keys: string[]) {
  for (const key of keys) {
    const value = filled(process.env[key]);
    if (value) return value;
  }
  return "";
}

function filled(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text !== "__FILL_ME__" ? text : "";
}

function normalizePem(value: unknown) {
  return filled(value).replace(/\\n/g, "\n").trim();
}

function formatText(report: ReturnType<typeof buildReport>) {
  const lines = [
    "Loopin WeChat Pay config check",
    `activeProvider: ${report.activeProvider}`,
    `ready: ${report.ready}`,
    `configured: ${report.configured}`,
    `cryptoReady: ${report.cryptoReady}`,
    `notifyUrl: ${report.notifyUrl || "missing"}`,
    `missing: ${report.readiness.missing.join(",") || "none"}`,
    "",
  ];
  for (const item of report.checks) {
    lines.push(`[${item.ok ? "ok" : item.severity}] ${item.env}: ${item.message}`);
  }
  return lines.join("\n");
}

function formatMarkdown(report: ReturnType<typeof buildReport>) {
  const lines = [
    "# Loopin WeChat Pay Config Check",
    "",
    `- activeProvider: \`${report.activeProvider}\``,
    `- ready: \`${report.ready}\``,
    `- configured: \`${report.configured}\``,
    `- cryptoReady: \`${report.cryptoReady}\``,
    `- notifyUrl: \`${report.notifyUrl || "missing"}\``,
    `- missing: \`${report.readiness.missing.join(",") || "none"}\``,
    "",
    "| Status | Env | Message |",
    "|---|---|---|",
  ];
  for (const item of report.checks) {
    lines.push(`| ${item.ok ? "ok" : item.severity} | ${markdownCell(item.env)} | ${markdownCell(item.message)} |`);
  }
  if (report.failures.length || report.warnings.length) {
    lines.push("", "## Remaining");
    for (const item of report.failures) {
      lines.push(`- ${item.env}: ${item.message}`);
    }
    for (const item of report.warnings) {
      lines.push(`- ${item.env}: ${item.message}`);
    }
  }
  lines.push("", "No merchant secret, private key, APIv3 key, or certificate content is printed by this check.");
  return lines.join("\n");
}

function markdownCell(value: string) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function writeOutput(file: string, content: string) {
  const target = path.resolve(repoRoot, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${content}\n`);
}

function printHelp() {
  console.log(`Usage:
  pnpm wechatpay:check
  pnpm wechatpay:check -- --json
  pnpm wechatpay:check -- --markdown --output .artifacts/wechatpay-check.md
  pnpm wechatpay:check -- --strict

Options:
  --json             print JSON
  --markdown         print Markdown
  --strict           exit non-zero unless ready
  --output <file>    write report

The check reads .env.local and apps/api/.env, and never prints secret values.
`);
}
