import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { previewTopicSignalFeeds, topicSignalFeedSources, topicSignalFeedStatus } from "./services/topic-signal-sync.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env.local") });
dotenv.config({ path: path.join(repoRoot, "apps/api/.env") });

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

const descriptor = readDescriptor(args);
const feeds = topicSignalFeedSources(descriptor.raw);
const status = topicSignalFeedStatus(descriptor.raw);
const warnings: string[] = [];
let preview: Awaited<ReturnType<typeof previewTopicSignalFeeds>> | undefined;

if (args.sampleFile) {
  const sampleText = readRequiredFile(args.sampleFile, "sample");
  const previewFeeds = selectPreviewFeeds(feeds, args, warnings);
  preview = await previewTopicSignalFeeds({
    feeds: previewFeeds,
    sampleSize: args.sampleSize,
    fetcher: async () => ({
      ok: true,
      status: 200,
      text: async () => sampleText,
    }),
  });
}

const descriptorOk = status.configured && status.feeds > 0 && status.invalid === 0;
const previewOk = !preview || (preview.failed === 0 && preview.ok > 0);
const ready = descriptorOk && previewOk && status.missingAuthEnv.length === 0;
const result = {
  ok: descriptorOk && previewOk,
  ready,
  descriptor: {
    source: descriptor.source,
    feeds: feeds.length,
  },
  status,
  ...(preview ? { preview } : {}),
  warnings,
};
const output = args.json ? JSON.stringify(result, null, 2) : formatText(result);

if (args.output) writeOutput(args.output, output);
console.log(output);
if (args.strict && !ready) process.exitCode = 1;

interface CliArgs {
  descriptorFile?: string;
  raw?: string;
  fromEnv: boolean;
  sampleFile?: string;
  sampleSize: number;
  feedIndex?: number;
  strict: boolean;
  json: boolean;
  output?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { fromEnv: false, sampleSize: 3, strict: false, json: false, help: false };
  const filtered = argv.filter((item) => item !== "--");
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index] ?? "";
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--from-env") out.fromEnv = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--json" || arg === "--format=json") out.json = true;
    else if (arg === "--descriptor" || arg === "--descriptor-file") out.descriptorFile = filtered[index += 1] ?? "";
    else if (arg.startsWith("--descriptor=")) out.descriptorFile = arg.slice("--descriptor=".length);
    else if (arg.startsWith("--descriptor-file=")) out.descriptorFile = arg.slice("--descriptor-file=".length);
    else if (arg === "--raw") out.raw = filtered[index += 1] ?? "";
    else if (arg.startsWith("--raw=")) out.raw = arg.slice("--raw=".length);
    else if (arg === "--sample" || arg === "--sample-file") out.sampleFile = filtered[index += 1] ?? "";
    else if (arg.startsWith("--sample=")) out.sampleFile = arg.slice("--sample=".length);
    else if (arg.startsWith("--sample-file=")) out.sampleFile = arg.slice("--sample-file=".length);
    else if (arg === "--sample-size") out.sampleSize = numericArg(filtered[index += 1], "sample-size", 3);
    else if (arg.startsWith("--sample-size=")) out.sampleSize = numericArg(arg.slice("--sample-size=".length), "sample-size", 3);
    else if (arg === "--feed-index") out.feedIndex = numericArg(filtered[index += 1], "feed-index", 0);
    else if (arg.startsWith("--feed-index=")) out.feedIndex = numericArg(arg.slice("--feed-index=".length), "feed-index", 0);
    else if (arg === "--output" || arg === "--out") out.output = filtered[index += 1] ?? "";
    else if (arg.startsWith("--output=")) out.output = arg.slice("--output=".length);
    else if (arg.startsWith("--out=")) out.output = arg.slice("--out=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function numericArg(value: string | undefined, label: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readDescriptor(options: CliArgs) {
  if (options.raw) return { source: "raw", raw: options.raw };
  if (options.descriptorFile) {
    const file = path.resolve(repoRoot, options.descriptorFile);
    return { source: file, raw: readRequiredFile(file, "descriptor") };
  }
  if (options.fromEnv) return { source: "TOPIC_SIGNAL_FEED_URLS", raw: process.env.TOPIC_SIGNAL_FEED_URLS ?? "" };
  throw new Error("Provide --descriptor <file>, --raw <json-or-url-list>, or --from-env");
}

function readRequiredFile(file: string, label: string) {
  const resolved = path.resolve(repoRoot, file);
  if (!existsSync(resolved)) throw new Error(`${label} file not found: ${resolved}`);
  return readFileSync(resolved, "utf8");
}

function selectPreviewFeeds<T>(feeds: T[], options: CliArgs, warnings: string[]) {
  if (!feeds.length) return [];
  if (options.feedIndex !== undefined) {
    const selected = feeds[options.feedIndex];
    if (!selected) throw new Error(`feed-index out of range: ${options.feedIndex}`);
    return [selected];
  }
  if (feeds.length > 1) {
    warnings.push("sample preview used feed-index 0; pass --feed-index to check another feed");
  }
  const first = feeds[0];
  return first ? [first] : [];
}

function formatText(report: typeof result) {
  const lines = [
    "Loopin topic feed check",
    `descriptor: ${report.descriptor.source}`,
    `feeds: ${report.status.feeds}, valid: ${report.status.valid}, invalid: ${report.status.invalid}`,
    `auth: required ${report.status.authRequired}, ready ${report.status.authReady}, missing ${report.status.missingAuthEnv.join(",") || "none"}`,
  ];
  if (report.status.errors.length) lines.push(`errors: ${report.status.errors.join("; ")}`);
  for (const warning of report.warnings) lines.push(`warning: ${warning}`);
  if (report.preview) {
    lines.push(`preview: ok ${report.preview.ok}, failed ${report.preview.failed}`);
    for (const item of report.preview.previews) {
      lines.push(`- ${item.label}: ok=${item.ok}, count=${item.count}${item.error ? `, error=${item.error}` : ""}`);
      for (const sample of item.sample) {
        lines.push(`  sample: ${sample.topic || "(missing topic)"} / ${sample.city || "unknown city"} / heat=${sample.heat ?? "n/a"}`);
      }
    }
  }
  lines.push(`ok: ${report.ok}`);
  lines.push(`ready: ${report.ready}`);
  return lines.join("\n");
}

function writeOutput(file: string, content: string) {
  const target = path.resolve(repoRoot, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${content}\n`);
}

function printHelp() {
  console.log(`Usage:
  pnpm topic:feed-check -- --descriptor docs/topic-signal-feed.descriptor.example.json
  pnpm topic:feed-check -- --descriptor docs/topic-signal-feed.descriptor.example.json --sample docs/topic-signal-feed.sample-response.example.json --feed-index 0
  pnpm topic:feed-check -- --from-env --strict

Options:
  --descriptor <file>   feed descriptor JSON file
  --raw <json|urls>     raw TOPIC_SIGNAL_FEED_URLS value
  --from-env            read TOPIC_SIGNAL_FEED_URLS from env/.env.local/apps/api/.env
  --sample <file>       sample feed response JSON; validates itemsPath/fieldMap locally
  --feed-index <n>      descriptor feed index to use with --sample
  --sample-size <n>     default: 3
  --json                print JSON
  --strict              exit non-zero when descriptor/auth/preview is not ready
  --output <file>       write report
`);
}
