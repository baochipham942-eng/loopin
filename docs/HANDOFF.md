# 交接文档 · 给艾克斯（Codex）

> 2026-06-06 由 Claude 写。2026-06-07 Aix 继续补了上线前增量：FC timer 清理、C 端活动列表首页 +「我的活动/票夹」MVP、微信登录/手机号绑定地基、AI 文案事实约束、AI Designer 活动页内容回填、审核活动流 MVP、候补放票 MVP，并已在微信开发者工具里走通 C 端闭环。生产侧已完成 FC 域名、Supabase schema 增量迁移、小程序预览/上传、demo 活动 smoke、微信 AppSecret 和订阅模板配置；后续又补了小程序订阅提醒入口、原生 tabBar/活动分享、Studio 运营台、报名 CSV 导出、订阅授权回写、FC `event-reminder-timer` 发送地基、PaymentProvider mock 抽象、微信支付 V3 代码层接入、C 端会后页 MVP、Agent 运营建议 MVP、选题雷达 MVP、选题雷达外部信号增强、来源管理、实时信号落库/运营录入和外部 JSON feed 定时同步 MVP、复盘增强、反馈落库、渠道归因、复邀话术、资料包链接 MVP，以及后台 IA MVP（Quotas 独立视图、Exporters、团队权限地基）、Exporters 增强（报名/候补/反馈/资料包 CSV）、后台令牌/成员权限门禁、权限配置 UI、自定义字段报名 CSV 导出、报名名单 Excel/PDF 导出、真实多账号邀请流和同频社交 MVP。剩下最需要外部真实验证的是：**真机体验版微信登录和订阅提醒联调**。
> 全项目已可本地运行、测试全绿。本文给你完整上手所需的一切：现状、怎么跑、你的两个任务的详细步骤、坑、凭据位置。

---

## 0. 项目是什么

**Loopin** = 面向年轻人的同频活动招募平台。C 端微信小程序（报名）+ B 端 Web 控制台 Loopin Studio（算账/建活动/看板/签到/AI 文案）+ Node 后端。
差异化两条主线：**盈亏测算**（建活动先算这场能不能赚钱）+ **AI 生成**（活动页文案 + 推广物料）。

完整方案见 `docs/01-loopin-plan-and-specs.md`；竞品/开源可借鉴报告 `docs/04`；决策记录 `docs/03-decisions.md`；进度总览 `docs/MORNING_BRIEFING.md` 顶部。

## 1. 仓库结构（pnpm + TS monorepo）

```
event recruit/
├── packages/core/        确定性领域核心（纯 TS，零依赖，框架无关）
│   ├── budget.ts         盈亏测算 ★差异化
│   ├── registration.ts   报名状态机 + 订单三状态(lifecycle/payment/refund)
│   ├── quota.ts          配额池可售算法 + 超卖守门 OversellError
│   ├── form-schema.ts    报名表 schema 校验（依赖条件/分阶段/分类型）
│   └── money.ts / models.ts
├── apps/api/             Fastify + Prisma(SQLite dev) + MiMo AI
│   ├── prisma/schema.prisma   全部领域模型（已 db push 到 prisma/dev.db）
│   ├── prisma/schema.postgres.prisma + migrations/  生产 Supabase Postgres
│   ├── src/app.ts        Fastify app/routes
│   ├── src/server.ts     本地/FC listen 入口
│   ├── src/services/     catalog.ts / registration.ts / ai.ts / auth.ts / users.ts
│   ├── src/llm.ts        OpenAI 兼容 LLM 客户端（接 MiMo，走代理）
│   ├── src/seed.ts       灌 demo 数据
│   └── .env              ⚠️gitignore：DATABASE_URL + MiMo(LLM_*) 配置
├── apps/studio/          B 端 React+Vite（运营台/后台 IA/建活动/看板/AI物料/签到）
└── apps/miniprogram/     C 端微信原生（活动列表/详情/报名/成功/我的活动/活动复盘）
```

## 2. 怎么跑起来（本地）

```bash
cd ~/Documents/"event recruit"
pnpm install --registry=https://registry.npmmirror.com

# 后端 DB（SQLite，生成 apps/api/prisma/dev.db）
pnpm --filter @loopin/api db:push
pnpm --filter @loopin/api seed        # demo 活动 + 盈亏快照 + 2 报名

# 起后端（:8787）
pnpm dev:api

# 起 Studio（:5273，已配 /api 代理到 8787）
pnpm dev:studio        # 浏览器开 http://localhost:5273

# 测试（应全绿：core 55 + api 39）
pnpm --filter @loopin/core test
pnpm --filter @loopin/api test
```

**已验证状态**：core 55 单测 + api 39 测试全绿；API typecheck 通过；Studio build 通过；`pnpm deploy:build` 通过；Studio 4 视图 + 两个 AI 功能浏览器实证（截图 `docs/studio-*.jpeg`）；报名闭环防超卖 curl + 集成测试双证；详情接口 smoke 已返回 `page.highlights/agenda/faq`；选题雷达已返回 `marketSignals/sourceBreakdown/confidence`，来源目录接口已返回匹配信号和来源汇总，实时信号可通过 `POST /api/topic-radar/signals` 落库并参与排序；`syncTopicSignals` 可从外部 JSON feed 幂等同步 `TopicSignal`；复盘反馈提交后可在 feedback/review 接口读到摘要；后台 IA 已在生产 smoke 通过 Quotas、报名/候补/反馈/资料包 CSV Exporters、团队成员接口、后台令牌门禁、自定义字段报名 CSV 导出、报名名单 Excel/PDF 导出和真实多账号邀请流；同频社交已在生产 smoke 通过活动同频信息、后台人物维护、兴趣订阅 feed 和人物发现。

## 3. 凭据 & 网络（重要）

- `apps/api/.env`（**已 gitignore，含真实值**）：
  - `DATABASE_URL="file:./dev.db"`（本地）
  - `LLM_BASE_URL=https://token-plan-sgp.xiaomimimo.com/v1`、`LLM_API_KEY=...`、`LLM_MODEL=mimo-v2.5-pro`、`LLM_PROXY=http://127.0.0.1:7897`
- 根目录 `.env.local`：
  - 本地 `DATABASE_URL` 可以是 SQLite；FC 部署使用 `FC_DATABASE_URL` 注入函数运行时 `DATABASE_URL`。做 `s api deploy --function config` 前必须确认 `FC_DATABASE_URL` 是 Supabase/Postgres，不要用本地 `DATABASE_URL` 覆盖生产。
- 微信小程序：AppID `wxfb83ad53ee194fe3`；上传私钥路径通过 `WECHAT_PRIVATE_KEY_PATH` 或 `WX_UPLOAD_PRIVATE_KEY_PATH` 本地配置，私钥文件不要提交进仓库。
- **MiMo 海外端点必须走代理** `http://127.0.0.1:7897`（已在 LLM_PROXY，llm.ts 用 undici ProxyAgent）。Clash 没开会连不上。
- `s.yaml` 绑定 HTTPS 域名时需要 `ALIYUN_FC_CERT_ID`；FC 环境里 `LLM_PROXY` 留空。日常只改函数配置可先跑 `pnpm deploy:fc:check`，只更新函数代码可跑 `pnpm deploy:fc:code-check` / `pnpm deploy:fc:code`，完整部署前跑 `pnpm deploy:fc:full-check`。
- 后台 IA：`.env.local` / FC 环境需要 `BACKOFFICE_ADMIN_TOKEN` 作为管理员入口；Studio「后台 IA」也支持成员邀请链接和成员令牌，成员令牌按主办方范围和权限访问后台。
- ⚠️ AppSecret / MiMo key / 上传私钥都属敏感，跑通后建议轮换。可跑 `pnpm secrets:rotation-check` 或 `pnpm secrets:rotation-check -- --markdown --output .artifacts/secret-rotation.md` 查看轮换状态和下一步动作；上线门禁用 `-- --strict`，未轮换时返回非 0。外部后台完成重置后用 `pnpm secrets:rotation-record -- --all --rotated-at now` 写入轮换标记；轮换时间必须是合法日期，坏值不会通过 readiness。当前旧上传私钥本机权限已收窄到 `600`。
- `pnpm production:readiness` 会只读检查生产 API、微信订阅消息、选题 feed 配置状态、引流归因漏斗接口、微信支付 readiness、密钥轮换标记和真机联调标记；支持 `-- --json`、`-- --markdown` 和 `-- --output .artifacts/production-readiness.md`，不会打印密钥值。上线门禁用 `-- --strict`，只要还有 warn/manual/fail 就返回非 0。
- `pnpm production:gate` 会串起 Supabase 迁移覆盖、密钥轮换 strict 和生产 readiness strict，生成 `.artifacts/production-gate.md`、`.artifacts/supabase-migrations.md`、`.artifacts/secret-rotation.md`、`.artifacts/production-readiness.md`；任一子门禁未通过就返回非 0。总报告会摘出子报告里的 `Remaining/Missing` 动作，优先看总报告就能知道还卡在哪。

## 4. 你的任务 ①：绑阿里云 FC 自定义域名，把后端上线

**目标**：`https://loopin.llmxy.xyz/api/*` 能访问后端（复用爸阿里云 FC 范式，**不买 ECS**，见 ADR-001）。

**背景事实**：爸阿里云只有函数计算 FC（mental.llmxy.xyz / people.llmxy.xyz 都在 FC，按量付费）。域名 `llmxy.xyz` 在阿里云。**Loopin 用 `loopin.llmxy.xyz`**（Codex 历史会话里的 `loopin.llmxyz.com` 是口误）。

**Aix 已完成的代码侧准备**：
1. 本地 SQLite schema 保持不动，新增 `apps/api/prisma/schema.postgres.prisma` 和初始 migration；migration 已含 `CHECK (capacity IS NULL OR used <= capacity)`。
2. Fastify app 已拆成 `src/app.ts` + `src/server.ts`，FC custom runtime 可直接跑 `node --import tsx src/server.ts`。
3. 根目录新增 `s.yaml`，函数名 `loopin-api`，区域 `ap-southeast-1`，自定义域名 `loopin.llmxy.xyz`，证书走 `ALIYUN_FC_CERT_ID`。
4. 根目录新增 `pnpm deploy:build`，会生成 `.fc/api`，剔除本地 `.env`、SQLite db、测试文件，并把 Prisma Client 生成为 Postgres + Debian engines。
5. `s.yaml` 已加 `sweep-expired-timer`、`event-reminder-timer`、`topic-signal-sync-timer`；timer payload 会打到 `/invoke`。本地可跑 `pnpm --filter @loopin/api sweep:expired`，选题信号同步用 `POST /api/admin/sync-topic-signals` 或 `{"task":"syncTopicSignals"}`。`TOPIC_SIGNAL_FEED_URLS` 支持纯 URL 列表，也支持 JSON 描述符配置 `headers/auth/itemsPath/fieldMap/source/label`，可接需要 Bearer/API Key 的合作方 API。
6. 后端已加微信登录/手机号绑定地基：`POST /api/auth/wechat/login` 负责 `wx.login` code → openid，并把本地临时 user 的报名迁到 openid user；`POST /api/auth/wechat/phone` 负责 `getPhoneNumber` code → 手机号，也可用报名表手填手机号绑定。
7. Studio 发布活动时已把 AI Designer 的亮点/议程/FAQ 持久化到 `EventPage`；C 端活动详情优先读后端 `page`，没有活动页数据时才显示默认亮点。`seed` 会灌入一份完整 AI 活动页 demo。
8. 审核票已能走人工审核：Studio 建活动可选 `approval` 票；C 端报名后停在 `submitted`，不自动 mock 成交；Studio「报名审核」页可 `approve/reject`；通过后才扣库存并进入 `approved/completed`，拒绝不占库存。
9. 候补已落最小闭环：新增 `WaitlistEntry` 存 `position/offerToken/offerExpiresAt/status`；满额报名会返回 `waitlisted`，C 端成功页和票夹显示位次；Studio「报名审核」页对候补可点 `promote` 转正，转正时才扣库存并生成 mock completed 订单。
10. 扫码签到已落最小闭环：`Registration.checkinToken` 生成结构化 `loopin.checkin` payload；`POST /api/checkin/scan` 校验 eventId/registrationId/token 后写 `CheckIn`；`CheckIn.registrationId` 唯一防重复核销；Studio「现场签到」支持粘贴/扫码枪回车核销。

**2026-06-07 Aix 复核**：
1. `https://loopin.llmxy.xyz/api/health` 已返回 ok，说明 FC 自定义域名和 HTTPS 证书可用。
2. `https://loopin.llmxy.xyz/api/events` 已能查生产 DB，且已有发布活动 `Loopin 体验测试局`。
3. `apps/miniprogram/app.js` 已按环境切换 API：开发版默认 localhost，体验版/正式版自动走 `https://loopin.llmxy.xyz/api`。
4. 微信后台 request 合法域名已由爸配置；`pnpm mini:check` 已通过，`WECHAT_CI_USE_KEY=1 pnpm mini:ci compile` 已完成本地编译打包。
5. `pnpm mini:preview` 已生成二维码到 `.artifacts/miniprogram/preview-qrcode.jpg`，`pnpm mini:upload` 已上传微信开发版；2026-06-08 最新预览/上传包体 66.0 KB，预览码已注入生产 API `https://loopin.llmxy.xyz/api`。
6. 微信开发者工具 CLI 对带空格项目路径会在上传阶段报 `41002 appid missing`，脚本已改成 devtools 路线自动 staging 到 `/tmp/loopin-mini`，二维码先输出到 `/private/tmp/loopin-mini-preview` 再复制回 `.artifacts`。
7. 微信开发者工具上传链路当前用 WeappLog 里的 `cli server started` 端口；2026-06-08 又修复了 DevTools CLI 在 detached 进程组里被杀的问题，DevTools 路线改为普通子进程，`pnpm mini:upload` 和 `pnpm mini:preview` 已复跑成功，当前包体 66.0 KB。上传密钥路线仍会报微信后端 `41001 access_token missing`，不作为默认兜底。
8. Supabase 生产库已补齐后续 schema 增量迁移：`Registration.checkinToken`、`WaitlistEntry`、`NotificationSubscription`、`EventFeedback`、`EventResource`、`TopicSignal`、`OrganizerMember`；迁移后 Prisma diff 为空。
9. 生产 demo 活动已跑通过完整 smoke：表单校验 → 报名 → mock 成交 → 票夹 payload → 扫码核销 → 重复核销 409。
10. 本机 Supabase CLI 直连 `db.<project>.supabase.co` 会被 fake-ip/IPv6 路径卡住；可用 FC 运行时的 pooler `DATABASE_URL` 执行 `supabase db push --db-url ...`，不要把连接串打印到终端。
11. 后台 IA 生产 smoke 已通过：`/events/:id/quotas`、`/quotas/:id/update`、`/events/:id/exports`、报名/候补/反馈/资料包 4 个服务端 CSV、`/organizers/:id/team-members` 和 `/team-members/:id/update` 均可用。
12. 后台 IA 已打开生产令牌门禁：无 `x-loopin-admin-token` 访问 `/events/:id/exports` 返回 401；带 `BACKOFFICE_ADMIN_TOKEN` 可读取 4 个导出器、报名 CSV 和团队成员；可选 `x-loopin-member-id` 会按成员状态、主办方范围和权限再校验。
13. 报名 CSV 已改为 schema 驱动自定义字段导出，生产 demo 活动已验证表头含 `姓名(name)`、`手机号(phone)`、`你的身份(role)`、`公司/项目(company)`；Studio Team 区已从权限文本输入改成复选配置，支持更新既有成员权限。
14. 报名名单 Excel 兼容导出已上线：`/events/:id/exports/registrations.xls` 返回 `application/vnd.ms-excel`，内容是 SpreadsheetML Workbook；生产 smoke 已验证 `registrations_excel` 出现在 Exporters 列表，动态字段和值都在 `.xls` 里。
15. 报名名单 PDF 导出已上线：`/events/:id/exports/registrations.pdf` 返回 `application/pdf`，按报名逐条输出动态字段明细；生产 smoke 已验证 `registrations_pdf` 出现在 Exporters 列表，文件名、PDF header、中文字体和动态字段编码都可用。
16. 真实多账号邀请流已上线：管理员可生成成员邀请链接；成员接受邀请后拿到自己的成员令牌；后台鉴权支持 `x-loopin-member-token`，会按成员状态、主办方范围和权限校验。生产 smoke 已验证邀请、接受、成员读导出器、写配额 403，测试成员已停用。
17. 同频社交 MVP 已上线：新增 `EventSocialProfile` 和 `InterestSubscription`；后台 IA 可维护公开人物；C 端活动详情展示同频人物并可订阅方向；「我的」页展示兴趣 feed。生产 smoke 已验证 `Loopin 体验测试局` 的同频信息、后台人物维护、兴趣订阅、feed 读回和人物发现。
18. 最新小程序开发版已重传：UTM 复盘细分展示、同频社交 UI 和当前小程序代码已过 `pnpm mini:check`；2026-06-08 `pnpm mini:upload` 走 DevTools CLI 成功，最新归因事件版包体 66.0 KB；同日 `pnpm mini:preview` 已生成最新预览码并注入生产 API。
19. 选题雷达真实 API 接入能力已补：同步器支持 feed 描述符、鉴权 header、`itemsPath` 和 `fieldMap`；测试覆盖了合作方 API 的嵌套列表、Bearer token、自定义 header、字段归一化，以及 `docs/topic-signal-feed.descriptor.example.json` 示例可解析。后台令牌保护的 `GET /api/admin/topic-signal-feeds/status` 可读取生产 feed 配置状态且不泄露 token，`POST /api/admin/topic-signal-feeds/preview` 可预检标准化样本；Studio「选题雷达」已接入配置状态、预检入口、「活动平台/合作方 API/公开样本」模板按钮和外部来源优先级面板，P0 自有反馈、P1 活动平台/合作方 API、P2 内容趋势，活动行按活动平台模板接入。本地可用 `pnpm topic:feed-check -- --descriptor docs/topic-signal-feed.descriptor.example.json --sample docs/topic-signal-feed.sample-response.example.json --feed-index 0` 先验 descriptor 和脱敏样本响应。2026-06-08 已先配置 `loopin_production_events` 自举 feed 到 FC：`GET /api/admin/topic-signal-feeds/status` 返回 `configured=true, feeds=1, valid=1`，手动 `POST /api/admin/sync-topic-signals` 返回 `synced=1`，`/api/topic-radar/signals?source=loopin_production_events` 可读到 `Loopin 体验测试局`。活动行/Luma/Eventbrite/Meetup 或合作方库拿到真实 URL/字段契约/凭证后，按 `docs/TOPIC_SIGNAL_FEEDS.md` 追加到 `feeds` 数组。
20. 微信支付 V3 代码层已补并部署到 FC：`PaymentProvider` 新增 `wechatpay`，支持 JSAPI 下单、商户私钥签小程序调起参数、平台证书验签、APIv3 key 解密回调、金额校验、回调确认订单和小程序支付状态轮询。`GET /api/payments/providers` 会返回 mock/wechatpay 状态、微信支付 readiness、缺失配置项、`canPrepare` 和 `canVerifyNotify`；Studio「运营台」支付配置卡已接入这份 readiness。本地新增 `pnpm wechatpay:check -- --strict`，可离线检查占位值、AppID/商户号/序列号格式、商户私钥签名、APIv3 key 长度、平台证书/公钥解析和 HTTPS notify URL，不打印密钥值；也支持 `pnpm wechatpay:check -- --markdown --output .artifacts/wechatpay-check.md` 生成交接报告。2026-06-08 生产 smoke 返回 `active=mock`，wechatpay 缺商户号/序列号/商户私钥/APIv3 key/平台证书，notify URL 已自动识别为 `https://loopin.llmxy.xyz/api/payments/wechatpay/notify`。真实收款配置和真机回归见 `docs/WECHAT_PAY_CONFIG.md`。
21. 微信真机联调诊断已上线：后台令牌保护的 `GET /api/events/:id/notification-diagnostics` 可查 openid 绑定、手机号绑定、订阅授权、提醒发送条件、最近订阅和最近报名；`POST /api/events/:id/notifications/test-reminder` 可对单个 userId 做一次订阅消息测试发送，成功后写入 `sentAt`；Studio「运营台」已接入口，最近订阅/最近报名可一键带入 userId 并刷新诊断。生产 smoke 已验证诊断无令牌 401、有令牌 200，测试发送无令牌 401、带令牌缺 userId 返回 400。命令行已补 `pnpm wechat:true-device:test-reminder -- --user-id <id> --dry-run --markdown`，可先预检 openid、报名和订阅授权，确认可发送后去掉 `--dry-run` 消耗一次订阅授权。
22. 生产 readiness 检查脚本已补：`pnpm production:readiness` 会聚合生产 API health、`notifications/config`、`topic-signal-feeds/status`、`attribution/funnel`、`payments/providers`、本地密钥轮换标记和真机联调标记；支持 `-- --json` 结构化输出、`-- --markdown` 可交接清单、`-- --output` 报告落文件和 `-- --strict` 上线门禁。`pnpm production:gate` 已补成总门禁，会同时跑 Supabase 迁移覆盖、密钥轮换 strict 和生产 readiness strict，并把支付、密钥和真机项的下一条命令直接摘到 Remaining。真机体验版手验时可跑 `pnpm wechat:true-device:status -- --markdown` 读取生产诊断，它会列出最近报名/订阅、openid/手机号绑定、测试发送状态和 record 建议；测试发送可跑 `pnpm wechat:true-device:test-reminder -- --user-id <id> --dry-run --markdown`，确认可发送后去掉 `--dry-run`；完成后跑 `pnpm wechat:true-device:record -- --user-id <id> --verified-at now --reminder-sent-at now`，脚本默认会再次校验生产诊断里的 openid、报名、订阅授权和测试提醒已发送状态，通过后才写入 `WECHAT_TRUE_DEVICE_VERIFIED_AT` 和 `WECHAT_TRUE_DEVICE_TEST_REMINDER_SENT_AT`，该项会从 `manual` 变成 `pass`。2026-06-08 最新实跑结果：API、微信订阅消息、真实选题 feed、引流归因漏斗通过；微信支付缺商户号/证书/APIv3 key/平台证书；密钥轮换标记未填；真机体验版仍需手验。
23. 小程序自定义 tabbar 已补并重传开发版：`app.json` 开启微信原生 custom tabbar，新增 `custom-tab-bar/`，活动/我的页在 `onShow` 同步选中态，页面底部留安全距离。`pnpm mini:check` 和 `WECHAT_CI_USE_KEY=1 pnpm mini:ci compile` 已通过。2026-06-08 将白屏的 Wechat Devtools Nightly 回退到 Stable `2.01.2510290` 并开启 `Service Port` 后，`pnpm mini:preview` 与 `pnpm mini:upload` 均走 DevTools CLI 成功；后续修复 DevTools CLI detached 进程被杀问题后，最新归因事件版包体 66.0 KB。脚本已修正 DevTools 假 0 成功识别，并默认不自动 preopen、不自动走上传密钥兜底，避免卡死工具和 `access_token missing` 兜底误耗。
24. 活动引流 UTM 自动归因已补：小程序活动列表、详情和报名页会接收 `utm_source/utm_medium/utm_campaign/utm_content/utm_term/channel/referrer`，列表进详情、详情进报名和分享都会透传；报名提交时这些值会作为隐藏字段写进 `formValues`。会话分享默认 `utm_source=wechat_share`，朋友圈默认 `utm_source=wechat_timeline`；Studio「运营台」每场活动会生成微信群、朋友圈、小红书、公众号、活动行、嘉宾转发、社群合作和合作方 8 条渠道路径，展示完整小程序路径，可编辑 `utm_content` / `referrer` 区分具体小红书笔记、嘉宾或社群投放位，并可一键复制全部渠道 TSV 投放清单；Studio「AI 推广物料」复制朋友圈/微信群/小红书/公众号文案时会按渠道附上小程序路径；活动复盘渠道归因优先读 `utm_source`，再回退到手填来源字段，并展示主要 `referrer/content/campaign` 细分。服务端漏斗已归一化活动行、嘉宾转发和社群合作中文标签。2026-06-08 又补了 `AttributionEvent` 漏斗事件，小程序会记录详情打开、点击报名和提交报名，服务端报名成功后记录预留成单，运营台复盘增长区展示详情 → 点击报名 → 提交 → 成单；Studio UTM 生成器已加 `pnpm --filter @loopin/studio test`，覆盖通用路径、8 个渠道、活动行 query 参数、空格清洗回退和 TSV 清单；对应 Supabase 增量迁移 `supabase/migrations/20260608032000_add_attribution_events.sql` 已应用到生产，`pnpm deploy:fc:code` 已 code-only 部署新版 API，线上 `attribution/funnel` readiness 已通过；后续可跑 `pnpm production:attribution-smoke` 用 `production_smoke` 渠道写入一组可识别测试事件，并确认漏斗计数增长。
25. 小程序归因事件版已成功上传微信开发版：2026-06-08 `pnpm mini:check` 和 `WECHAT_CI_USE_KEY=1 pnpm mini:ci compile` 通过，编译日志确认 `utils/tracking.js` 进入包；修复 DevTools CLI detached 进程被杀后，`pnpm mini:upload` 与 `pnpm mini:preview` 均成功，包体 66.0 KB，预览码在 `.artifacts/miniprogram/preview-qrcode.jpg`。

**还需要真实体验版才能做的事**：
1. 真机/体验版验证 `wx.login` 和票夹身份迁移。手机号组件因小程序类目限制暂不申请，当前体验版走报名表手填手机号。
2. 真机/体验版验证报名成功页「开启活动提醒」订阅授权；授权结果会写入 `NotificationSubscription`，FC `event-reminder-timer` 每 15 分钟扫描待发提醒。当前生产 `notifications/config` 已返回 `enabled:true`，可在 Studio「运营台」读取微信联调诊断核对，并对该 userId 点一次测试发送。
   当前使用「活动开始通知」模板，字段为 `thing1`=活动标题、`time2`=活动时间、`thing3`=温馨提示。
   复跑流程和 readiness 标记见 `docs/WECHAT_TRUE_DEVICE_CHECKLIST.md`。
3. 配置真实微信支付商户参数并做真机支付回归；先跑 `pnpm wechatpay:check -- --markdown --output .artifacts/wechatpay-check.md` 和 `pnpm wechatpay:check -- --strict`，再看 Studio「运营台」支付配置卡或 `GET /api/payments/providers` 的 `wechatpay.readiness.missing`，确认缺项清空后再切 `PAYMENT_PROVIDER=wechatpay`。配置清单见 `docs/WECHAT_PAY_CONFIG.md`。
4. AppSecret / 小程序上传私钥在会话中暴露过，MVP 跑通后做一次轮换；`pnpm secrets:rotation-check` 会检查 `WX_APPSECRET_ROTATED_AT`、`WECHAT_PRIVATE_KEY_ROTATED_AT`、`LLM_API_KEY_ROTATED_AT`、`BACKOFFICE_ADMIN_TOKEN_ROTATED_AT` 这些标记，支持 `-- --strict` 门禁和 `-- --output` 报告落文件。完成重置后用 `pnpm secrets:rotation-record -- --all --rotated-at now` 记录标记，不手写密钥值。

> 现在阿里云 FC、Supabase、生产 demo 活动 smoke、微信 AppSecret、订阅模板配置、真实选题 feed 自举同步、同频社交、后端归因漏斗和小程序归因事件版上传都已经通了。下一步主要是真机体验版联调、微信支付商户参数和密钥轮换。

## 5. C 端微信开发者工具手验状态

**状态**：2026-06-07 Aix 已用真实微信开发者工具走通 活动列表 → 详情 → 报名 → 成功 → 我的活动。

**证据**：活动列表首页 `pages/events/index` 真实拉到 seed 活动并显示 `6 月 14 日 周日`、`19:00`、`¥199`；点击卡片进入详情页，详情显示 `AI 产品人深夜局 · 上海`、`6 月 14 日 周日 19:00`、剩余名额 48；提交测试报名 `艾克斯测试 / 13800138088 / 产品经理 / Loopin Test` 后进入成功页 `报名成功，已通过审核 🎉`；后台 `GET /api/events/<eventId>/registrations` 里该报名为 `approved` + `completed`；票夹页显示 `已报名`、`标准票 · ¥199`、核验码 `cmq38pxyz0005zv2s122zw812`。

复跑步骤：
1. 先本地起后端：`pnpm dev:api` + `pnpm --filter @loopin/api seed`（确保有 demo 活动）。
2. 微信开发者工具 → 导入项目 → 选 `apps/miniprogram` 目录，AppID 填 `wxfb83ad53ee194fe3`。
3. 项目已设 `urlCheck:false`（`project.config.json`），开发期不校验合法域名，能连 `http://localhost:8787`。如果仍报 `request:fail url not in domain list`，检查开发者工具本地缓存是否覆盖了 `setting.urlCheck=true`。
4. 走流程：首页(活动列表) → 点活动卡片进详情 → 立即报名 → 填表(姓名/手机号/身份 chip/公司) → 提交报名 → 报名成功页 → 查看我的活动。
5. 后台核对：Studio「报名看板」「现场签到」应能看到这条新报名（也可 `GET http://localhost:8787/api/events/<id>/registrations`）；C 端票夹接口可看 `GET http://localhost:8787/api/users/<localUserId>/registrations`。
6. 报告任何渲染/交互问题（小程序 UI 之前只在 Claude 这边过了 contract，没过真机渲染）。

注意：`apps/miniprogram/app.js` 已按环境切换 API：开发版默认 `http://localhost:8787/api`，体验版/正式版自动走 `https://loopin.llmxy.xyz/api`。

微信合法域名配置路径：微信公众平台 → 小程序后台 → 开发管理 → 开发设置 → 服务器域名 → request 合法域名。这里只填 `https://loopin.llmxy.xyz`，不要填 `/api` 路径；当前没有用上传、下载、WebSocket，其他三类域名可以先不配。

## 6. 微信支付：代码层已预备，实付先不切默认

第一版付费默认仍走 mock（ADR-003）。微信支付商户：开通免费，但需营业执照主体 + 每笔 0.6% 手续费 + 小程序企业认证 ¥300/年——爸决定晚点再真接商户。当前 `PaymentProvider` 已有 `mock` 和 `wechatpay` 两个实现；`PAYMENT_PROVIDER=wechatpay` 且商户参数齐全时，后端会走 `/v3/pay/transactions/jsapi` 下单、签小程序调起参数，并通过 `/api/payments/wechatpay/notify` 验签解密回调后确认订单。实付上线前还要配置真实商户号/证书/APIv3 key，并按 `docs/WECHAT_PAY_CONFIG.md` 跑真机支付回归。

## 7. 已知坑（别踩）

- **MiMo 偶发返回非数组字段**会崩前端：已在 `services/ai.ts` 做服务端归一化 + 客户端 Array 守卫。再加 AI 字段时沿用这套。
- **MiMo 慢**（活动页~30s，物料~35-75s）：UI 已加 loading 文案，别以为卡死。
- **MiMo 会编时间/地点**：2026-06-07 已把活动页和推广物料 prompt 改成事实字段约束；给了时间地点就必须沿用，没给只能写待定。
- **EventPage 外键是 RESTRICT**：清 seed/test 数据要先删 `eventPage` 再删 `event`。`seed.ts` 和测试 clean 已处理，后续写批量清理时别漏。
- **`deploy:build` 会临时生成 Postgres Prisma Client**：跑完脚本会再生成 SQLite client；如果中途失败后本地测试报 `file:` URL 不匹配，先跑 `pnpm --filter @loopin/api db:generate`。
- **微信开发者工具本地配置会覆盖项目配置**：这次真实手验时，`project.config.json` 是 `urlCheck:false`，但开发者工具本地缓存仍是 `setting.urlCheck:true`，导致 localhost 请求被拦。改成本地 `false` 后请求恢复。
- **开发者工具合法域名校验会反复抽风**：后续又遇到本地缓存显示 `urlCheck:false`，但运行态仍对 `localhost/127.0.0.1` 报 `request:fail url not in domain list`。这不影响代码层接口验证；真机联调必须等 HTTPS 合法域名配置好。
- **开发者工具 CLI 端口文件可能是旧值**：`~/Library/Application Support/微信开发者工具/**/Default/.cli` 有时仍是旧端口，但 IDE 实际监听新端口。当前上传脚本会优先从最新 WeappLog 里读真实端口；手动兜底可先跑 `cli islogin` 看 HTTP 服务地址，再给 `cli upload --port <端口>`。
- **Wechat Devtools / Mac 微信白屏不要混成代码白屏**：这次自定义 tabbar 上传前，开发者工具 UI 白屏，CLI 卡在上传直到 timeout；之后 Mac 微信直接打开小程序也出现纯白窗，但 DevTools CLI 能正常生成预览码，生产 `/api/events` 和 `/api/notifications/config` 也正常。2026-06-08 已确认白屏根因在 DevTools Nightly `2.02.2606042`，处理方式是备份 `/Applications/wechatwebdevtools.app`，用 Homebrew 重装 Stable `2.01.2510290`，必要时完整备份并重建 `~/Library/Application Support/微信开发者工具`。重建用户数据后必须到 Settings → Security Settings 只开启 `Service Port`，再跑 `LOOPIN_MINI_API_BASE=https://loopin.llmxy.xyz/api WECHAT_CI_PREVIEW_PAGE=pages/events/index pnpm mini:preview`；脚本遇到服务端口关闭会打印恢复提示。真机联调以手机扫码/体验版为准。上传密钥路线当前稳定报 `41001 access_token missing`，脚本默认不再自动兜底，只有显式设 `WECHAT_CI_ENABLE_KEY_FALLBACK=1` 才会尝试；DevTools CLI 路线不要用 detached 进程组，否则这版工具会把上传子进程杀掉。
- **C 端本地 userId 必须先 upsert**：小程序票夹使用本地临时 userId，后端 `/api/register` 必须先 upsert 用户，否则 Prisma 会在报名外键上报错。
- **微信空 POST + Fastify 5**：小程序空 POST 默认带 `content-type: application/json`，Fastify 5 会拒绝空 JSON body；`/orders/:id/complete` 请求已补 `data: {}`。
- **Serverless Devs deploy 会打印环境变量明文**：FC 部署会展开 `DATABASE_URL/LLM_API_KEY/WX_APPSECRET/BACKOFFICE_ADMIN_TOKEN`，不要把部署日志贴到文档或群里；部署后及时清理新生成的 `~/.s/logs/*`。只改函数配置时用 `s api deploy --function config -y --silent`，并确认模板走 `FC_DATABASE_URL`，不要让本地 SQLite `DATABASE_URL=file:./dev.db` 进入 FC。
- **dev.db 在 `apps/api/prisma/dev.db`**（Prisma 相对 schema 解析），不是 apps/api/dev.db。
- **集成测试用独立 `test.db`**（globalSetup 从 dev.db 复制）；改 schema 后要重新 `db:push` 再跑测试。
- 共享工作树时 `git commit <pathspec>` 别吞别人 staged 文件；**未明确授权别 commit/push**。

## 8. 全量待办

见 `TODOS.md`（最新台账）。你这次之后的开发线：真机授权联调、配置真实微信支付商户参数并真机回归、AppSecret/上传私钥轮换；若要做真文件直传，再接对象存储和微信 upload/download 合法域名。真实选题来源已有 Loopin 生产活动自举 feed，后续拿到活动行/合作方 URL 和凭证后，可按 `docs/TOPIC_SIGNAL_FEEDS.md` 追加 descriptor，用 `pnpm topic:feed-check` 验脱敏样本，再用 Studio「选题雷达」读取生产 feed 配置状态并预检；投放时运营台已有活动行/嘉宾转发/社群合作 UTM 路径，能和选题来源分开归因。
