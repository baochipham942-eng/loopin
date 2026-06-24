# 密钥轮换 Runbook

这些密钥在开发过程里出现过明文或被本机工具使用过。MVP 跑通后需要轮换一次，并用 `*_ROTATED_AT` 留下状态标记。

## 检查命令

```bash
pnpm secrets:rotation-check
pnpm secrets:rotation-check -- --markdown
pnpm secrets:rotation-check -- --markdown --output .artifacts/secret-rotation.md
pnpm secrets:rotation-check -- --strict
pnpm production:readiness -- --json
```

检查脚本只输出存在状态、轮换时间是否合法、文件权限和下一步动作，不打印密钥值。`--strict` 会在任一密钥缺失、未填写合法轮换时间、上传私钥文件缺失或权限不安全时返回非 0；轮换前返回非 0 是预期行为。`--output` 会把当前 JSON 或 Markdown 报告写到指定路径，报告不会包含密钥值。

外部后台完成重置和 FC 环境变量更新后，用记录脚本写入轮换时间。这个脚本只写 `*_ROTATED_AT` 标记，不读取、不输出、不修改任何密钥值。手动写时间也必须是可被 `Date.parse` 解析的日期，例如 `2026-06-08T10:30:00+08:00`。

```bash
pnpm secrets:rotation-record -- --all --rotated-at now
pnpm secrets:rotation-record -- --secret wx-appsecret --secret llm-api-key --rotated-at now
pnpm secrets:rotation-record -- --secrets wx-appsecret,wechat-upload-key --rotated-at 2026-06-08
```

## 微信 AppSecret

1. 微信公众平台重置小程序密钥。
2. 更新本地 `.env.local` 的 `WX_APPSECRET`。
3. 更新 FC 环境变量 `WX_APPSECRET`。
4. 验证生产 `GET https://loopin.llmxy.xyz/api/notifications/config` 仍返回 `enabled=true`。
5. 运行 `pnpm secrets:rotation-record -- --secret wx-appsecret --rotated-at now`。

## 小程序上传私钥

1. 微信公众平台重新生成代码上传密钥。
2. 保存新 `.key` 文件到本机私有路径，不放进仓库。
3. 设置权限：`chmod 600 /path/to/private.key`。
4. 更新 `.env.local` 的 `WECHAT_PRIVATE_KEY_PATH` 和 `WX_UPLOAD_PRIVATE_KEY_PATH`。
5. 删除旧上传私钥文件。
6. 跑 `pnpm mini:check`，需要上传时再跑 `pnpm mini:upload`。
7. 运行 `pnpm secrets:rotation-record -- --secret wechat-upload-key --rotated-at now`。

## MiMo / LLM API Key

1. 在模型供应商后台重置 API Key。
2. 更新 `.env.local`、`apps/api/.env` 和 FC 环境变量 `LLM_API_KEY`。
3. 本地跑 `pnpm --filter @loopin/api test -- ai.prompt.test.ts`。
4. 用 Studio 生成一次 AI 活动页或推广物料做真实 smoke。
5. 运行 `pnpm secrets:rotation-record -- --secret llm-api-key --rotated-at now`。

## 后台管理员令牌

1. 生成新令牌，建议使用足够长的随机值。
2. 更新 `.env.local` 和 FC 环境变量 `BACKOFFICE_ADMIN_TOKEN`。
3. 替换 Studio 本地保存的管理员令牌。
4. 验证无令牌访问后台接口仍是 401，带新令牌能读取导出器或 feed 状态。
5. 运行 `pnpm secrets:rotation-record -- --secret backoffice-admin-token --rotated-at now`。

## 收口

轮换完成后，`pnpm secrets:rotation-check -- --strict` 应返回 0，四项都显示 `rotated=true`；`pnpm production:readiness -- --json` 的 `secret_rotation` 应变成 `pass`。

## Serverless Devs 部署日志

FC 部署或 Serverless Devs 日志可能打印环境变量明文，不要把部署日志贴到文档、群聊或 issue 里。`pnpm security:supabase -- --strict` 会扫描仓库 `.s/logs` 和本机 `~/.s/logs`，只输出命中文件/目录统计和样例路径，不打印密钥值。

日志处理走隔离复验，不直接删除：

```bash
pnpm security:supabase -- --markdown --output .artifacts/supabase-security.md

mkdir -p /tmp/loopin-s-logs-quarantine-$(date +%Y%m%d-%H%M%S)
# 按 .artifacts/supabase-security.md 里的命中目录逐个移动，例如：
mv ~/.s/logs/<matched-dir> /tmp/loopin-s-logs-quarantine-<timestamp>/

pnpm security:supabase -- --strict
```

复验不再报 `deploy_logs_may_contain_secrets` 后，再决定是否删除 `/tmp/loopin-s-logs-quarantine-*`。删除属于不可逆动作，必须单独确认。
