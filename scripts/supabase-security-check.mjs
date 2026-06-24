#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const envFiles = [".env.local", "apps/api/.env"].map((file) => path.join(repoRoot, file));
const env = { ...process.env, ...mergeEnvFiles(envFiles) };
const dbUrl = args.dbUrl || first(env, ["FC_DATABASE_URL", "SUPABASE_DB_URL", "DATABASE_URL"]);
const DEPLOY_LOG_SCAN_FILE_LIMIT = Number(process.env.LOOPIN_SECURITY_DEPLOY_LOG_SCAN_FILE_LIMIT || 5000);
const DEPLOY_LOG_DETAIL_LIMIT = 8;

const TABLE_SQL = `
select
  n.nspname || '.' || c.relname as table_name,
  case when c.relrowsecurity then 'rls_on' else 'rls_off' end as rls,
  case when c.relforcerowsecurity then 'force_on' else 'force_off' end as force_rls,
  coalesce(s.n_live_tup, 0) as approx_rows,
  coalesce(string_agg(distinct g.grantee || ':' || g.privilege_type, ', '), '') as public_api_grants
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
left join information_schema.role_table_grants g
  on g.table_schema = n.nspname
 and g.table_name = c.relname
 and g.grantee in ('anon', 'authenticated')
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
group by n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity, s.n_live_tup
order by c.relname;
`;

const BUCKET_SQL = `
select id, name, public
from storage.buckets
order by name;
`;

const POLICY_SQL = `
select schemaname || '.' || tablename as table_name, count(*) as policy_count
from pg_policies
where schemaname = 'public'
group by schemaname, tablename
order by table_name;
`;

const remote = args.skipRemote ? skippedRemote() : runRemoteChecks(dbUrl);
const local = runLocalChecks();
const issues = [...remote.issues, ...local.issues];
const failCount = issues.filter((issue) => issue.severity === "fail").length;
const report = {
  checkedAt: new Date().toISOString(),
  projectRef: projectRefFromUrl(dbUrl),
  dbHost: hostFromUrl(dbUrl),
  ok: failCount === 0,
  strict: args.strict,
  remote,
  local,
  issues,
  exitCode: args.strict && failCount > 0 ? 1 : 0,
};

const output = args.markdown ? formatMarkdown(report) : args.json ? JSON.stringify(report, null, 2) : formatText(report);
if (args.output) writeOutput(args.output, output);
console.log(output);
if (report.exitCode) process.exitCode = report.exitCode;

function runRemoteChecks(rawUrl) {
  if (!rawUrl || !/^postgres(?:ql)?:\/\//.test(rawUrl)) {
    return {
      status: "skipped",
      reason: "No PostgreSQL FC_DATABASE_URL/SUPABASE_DB_URL/DATABASE_URL found.",
      tables: [],
      buckets: [],
      policies: [],
      issues: [{
        severity: "warn",
        key: "remote_db_skipped",
        message: "未找到可用的 Supabase/Postgres 连接串，远端 RLS 和授权没有被检查。",
        action: "设置 FC_DATABASE_URL 后重跑 pnpm security:supabase -- --strict。",
      }],
    };
  }

  const psql = resolvePsql();
  if (!psql) {
    return {
      status: "failed",
      reason: "psql is not installed or not on PATH.",
      tables: [],
      buckets: [],
      policies: [],
      issues: [{
        severity: "fail",
        key: "psql_missing",
        message: "本机没有 psql，无法只读检查 Supabase 远端权限。",
        action: "安装 PostgreSQL client，或在有 psql 的环境重跑 pnpm security:supabase -- --strict。",
      }],
    };
  }

  const connection = parsePostgresUrl(rawUrl);
  const tableResult = runPsql(psql, connection, TABLE_SQL);
  if (!tableResult.ok) {
    return {
      status: "failed",
      reason: sanitizeError(tableResult.error),
      tables: [],
      buckets: [],
      policies: [],
      issues: [{
        severity: "fail",
        key: "remote_db_connect_failed",
        message: "无法连接 Supabase 远端库执行只读安全检查。",
        action: "确认 FC_DATABASE_URL 有效、网络能连 Supabase pooler，再重跑检查。",
      }],
    };
  }

  const bucketResult = runPsql(psql, connection, BUCKET_SQL);
  const policyResult = runPsql(psql, connection, POLICY_SQL);
  const tables = parseTableRows(tableResult.stdout);
  const buckets = bucketResult.ok ? parseBucketRows(bucketResult.stdout) : [];
  const policies = policyResult.ok ? parsePolicyRows(policyResult.stdout) : [];
  const issues = [];
  const exposedTables = tables.filter((table) => !table.rlsEnabled || table.dangerousGrants.length > 0);
  const rlsOff = tables.filter((table) => !table.rlsEnabled);
  const grantOpen = tables.filter((table) => table.dangerousGrants.length > 0);
  const publicBuckets = buckets.filter((bucket) => bucket.public);

  if (rlsOff.length) {
    issues.push({
      severity: "fail",
      key: "rls_disabled_in_public",
      message: `${rlsOff.length} 张 public 表没有启用 RLS。`,
      action: "执行生成的 lockdown SQL：启用 RLS，并只按明确业务需要添加最小 policy。",
      details: rlsOff.map((table) => table.tableName),
    });
  }
  if (grantOpen.length) {
    issues.push({
      severity: "fail",
      key: "anon_authenticated_table_grants",
      message: `${grantOpen.length} 张 public 表对 anon/authenticated 仍有读写或维护权限。`,
      action: "撤销 anon/authenticated 在 public 表、sequence、function 上的默认授权。",
      details: grantOpen.map((table) => `${table.tableName}: ${table.dangerousGrants.join(", ")}`),
    });
  }
  if (publicBuckets.length) {
    issues.push({
      severity: "fail",
      key: "public_storage_buckets",
      message: `${publicBuckets.length} 个 storage bucket 是 public。`,
      action: "确认 bucket 是否真的需要公开；不需要时改为 private，并通过后端签名 URL 暴露资源。",
      details: publicBuckets.map((bucket) => bucket.name),
    });
  }
  if (!policies.length && tables.length) {
    issues.push({
      severity: "warn",
      key: "no_rls_policies",
      message: "public schema 没有任何 RLS policy。",
      action: "默认关闭后，只给确实要走 Supabase public API 的表添加最小 read/insert policy。",
    });
  }

  return {
    status: "checked",
    tableCount: tables.length,
    exposedTableCount: exposedTables.length,
    bucketCount: buckets.length,
    policyCount: policies.reduce((sum, item) => sum + item.policyCount, 0),
    tables,
    buckets,
    policies,
    lockdownSql: formatLockdownSql(tables),
    issues,
  };
}

function skippedRemote() {
  return {
    status: "skipped",
    reason: "Skipped by --skip-remote.",
    tables: [],
    buckets: [],
    policies: [],
    issues: [{
      severity: "warn",
      key: "remote_db_skipped",
      message: "远端 RLS 和授权检查被 --skip-remote 跳过。",
      action: "上线门禁必须去掉 --skip-remote，并连接生产 Supabase 重跑。",
    }],
  };
}

function runLocalChecks() {
  const frontendEnvIssues = scanFrontendEnv();
  const migrationIssues = scanMigrationBaseline();
  const logIssues = scanDeployLogs();
  return {
    frontendEnv: frontendEnvIssues,
    migrations: migrationIssues,
    deployLogs: logIssues,
    issues: [...frontendEnvIssues, ...migrationIssues, ...logIssues],
  };
}

function scanFrontendEnv() {
  const issues = [];
  const candidates = [
    ".env.local.example",
    "apps/studio/.env",
    "apps/studio/.env.local",
    "apps/studio/.env.production",
    "apps/miniprogram/.env",
    "apps/miniprogram/.env.local",
  ];
  const dangerousPrefixes = /^(VITE_|NEXT_PUBLIC_|PUBLIC_|REACT_APP_)/;
  const secretNames = /(SERVICE_ROLE|DATABASE_URL|POSTGRES|JWT_SECRET|APPSECRET|PRIVATE_KEY|API_V3_KEY|ADMIN_TOKEN|SECRET)/;
  const exposed = [];
  for (const file of candidates) {
    const absolute = path.join(repoRoot, file);
    if (!existsSync(absolute)) continue;
    const parsed = parseEnv(readFileSync(absolute, "utf8"));
    for (const key of Object.keys(parsed)) {
      if (dangerousPrefixes.test(key) && secretNames.test(key)) {
        exposed.push(`${file}:${key}`);
      }
    }
  }
  if (exposed.length) {
    issues.push({
      severity: "fail",
      key: "frontend_public_secret_env",
      message: "前端 public env 名里出现敏感配置。",
      action: "把这些配置移到后端环境变量；前端只保留非敏感 public base URL。",
      details: exposed,
    });
  }
  return issues;
}

function scanMigrationBaseline() {
  const migrationDir = path.join(repoRoot, "supabase/migrations");
  if (!existsSync(migrationDir)) return [];
  const sql = readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(migrationDir, name), "utf8"))
    .join("\n");
  const createdTables = [...sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+"([^"]+)"/g)].map((match) => match[1]);
  if (createdTables.length && !/ENABLE ROW LEVEL SECURITY/i.test(sql)) {
    return [{
      severity: "fail",
      key: "migration_missing_rls_baseline",
      message: "Supabase migrations 创建了 public 表，但没有任何 ENABLE ROW LEVEL SECURITY。",
      action: "补一条安全基线迁移：撤销 anon/authenticated 默认权限，并为所有 public 表启用 RLS。",
    }];
  }
  if (createdTables.length && !/REVOKE\s+ALL/i.test(sql)) {
    return [{
      severity: "warn",
      key: "migration_missing_revoke_baseline",
      message: "Supabase migrations 没有默认 REVOKE 基线。",
      action: "补 REVOKE ALL ON ALL TABLES/SEQUENCES/FUNCTIONS IN SCHEMA public FROM anon, authenticated。",
    }];
  }
  return [];
}

function scanDeployLogs() {
  const roots = [
    path.join(repoRoot, ".s/logs"),
    path.join(process.env.HOME || "", ".s/logs"),
  ].filter(Boolean);
  const patterns = /(DATABASE_URL|FC_DATABASE_URL|SERVICE_ROLE|SUPABASE.*KEY|WX_APPSECRET|LLM_API_KEY|BACKOFFICE_ADMIN_TOKEN|WECHATPAY|PRIVATE_KEY)/;
  const hits = [];
  let scanned = 0;
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const file of listFiles(root, 20, 0, Math.max(0, DEPLOY_LOG_SCAN_FILE_LIMIT - scanned))) {
      scanned += 1;
      if (!isTextLike(file)) continue;
      const text = safeRead(file, 256_000);
      if (patterns.test(text)) {
        hits.push(path.relative(repoRoot, file).startsWith("..") ? file : path.relative(repoRoot, file));
      }
      if (scanned >= DEPLOY_LOG_SCAN_FILE_LIMIT) break;
    }
    if (scanned >= DEPLOY_LOG_SCAN_FILE_LIMIT) break;
  }
  if (!hits.length) return [];
  const hitDirs = [...new Set(hits.map((file) => path.dirname(file)))].sort();
  const details = [
    `matched files: ${hits.length}`,
    `matched directories: ${hitDirs.length}`,
    `scanned files: ${scanned}`,
    ...(hitDirs.length > DEPLOY_LOG_DETAIL_LIMIT ? [`additional directories omitted: ${hitDirs.length - DEPLOY_LOG_DETAIL_LIMIT}`] : []),
    ...hitDirs.slice(0, DEPLOY_LOG_DETAIL_LIMIT),
  ];
  return [{
    severity: "warn",
    key: "deploy_logs_may_contain_secrets",
    message: "本机部署日志里出现敏感配置名，日志可能保留过明文环境变量。",
    action: "按 docs/SECRET_ROTATION.md 的日志隔离流程处理：只移动命中目录到 /tmp quarantine，复跑安全检查；确认后再由人工删除。",
    details,
  }];
}

function runPsql(psql, connection, sql) {
  const child = spawnSync(psql, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-P", "pager=off", "-F", "\t", "-A", "-c", sql], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PGHOST: connection.host,
      PGPORT: String(connection.port || 5432),
      PGDATABASE: connection.database,
      PGUSER: connection.user,
      PGPASSWORD: connection.password,
      PGSSLMODE: connection.sslmode || "require",
      PGCONNECT_TIMEOUT: String(args.timeoutSeconds || 12),
    },
  });
  return {
    ok: child.status === 0,
    stdout: child.stdout || "",
    error: child.stderr || child.stdout || child.signal || `psql exited ${child.status}`,
  };
}

function parseTableRows(stdout) {
  return parseTsv(stdout).map((row) => {
    const grants = splitList(row.public_api_grants);
    const dangerousGrants = grants.filter((grant) => /:(SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)/.test(grant));
    return {
      tableName: row.table_name,
      rlsEnabled: row.rls === "rls_on",
      forceRls: row.force_rls === "force_on",
      grants,
      dangerousGrants,
      approxRows: Number(row.approx_rows || 0),
    };
  });
}

function parseBucketRows(stdout) {
  return parseTsv(stdout).map((row) => ({
    name: row.name || row.id,
    id: row.id,
    public: row.public === "t" || row.public === "true",
  }));
}

function parsePolicyRows(stdout) {
  return parseTsv(stdout).map((row) => ({
    tableName: row.table_name,
    policyCount: Number(row.policy_count || 0),
  }));
}

function parseTsv(stdout) {
  const lines = stdout.split(/\r?\n/).filter(Boolean).filter((line) => !/^\(\d+ rows?\)$/.test(line));
  if (!lines.length) return [];
  const headers = lines.shift().split("\t");
  return lines.map((line) => {
    const cols = line.split("\t");
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cols[index] ?? "";
    });
    return row;
  });
}

function formatMarkdown(report) {
  const lines = [
    "# Supabase Security Baseline",
    "",
    `- Checked at: \`${report.checkedAt}\``,
    `- Project ref: \`${report.projectRef || "unknown"}\``,
    `- DB host: \`${report.dbHost || "unknown"}\``,
    `- OK: \`${report.ok}\``,
    `- Strict: \`${report.strict}\`, exit code: \`${report.exitCode}\``,
    "",
    "## Remote Checks",
    "",
    `- Status: \`${report.remote.status}\``,
  ];
  if (report.remote.reason) lines.push(`- Reason: ${report.remote.reason}`);
  if (report.remote.status === "checked") {
    const rlsOff = report.remote.tables.filter((table) => !table.rlsEnabled).length;
    const grantOpen = report.remote.tables.filter((table) => table.dangerousGrants.length > 0).length;
    const publicBuckets = report.remote.buckets.filter((bucket) => bucket.public).length;
    lines.push(
      `- Public tables: \`${report.remote.tableCount}\``,
      `- RLS off tables: \`${rlsOff}\``,
      `- Tables with anon/authenticated grants: \`${grantOpen}\``,
      `- Public buckets: \`${publicBuckets}\``,
      `- RLS policies: \`${report.remote.policyCount}\``,
      "",
      "| Table | RLS | anon/authenticated grants | Approx rows |",
      "|---|---|---|---:|",
    );
    for (const table of report.remote.tables) {
      lines.push(`| \`${table.tableName}\` | ${table.rlsEnabled ? "on" : "off"} | ${markdownCell(table.dangerousGrants.join(", ") || "")} | ${table.approxRows} |`);
    }
    if (report.remote.buckets.length) {
      lines.push("", "| Bucket | Public |", "|---|---|");
      for (const bucket of report.remote.buckets) lines.push(`| \`${bucket.name}\` | ${bucket.public ? "yes" : "no"} |`);
    }
  }

  lines.push("", "## Local Checks", "");
  lines.push(`- Frontend public secret env issues: \`${report.local.frontendEnv.length}\``);
  lines.push(`- Migration baseline issues: \`${report.local.migrations.length}\``);
  lines.push(`- Deploy log warnings: \`${report.local.deployLogs.length}\``);

  if (report.issues.length) {
    lines.push("", "## Remaining");
    for (const issue of report.issues) {
      lines.push(`- [${issue.severity}] ${issue.message} ${issue.action}`);
      if (issue.details?.length) {
        for (const detail of issue.details.slice(0, 12)) lines.push(`  - \`${detail}\``);
        if (issue.details.length > 12) lines.push(`  - ... ${issue.details.length - 12} more`);
      }
    }
  }

  if (report.remote.lockdownSql) {
    lines.push(
      "",
      "## Lockdown SQL",
      "",
      "Review before running against production. It revokes Supabase public API table access and enables RLS; it does not add permissive policies.",
      "",
      "```sql",
      report.remote.lockdownSql.trim(),
      "```",
    );
  }
  lines.push("", "No secret values are printed by this check.");
  return lines.join("\n");
}

function formatText(report) {
  const lines = [
    `Supabase security baseline: ${report.ok ? "ok" : "failed"}`,
    `project: ${report.projectRef || "unknown"} (${report.dbHost || "unknown"})`,
    `remote: ${report.remote.status}`,
  ];
  for (const issue of report.issues) lines.push(`[${issue.severity}] ${issue.key}: ${issue.message}`);
  return lines.join("\n");
}

function formatLockdownSql(tables) {
  if (!tables.length) return "";
  const tableLines = tables
    .filter((table) => table.tableName?.startsWith("public."))
    .map((table) => `ALTER TABLE ${quoteQualified(table.tableName)} ENABLE ROW LEVEL SECURITY;`);
  return [
    "BEGIN;",
    "REVOKE ALL ON SCHEMA public FROM anon, authenticated;",
    "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;",
    "REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;",
    "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;",
    ...tableLines,
    "COMMIT;",
  ].join("\n");
}

function quoteQualified(name) {
  const [schema, table] = String(name).split(".");
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function parseArgs(argv) {
  const out = { json: false, markdown: false, strict: false, output: "", dbUrl: "", timeoutSeconds: 12, skipRemote: false };
  const filtered = argv.filter((item) => item !== "--");
  for (let index = 0; index < filtered.length; index += 1) {
    const arg = filtered[index];
    if (arg === "--json" || arg === "--format=json") out.json = true;
    else if (arg === "--markdown" || arg === "--md" || arg === "--format=markdown") out.markdown = true;
    else if (arg === "--strict") out.strict = true;
    else if (arg === "--output" || arg === "--out") out.output = filtered[index += 1] ?? "";
    else if (arg.startsWith("--output=")) out.output = arg.slice("--output=".length);
    else if (arg.startsWith("--out=")) out.output = arg.slice("--out=".length);
    else if (arg === "--db-url") out.dbUrl = filtered[index += 1] ?? "";
    else if (arg.startsWith("--db-url=")) out.dbUrl = arg.slice("--db-url=".length);
    else if (arg === "--skip-remote") out.skipRemote = true;
    else if (arg === "--timeout-seconds") out.timeoutSeconds = Number(filtered[index += 1] || 12);
    else if (arg.startsWith("--timeout-seconds=")) out.timeoutSeconds = Number(arg.slice("--timeout-seconds=".length));
  }
  return out;
}

function readEnvFile(file) {
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}

function mergeEnvFiles(files) {
  return files.map(readEnvFile).reduce((merged, current) => ({ ...merged, ...current }), {});
}

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function first(source, keys) {
  for (const key of keys) {
    if (source[key]) return source[key];
  }
  return "";
}

function parsePostgresUrl(rawUrl) {
  const url = new URL(rawUrl);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslmode: url.searchParams.get("sslmode") || "require",
  };
}

function projectRefFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const user = decodeURIComponent(url.username || "");
    if (user.startsWith("postgres.")) return user.slice("postgres.".length);
    const dbHost = url.hostname.match(/^db\.([^.]+)\.supabase\.co$/);
    return dbHost?.[1] || "";
  } catch {
    return "";
  }
}

function hostFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

function resolvePsql() {
  const probe = spawnSync("psql", ["--version"], { encoding: "utf8" });
  if (probe.status === 0) return "psql";
  const homebrew = "/opt/homebrew/bin/psql";
  return existsSync(homebrew) ? homebrew : "";
}

function splitList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function sanitizeError(value) {
  return String(value || "").replace(/postgres(?:ql)?:\/\/\S+/g, "postgres://<redacted>");
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function writeOutput(file, content) {
  const target = path.resolve(repoRoot, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${content}\n`);
}

function listFiles(root, maxDepth, depth = 0, maxFiles = 200) {
  if (depth > maxDepth) return [];
  if (maxFiles <= 0) return [];
  let stats;
  try {
    stats = statSync(root);
  } catch {
    return [];
  }
  if (stats.isFile()) return [root];
  if (!stats.isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(root).sort()) {
    out.push(...listFiles(path.join(root, entry), maxDepth, depth + 1, maxFiles - out.length));
    if (out.length >= maxFiles) break;
  }
  return out;
}

function isTextLike(file) {
  return /\.(log|txt|json|jsonl|yaml|yml)$/i.test(file) || !path.extname(file);
}

function safeRead(file, maxBytes) {
  const buffer = readFileSync(file);
  return buffer.subarray(0, maxBytes).toString("utf8");
}
