# 晨间简报 · 2026-06-06

> 📌 **当日后续大进展（在本简报之后陆续完成，最新状态以 `TODOS.md` 为准）**：
> 1. 竞品+开源 4 路调研 → `docs/04`，并据此做完 **P0 模型查漏改造**（订单三状态/Quota 配额池/预留式结账/表单引擎，TDD）。
> 2. **接库**：报名闭环 reserve→complete→checkin 接真实 DB，超卖守门落 DB 条件原子更新（5 集成测试 + curl 实证防超卖）。
> 3. **C 端小程序**接真实后端闭环（契约 curl 全验证，UI 待开发者工具点）。
> 4. **B 端 Studio 产品化**：建活动(算账→发布)→报名看板→现场签到，浏览器三视图全部截图实证（`docs/studio-*.jpeg`）。
> 5. **AI 功能接 MiMo**（mimo-v2.5-pro）：AI Designer 一键生成活动页文案 + AI 物料（朋友圈/群/小红书/公众号多版本），浏览器实证（`docs/studio-ai-*.jpeg`）。
> 决策修正：部署走 **FC + Supabase 不买 ECS**，域名 `loopin.llmxy.xyz`（详见下方 + ADR-001）。
>
> 验证总账：core 55 单测 + api 5 集成测试全绿，三包 typecheck 通过，Studio 构建通过。两个 AI 功能浏览器实证。

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
5. Prisma 数据模型覆盖全部 17 个领域对象（下一阶段接库用）。

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
