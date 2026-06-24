#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const outputDir = path.resolve(repoRoot, args.outputDir || ".artifacts");
mkdirSync(outputDir, { recursive: true });

const gates = [
  {
    key: "migration_parity",
    label: "Supabase 迁移覆盖",
    report: path.join(outputDir, "supabase-migrations.md"),
    command: [
      "scripts/check-supabase-migrations.mjs",
      "--strict",
      "--markdown",
      "--output",
      path.relative(repoRoot, path.join(outputDir, "supabase-migrations.md")),
    ],
  },
  {
    key: "secret_rotation",
    label: "敏感密钥轮换",
    report: path.join(outputDir, "secret-rotation.md"),
    command: [
      "scripts/secret-rotation-check.mjs",
      "--strict",
      "--markdown",
      "--output",
      path.relative(repoRoot, path.join(outputDir, "secret-rotation.md")),
    ],
  },
  {
    key: "supabase_security",
    label: "Supabase 安全基线",
    report: path.join(outputDir, "supabase-security.md"),
    command: [
      "scripts/supabase-security-check.mjs",
      "--strict",
      "--markdown",
      "--output",
      path.relative(repoRoot, path.join(outputDir, "supabase-security.md")),
    ],
  },
  {
    key: "production_readiness",
    label: "生产 readiness",
    report: path.join(outputDir, "production-readiness.md"),
    command: [
      "scripts/production-readiness-check.mjs",
      "--strict",
      "--markdown",
      "--output",
      path.relative(repoRoot, path.join(outputDir, "production-readiness.md")),
      ...(args.baseUrl ? ["--base-url", args.baseUrl] : []),
    ],
  },
];

const results = gates.map(runGate);
const ready = results.every((result) => result.exitCode === 0);
const summary = formatSummary({ ready, results, outputDir });
const summaryPath = path.join(outputDir, "production-gate.md");
writeFileSync(summaryPath, `${summary}\n`);
console.log(summary);
if (!ready) process.exitCode = 1;

function runGate(gate) {
  const child = spawnSync(process.execPath, gate.command, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const remaining = readRemainingItems(gate.report);
  return {
    ...gate,
    exitCode: child.status ?? 1,
    signal: child.signal || "",
    stderr: child.stderr?.trim() || "",
    remaining,
  };
}

function formatSummary(report) {
  const lines = [
    "# Loopin Production Gate",
    "",
    `- Checked at: \`${new Date().toISOString()}\``,
    `- Ready: \`${report.ready}\``,
    `- Output dir: \`${path.relative(repoRoot, report.outputDir)}\``,
    "",
    "| Gate | Exit code | Report | Note |",
    "|---|---:|---|---|",
  ];
  for (const result of report.results) {
    const note = result.remaining.length
      ? result.remaining.slice(0, 2).join("<br>")
      : result.stderr || (result.exitCode === 0 ? "pass" : "see report");
    lines.push(
      [
        tableCell(result.label),
        ` ${result.exitCode} `,
        tableCell(path.relative(repoRoot, result.report)),
        tableCell(note),
      ].join("|").replace(/^/, "|").concat("|"),
    );
  }
  if (!report.ready) {
    lines.push("", "## Remaining");
    for (const result of report.results.filter((item) => item.exitCode !== 0)) {
      if (!result.remaining.length) {
        lines.push(`- ${result.label}: see \`${path.relative(repoRoot, result.report)}\``);
      } else {
        lines.push(`- ${result.label}`);
        for (const item of result.remaining) {
          lines.push(`  - ${item}`);
        }
      }
    }
  }
  return lines.join("\n");
}

function readRemainingItems(reportPath) {
  if (!existsSync(reportPath)) return [];
  const text = readFileSync(reportPath, "utf8");
  const section = text.match(/(?:^|\n)## (?:Remaining|Missing)\n([\s\S]*?)(?:\n## |\n# |$)/);
  if (!section) return [];
  return section[1]
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function tableCell(value) {
  return ` ${String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")} `;
}

function parseArgs(argv) {
  const out = { outputDir: "", baseUrl: "" };
  const filtered = argv.filter((item) => item !== "--");
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index];
    if (arg === "--output-dir" || arg === "--dir") out.outputDir = filtered[index += 1] ?? "";
    else if (arg.startsWith("--output-dir=")) out.outputDir = arg.slice("--output-dir=".length);
    else if (arg.startsWith("--dir=")) out.outputDir = arg.slice("--dir=".length);
    else if (arg === "--base-url") out.baseUrl = filtered[index += 1] ?? "";
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length);
  }
  return out;
}
