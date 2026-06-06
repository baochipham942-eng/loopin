#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const APPID = process.env.WECHAT_APPID || "wxfb83ad53ee194fe3";
const DEFAULT_KEY_PATH = "/Users/linchen/Downloads/private.wxfb83ad53ee194fe3.key";
const PRIVATE_KEY_PATH = path.resolve(process.env.WECHAT_PRIVATE_KEY_PATH || DEFAULT_KEY_PATH);
const SOURCE_PROJECT_PATH = path.resolve(process.env.WECHAT_CI_PROJECT_PATH || path.join(repoRoot, "apps/miniprogram"));
const ARTIFACT_ROOT = path.resolve(process.env.WECHAT_CI_ARTIFACT_ROOT || path.join(repoRoot, ".artifacts/miniprogram"));
const STAGED_PROJECT_PATH = path.join(ARTIFACT_ROOT, "project");

const cliArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const commandAlias = cliArgs[0] || "preview";
const commandMap = {
  preview: "preview",
  upload: "upload",
  check: "check-code-quality",
  "check-code-quality": "check-code-quality",
  compile: "get-compiled-result",
  "get-compiled-result": "get-compiled-result",
  "pack-npm": "pack-npm",
};
if (commandAlias === "--help" || commandAlias === "-h") {
  printHelp();
  process.exit(0);
}
const command = commandMap[commandAlias];

if (!command) {
  printHelp();
  process.exit(1);
}

// 路由选择：preview/upload 默认走官方微信开发者工具 CLI（登录态，绕开 CI 上传密钥的 41001 后端问题）；
// 设 WECHAT_CI_USE_KEY=1 或开发者工具未安装时，回退 miniprogram-ci 上传密钥路线。
const DEVTOOLS_CLI = process.env.WECHAT_DEVTOOLS_CLI || "/Applications/wechatwebdevtools.app/Contents/MacOS/cli";
const useDevtools =
  (command === "preview" || command === "upload") &&
  process.env.WECHAT_CI_USE_KEY !== "1" &&
  existsSync(DEVTOOLS_CLI);

assertExists(SOURCE_PROJECT_PATH, "Mini Program project");
if (!useDevtools) {
  assertExists(PRIVATE_KEY_PATH, "WeChat upload private key");
  assertExists(path.join(repoRoot, "node_modules/.bin/miniprogram-ci"), "miniprogram-ci binary");
}

mkdirSync(ARTIFACT_ROOT, { recursive: true });
// devtools CLI 对 .artifacts 下的 staged 副本会挂死（实测），必须用源目录；
// staging（含 apiBase 注入）仅在 upload-key 路线生效。
const projectPath = useDevtools ? SOURCE_PROJECT_PATH : stageProject();
if (useDevtools && (process.env.LOOPIN_MINI_API_BASE || process.env.WECHAT_CI_API_BASE)) {
  console.warn(
    "[miniprogram-ci] 警告: devtools-cli 路线直接使用源目录，LOOPIN_MINI_API_BASE/WECHAT_CI_API_BASE 注入不生效；如需注入请设 WECHAT_CI_USE_KEY=1 走上传密钥路线。",
  );
}

const version = process.env.WECHAT_CI_VERSION || rootPackage.version || "0.0.1";
const robot = process.env.WECHAT_CI_ROBOT || "1";
const threads = process.env.WECHAT_CI_THREADS || "2";
const description =
  process.env.WECHAT_CI_DESC ||
  `Loopin ${version} ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`;
const proxy = process.env.WECHAT_CI_PROXY || "";
const timeoutMs = Number.parseInt(process.env.WECHAT_CI_TIMEOUT_MS || "180000", 10);

const args = [
  command,
  "--pp",
  projectPath,
  "--pkp",
  PRIVATE_KEY_PATH,
  "--appid",
  APPID,
  "--project-type",
  "miniProgram",
  "--use-project-config",
  "--locales",
  "zh",
];

if (proxy) {
  args.push("--proxy", proxy);
}

if (command === "preview" || command === "upload" || command === "get-compiled-result") {
  args.push("--uv", version, "-r", robot, "--threads", threads, "--ud", description);
}

const qrcodeDest = path.resolve(
  process.env.WECHAT_CI_QRCODE_PATH || path.join(ARTIFACT_ROOT, "preview-qrcode.jpg"),
);
if (command === "preview") {
  mkdirSync(path.dirname(qrcodeDest), { recursive: true });
  args.push("--qrcode-format", "image", "--qrcode-output-dest", qrcodeDest);

  if (process.env.WECHAT_CI_PREVIEW_PAGE) {
    args.push("--preview-page-path", process.env.WECHAT_CI_PREVIEW_PAGE);
  }
  if (process.env.WECHAT_CI_PREVIEW_QUERY) {
    args.push("--preview-search-query", process.env.WECHAT_CI_PREVIEW_QUERY);
  }
}

if (command === "check-code-quality") {
  const reportPath = path.resolve(
    process.env.WECHAT_CI_REPORT_PATH || path.join(ARTIFACT_ROOT, "code-quality.json"),
  );
  mkdirSync(path.dirname(reportPath), { recursive: true });
  args.push("--sp", reportPath);
}

if (command === "get-compiled-result") {
  const savePath = path.resolve(
    process.env.WECHAT_CI_COMPILED_PATH || path.join(ARTIFACT_ROOT, "compiled"),
  );
  rmSync(savePath, { recursive: true, force: true });
  mkdirSync(path.dirname(savePath), { recursive: true });
  args.push("--sp", savePath);
}

// 官方开发者工具 CLI 参数（preview/upload）。注意：--qr-output 不能传 /tmp 这类符号链接路径。
const devtoolsArgs =
  command === "preview"
    ? ["preview", "--project", projectPath, "--qr-format", "image", "--qr-output", qrcodeDest]
    : ["upload", "--project", projectPath, "-v", version, "-d", description];
if (useDevtools && command === "preview" && (process.env.WECHAT_CI_PREVIEW_PAGE || process.env.WECHAT_CI_PREVIEW_QUERY)) {
  devtoolsArgs.push(
    "--compile-condition",
    JSON.stringify({
      pathName: process.env.WECHAT_CI_PREVIEW_PAGE || "",
      query: process.env.WECHAT_CI_PREVIEW_QUERY || "",
    }),
  );
}

const bin = useDevtools ? DEVTOOLS_CLI : path.join(repoRoot, "node_modules/.bin/miniprogram-ci");
const finalArgs = useDevtools ? devtoolsArgs : args;
console.log(`[miniprogram-ci] command=${command} route=${useDevtools ? "devtools-cli" : "upload-key"}`);
console.log(`[miniprogram-ci] project=${projectPath}`);
console.log(`[miniprogram-ci] appid=${APPID}`);
if (process.env.LOOPIN_MINI_API_BASE || process.env.WECHAT_CI_API_BASE) {
  console.log(`[miniprogram-ci] apiBase=${process.env.LOOPIN_MINI_API_BASE || process.env.WECHAT_CI_API_BASE}`);
}

const child = spawn(bin, finalArgs, {
  cwd: repoRoot,
  detached: true,
  stdio: "inherit",
  env: buildChildEnv(proxy),
});

let timedOut = false;
const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
  ? setTimeout(() => {
      timedOut = true;
      console.error(`[miniprogram-ci] timed out after ${timeoutMs}ms`);
      killProcessGroup(child.pid, "SIGTERM");
      setTimeout(() => killProcessGroup(child.pid, "SIGKILL"), 5000).unref();
    }, timeoutMs)
  : null;
timeout?.unref();

child.on("exit", (code, signal) => {
  if (timeout) clearTimeout(timeout);
  if (timedOut) {
    process.exit(124);
  }
  if (signal) {
    console.error(`[miniprogram-ci] exited by signal ${signal}`);
    process.exit(1);
  }
  if (useDevtools && code) {
    console.error(
      "[miniprogram-ci] devtools CLI 失败。确认微信开发者工具已登录、设置→安全设置→服务端口已开启；或设 WECHAT_CI_USE_KEY=1 回退上传密钥路线。",
    );
  }
  process.exit(code ?? 0);
});

function stageProject() {
  rmSync(STAGED_PROJECT_PATH, { recursive: true, force: true });
  cpSync(SOURCE_PROJECT_PATH, STAGED_PROJECT_PATH, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`),
  });

  const apiBase = process.env.LOOPIN_MINI_API_BASE || process.env.WECHAT_CI_API_BASE;
  if (apiBase) {
    const appJsPath = path.join(STAGED_PROJECT_PATH, "app.js");
    const appJs = readFileSync(appJsPath, "utf8");
    const next = appJs.replace(/apiBase:\s*"[^"]+"/, `apiBase: "${apiBase}"`);
    if (next === appJs) {
      throw new Error(`Could not replace apiBase in ${appJsPath}`);
    }
    writeFileSync(appJsPath, next);
  }

  return STAGED_PROJECT_PATH;
}

function assertExists(targetPath, label) {
  if (!existsSync(targetPath)) {
    throw new Error(`${label} not found: ${targetPath}`);
  }
}

function buildChildEnv(explicitProxy) {
  const childEnv = { ...process.env };
  if (explicitProxy) return childEnv;

  delete childEnv.HTTPS_PROXY;
  delete childEnv.https_proxy;
  delete childEnv.HTTP_PROXY;
  delete childEnv.http_proxy;

  const noProxyHosts = ["servicewechat.com", ".servicewechat.com"];
  childEnv.NO_PROXY = appendNoProxy(childEnv.NO_PROXY, noProxyHosts);
  childEnv.no_proxy = appendNoProxy(childEnv.no_proxy, noProxyHosts);
  return childEnv;
}

function appendNoProxy(value, hosts) {
  const parts = new Set(
    String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  for (const host of hosts) parts.add(host);
  return Array.from(parts).join(",");
}

function killProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

function printHelp() {
  console.log(`Usage: pnpm mini:ci <preview|upload|check-code-quality|compile|pack-npm>

Defaults:
  project: apps/miniprogram
  appid: ${APPID}
  private key: ${DEFAULT_KEY_PATH}
  artifacts: .artifacts/miniprogram

Useful env:
  WECHAT_PRIVATE_KEY_PATH=/path/private.${APPID}.key
  WECHAT_CI_VERSION=${rootPackage.version}
  WECHAT_CI_ROBOT=1
  LOOPIN_MINI_API_BASE=https://loopin.llmxy.xyz/api
  WECHAT_CI_QRCODE_PATH=.artifacts/miniprogram/preview-qrcode.jpg
  WECHAT_CI_TIMEOUT_MS=180000
`);
}
