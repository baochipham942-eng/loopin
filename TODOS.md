# Loopin TODOS

## ✅ 已完成（2026-06-06，Claude 接手艾克斯进度）
- [x] 持久化完整方案 + 各端 spec 到 `docs/`
- [x] pnpm + TS monorepo 骨架
- [x] `packages/core`：盈亏测算 / 报名·订单状态机 / 报名表 schema 校验
- [x] `apps/api`：Fastify + 盈亏/校验接口（实测通过）
- [x] `apps/studio`：B 端「活动赚钱计算器」页（浏览器验证）
- [x] `apps/miniprogram`：C 端骨架（详情/报名/成功）
- [x] Prisma 数据模型（领域对象）
- [x] 竞品&开源调研报告 `docs/04`（4 路并行）
- [x] **P0 模型查漏改造（TDD，55 单测全绿 + typecheck + Prisma 校验通过）**：
  - [x] 订单三状态分离 orderLifecycle/paymentStatus/refundStatus + canRefund 不变量
  - [x] Quota 配额池（quota.ts）：可售=上限−已售−未过期预留 + 超卖守门 OversellError + 预留时限；Prisma Quota+TicketTypeQuota 多对多，库存移出票种
  - [x] Order 加 reservedUntil/三状态/价格快照字段（预留式结账地基）
  - [x] 表单引擎增强：结构化 options(value/label) + dependsOn(identifier) + belongsTo + askDuringCheckin + number 类型/min-max；小程序报名页同步
- [x] **接库（本地 SQLite，5 集成测试全绿 + 实跑闭环）**：
  - [x] Prisma client + `prisma db push` 建 dev.db；Order 加 seats/quotaId 关系
  - [x] 服务层 `services/catalog.ts`+`registration.ts`：reserve→complete→checkin / cancel / sweepExpired，复用 core 守门
  - [x] Quota 扣减落 DB 条件原子更新 `UPDATE...WHERE used+seats<=capacity`（实测第3单 409 售罄、绕过软预留也被 DB 兜底抛 OversellError）
  - [x] 预留过期 sweepExpired 回收（实测释放后可再预留）；取消已成交回滚库存
  - [x] API 路由：建活动/可售查询/报名/成交/取消/签到/sweep；seed 脚本
- [x] **C 端小程序接真实后端闭环**（契约 curl 全验证；UI 渲染待开发者工具点）：
  - [x] 后端补 GET /api/events（列表）+ GET /api/events/:id（详情=event+票种+formSchema+可售）
  - [x] event-detail 拉真实活动（无 id 取最新）+ 余票/售罄态
  - [x] register 拉后端 schema 动态渲染（text/phone/number/single_select/profession_tag chip 多选）→ validate→register(预留)→complete(mock成交) 闭环，409 售罄提示
- [x] **B 端 Studio 产品化（浏览器三视图全部截图实证，见 docs/studio-*.jpeg）**：
  - [x] 建活动流：算账（差异化）→活动信息→发布（POST /api/events 存盈亏快照），发布即喂 C 端
  - [x] 报名增长看板：计数/可售/保本进度条/盈亏 verdict（GET /api/events/:id/dashboard）
  - [x] 现场签到：报名列表+搜索+签到按钮（点签到 已通过→已签到✅ 写库实证）
  - [x] 后端配套：建活动存 BudgetPlan、registrations、dashboard 接口；seed 升级（含盈亏+2报名）
- [x] **AI 功能接入 MiMo（mimo-v2.5-pro，浏览器两功能截图实证，见 docs/studio-ai-*.jpeg）**：
  - [x] LLM client（OpenAI 兼容 + undici 代理 + chatJSON 重试 + 输出归一化到类型契约，避开 LLM 概率性 JSON 崩前端的坑）
  - [x] AI Designer：建活动一键生成 标题/卖点/亮点/议程/适合谁/FAQ/须知，标题回填表单
  - [x] AI 物料：朋友圈/微信群/小红书(带话题标签)/公众号 多版本 + 复制
  - [x] 修白屏 bug（MiMo 偶发返字段非数组 → 服务端归一化 + 客户端 Array 守卫）
- [x] **FC 部署代码准备（2026-06-06，Aix）**：
  - [x] API 入口拆成 `buildApp()` + `server.ts` listen，适配本地和 FC custom runtime
  - [x] 生产 Postgres schema + 初始 migration，含 `CHECK(capacity IS NULL OR used<=capacity)` 库存兜底
  - [x] `s.yaml` + `pnpm deploy:build`，部署包剔除本地 `.env`、SQLite db、测试文件，并带 FC Debian Prisma engines
  - [x] 取消已成交订单的库存回滚改为 Prisma 事务，兼容 SQLite/Postgres
- [x] **上线前增量（2026-06-07，Aix）**：
  - [x] 预留过期清理接 FC timer：新增 `/invoke` 事件入口、`sweep-expired-timer`、`pnpm --filter @loopin/api sweep:expired` 本地脚本，同一段逻辑复用 `sweepExpired`
  - [x] C 端活动列表首页：新增 `pages/events` 作为小程序第一屏，拉 `GET /api/events`，可进详情/我的活动
  - [x] C 端「我的活动 / 票夹」MVP：本地临时 userId、报名绑定用户、后端 `GET /api/users/:id/registrations`、小程序新增 `pages/my`
  - [x] 微信登录/手机号绑定地基：后端新增 `/api/auth/wechat/login` + `/api/auth/wechat/phone`，支持 code2Session / getPhoneNumber code，也支持报名表手填手机号绑定当前用户；临时用户绑定 openid 时迁移报名，票夹不丢
  - [x] AI 文案事实约束：活动页和推广物料 prompt 明确禁止自行补时间/地点/嘉宾/票价；Studio 生成活动页时传入开始时间和地点
  - [x] AI Designer 生成结果回填活动页：Studio 发布时持久化 `EventPage` 的亮点/议程/FAQ；C 端详情页读取并展示，seed demo 自带完整活动页
  - [x] 审核活动流 MVP：`approval` 票报名保持 `submitted`，C 端显示待确认；Studio 新增「报名审核」页，可通过/拒绝；通过后才 `approved/completed` 并占用名额，拒绝不占库存
  - [x] 候补放票 MVP：新增 `WaitlistEntry(position/offerToken/offerExpiresAt/status)`；满额报名进入候补；C 端显示候补位次；Studio「报名审核」页可将候补转正，转正时才扣库存并生成 mock completed 订单
  - [x] 现场端扫码签到 MVP：`Registration.checkinToken` + 结构化 `loopin.checkin` payload；`POST /api/checkin/scan` 按 eventId/registrationId/token 核销；`CheckIn.registrationId` 唯一防重复；Studio 支持粘贴/扫码枪回车核销，C 端票夹可复制核验 payload
  - [x] 小程序预览/上传链路：`pnpm mini:preview` 生成二维码，`pnpm mini:upload` 上传微信开发版；修复微信开发者工具 CLI 对带空格项目路径报 `41002 appid missing` 的问题，devtools 路线自动 staging 到 `/tmp/loopin-mini`
  - [x] 密钥轮换检查脚本：新增 `pnpm secrets:rotation-check`，检查 `.env.local`、`apps/api/.env`、上传私钥文件权限和轮换标记；不打印密钥值；支持 Markdown、报告落文件和 strict 门禁；上传脚本已兼容 `WX_APPID` / `WX_UPLOAD_PRIVATE_KEY_PATH`，当前旧上传私钥权限已收窄为 `600`
  - [x] 密钥轮换 runbook：新增 `docs/SECRET_ROTATION.md`，并给 `pnpm secrets:rotation-check` 增加 `-- --markdown` 可读清单输出；轮换步骤覆盖 AppSecret、上传私钥、LLM key 和后台管理员令牌
  - [x] 生产 readiness 检查脚本：新增 `pnpm production:readiness`，只读检查生产 API、微信订阅消息、选题 feed 配置状态、引流归因漏斗接口、微信支付 readiness、密钥轮换标记和真机联调标记；支持 JSON / Markdown 输出、报告落文件和 strict 门禁，且不打印密钥值
  - [x] 生产总门禁：新增 `pnpm production:gate`，串起 Supabase 迁移覆盖、密钥轮换 strict 和生产 readiness strict，生成 `.artifacts` 报告；任一剩余项未清都会返回非 0；总报告会摘出子报告 `Remaining/Missing` 动作，方便直接推进
  - [x] 生产库增量迁移补齐：Supabase 远端已应用 `Registration.checkinToken`、`WaitlistEntry`、`NotificationSubscription`、`EventFeedback`、`EventResource`、`TopicSignal`、`OrganizerMember`、同频社交表和 `AttributionEvent` 迁移；归因漏斗线上 readiness 已通过
  - [x] 生产 demo 活动：`Loopin 体验测试局` 已发布到 `https://loopin.llmxy.xyz/api/events`，体验版首页不再空列表
  - [x] 生产真实链路 smoke：表单校验 → 报名 → mock 成交 → 票夹 payload → 扫码核销 → 重复核销 409 全通过（demo 活动）
  - [x] 验证：core 55 单测、api 39 测试、API typecheck、Studio build、`pnpm deploy:build` 通过；详情接口 smoke 返回 `page.highlights/agenda/faq`
  - [x] 小程序通知功能地基：后端 `GET /api/notifications/config` 从 FC 环境变量读取微信凭证和订阅模板 ID 状态，生产接口已部署；FC 已配置 AppSecret 和「活动开始通知」模板，当前生产返回 `enabled:true`
  - [x] 通知真实发送地基：新增 `NotificationSubscription`、订阅授权回写接口、`sendEventReminders` 维护任务和 FC `event-reminder-timer`；未配 `WX_APPSECRET`/模板 ID 时安全跳过发送；Studio「运营台」可查看配置状态并手动触发提醒扫描
  - [x] 订阅消息真机测试发送：新增后台令牌保护的 `POST /api/events/:id/notifications/test-reminder`，Studio「运营台」微信联调诊断可对单个 userId 发送测试提醒；成功后写入 `sentAt`，便于真机即时验证模板、openid 和订阅授权；FC 已部署，生产 smoke 验证无令牌 401、带令牌缺 userId 返回 400
  - [x] 小程序原生 tabBar + 活动分享：活动列表/我的活动固定底部 tab，详情页可分享具体活动
  - [x] Studio 运营台：聚合活动报名进度、待审核/候补/签到动作，支持复制小程序活动路径和报名名单 CSV 导出
  - [x] Agent 运营建议 MVP：按待审核、候补、保本差距、推广物料缺口、临近开场提醒和会后复盘生成 `AgentTask`，Studio 运营台支持接受/完成/忽略
  - [x] 选题雷达 MVP：后端半自动选题种子 + `/api/topic-radar/suggestions`，Studio 可按行业/城市/人群/形式生成选题并一键带入建活动/盈亏测算
  - [x] 选题雷达外部信号增强 MVP：内置外部市场信号库 + API 可传 `externalSignals`，按公开活动样本/社群观察/行业样本等来源增强排序；Studio 展示置信度、信号证据和来源拆解
  - [x] 选题雷达来源管理 MVP：新增 `GET /api/topic-radar/signals`，可按行业/城市/人群/形式/来源查询匹配信号；Studio 选题雷达展示来源汇总、匹配分、命中字段和信号证据
  - [x] 选题雷达实时信号源 MVP：新增 `TopicSignal`、`POST /api/topic-radar/signals`，Studio 可录入社群观察/合作方反馈/公开样本；落库信号会参与 `/suggestions` 排序和 `/signals` 来源目录
  - [x] 选题雷达外部 JSON feed 同步 MVP：新增 `TOPIC_SIGNAL_FEED_URLS`、`syncTopicSignals` 维护任务、`POST /api/admin/sync-topic-signals` 和 FC `topic-signal-sync-timer`；外部 API/feed 可定时同步进 `TopicSignal`
  - [x] 选题雷达真实 API 接入描述符：`TOPIC_SIGNAL_FEED_URLS` 支持 JSON 描述符、Bearer/API Key/header env、`itemsPath` 和 `fieldMap`，可接合作方活动 API/公开样本 API
  - [x] 选题雷达真实 feed 接入包：新增 `docs/TOPIC_SIGNAL_FEEDS.md`、可复制的 `docs/topic-signal-feed.descriptor.example.json`、脱敏样本响应 `docs/topic-signal-feed.sample-response.example.json` 和本地预检命令 `pnpm topic:feed-check`；测试读取文档示例，确保 descriptor 能被同步器解析且不泄露 env 值；来源分层已补到文档和 Studio，活动行按「活动平台」模板接入，Luma/Eventbrite/Meetup、合作方活动库和内容趋势作为后续来源池
  - [x] 选题雷达真实 feed 预检：新增后台令牌保护的 `POST /api/admin/topic-signal-feeds/preview`，Studio「选题雷达」可贴 feed descriptor 试抓并查看标准化样本；FC 已部署，生产 smoke 验证无令牌 401、有令牌 200，并用生产活动列表预检出 `Loopin 体验测试局`
  - [x] 选题雷达真实 feed 配置状态自查：新增后台令牌保护的 `GET /api/admin/topic-signal-feeds/status`，只返回 URL/host、source/label、缺失 env 名和 readiness，不泄露 token；Studio「选题雷达」可读取生产 feed 配置状态，并可一键切换活动平台/合作方 API/公开样本三类预检模板
  - [x] 选题雷达生产自举 feed：FC 已配置 `loopin_production_events`，从 `https://loopin.llmxy.xyz/api/events` 同步生产活动到 `TopicSignal`；生产 readiness 的 `topic_feed` 已通过，手动同步返回 `synced=1`
  - [x] 微信支付 V3 代码层接入：新增 `wechatpay` PaymentProvider，支持 JSAPI 下单、商户私钥签小程序调起参数、平台证书验签、APIv3 key 解密回调、金额校验、回调确认订单和小程序支付状态轮询；FC 已部署，生产 `GET /api/payments/providers` 返回 `active=mock`，未配置商户参数时继续走 mock
  - [x] 微信支付配置 readiness：`GET /api/payments/providers` 同时返回 mock/wechatpay 状态，微信支付缺失配置项、`canPrepare` 和 `canVerifyNotify` 可直接自查；平台证书已纳入完整可上线配置判断，避免只下单成功但回调验签失败；FC 已部署，生产 smoke 返回 `active=mock`、wechatpay 缺商户号/序列号/商户私钥/APIv3 key/平台证书，notify URL 已自动识别为 `https://loopin.llmxy.xyz/api/payments/wechatpay/notify`
  - [x] 微信支付离线配置检查：新增 `pnpm wechatpay:check`，检查占位值、AppID/商户号/证书序列号格式、商户私钥签名、APIv3 key 32 字节、平台证书/公钥解析和 HTTPS notify URL；支持 `-- --strict` 门禁、JSON 和 Markdown 报告输出，不打印密钥值
  - [x] 微信支付配置可视化：Studio「运营台」新增支付配置卡，展示当前 Provider、微信支付配置状态、JSAPI 下单 readiness、回调验签 readiness 和缺失商户参数；商户材料到位后可直接在后台核对缺项
  - [x] 微信支付商户参数 runbook：新增 `docs/WECHAT_PAY_CONFIG.md`，明确商户号、证书序列号、商户私钥、APIv3 key、平台证书、notify URL、切换顺序和真机回归点
  - [x] 复盘增强 MVP：`/api/events/:id/review` 派生收入/转化/未到场、人群画像、参与者分层、资料包、反馈问卷和下一场选题建议；小程序会后页展示对应模块
  - [x] 复盘反馈落库 MVP：新增 `EventFeedback`、`GET/POST /api/events/:id/feedback`；小程序会后页可提交评分/价值点/下一场话题/参与意愿；Studio 运营台展示反馈总数、平均分、最近反馈和话题倾向
  - [x] 复盘增长 MVP：报名表新增「从哪里知道的」来源字段；`/api/events/:id/review` 输出渠道归因和复邀话术；小程序会后页、Studio 运营台展示渠道报名/到场和可复制复邀话术
  - [x] 资料包链接 MVP：新增 `EventResource`、`GET/POST /api/events/:id/resources`；Studio 运营台可添加资料链接；小程序会后页可复制资料链接；`/review.resourcePack` 会合并已添加资料
  - [x] 后台 IA MVP：新增 `OrganizerMember`，Studio 独立「后台 IA」页接 Quotas、Exporters、团队成员；API 支持配额读取/更新、服务端报名 CSV 导出、成员创建/更新/列表；生产已完成迁移、部署和 smoke
  - [x] 后台 IA Exporters 增强：服务端导出器扩到报名名单、候补名单、会后反馈、资料包 4 个 CSV；API 测试覆盖真实报名/候补/反馈/资料数据；生产 smoke 已通过 4 个 CSV
  - [x] 后台 IA 权限门禁第一段：新增 `BACKOFFICE_ADMIN_TOKEN`、后台路由 `x-loopin-admin-token` 校验、可选成员 ID 的状态/主办方范围/权限校验；Studio「后台 IA」支持保存令牌并带请求头下载 CSV；生产 smoke 已验证无令牌 401、带令牌 4 个导出器和团队成员列表可读
  - [x] 后台 IA 权限配置 UI + 自定义字段导出：Studio Team 区成员权限改为复选配置并可更新既有成员；报名 CSV 按活动报名表 schema 导出动态字段，生产 smoke 已验证 demo 活动导出 `姓名(name)`、`手机号(phone)`、`你的身份(role)`、`公司/项目(company)`
  - [x] 后台 IA Excel 导出：新增报名名单 Excel 兼容导出 `registrations.xls`，Exporters 列表扩到 5 个；Studio 下载文件名跟随后端 content-disposition；生产 smoke 已验证 Excel content-type、Workbook XML、动态字段和值
  - [x] 后台 IA PDF 导出：新增报名名单 PDF 导出 `registrations.pdf`，Exporters 列表扩到 6 个；生产 smoke 已验证 PDF content-type、文件名、PDF header、中文字体和动态字段编码
  - [x] 后台 IA 真实多账号邀请流：新增成员邀请 token、接受邀请换成员令牌、成员令牌独立鉴权和权限/主办方范围校验；生产 smoke 已验证邀请→接受→成员读导出器→写配额 403，测试成员已停用
  - [x] 同频社交 MVP：新增活动公开人物 `EventSocialProfile`、兴趣订阅 `InterestSubscription`、活动社交信息/人物发现/兴趣 feed API；Studio 后台 IA 可维护公开人物，小程序活动详情展示同频人物并可订阅方向，「我的」页展示兴趣 feed；API 测试、Studio build、小程序编译已通过；生产已完成迁移、FC 部署和 smoke，验证活动同频信息、后台人物维护、兴趣订阅 feed 和人物发现可用
  - [x] 活动引流 UTM 自动归因：小程序活动列表/详情/报名页支持 `utm_source` 等参数透传，报名提交写入隐藏 `formValues`，会话分享默认 `wechat_share`、朋友圈默认 `wechat_timeline`；Studio 运营台可复制微信群/朋友圈/小红书/公众号/活动行/嘉宾转发/社群合作/合作方渠道路径，展示完整小程序路径，可编辑 `utm_content` / `referrer` 区分具体投放位，并可一键复制全部渠道 TSV 投放清单；AI 推广物料复制时按渠道附上小程序路径；复盘渠道归因优先读取 UTM 来源，并展示 referrer/content/campaign 细分；`AttributionEvent` 已记录详情打开、点击报名、提交报名和报名预留，运营台展示引流漏斗；Studio UTM 生成器已有正式单测覆盖 8 渠道、活动行参数、清洗回退和 TSV 清单；新增 `pnpm production:attribution-smoke` 可验证生产写入和漏斗聚合
  - [x] 微信真机联调诊断：新增后台令牌保护的 `GET /api/events/:id/notification-diagnostics`，Studio 运营台可查看 openid 绑定、手机号绑定、订阅授权、提醒发送条件、最近订阅和最近报名；FC 已部署，生产 smoke 验证无令牌 401、有令牌 200
  - [x] 微信真机联调诊断提效：Studio「运营台」最近订阅/最近报名支持一键带入 userId 并刷新诊断，真机报名后无需手动复制 userId 即可检查 openid、订阅授权和测试发送条件；Studio build 已通过
  - [x] 微信真机联调 checklist：新增 `docs/WECHAT_TRUE_DEVICE_CHECKLIST.md`，把体验版报名、订阅授权、票夹保持、Studio 诊断和单用户测试发送整理成可复跑流程
  - [x] 真机体验版 readiness 标记：`pnpm production:readiness` 支持读取 `WECHAT_TRUE_DEVICE_VERIFIED_AT`、`WECHAT_TRUE_DEVICE_VERIFIED_USER_ID` 和 `WECHAT_TRUE_DEVICE_TEST_REMINDER_SENT_AT`，完成手验后可把真机项从 manual 变成 pass；新增 `pnpm wechat:true-device:status` 只读查询生产微信诊断，列出最近报名/订阅、测试发送状态和可记录 readiness 的 userId 候选；新增 `pnpm wechat:true-device:test-reminder`，可先 dry-run 预检再发送单用户测试提醒；`pnpm wechat:true-device:record` 默认会先校验生产诊断，未满足 openid、报名、订阅授权和提醒已发送时拒绝写入通过标记
- [x] **C 端微信开发者工具真实手验（2026-06-07，Aix）**：
  - [x] 本机 `/Applications/wechatwebdevtools.app` 打开 `apps/miniprogram`，启用 automator，走通 活动列表 → 详情 → 报名 → 成功 → 我的活动
  - [x] 补充手验活动列表首页：`pages/events/index` 成为第一屏，真实拉到 seed 活动，点击卡片进入详情，详情可回列表，列表可进我的活动
  - [x] 修复手验暴露的问题：开发者工具本地缓存 `urlCheck=true` 覆盖项目配置；小程序本地 `userId` 未 upsert 导致报名外键错误；空 JSON POST 导致 mock 成交失败；seed 时间按 UTC 写错导致显示成凌晨
  - [x] 证据：详情页显示 `6 月 14 日 周日 19:00`、剩余 48；新增报名 `艾克斯测试` 后后台为 `approved/completed`；票夹页显示该报名 `已报名`、`标准票 · ¥199`、核验码 `cmq38pxyz0005zv2s122zw812`

## 🔒 阻塞中（需爸）
- [x] Supabase 生产库连接串 + 迁移部署（另一个会话处理初始打通；Aix 已补齐后续 schema 增量迁移并跑通过生产报名/核销 smoke）
- [x] 阿里云 FC 绑定自定义域名 `loopin.llmxy.xyz` + HTTPS 证书（另一个会话处理；Aix 已验证 `/api/health` 返回 ok）
- [x] FC 配置微信 `WX_APPSECRET`：生产 `notifications/config` 已返回 `configured.wechat=true`
- [x] 微信订阅消息模板 ID 配到 FC：使用「活动开始通知」模板 `nUSx4R56hjt3Ud3Bkj-lzbg3Rwc4FBr3oL7QpOuDVmU`，生产 `notifications/config` 已返回 `enabled:true`
- [ ] 真机体验版微信登录/订阅提醒联调（request 合法域名已配置；preview/upload 已完成；手机号组件因小程序类目限制暂不申请，体验版走报名表手填手机号；联调诊断、最近记录一键诊断和单用户测试发送已接到 Studio 运营台）
- [x] 重传最新小程序开发版：2026-06-08 `pnpm mini:upload` 走 DevTools CLI 成功，最新归因事件版包体 66.0 KB；最新预览码已生成到 `.artifacts/miniprogram/preview-qrcode.jpg`，并注入生产 API
- [x] 真实选题 feed 生产配置：2026-06-08 已用 config-only 部署写入 FC；为避免本地 SQLite 覆盖生产，`s.yaml` 改为使用 `FC_DATABASE_URL` 注入函数运行时 `DATABASE_URL`
- [x] 重传最新小程序开发版（自定义 tabbar UI）：2026-06-08 先清理白屏卡死的 Wechat Devtools，再用 `pnpm mini:upload` 走 DevTools CLI 成功；后续归因事件版包体 66.0 KB；脚本已改为默认不自动 preopen、不自动走上传密钥兜底，避免卡死工具和 `access_token missing` 兜底误耗
- [x] 重传小程序归因事件版：`pnpm mini:check` 和 `WECHAT_CI_USE_KEY=1 pnpm mini:ci compile` 已通过，`utils/tracking.js` 已进入编译包；修复 DevTools CLI detached 进程被杀后，`pnpm mini:upload` 与 `pnpm mini:preview` 成功，包体 66.0 KB，预览码已生成
- [ ] AppSecret / 上传私钥轮换（安全；`pnpm secrets:rotation-check` 已可检查轮换状态，外部重置后用 `pnpm secrets:rotation-record -- --all --rotated-at now` 写标记；当前旧上传私钥权限已收窄为 `600`）
- [ ] 配置真实微信支付商户参数并真机回归（商户号、商户 API 证书序列号、商户私钥、APIv3 key、平台证书/公钥、notify URL；代码层、`pnpm wechatpay:check`、providers readiness、Studio 支付配置卡和 `docs/WECHAT_PAY_CONFIG.md` 已就绪）

## ✅ 已拍板
- [x] 部署走 FC + Supabase，不买 ECS（ADR-001，2026-06-06）
- [x] 技术栈低后悔组合（ADR-002）

## ⏭️ 下一阶段（确认后做）

> P0 模型 + 接库已完成（见上方"已完成"）。报名闭环已跑通真实 DB，下面接增量。

### 接库收尾（生产前）
- [x] 生产 schema/migration 准备：Postgres schema + `CHECK(capacity IS NULL OR used<=capacity)` 兜底（SQLite dev 暂靠条件更新）
- [x] 生产换 Supabase：创建/确认 Supabase 连接串并执行 migrate deploy
- [x] 预留过期改定时触发：FC timer 触发 `/invoke` 跑 `sweepExpired`，手动接口 `POST /api/admin/sweep-expired` 保留

### 主体开发
- [x] 候补(position+offerToken+expiry) 落库 + 放票回收
- [x] 审核活动流（approval 票 kind 的 submitted→approved 人工审）
- [x] PaymentProvider interface（prepare/confirm/refund/webhook），mock 是其一实现；API 已有 `payment/prepare`，成交会写 `Payment` 记录；微信支付 V3 Provider 已补 JSAPI 下单、回调验签解密和订单确认，并已部署到 FC；待真实商户号/证书配置后真机支付联调
- [ ] 支付：配置真实微信支付商户参数 + 真机 `wx.requestPayment`/回调联调
- [x] 选题雷达实时数据源 + 复盘深水区 MVP（选题雷达外部信号增强、来源管理、实时信号落库/录入、复盘反馈落库、渠道归因、复邀话术和资料包链接已完成）
- [x] 选题雷达真实抓取/API 定时同步基础管道（外部 JSON feed → `TopicSignal` 幂等写入 → `/invoke`/admin 手动触发 → FC timer）
- [ ] 配置真实选题来源 feed/API（接入描述符、鉴权能力、本地样本预检、后台预检入口、配置状态自查和可复制 descriptor 模板已完成；还需要具体 URL、字段契约或凭证）
- [x] AI 物料 prompt 收紧：严格使用给定时间/地点，别让 MiMo 编时间（实测把 19:00 写成"凌晨3点"）
- [x] AI Designer 生成结果可回填亮点/议程/FAQ 到活动页，并在 C 端详情页展示
- [x] 后台 IA 按 Pretix（Quotas 独立菜单/Exporters/团队权限地基）
- [x] 后台 IA 深水区第一段：更多 Exporters（报名/候补/反馈/资料包 CSV）
- [x] 后台 IA 深水区第二段：后台令牌门禁、权限校验中间件、按主办方范围授权
- [x] 后台 IA 深水区第三段：权限配置 UI、自定义字段报名 CSV 导出
- [x] 后台 IA 深水区第四段：报名名单 Excel 兼容导出
- [x] 后台 IA 深水区：真实多账号登录/邀请流
- [x] C 端：活动列表首页 MVP
- [x] C 端：我的活动、票夹 MVP
- [x] C 端：微信登录+手机号绑定接口/小程序交互地基
- [x] C 端：原生 tabBar + 活动分享 + 报名成功页订阅提醒入口
- [x] C 端：会后页 MVP + 复盘增强（票夹入口 + `/api/events/:id/review` 派生报名/签到/收入/画像分层/资料包/问卷/后续动作）
- [x] C 端：活动引流 UTM 透传和报名隐藏归因
- [ ] C 端：真机微信登录联调（openid 身份迁移、票夹保持、订阅授权；Studio 运营台可查诊断并做单用户测试发送）
- [x] C 端：自定义 tabbar 视觉增强（微信原生 custom tabbar，活动/我的页同步选中态；`pnpm mini:check` 和 `WECHAT_CI_USE_KEY=1 pnpm mini:ci compile` 已通过，最新预览码已生成；未引入 TDesign 包）
- [x] B 端：运营台 + 报名名单 CSV 导出 + 渠道引流路径生成
- [x] 现场端：扫码签到最小闭环（结构化二维码 payload + token 校验 + CheckIn 防重唯一索引，避免 substring 切位）
- [x] 同频社交：guest list 雪球(Partiful) + 兴趣订阅 feed(Luma) + 按讲师/人发现
- [ ] 部署：微信真机体验版联调
- [x] 部署：重传最新小程序开发版（同频社交 UI），包体 57.3 KB
- [x] 部署：重传最新小程序开发版（自定义 tabbar UI），后续归因事件版包体 66.0 KB；DevTools 白屏时先关掉卡死进程再上传，DevTools CLI 不使用 detached 进程组

## 参考
- **交接文档（给艾克斯：绑 FC 域名 + 点 C 端）：`docs/HANDOFF.md`** ⭐
- 方案/spec：`docs/01-loopin-plan-and-specs.md`
- 架构/栈：`docs/02-architecture-and-stack.md`
- 决策：`docs/03-decisions.md`
- **竞品&开源可借鉴报告：`docs/04-competitive-and-oss-research.md`** ⭐
- 进度简报：`docs/MORNING_BRIEFING.md`
