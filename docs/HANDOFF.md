# 交接文档 · 给艾克斯（Codex）

> 2026-06-06 由 Claude 写。Aix 已继续推进任务①的代码侧部署准备；剩下两件事：**① 用真实 Supabase/阿里云凭据部署并绑域名；② 在微信开发者工具里点一遍 C 端小程序闭环**。
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
│   ├── src/services/     catalog.ts / registration.ts / ai.ts
│   ├── src/llm.ts        OpenAI 兼容 LLM 客户端（接 MiMo，走代理）
│   ├── src/seed.ts       灌 demo 数据
│   └── .env              ⚠️gitignore：DATABASE_URL + MiMo(LLM_*) 配置
├── apps/studio/          B 端 React+Vite（建活动/看板/AI物料/签到 4 tab）
└── apps/miniprogram/     C 端微信原生（活动详情/报名/成功）
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

# 测试（应全绿：core 55 + api 5）
pnpm --filter @loopin/core test
pnpm --filter @loopin/api test
```

**已验证状态**：core 55 单测 + api 5 集成测试全绿；API typecheck 通过；Studio build 通过；SQLite/Postgres 两份 Prisma schema validate 通过；FC 部署包 `.fc/api` 可启动并返回 `/api/health`；Studio 4 视图 + 两个 AI 功能浏览器实证（截图 `docs/studio-*.jpeg`）；报名闭环防超卖 curl + 集成测试双证。

## 3. 凭据 & 网络（重要）

- `apps/api/.env`（**已 gitignore，含真实值**）：
  - `DATABASE_URL="file:./dev.db"`（本地）
  - `LLM_BASE_URL=https://token-plan-sgp.xiaomimimo.com/v1`、`LLM_API_KEY=...`、`LLM_MODEL=mimo-v2.5-pro`、`LLM_PROXY=http://127.0.0.1:7897`
- 微信小程序：AppID `wxfb83ad53ee194fe3`；上传私钥 `/Users/linchen/Downloads/private.wxfb83ad53ee194fe3.key`
- **MiMo 海外端点必须走代理** `http://127.0.0.1:7897`（已在 LLM_PROXY，llm.ts 用 undici ProxyAgent）。Clash 没开会连不上。
- `s.yaml` 绑定 HTTPS 域名时需要 `ALIYUN_FC_CERT_ID`；FC 环境里 `LLM_PROXY` 留空。
- ⚠️ AppSecret / MiMo key / 上传私钥都属敏感，跑通后建议轮换。

## 4. 你的任务 ①：绑阿里云 FC 自定义域名，把后端上线

**目标**：`https://loopin.llmxy.xyz/api/*` 能访问后端（复用爸阿里云 FC 范式，**不买 ECS**，见 ADR-001）。

**背景事实**：爸阿里云只有函数计算 FC（mental.llmxy.xyz / people.llmxy.xyz 都在 FC，按量付费）。域名 `llmxy.xyz` 在阿里云。**Loopin 用 `loopin.llmxy.xyz`**（Codex 历史会话里的 `loopin.llmxyz.com` 是口误）。

**Aix 已完成的代码侧准备**：
1. 本地 SQLite schema 保持不动，新增 `apps/api/prisma/schema.postgres.prisma` 和初始 migration；migration 已含 `CHECK (capacity IS NULL OR used <= capacity)`。
2. Fastify app 已拆成 `src/app.ts` + `src/server.ts`，FC custom runtime 可直接跑 `node --import tsx src/server.ts`。
3. 根目录新增 `s.yaml`，函数名 `loopin-api`，区域 `ap-southeast-1`，自定义域名 `loopin.llmxy.xyz`，证书走 `ALIYUN_FC_CERT_ID`。
4. 根目录新增 `pnpm deploy:build`，会生成 `.fc/api`，剔除本地 `.env`、SQLite db、测试文件，并把 Prisma Client 生成为 Postgres + Debian engines。

**还需要真实外部资源才能做的事**：
1. 创建或确认 Supabase project，拿到生产 `DATABASE_URL=postgresql://...`。
2. 用生产 `DATABASE_URL` 跑 `pnpm --filter @loopin/api db:migrate:deploy`。
3. 填 `DATABASE_URL`、`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`ALIYUN_FC_CERT_ID` 后跑 `pnpm deploy:build && s deploy`。
4. 阿里云 FC/证书控制台确认 `loopin.llmxy.xyz` + HTTPS 绑定。
5. 验证：`https://loopin.llmxy.xyz/api/health` 返回 ok；`/api/events` 返回种子活动。

> ⚠️ 这一步要登爸的阿里云控制台（账号/2FA）+ 可能动 Supabase 资源。绑域名/证书属于控制台操作，部署脚本和代码改动你来写。

## 5. 你的任务 ②：微信开发者工具点一遍 C 端

**目标**：在真实微信开发者工具里走通 详情 → 报名 → 成功，确认 UI 渲染 & 闭环（这是 Claude 没法 headless 截图验证的部分，contract 已 curl 全验证）。

**Aix 当前补充状态**：本机没有找到微信开发者工具或 `wechatwebdevtools` CLI，所以真实 UI 还没点。已重跑 `pnpm --filter @loopin/api seed`，并用本地 API 冒烟走过 `GET /events` → `GET /events/:id` → `POST /register` → `POST /orders/:id/complete` → `GET /events/:id/registrations`，结果新报名成交成功，报名数从 2 变 3。

步骤：
1. 先本地起后端：`pnpm dev:api` + `pnpm --filter @loopin/api seed`（确保有 demo 活动）。
2. 微信开发者工具 → 导入项目 → 选 `apps/miniprogram` 目录，AppID 填 `wxfb83ad53ee194fe3`。
3. 项目已设 `urlCheck:false`（`project.config.json`），开发期不校验合法域名，能连 `http://localhost:8787`。
4. 走流程：首页(活动详情，自动拉最新活动) → 立即报名 → 填表(姓名/手机号/身份 chip/公司) → 提交报名 → 报名成功页。
5. 后台核对：Studio「报名看板」「现场签到」应能看到这条新报名（也可 `GET http://localhost:8787/api/events/<id>/registrations`）。
6. 报告任何渲染/交互问题（小程序 UI 之前只在 Claude 这边过了 contract，没过真机渲染）。

注意：**真机体验版/预览连不上 localhost**，要等任务①的 FC 域名就绪后把 `apps/miniprogram/app.js` 的 `apiBase` 改成 `https://loopin.llmxy.xyz/api` 才能真机跑。开发者工具模拟器用 localhost 即可。

## 6. 微信支付：先别碰（已确认）

第一版付费走 mock（ADR-003）。微信支付商户：开通免费，但需营业执照主体 + 每笔 0.6% 手续费 + 小程序企业认证 ¥300/年——爸决定晚点再弄。`complete` 接口现在是 mock 成交，PaymentProvider 抽象待后续（见 TODOS）。

## 7. 已知坑（别踩）

- **MiMo 偶发返回非数组字段**会崩前端：已在 `services/ai.ts` 做服务端归一化 + 客户端 Array 守卫。再加 AI 字段时沿用这套。
- **MiMo 慢**（活动页~30s，物料~35-75s）：UI 已加 loading 文案，别以为卡死。
- **dev.db 在 `apps/api/prisma/dev.db`**（Prisma 相对 schema 解析），不是 apps/api/dev.db。
- **集成测试用独立 `test.db`**（globalSetup 从 dev.db 复制）；改 schema 后要重新 `db:push` 再跑测试。
- 共享工作树时 `git commit <pathspec>` 别吞别人 staged 文件；**未明确授权别 commit/push**。

## 8. 全量待办

见 `TODOS.md`（最新台账）。你这次之后的开发线：选题雷达、候补放票、审核流、真微信支付 V3、C 端我的活动/票夹、同频社交、AI prompt 收紧（MiMo 会编时间）。
