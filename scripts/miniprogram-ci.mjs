#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

const APPID = process.env.WECHAT_APPID || process.env.WX_APPID || "wxfb83ad53ee194fe3";
const PRIVATE_KEY_PATH = process.env.WECHAT_PRIVATE_KEY_PATH || process.env.WX_UPLOAD_PRIVATE_KEY_PATH || "";
const RESOLVED_PRIVATE_KEY_PATH = PRIVATE_KEY_PATH ? path.resolve(PRIVATE_KEY_PATH) : "";
const SOURCE_PROJECT_PATH = path.resolve(process.env.WECHAT_CI_PROJECT_PATH || path.join(repoRoot, "apps/miniprogram"));
const ARTIFACT_ROOT = path.resolve(process.env.WECHAT_CI_ARTIFACT_ROOT || path.join(repoRoot, ".artifacts/miniprogram"));
const STAGED_PROJECT_PATH = path.join(ARTIFACT_ROOT, "project");
const DEVTOOLS_STAGED_PROJECT_PATH = path.resolve(
  process.env.WECHAT_DEVTOOLS_STAGED_PROJECT_PATH || "/tmp/loopin-mini",
);
const DEVTOOLS_PORT = process.env.WECHAT_DEVTOOLS_PORT || findDevtoolsPort();

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
  if (!RESOLVED_PRIVATE_KEY_PATH) {
    throw new Error("WeChat upload private key path is required. Set WECHAT_PRIVATE_KEY_PATH or WX_UPLOAD_PRIVATE_KEY_PATH.");
  }
  assertExists(RESOLVED_PRIVATE_KEY_PATH, "WeChat upload private key");
  assertExists(path.join(repoRoot, "node_modules/.bin/miniprogram-ci"), "miniprogram-ci binary");
}

mkdirSync(ARTIFACT_ROOT, { recursive: true });
// WeChat Devtools upload/preview may mis-handle project paths containing spaces,
// so devtools runs from a real /private/tmp staged copy.
const projectPath = useDevtools ? stageProject(DEVTOOLS_STAGED_PROJECT_PATH) : stageProject(STAGED_PROJECT_PATH);

const version = process.env.WECHAT_CI_VERSION || rootPackage.version || "0.0.1";
const robot = process.env.WECHAT_CI_ROBOT || "1";
const threads = process.env.WECHAT_CI_THREADS || "2";
const description =
  process.env.WECHAT_CI_DESC ||
  `Loopin ${version} ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`;
const proxy = process.env.WECHAT_CI_PROXY || "";
const defaultTimeoutMs = useDevtools && command === "upload" ? "120000" : "180000";
const timeoutMs = Number.parseInt(process.env.WECHAT_CI_TIMEOUT_MS || defaultTimeoutMs, 10);
const shouldPreopenDevtools = useDevtools && command === "upload" && process.env.WECHAT_DEVTOOLS_PREOPEN === "1";
const allowKeyFallback = useDevtools && process.env.WECHAT_CI_ENABLE_KEY_FALLBACK === "1";
const disableDevtoolsGpu = process.env.WECHAT_DEVTOOLS_DISABLE_GPU === "1";

const args = [
  command,
  "--pp",
  projectPath,
  "--pkp",
  RESOLVED_PRIVATE_KEY_PATH,
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

const artifactQrcodeDest = path.resolve(
  process.env.WECHAT_CI_QRCODE_PATH || path.join(ARTIFACT_ROOT, "preview-qrcode.jpg"),
);
const qrcodeDest = useDevtools && !process.env.WECHAT_CI_QRCODE_PATH
  ? path.resolve("/private/tmp/loopin-mini-preview/preview.jpg")
  : artifactQrcodeDest;
const artifactInfoDest = path.resolve(path.join(ARTIFACT_ROOT, "preview-info.json"));
const previewInfoDest = useDevtools
  ? path.resolve("/private/tmp/loopin-mini-preview/info.json")
  : artifactInfoDest;
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
    ? ["preview", "--project", projectPath, "--appid", APPID, "--qr-format", "image", "--qr-output", qrcodeDest, "--info-output", previewInfoDest]
    : ["upload", "--project", projectPath, "--appid", APPID, "-v", version, "-d", description];
if (useDevtools) {
  if (DEVTOOLS_PORT) devtoolsArgs.push("--port", DEVTOOLS_PORT);
  if (disableDevtoolsGpu) devtoolsArgs.push("--disable-gpu");
  devtoolsArgs.push("--lang", "zh");
}
if (useDevtools && command === "preview" && (process.env.WECHAT_CI_PREVIEW_PAGE || process.env.WECHAT_CI_PREVIEW_QUERY)) {
  devtoolsArgs.push(
    "--compile-condition",
    JSON.stringify({
      pathName: process.env.WECHAT_CI_PREVIEW_PAGE || "",
      query: process.env.WECHAT_CI_PREVIEW_QUERY || "",
    }),
  );
}

const keyCli = path.join(repoRoot, "node_modules/.bin/miniprogram-ci");
const bin = useDevtools ? DEVTOOLS_CLI : keyCli;
const finalArgs = useDevtools ? devtoolsArgs : args;
console.log(`[miniprogram-ci] command=${command} route=${useDevtools ? "devtools-cli" : "upload-key"}`);
console.log(`[miniprogram-ci] project=${projectPath}`);
console.log(`[miniprogram-ci] appid=${APPID}`);
if (useDevtools && DEVTOOLS_PORT) console.log(`[miniprogram-ci] devtoolsPort=${DEVTOOLS_PORT}`);
if (process.env.LOOPIN_MINI_API_BASE || process.env.WECHAT_CI_API_BASE) {
  console.log(`[miniprogram-ci] apiBase=${process.env.LOOPIN_MINI_API_BASE || process.env.WECHAT_CI_API_BASE}`);
}

if (shouldPreopenDevtools) {
  preopenDevtoolsProject(projectPath);
}

runCli(bin, finalArgs, {
  route: useDevtools ? "devtools-cli" : "upload-key",
  allowKeyFallback,
});

function stageProject(targetPath) {
  rmSync(targetPath, { recursive: true, force: true });
  mkdirSync(path.dirname(targetPath), { recursive: true });
  cpSync(SOURCE_PROJECT_PATH, targetPath, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`),
  });

  const apiBase = process.env.LOOPIN_MINI_API_BASE || process.env.WECHAT_CI_API_BASE;
  if (apiBase) {
    const appJsPath = path.join(targetPath, "app.js");
    const appJs = readFileSync(appJsPath, "utf8");
    const next = appJs
      .replace(/const LOCAL_API_BASE = "[^"]+";/, `const LOCAL_API_BASE = "${apiBase}";`)
      .replace(/const PROD_API_BASE = "[^"]+";/, `const PROD_API_BASE = "${apiBase}";`)
      .replace(/apiBase:\s*"[^"]+"/, `apiBase: "${apiBase}"`);
    if (next === appJs) {
      throw new Error(`Could not replace api base in ${appJsPath}`);
    }
    writeFileSync(appJsPath, next);
  }

  return targetPath;
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

function findDevtoolsPort() {
  const base = path.join(homedir(), "Library/Application Support/微信开发者工具");
  if (!existsSync(base)) return "";
  const logPort = findLatestDevtoolsLogPort(base);
  if (logPort) return logPort;

  const candidates = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cliPath = path.join(base, entry.name, "Default", ".cli");
    if (!existsSync(cliPath)) continue;
    const port = readFileSync(cliPath, "utf8").trim();
    if (/^\d+$/.test(port)) candidates.push({ port, mtimeMs: statSync(cliPath).mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.port || "";
}

function findLatestDevtoolsLogPort(base) {
  const logs = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const logDir = path.join(base, entry.name, "WeappLog", "logs");
    if (!existsSync(logDir)) continue;
    for (const logEntry of readdirSync(logDir, { withFileTypes: true })) {
      if (!logEntry.isFile() || !logEntry.name.endsWith(".log")) continue;
      const filePath = path.join(logDir, logEntry.name);
      logs.push({ filePath, mtimeMs: statSync(filePath).mtimeMs });
    }
  }
  logs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const { filePath } of logs.slice(0, 8)) {
    const content = readFileSync(filePath, "utf8");
    const matches = Array.from(content.matchAll(/cli server started at 127\.0\.0\.1:(\d+)/g));
    const port = matches.at(-1)?.[1];
    if (port) return port;
  }
  return "";
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

function runCli(targetBin, targetArgs, options) {
  const detached = options.route !== "devtools-cli";
  const child = spawn(targetBin, targetArgs, {
    cwd: repoRoot,
    detached,
    stdio: ["inherit", "pipe", "pipe"],
    env: buildChildEnv(proxy),
  });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
  });
  child.stderr?.on("data", (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stderr.write(text);
  });

  let timedOut = false;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true;
        console.error(`[miniprogram-ci] timed out after ${timeoutMs}ms`);
        killChild(child.pid, detached, "SIGTERM");
        setTimeout(() => killChild(child.pid, detached, "SIGKILL"), 5000).unref();
      }, timeoutMs)
    : null;
  timeout?.unref();

  child.on("exit", (code, signal) => {
    if (timeout) clearTimeout(timeout);
    const devtoolsReportedFailure = options.route === "devtools-cli" && hasDevtoolsFailure(output);
    const failed = timedOut || signal || Boolean(code) || devtoolsReportedFailure;

    if (failed && options.allowKeyFallback) {
      const reason = timedOut ? "timeout" : signal ? `signal ${signal}` : devtoolsReportedFailure ? "reported failure" : `exit code ${code}`;
      console.error(`[miniprogram-ci] devtools CLI failed by ${reason}; retrying with upload-key route.`);
      try {
        assertExists(PRIVATE_KEY_PATH, "WeChat upload private key");
        assertExists(keyCli, "miniprogram-ci binary");
      } catch (error) {
        console.error(`[miniprogram-ci] upload-key fallback unavailable: ${error.message}`);
        process.exit(timedOut ? 124 : 1);
      }
      console.log("[miniprogram-ci] route=upload-key-fallback");
      runCli(keyCli, args, { route: "upload-key-fallback", allowKeyFallback: false });
      return;
    }

    if (timedOut) {
      reportDevtoolsFailure(output, { signal, timedOut, code });
      process.exit(124);
    }
    if (signal) {
      console.error(`[miniprogram-ci] exited by signal ${signal}`);
      reportDevtoolsFailure(output, { signal, timedOut, code });
      process.exit(1);
    }
    if (devtoolsReportedFailure) {
      console.error("[miniprogram-ci] devtools CLI reported failure even though process exited 0.");
      reportDevtoolsFailure(output, { signal, timedOut, code });
      process.exit(1);
    }
    if (options.route === "devtools-cli" && code) {
      console.error(
        "[miniprogram-ci] devtools CLI 失败。确认微信开发者工具已登录、设置→安全设置→服务端口已开启；或设 WECHAT_CI_USE_KEY=1 回退上传密钥路线。",
      );
      reportDevtoolsFailure(output, { signal, timedOut, code });
    }
    if (code === 0 && command === "preview" && qrcodeDest !== artifactQrcodeDest && existsSync(qrcodeDest)) {
      mkdirSync(path.dirname(artifactQrcodeDest), { recursive: true });
      cpSync(qrcodeDest, artifactQrcodeDest);
      console.log(`[miniprogram-ci] qrcode=${artifactQrcodeDest}`);
    }
    if (code === 0 && command === "preview" && previewInfoDest !== artifactInfoDest && existsSync(previewInfoDest)) {
      mkdirSync(path.dirname(artifactInfoDest), { recursive: true });
      cpSync(previewInfoDest, artifactInfoDest);
      console.log(`[miniprogram-ci] info=${artifactInfoDest}`);
    }
    process.exit(code ?? 0);
  });
}

function killChild(pid, detached, signal) {
  if (detached) {
    killProcessGroup(pid, signal);
    return;
  }
  try {
    process.kill(pid, signal);
  } catch {}
}

function preopenDevtoolsProject(projectPath) {
  const openArgs = ["open", "--project", projectPath, "--appid", APPID];
  if (DEVTOOLS_PORT) openArgs.push("--port", DEVTOOLS_PORT);
  if (disableDevtoolsGpu) openArgs.push("--disable-gpu");
  openArgs.push("--lang", "zh");

  const openTimeoutMs = Number.parseInt(process.env.WECHAT_DEVTOOLS_OPEN_TIMEOUT_MS || "12000", 10);
  console.log(`[miniprogram-ci] preopen=${projectPath}`);
  const result = spawnSync(DEVTOOLS_CLI, openArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: buildChildEnv(proxy),
    timeout: Number.isFinite(openTimeoutMs) && openTimeoutMs > 0 ? openTimeoutMs : 12000,
  });
  if (result.signal) {
    console.error(`[miniprogram-ci] devtools open ended by signal ${result.signal}; continuing to upload.`);
    return;
  }
  if (result.status) {
    console.error(`[miniprogram-ci] devtools open failed by exit code ${result.status}; continuing to upload.`);
  }
}

function hasDevtoolsFailure(output) {
  return [
    "✖ 上传",
    "✖ 预览",
    "[error]",
    "winId is not found",
    "#initialize-error",
    "IDE service port disabled",
    "服务端口已关闭",
    "wait IDE port timeout",
    "reading IDE port file",
  ].some((marker) => output.includes(marker));
}

function reportDevtoolsFailure(output, { signal, timedOut, code }) {
  if (!useDevtools) return;
  const hints = [];
  if (
    output.includes("IDE service port disabled") ||
    output.includes("服务端口已关闭") ||
    output.includes("wait IDE port timeout") ||
    output.includes("reading IDE port file")
  ) {
    hints.push("打开微信开发者工具 → Settings → Security Settings，只开启 Service Port；然后重跑本命令。");
  }
  if (output.includes("winId is not found") || signal === "SIGKILL" || timedOut) {
    hints.push("若 DevTools GUI 白屏，先退出工具；仍白屏时用 Homebrew 重装 Stable 版，再开启 Service Port。");
  }
  if (code || signal || timedOut) {
    hints.push("当前脚本默认不自动走上传密钥兜底；只有显式设置 WECHAT_CI_ENABLE_KEY_FALLBACK=1 才会尝试。");
  }
  if (hints.length === 0) return;
  console.error("[miniprogram-ci] DevTools 恢复提示：");
  for (const hint of Array.from(new Set(hints))) {
    console.error(`- ${hint}`);
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
  WX_UPLOAD_PRIVATE_KEY_PATH=/path/private.${APPID}.key
  WECHAT_CI_VERSION=${rootPackage.version}
  WECHAT_CI_ROBOT=1
  LOOPIN_MINI_API_BASE=https://loopin.llmxy.xyz/api
  WECHAT_CI_QRCODE_PATH=.artifacts/miniprogram/preview-qrcode.jpg
  WECHAT_CI_TIMEOUT_MS=120000   # devtools upload default; other commands default to 180000
  WECHAT_DEVTOOLS_PREOPEN=1
  WECHAT_DEVTOOLS_DISABLE_GPU=1
  WECHAT_CI_ENABLE_KEY_FALLBACK=1
`);
}
