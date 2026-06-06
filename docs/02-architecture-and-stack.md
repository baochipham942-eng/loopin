# 架构与技术栈

> 技术栈已按低后悔组合定型；部署形态 2026-06-06 经爸确认走 **FC + Supabase**（非 ECS）。详见 `03-decisions.md` ADR-001/002。

## 部署形态（2026-06-06 爸确认）

- **后端：阿里云函数计算 FC（serverless）**，复用 mental/people 同一套范式，按量付费、零固定成本（见 ADR-001）。**不买 ECS。**
- **数据库：Supabase（Postgres）**，FC 只跑无状态 API。
- **域名：`loopin.llmxy.xyz`**（复用阿里云 `llmxy.xyz`；Codex 会话里的 `loopin.llmxyz.com` 是口误）
  - `https://loopin.llmxy.xyz/api` → 小程序 + 后台 API
  - 运营端 Web（Loopin Studio）可走 Vercel 或同域子路径，待定
- 第一版付费 **先 mock**，不接真实微信支付/分账
- 微信开发者工具开发期勾选"不校验合法域名"，本地开发不依赖服务器
- 留给爸：FC 绑定自定义域名 `loopin.llmxy.xyz` + HTTPS 证书需控制台点一下（账号/2FA），部署脚本我写

## 技术栈选型

| 层 | 选择 | 理由 |
|---|---|---|
| 包管理/语言 | pnpm workspace + TypeScript | 爸主力栈，monorepo 共享类型 |
| **核心业务逻辑** | `packages/core`（纯 TS，零依赖） | 盈亏测算/状态机/表单校验框架无关，换栈不丢；确定性系统不交给大模型 |
| 后端 | Fastify + Prisma + SQLite(dev)→Supabase Postgres(prod) | 轻、TS 友好；SQLite 本地零配置，生产换 Supabase 连接串；部署到阿里云 FC |
| B 端 Studio | React + Vite + Tailwind | 主流、可快速出 admin |
| C 端小程序 | 微信原生（wxml/wxss/js） | 第一版只需详情+报名，原生最稳无构建坑；后续若多端复用再评估 Taro |
| AI 生成 | 调 LLM API（爸已有多 key，走 `.env.local`） | AI Designer/物料/选题；非确定性，与确定性系统隔离 |
| 小程序上传 | miniprogram-ci + 上传私钥 | 免人工微信号，CI 上传 |

## Monorepo 结构

```
event recruit/
├── packages/
│   └── core/              # 确定性领域核心（已实现 + 测试）
│       ├── budget.ts      # 盈亏测算计算器 ★差异化
│       ├── registration.ts# 报名状态机
│       ├── form-schema.ts # 报名表 schema + 校验
│       ├── money.ts       # 金额（分）运算，避免浮点
│       └── models.ts      # 领域类型
├── apps/
│   ├── api/               # Fastify 后端 + Prisma 数据模型
│   ├── studio/            # B 端 React 管理后台
│   └── miniprogram/       # C 端微信原生小程序
└── docs/
```

## 凭据管理（敏感，不进 repo）

- AppID / AppSecret / 上传私钥 → 仅放 `.env.local`（已 gitignore）或服务器环境变量
- `.env.local.example` 给出占位模板
- ⚠️ MVP 能跑后建议轮换 AppSecret 和上传密钥（会话中已暴露在明文）
