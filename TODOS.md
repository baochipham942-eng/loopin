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

## 🔒 阻塞中（需爸）
- [ ] **微信开发者工具点一遍 C 端**：本机暂未安装微信开发者工具；Aix 已重跑 seed + 服务侧接口冒烟，真实 UI 仍需导入 apps/miniprogram 后走 详情→报名→成功（urlCheck 已关，localhost 真机不通需 FC 域名）
- [ ] Supabase 生产库连接串：填 `DATABASE_URL=postgresql://...` 后跑 `pnpm --filter @loopin/api db:migrate:deploy`
- [ ] 阿里云 FC 绑定自定义域名 `loopin.llmxy.xyz` + HTTPS 证书（`s.yaml` 已准备，仍需账号/2FA + `ALIYUN_FC_CERT_ID`）
- [ ] 微信后台图3 合法域名配置（依赖 FC 域名+HTTPS 就绪）
- [ ] AppSecret / 上传私钥轮换（安全）

## ✅ 已拍板
- [x] 部署走 FC + Supabase，不买 ECS（ADR-001，2026-06-06）
- [x] 技术栈低后悔组合（ADR-002）

## ⏭️ 下一阶段（确认后做）

> P0 模型 + 接库已完成（见上方"已完成"）。报名闭环已跑通真实 DB，下面接增量。

### 接库收尾（生产前）
- [x] 生产 schema/migration 准备：Postgres schema + `CHECK(capacity IS NULL OR used<=capacity)` 兜底（SQLite dev 暂靠条件更新）
- [ ] 生产换 Supabase：创建/确认 Supabase 连接串并执行 migrate deploy
- [ ] 预留过期改定时触发（现为手动 `POST /api/admin/sweep-expired`）：FC 定时触发器 / cron 调 sweepExpired

### 主体开发
- [ ] 候补(position+offerToken+expiry) 落库 + 放票回收
- [ ] 审核活动流（approval 票 kind 的 submitted→approved 人工审）
- [ ] PaymentProvider interface（prepare/confirm/refund/webhook），mock 是其一实现 → 后续替真微信支付 V3（含回调验签）
- [ ] 选题雷达（半自动数据源）+ Agent 运营建议 + 复盘
- [ ] AI 物料 prompt 收紧：严格使用给定时间/地点，别让 MiMo 编时间（实测把 19:00 写成"凌晨3点"）；AI Designer 生成结果可一键回填亮点/议程到活动页（现仅回填标题）
- [ ] 后台 IA 按 Pretix（Quotas 独立菜单/Exporters/团队权限）
- [ ] C 端：我的活动、票夹、会后页、微信登录+手机号授权、schema 动态渲染、自定义 tabbar(TDesign)
- [ ] 现场端：扫码签到（CheckinList 配置 + 结构化二维码 payload + 防重唯一索引，别用 substring 切位）
- [ ] 同频社交：guest list 雪球(Partiful) + 兴趣订阅 feed(Luma) + 按讲师/人发现
- [ ] 部署：FC serverless 上线 + Supabase 接库 + miniprogram-ci CI 上传 + 微信真机体验版联调

## 参考
- **交接文档（给艾克斯：绑 FC 域名 + 点 C 端）：`docs/HANDOFF.md`** ⭐
- 方案/spec：`docs/01-loopin-plan-and-specs.md`
- 架构/栈：`docs/02-architecture-and-stack.md`
- 决策：`docs/03-decisions.md`
- **竞品&开源可借鉴报告：`docs/04-competitive-and-oss-research.md`** ⭐
- 进度简报：`docs/MORNING_BRIEFING.md`
