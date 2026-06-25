# 晨间简报 · 2026-06-06

> 📌 **当日后续大进展（在本简报之后陆续完成，最新状态以 `TODOS.md` 为准）**：
> 1. 竞品+开源 4 路调研 → `docs/04`，并据此做完 **P0 模型查漏改造**（订单三状态/Quota 配额池/预留式结账/表单引擎，TDD）。
> 2. **接库**：报名闭环 reserve→complete→checkin 接真实 DB，超卖守门落 DB 条件原子更新（5 集成测试 + curl 实证防超卖）。
> 3. **C 端小程序**接真实后端闭环（契约 curl 全验证，UI 待开发者工具点）。
> 4. **B 端 Studio 产品化**：建活动(算账→发布)→报名看板→现场签到，浏览器三视图全部截图实证（`docs/studio-*.jpeg`）。
> 5. **AI 功能接 MiMo**（mimo-v2.5-pro）：AI Designer 一键生成活动页文案 + AI 物料（朋友圈/群/小红书/公众号多版本），浏览器实证（`docs/studio-ai-*.jpeg`）。
> 决策修正：部署走 **FC + Supabase 不买 ECS**，域名 `loopin.llmxy.xyz`（详见下方 + ADR-001）。
>
> 验证总账：core 55 单测 + api 39 测试全绿，API typecheck 通过，Studio 构建通过。两个 AI 功能浏览器实证。
>
> 〔2026-06-07 Aix 更新〕继续补了上线前增量：FC timer 过期预留回收、C 端活动列表首页 +「我的活动/票夹」MVP、微信登录/手机号绑定地基、AI 文案事实约束、AI Designer 活动页内容回填、审核活动流 MVP、候补放票 MVP、扫码签到最小闭环，并已用微信开发者工具走通 C 端真实 UI：活动列表 → 详情 → 报名 → 成功 → 我的活动。最新验证：core 55 单测、api 39 测试、API typecheck、Studio build、`pnpm deploy:build` 通过；生产 `https://loopin.llmxy.xyz/api/health` 已返回 ok；Supabase 生产库已补齐 `Registration.checkinToken` / `WaitlistEntry` / `NotificationSubscription` / `EventFeedback` / `EventResource` / `TopicSignal` / `OrganizerMember` 增量迁移，Prisma diff 为空；`/api/events` 已有 demo 活动 `Loopin 体验测试局`；生产 smoke 已跑通表单校验 → 报名 → mock 成交 → 票夹 payload → 扫码核销 → 重复核销 409；微信 request 合法域名已配置，`pnpm mini:preview` 已生成二维码，`pnpm mini:upload` 已上传微信开发版。后续又补了小程序订阅提醒入口、原生 tabBar/活动分享、Studio 运营台、报名 CSV 导出、订阅授权回写、FC `event-reminder-timer` 发送地基、PaymentProvider mock 抽象、微信支付 V3 代码层接入、微信支付配置 readiness、C 端会后页 MVP、Agent 运营建议 MVP、选题雷达 MVP、选题雷达外部信号增强、来源管理、实时信号源和外部 JSON feed 定时同步 MVP、选题雷达真实 API 接入描述符、复盘增强、反馈落库、渠道归因、复邀话术、资料包链接 MVP，以及后台 IA MVP（Quotas 独立视图、Exporters、团队权限地基）、4 个 CSV 导出器、后台令牌/成员权限门禁、权限配置 UI、自定义字段报名 CSV、报名名单 Excel/PDF 导出、真实多账号邀请流和同频社交 MVP；生产已 smoke 通过无令牌 401、带令牌读取 6 个导出器、报名 CSV/Excel/PDF、团队成员、邀请→接受→成员令牌读导出器，并验证 demo 活动动态字段表头与 PDF 动态字段编码；同频社交已验证活动同频信息、后台人物维护、兴趣订阅 feed 和人物发现。FC 已配置 `WX_APPSECRET` 和「活动开始通知」模板，生产 `notifications/config` 已返回 `enabled:true`；手机号组件因小程序类目限制暂不申请，体验版走报名表手填手机号；2026-06-08 最新小程序开发版已通过 `pnpm mini:upload` 重传成功，包体 57.3 KB，最新预览码已生成并注入生产 API；微信支付 V3 代码层、readiness 和 Studio 支付配置卡已部署到 FC/Studio，生产 `/api/payments/providers` 返回 `active=mock`、providers 含 mock/wechatpay，wechatpay 缺商户号/序列号/商户私钥/APIv3 key/平台证书，notify URL 为 `https://loopin.llmxy.xyz/api/payments/wechatpay/notify`；微信真机联调诊断、最近记录一键诊断和单用户测试发送已部署到 FC 和 Studio 运营台，生产 smoke 验证诊断无令牌 401、有令牌 200，测试发送无令牌 401、带令牌缺 userId 返回 400；选题真实 feed 预检已部署到 FC 和 Studio 选题雷达，生产 smoke 用 `/api/events` 预检出 `Loopin 体验测试局`；2026-06-08 又补了选题真实 feed 配置状态自查，后台 `GET /api/admin/topic-signal-feeds/status` 只返回 URL/host、source/label、缺失 env 名和 readiness，Studio「选题雷达」可读取生产配置状态；剩余是真机体验版联调、配置真实选题来源 URL/凭证、配置真实微信支付商户参数并真机回归、密钥轮换；`pnpm secrets:rotation-check` 已可检查轮换状态，旧上传私钥权限已收窄到 `600`。
> 〔2026-06-08 Aix 更新〕新增 `pnpm production:readiness`，把生产 API health、微信订阅消息、选题 feed 配置状态、微信支付 readiness、密钥轮换标记和真机联调手动门槛聚合成一个只读检查；当时实跑结果显示 API/订阅消息通过，剩余仍是真实 feed、微信支付商户参数、密钥轮换和真机体验版联调；后续状态以更新段落和 `pnpm production:readiness` 为准。
> 〔2026-06-08 Aix 更新〕小程序 C 端自定义 tabbar 已完成并重传开发版：微信原生 custom tabbar、活动/我的选中态同步和底部安全距离已接好，`mini:check` 与 `mini:ci compile` 通过，`mini:preview` 生成 60.1 KB 新预览码；清理白屏卡死的 Wechat Devtools 后，`pnpm mini:upload` 走 DevTools CLI 上传成功，包体 60.1 KB。上传脚本已修正 DevTools 假 0 成功识别，并默认不自动 preopen、不自动走上传密钥兜底。
> 〔2026-06-08 Aix 更新〕外部选题来源已补成可执行接入清单：P0 一方信号、P1 活动平台/合作方 API、P2 内容热点人工样本；活动行放入活动平台模板，Studio「选题雷达」预检区有活动平台/合作方 API/公开样本三类模板按钮，并新增来源优先级面板。UTM 复盘细分版小程序已重新上传并生成预览码，当前归因事件版包体 66.0 KB；运营台引流路径扩到微信群、朋友圈、小红书、公众号、活动行、嘉宾转发、社群合作和合作方 8 类。当时 `pnpm production:readiness -- --json` 仍显示 `ready:false`，通过项为生产 API 和微信订阅消息，剩余是真实 feed 未配置、微信支付商户参数未配置、密钥轮换标记未填、真机体验版手验未记录。
> 〔2026-06-08 Aix 更新〕真实选题 feed 已先用 Loopin 生产活动接口自举：FC 配置 `TOPIC_SIGNAL_FEED_URLS` 指向 `https://loopin.llmxy.xyz/api/events`，`topic_feed` readiness 已从 warn 变 pass，手动 `sync-topic-signals` 返回 `synced=1`，来源目录可查到 `loopin_production_events`。同时把 `s.yaml` 改为使用 `FC_DATABASE_URL` 注入生产数据库，避免后续 config-only 部署把本地 `DATABASE_URL=file:./dev.db` 覆盖到 FC。最新 production readiness 为 4 pass / 2 warn / 1 manual，生产 API、微信订阅消息、真实选题 feed、引流归因漏斗已通过；剩余微信支付商户参数、密钥轮换和真机体验版手验。
> 〔2026-06-08 Aix 更新〕`AttributionEvent` 生产迁移已应用，`pnpm deploy:fc:code` 已 code-only 部署新版 API，线上 `attribution/funnel` 返回 200。小程序归因事件版已重传开发版并生成预览码：修复 DevTools CLI detached 进程被杀后，`pnpm mini:upload` / `pnpm mini:preview` 均成功，当前包体 66.0 KB。

---

爸早。昨晚你给艾克斯的"目标"在 01:06 设好、01:07 就被中断了（turn_aborted，只跑了 40 秒），**阿里云/开发实际一行没动**，项目目录是空 git 仓库。我接手后，把能独立做的部分推到了第一个可运行切片。

## 我做了什么（全部已验证）

1. **把方案落盘**——你和艾克斯共创的完整 Loopin 方案 + 各端 spec 此前只存在于 Codex 会话里，没进 repo，风险很高。已持久化到 `docs/01~03`。
2. **搭了 pnpm + TS monorepo**，核心业务逻辑放进框架无关的 `packages/core`（换栈不丢，见 ADR-002）。
3. **盈亏测算计算器（你最看重的差异化点）做成第一个完整 end-to-end 切片**：
   - `packages/core`：盈亏计算 / 报名状态机 / 表单校验 —— **26 个单测全绿**
   - `apps/api`：Fastify 后端，`/api/budget/calc`、`/api/budget/suggest-price` 等接口**实测通过**
   - `apps/studio`：B 端 React 页面，浏览器打开即用，**已截图确认渲染**（见 `studio-desktop.png`）
   - 例子：199 元票/50 人 → "少于 57 人会亏；目标 50 人会亏 ¥900"；建议票价提到 ¥217 可在 50 人保本
4. **C 端微信小程序骨架**：活动详情 → 报名（schema 驱动，调后端共享校验）→ 报名成功，可在微信开发者工具直接导入（已设 urlCheck:false 免合法域名）。
5. Prisma 数据模型已覆盖核心领域对象，并补入 `WaitlistEntry` 支撑候补放票。

怎么看效果：`pnpm install` 后 `pnpm dev:api` + `pnpm dev:studio`，开 http://localhost:5273。

## 〔2026-06-06 更新〕原来要你拍的两件事，已确认

### 1. 部署：不买 ECS，走阿里云 FC（你已确认，见 ADR-001）
- 纠错：你阿里云上**没有 ECS，只有函数计算 FC**（mental/people 都在 FC，按量 ¥0–几元）。Codex 当时建议"新建 ECS"是不知情。
- 已定：Loopin 后端也上 **FC（零固定成本）+ Supabase 做库**；域名复用 **`loopin.llmxy.xyz`**（原 `loopin.llmxyz.com` 是口误）。
- **只剩一步需要你**：在阿里云控制台给 FC 绑自定义域名 `loopin.llmxy.xyz` + HTTPS 证书（要账号/2FA）。部署脚本我写，绑好域名后我推上去。

### 2. 技术栈（已定，见 ADR-002）
低后悔组合：**pnpm+TS / Fastify+Prisma（本地 SQLite→生产 Supabase）/ React+Vite / 微信原生**。核心逻辑隔离在 `packages/core`，换栈成本低。

## 安全提醒
微信 AppSecret 和上传私钥在会话里已明文出现过，MVP 跑起来后建议轮换一次。两者都只在 `.env.local`（已 gitignore），没进 repo。

## 下一步（你醒来确认后我继续）
1. 接 Prisma + DB，把活动/票种/报名/订单写库，报名闭环从 mock 转真实状态机
2. 活动页 AI Designer + 推广物料生成（要填一个 LLM key 到 `.env.local`）
3. FC 域名就绪后部署 + 微信真机体验版联调
详见 `TODOS.md`。
