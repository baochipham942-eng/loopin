# Loopin

> 面向年轻人的同频活动入口（C 端）+ 面向主办方的活动赚钱与增长系统（B 端 Loopin Studio）。
> Find your people. Join the moment.

完整产品方案与各端 spec 见 [`docs/`](./docs)。

## Monorepo

```
packages/core      确定性领域核心（盈亏测算/报名状态机/表单校验），零依赖纯 TS，框架无关
apps/api           Fastify 后端，暴露盈亏计算 & 表单校验接口
apps/studio        B 端 React 管理后台（运营台/后台 IA/选题雷达/建活动/报名审核/签到/AI 物料）
apps/miniprogram   C 端微信原生小程序（活动列表/详情/报名/报名成功/我的活动/活动复盘）
```

## 快速开始

```bash
pnpm install --registry=https://registry.npmmirror.com

# 跑单测：core 55 + api 39 测试
pnpm --filter @loopin/core test
pnpm --filter @loopin/api test

# 初始化本地 DB（SQLite，生产换 Supabase 连接串）
pnpm --filter @loopin/api db:push     # 建 prisma/dev.db
pnpm --filter @loopin/api seed        # 灌一个 demo 活动

# 启动后端 API（:8787，报名闭环 + 盈亏/校验接口）
pnpm dev:api

# 启动 B 端 Studio（:5273，已配 /api 代理到 8787）
pnpm dev:studio
# 浏览器打开 http://localhost:5273 即可用「活动赚钱计算器」

# C 端小程序：微信开发者工具导入 apps/miniprogram
# 开发版默认连 localhost；体验版/正式版自动连 https://loopin.llmxy.xyz/api
# 开发期已设 urlCheck:false，不校验合法域名；真机体验版需要在微信后台配置 request 合法域名
```

## 报名闭环 API（已接 DB）

`POST /api/events`（建活动+票种+配额+AI 活动页）· `GET /api/events`（C 端活动列表）· `GET /api/events/:id`（详情+报名表+AI 活动页）· `GET /api/events/:id/availability`（可售）·
`GET /api/events/:id/quotas` / `POST /api/quotas/:id/update`（后台 IA 配额池读取和调整）·
`GET /api/events/:id/exports` / `GET /api/events/:id/exports/registrations.csv` / `registrations.xls` / `registrations.pdf` / `waitlist.csv` / `feedback.csv` / `resources.csv`（后台 IA 导出器和服务端 CSV/Excel/PDF；报名导出会按活动报名表 schema 导出自定义字段）·
`GET /api/organizers/:id/team-members` / `POST /api/organizers/:id/team-members` / `POST /api/organizers/:id/team-invitations` / `POST /api/team-invitations/accept` / `POST /api/team-members/:id/update`（主办方团队成员、邀请链接、成员令牌和权限校验）·
`POST /api/auth/wechat/login`（wx.login code 换 openid，开发期可回退 local user）·
`POST /api/auth/wechat/phone`（getPhoneNumber code 或报名表手填手机号绑定）·
`POST /api/topic-radar/suggestions`（活动选题雷达，返回市场信号、来源拆解、预算预设和建活动草稿）·
`POST /api/topic-radar/signals`（写入实时市场信号，支持运营录入/外部来源幂等更新）·
`GET /api/topic-radar/signals`（选题雷达信号目录，返回匹配信号、来源汇总和筛选 facets）·
`GET /api/admin/topic-signal-feeds/status`（后台令牌保护的外部 feed 配置状态，不泄露 token）·
`POST /api/admin/topic-signal-feeds/preview`（后台令牌保护的外部 feed 预检，返回标准化样本但不落库）·
`GET /api/notifications/config`（小程序订阅消息模板/微信凭证配置状态）·
`POST /api/notifications/event-reminder/subscriptions`（记录活动提醒订阅授权）·
`GET /api/events/:id/notification-diagnostics`（后台令牌保护的微信真机联调诊断：openid 绑定、订阅授权、提醒发送条件）·
`POST /api/events/:id/notifications/test-reminder`（后台令牌保护的单用户订阅消息测试发送，成功后标记该订阅已发送）·
`GET /api/events/:id/agent-tasks` / `POST /api/events/:id/agent-tasks/refresh`（生成并读取 Agent 运营建议）·
`POST /api/agent-tasks/:id/status`（接受/忽略/完成运营建议）·
`GET /api/events/:id/review`（活动复盘：报名/到场/收入/画像分层/资料包/反馈问卷/渠道归因/复邀话术/下一场建议）·
`GET /api/events/:id/feedback` / `POST /api/events/:id/feedback`（会后反馈问卷提交、最近反馈和摘要）·
`GET /api/events/:id/resources` / `POST /api/events/:id/resources`（会后资料包链接读取和添加）·
`GET /api/events/:id/social` / `GET|POST /api/events/:id/social-profiles`（活动同频人物、公开嘉宾/参与者和后台人物维护）·
`POST /api/users/:id/interest-subscriptions` / `GET /api/users/:id/interest-feed` / `GET /api/discovery/people`（兴趣订阅 feed、按讲师/人发现）·
`GET /api/payments/providers` / `POST /api/orders/:id/payment/prepare` / `GET /api/orders/:id/payment/status` / `POST /api/payments/wechatpay/notify`（mock 支付和微信支付 V3 JSAPI 下单/回调验签解密/订单确认；providers 会返回微信支付 readiness 和缺失配置项）·
`POST /api/register`（预留）· `POST /api/orders/:id/complete`（mock 成交，原子扣库存防超卖）·
`POST /api/orders/:id/cancel`（取消回滚）· `POST /api/registrations/:id/checkin`（签到）·
`POST /api/checkin/scan`（结构化核验 payload 扫码核销，防重复签到）·
`POST /api/registrations/:id/approve` / `reject`（审核票人工审核）·
`POST /api/registrations/:id/promote`（候补转正）·
`GET /api/users/:id/registrations`（C 端我的活动/票夹）·
`POST /api/admin/sweep-expired` / FC `/invoke` timer（回收过期预留）·
`POST /api/admin/send-event-reminders` / FC `event-reminder-timer`（扫描并发送活动提醒）·
`POST /api/admin/sync-topic-signals` / FC `topic-signal-sync-timer`（从 `TOPIC_SIGNAL_FEED_URLS` 同步外部选题信号）

## 凭据

复制 `.env.local.example` → `.env.local` 填真实值。`.env.local` 与 `*.key` 已 gitignore，永不提交。
本地开发的 `DATABASE_URL` 可以继续是 SQLite；FC 部署使用独立的 `FC_DATABASE_URL` 注入为函数运行时 `DATABASE_URL`，避免 config-only 部署时把本地 SQLite 覆盖到生产。
微信 AppID/Secret、订阅消息模板 ID、上传私钥见 `.env.local.example`（⚠️ 会话中已明文暴露，跑起来后建议轮换）。
后台 IA 生产环境已配置 `BACKOFFICE_ADMIN_TOKEN`；后台 IA 路由要求 `x-loopin-admin-token`，可选 `x-loopin-member-id` 会进一步校验成员状态、主办方范围和权限。
`pnpm secrets:rotation-check` 会检查 `.env.local`、`apps/api/.env`、轮换时间格式和微信上传私钥文件权限，只输出配置存在状态、轮换标记和建议动作，不打印密钥值；支持 `-- --markdown` 输出可读清单、`-- --output .artifacts/secret-rotation.md` 保存报告、`-- --strict` 在未轮换时返回非 0。轮换步骤见 [`docs/SECRET_ROTATION.md`](./docs/SECRET_ROTATION.md)，外部后台完成重置后可用 `pnpm secrets:rotation-record -- --all --rotated-at now` 写入 `*_ROTATED_AT` 状态记录。
真实选题来源接入前可跑 `pnpm topic:feed-check -- --descriptor docs/topic-signal-feed.descriptor.example.json --sample docs/topic-signal-feed.sample-response.example.json --feed-index 0`，本地验证 descriptor 的 `itemsPath` / `fieldMap` 能归一化出标准 `TopicSignal` 样本；真实配置步骤见 [`docs/TOPIC_SIGNAL_FEEDS.md`](./docs/TOPIC_SIGNAL_FEEDS.md)。
`pnpm security:supabase` 会只读检查 Supabase/Postgres 生产库的 public 表 RLS、`anon/authenticated` 授权、public storage bucket、前端 public env 泄露和本机部署日志痕迹；不打印连接串和密钥值。可用 `pnpm security:supabase -- --markdown --output .artifacts/supabase-security.md` 生成报告；上线门禁用 `pnpm security:supabase -- --strict`，发现 public 表裸权限会返回非 0，并在报告里生成可审的 lockdown SQL。
`pnpm production:readiness` 会只读检查生产 `https://loopin.llmxy.xyz`：API 健康、微信订阅消息、选题 feed 配置状态、引流归因漏斗接口、微信支付 readiness、本地密钥轮换标记和真机联调标记；支持 `-- --json` 输出结构化结果，也支持 `-- --markdown` 输出可交接清单，不打印密钥值。可用 `-- --markdown --output .artifacts/production-readiness.md` 保存报告；上线门禁用 `pnpm production:readiness -- --strict`，只要还有 warn/manual/fail 就返回非 0。真机手验时可先跑 `pnpm wechat:true-device:status -- --markdown` 读取生产微信诊断，再用 `pnpm wechat:true-device:test-reminder -- --user-id <id> --dry-run --markdown` 预检并发送测试提醒，最后用 `pnpm wechat:true-device:record -- --user-id <id> --verified-at now --reminder-sent-at now` 写入 readiness 标记。
最终上线门禁用 `pnpm production:gate`，会串起 Supabase 增量迁移覆盖、密钥轮换 strict、Supabase 安全基线和生产 readiness strict 检查，并生成 `.artifacts/production-gate.md`、`.artifacts/supabase-migrations.md`、`.artifacts/secret-rotation.md`、`.artifacts/supabase-security.md`、`.artifacts/production-readiness.md`；任一子门禁未通过都会返回非 0。总报告会直接摘出子报告里的剩余动作，支付、密钥、RLS/权限和真机项都会给到下一条可执行命令。

## FC 部署准备

后端本地开发继续用 SQLite：`apps/api/prisma/schema.prisma`。
生产部署用 Supabase Postgres：`apps/api/prisma/schema.postgres.prisma` + `apps/api/prisma/migrations/20260606000000_init_postgres/migration.sql`。
Supabase 远端增量迁移在 `supabase/migrations/`；2026-06-08 已补齐 `Registration.checkinToken`、`WaitlistEntry`、`NotificationSubscription`、`EventFeedback`、`EventResource`、`TopicSignal`、`OrganizerMember`、同频社交表和 `AttributionEvent`。`AttributionEvent` 已在生产库应用，并通过 code-only FC 部署验证 `attribution/funnel` 线上可用。

```bash
# 配置检查只要求 FC_DATABASE_URL、LLM_*、微信 WX_* 等函数配置项
pnpm deploy:fc:check

# 只更新函数代码，不改环境变量和自定义域名；适合域名/证书已存在但本机没有 ALIYUN_FC_CERT_ID 的场景
pnpm deploy:fc:code-check

# 完整部署还会检查 ALIYUN_FC_CERT_ID
pnpm deploy:fc:full-check

DATABASE_URL="$FC_DATABASE_URL" pnpm --filter @loopin/api db:migrate:deploy
pnpm deploy:build
pnpm deploy:fc
```

`pnpm deploy:build` 会生成 `.fc/api` 部署包，并剔除本地 `.env`、SQLite db、测试文件；FC 运行时走 `s.yaml` 里的 `loopin.llmxy.xyz` custom domain。`pnpm deploy:fc:code` 只更新代码，保留现有函数配置和域名；完整 `pnpm deploy:fc` 会同步函数配置和自定义域名，需要 `ALIYUN_FC_CERT_ID`。`s.yaml` 里已配置 `sweep-expired-timer`、`event-reminder-timer` 和 `topic-signal-sync-timer`。
FC 已配置 `WX_APPSECRET` 和活动开始通知模板 `WX_SUBSCRIBE_EVENT_TEMPLATE_ID`，体验版可进入真实 openid 模式；报名成功页会显示活动提醒订阅按钮，`event-reminder-timer` 会按 `WX_EVENT_REMINDER_LEAD_MINUTES` 扫描并发送。Studio「运营台」可查看微信凭证/模板 ID 状态，并手动触发一次提醒扫描。
Studio「运营台」的微信联调诊断支持按 userId 定位单个用户，并对已授权订阅做一次测试发送；测试发送会消耗一次订阅授权，成功后该订阅的 `sentAt` 会写入。命令行也可跑 `pnpm wechat:true-device:status -- --user-id <id> --markdown` 查诊断，再用 `pnpm wechat:true-device:test-reminder -- --user-id <id> --dry-run --markdown` 预检，确认可发送后去掉 `--dry-run` 发送测试提醒。真机体验版按 [`docs/WECHAT_TRUE_DEVICE_CHECKLIST.md`](./docs/WECHAT_TRUE_DEVICE_CHECKLIST.md) 验；完成后用 `pnpm wechat:true-device:record -- --user-id <id> --verified-at now --reminder-sent-at now` 记录，脚本会先校验生产诊断里的 openid、报名、订阅授权和提醒发送状态，通过后 readiness 才会把该项改为通过。
选题雷达外部信号源通过 `TOPIC_SIGNAL_FEED_URLS` 配置，支持纯 URL 列表，也支持 JSON 描述符配置 `headers/auth/itemsPath/fieldMap/source/label`；可接需要 Bearer/API Key 的合作方 API，字段会归一化后按 `source + externalId` 幂等写入 `TopicSignal`。Studio「选题雷达」可读取生产 feed 配置状态，查看 URL/鉴权 env 是否可被同步器识别，也可先用后台令牌预检 feed，确认能抓到标准化样本后再配置到 FC 环境；预检区已内置「活动平台」「合作方 API」「公开样本」三类模板，活动行放在活动平台模板里，并新增 P0 自有反馈、P1 活动平台/合作方 API、P2 内容趋势的来源优先级提示。2026-06-08 已先配置 `loopin_production_events` 自举 feed，生产 readiness 的 `topic_feed` 已通过，手动同步返回 `synced=1`。接真实来源时可直接用 [`docs/TOPIC_SIGNAL_FEEDS.md`](./docs/TOPIC_SIGNAL_FEEDS.md) 和 [`docs/topic-signal-feed.descriptor.example.json`](./docs/topic-signal-feed.descriptor.example.json) 追加到 `feeds` 数组。
小程序活动列表、详情页和报名页已支持隐藏 UTM 透传：可在活动页路径后追加 `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` / `utm_term` / `channel` / `referrer`，报名提交时会合入 `formValues`；小程序会话分享默认标记 `wechat_share`，朋友圈默认标记 `wechat_timeline`。Studio「运营台」每场活动会生成微信群、朋友圈、小红书、公众号、活动行、嘉宾转发、社群合作和合作方 8 条渠道路径，并展示完整小程序路径，运营可编辑 `utm_content` 和 `referrer` 来区分小红书笔记、嘉宾或社群投放位，也可一键复制全部渠道 TSV 投放清单；Studio「AI 推广物料」复制朋友圈/微信群/小红书/公众号文案时也会按渠道附上对应小程序路径。Studio UTM 生成器已有单测覆盖通用路径、8 个渠道、活动行参数和空格清洗回退。活动复盘渠道归因优先读取 `utm_source`，再回退到 `channel/referrer/source`，并展示 `campaign/content/referrer` 细分；同时 `AttributionEvent` 会记录详情打开、点击报名、提交报名和服务端报名预留，运营台能看到引流漏斗。生产写入验证可跑 `pnpm production:attribution-smoke`，会用 `production_smoke` 渠道写入一组可识别测试事件并确认漏斗计数增长。
微信支付 V3 通过 `PAYMENT_PROVIDER=wechatpay` 开启；需配置商户号、商户 API 证书序列号、商户私钥、APIv3 key、平台证书和 notify URL。后端会做 JSAPI 下单、商户私钥签小程序调起参数、平台证书验回调签名、APIv3 key 解密回调密文、校验金额后确认订单；`GET /api/payments/providers` 会显示 `wechatpay.readiness.missing`、`canPrepare` 和 `canVerifyNotify`，方便配置商户参数后自查。拿到商户材料后可先跑 `pnpm wechatpay:check -- --strict` 或 `pnpm wechatpay:check -- --markdown --output .artifacts/wechatpay-check.md` 做离线格式/私钥/APIv3 key/证书检查，不会打印密钥值。代码层已部署，生产默认仍走 mock；配置和真机回归按 [`docs/WECHAT_PAY_CONFIG.md`](./docs/WECHAT_PAY_CONFIG.md)。
Studio「后台 IA」已接 Quotas 独立视图、Exporters、管理员/成员令牌输入、团队权限配置 UI、邀请链接和同频人物维护；生产已 smoke 通过无令牌 401、带令牌读取 6 个导出器、报名 CSV/Excel/PDF 下载、团队成员列表、邀请→接受→成员令牌读导出器，以及报名导出动态字段 `姓名(name)`、`手机号(phone)`、`你的身份(role)`、`公司/项目(company)`。同频社交 MVP 已完成生产迁移、FC 部署和 smoke，验证活动同频信息、后台人物维护、兴趣订阅 feed 和人物发现可用。

## 当前进度

见 [`docs/MORNING_BRIEFING.md`](./docs/MORNING_BRIEFING.md) 和 [`TODOS.md`](./TODOS.md)。

## 微信小程序合法域名

微信公众平台 → 小程序后台 → 开发管理 → 开发设置 → 服务器域名：

- `request合法域名` 添加 `https://loopin.llmxy.xyz`
- 不填路径 `/api`，微信后台只认域名
- 当前小程序只用 `wx.request`，暂不需要配置 `uploadFile`、`downloadFile`、`socket` 域名
