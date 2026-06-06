# Loopin

> 面向年轻人的同频活动入口（C 端）+ 面向主办方的活动赚钱与增长系统（B 端 Loopin Studio）。
> Find your people. Join the moment.

完整产品方案与各端 spec 见 [`docs/`](./docs)。

## Monorepo

```
packages/core      确定性领域核心（盈亏测算/报名状态机/表单校验），零依赖纯 TS，框架无关
apps/api           Fastify 后端，暴露盈亏计算 & 表单校验接口
apps/studio        B 端 React 管理后台（已实现「活动赚钱计算器」页）
apps/miniprogram   C 端微信原生小程序骨架（活动详情/报名/报名成功）
```

## 快速开始

```bash
pnpm install --registry=https://registry.npmmirror.com

# 跑单测：core 55 + api 5 集成测试
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
# 开发期已设 urlCheck:false，不校验合法域名
```

## 报名闭环 API（已接 DB）

`POST /api/events`（建活动+票种+配额）· `GET /api/events/:id/availability`（可售）·
`POST /api/register`（预留）· `POST /api/orders/:id/complete`（成交，原子扣库存防超卖）·
`POST /api/orders/:id/cancel`（取消回滚）· `POST /api/registrations/:id/checkin`（签到）·
`POST /api/admin/sweep-expired`（回收过期预留）

## 凭据

复制 `.env.local.example` → `.env.local` 填真实值。`.env.local` 与 `*.key` 已 gitignore，永不提交。
微信 AppID/Secret、上传私钥见 `.env.local.example`（⚠️ 会话中已明文暴露，跑起来后建议轮换）。

## FC 部署准备

后端本地开发继续用 SQLite：`apps/api/prisma/schema.prisma`。
生产部署用 Supabase Postgres：`apps/api/prisma/schema.postgres.prisma` + `apps/api/prisma/migrations/20260606000000_init_postgres/migration.sql`。

```bash
# 需要先在环境里填 Supabase DATABASE_URL、LLM_*、ALIYUN_FC_CERT_ID
pnpm --filter @loopin/api db:migrate:deploy
pnpm deploy:build
s deploy
```

`pnpm deploy:build` 会生成 `.fc/api` 部署包，并剔除本地 `.env`、SQLite db、测试文件；FC 运行时走 `s.yaml` 里的 `loopin.llmxy.xyz` custom domain。

## 当前进度

见 [`docs/MORNING_BRIEFING.md`](./docs/MORNING_BRIEFING.md) 和 [`TODOS.md`](./TODOS.md)。
