# 决策记录（ADR）

## ADR-001：部署走阿里云函数计算 FC（serverless），不买 ECS 〔2026-06-06 爸确认〕

- **背景**：Codex 会话当时建议"新建 ECS"，但它不知道爸阿里云上**没有 ECS、只有函数计算 FC**。
- **核实事实**（cloud-assets memory + mental-health-agent 部署配置）：
  - `mental.llmxy.xyz`、`people.llmxy.xyz` 都跑在阿里云 **FC 3.0（新加坡区）**，按量付费，月费 ¥0–几元，无常驻服务器。
  - 域名是 **`llmxy.xyz`**（阿里云注册，到期 2026-12-27）。Codex 会话里的 `loopin.llmxyz.com` 是口误，**实际用 `loopin.llmxy.xyz`**。
- **决策：Loopin 后端也上 FC**，复用账号+域名+serverless 范式，零固定成本，纯按量。
  - 新建 ECS（方案 C，~¥24–60/月固定）只有在需要长连接/WebSocket（如实时签到推送）才考虑，MVP 用不上。
  - 腾讯云开发 CloudBase（方案 B）会把后端锁腾讯生态、不利于 C+B 双端共享一套 API，否决。
- **配套**：FC 无本地持久化，数据库用 **Supabase（Postgres，code-agent 已在用，免费档够 MVP）**，FC 只跑无状态 API。
- **留给爸的一步**：FC 自定义域名 `loopin.llmxy.xyz` + HTTPS 证书绑定需在阿里云控制台点一下（要账号/2FA），其余部署脚本我来写。

## ADR-002：技术栈选型（低后悔 + 核心框架无关）

- **背景**：爸睡觉前授权自主开发，但技术栈是有真实分叉的决策（小程序原生 vs Taro/uni-app；后端框架；DB）。
- **决策**：选主流低后悔组合（pnpm+TS / Fastify+Prisma / React+Vite / 微信原生），DB 本地用 SQLite、生产用 **Supabase Postgres**（见 ADR-001），并把**确定性业务逻辑全部放进 `packages/core`（零依赖纯 TS）**。
- **后果**：即使爸醒来要换小程序框架或后端，差异化核心（盈亏测算、状态机、表单校验）都不用重写，换栈变成低成本可逆决策。详见 `02-architecture-and-stack.md`。

## ADR-003：付费链路第一版 mock

- 来自会话已确认。第一版不接真实微信支付/分账，订单/支付走 mock 状态机，把精力放在闭环跑通和主办方价值验证上。`packages/core` 的 Order 状态机为真实支付预留接口。

## ADR-004：先做盈亏测算计算器作为第一个完整切片

- **理由**：①爸亲自提出并最看重的差异化点；②纯确定性，零外部依赖，能 100% 本地跑通和单测验证；③B 端可浏览器演示，无需小程序环境。
- 作为"进入开发阶段"的第一个 end-to-end 可运行证据。

## ADR-005：报名表 schema 驱动

- 报名表字段可配置化是 C 端落地页的核心难点。用 JSON schema 描述字段（类型/属性/校验/可见性），C 端按 schema 渲染、后端按 schema 校验，同一份 schema 两端共享（放 core）。避免硬编码字段。
