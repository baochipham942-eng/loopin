# Loopin Studio 后台重构计划

> 来源:2026-06-08 林晨(劳拉)对管理后台现状的诊断。
> 问题定性:艾克斯把一份按生命周期组织好的 B 端 spec(见 `01-loopin-plan-and-specs.md`)
> 拍平成 8 个乱序 tab,且把"平台管理员"和"主办方"两类用户揉进同一个落地页式界面。
> 本文件作为重构依据,分 P0→P4 推进。

## 一、诊断

### 1. 角色不分 —— 平台管理员和主办方塞进同一个壳
`apps/studio/src/App.tsx` 用 8 个平铺 tab 混了两类人的活。最典型:「后台 IA」tab 里
主办方一边管自己的配额,一边能看到**管理员令牌输入框**。

| 其实是「平台管理员」的活 | 现状位置 |
|---|---|
| 支付凭证/微信模板配置、真机诊断、提醒扫描 | 藏在「运营台」`Operations.tsx`(1141 行) |
| 选题信号源 feed 配置 / 预检 | 藏在「选题雷达」`TopicRadar.tsx`(800 行) |
| 配额池底层、数据导出器、管理员令牌、团队权限 | 「后台 IA」`Backoffice.tsx`(734 行) |
| 密钥轮换、生产门禁、白名单主办方管理 | 散落 / 缺失 |

### 2. 不像管理后台 —— 是个落地页
`App.tsx` 是一个 hero 单页:紫色渐变背景 + 大号营销标题「这场活动能赚钱吗?」+ 居中
badge + 一排 tab。缺左导航、主办方/活动全局切换器、顶栏账号、面包屑、数据密集布局。
每个 view 还各自塞一个活动下拉,体验割裂。

### 3. 没按生命周期 —— tab 顺序随机
现状:运营台 / 后台IA / 选题雷达 / 建活动 / 报名看板 / 报名审核 / AI物料 / 现场签到。
spec 定义的链路是:选题→算账→建页→报名表→票种→物料→看板→Agent建议→复盘。
导航完全没体现"筹备 / 招募 / 现场 / 复盘"主线。

### 4. 核心是半成品,外围过度堆砌 —— 体量倒挂
```
过度堆砌:    运营台 1141   选题雷达 800   后台IA 734
真核心 stub: 报名看板 94   报名审核 99    现场签到 118
```

对照 spec 9 模块的缺口:

| Spec B端模块 | 现状 |
|---|---|
| ④ 可配置报名表(字段类型/必填/公开/审核参考) | ❌ 基本没做,只有一个"票种类型"下拉 |
| ⑤ 票种与收款(免费/审核/付费、早鸟/邀请码/库存/退款) | ❌ 弱成一个 select,支付配置还跑去了平台端 |
| ⑦ 报名增长看板 | ⚠️ stub:只有计数表,无趋势/渠道/票种销量/画像/no-show/今日动作 |
| 现场端(已签未签候补分栏/临时通过/标记嘉宾VIP/统计/大屏) | ⚠️ stub:只有粘贴 payload + 搜名字 |
| ⑧ Agent建议 / ⑨ 复盘复办 | ⚠️ 散在「运营台」巨型文件里,无独立面 |

报名审核连批量通过/拒绝、状态筛选、详情、分页、候补批量转正都没有。

## 二、改进方案

### 拆成两个独立产品面
```
Loopin Admin（平台管理员 / 运营控制台）   ← 运营团队用
Loopin Studio（主办方工作台）            ← 白名单主办方用
```
架构:路由 + 角色网关分流,两套独立 Layout,共享 `packages/core` 和 API。

**Loopin Admin（平台端)**
- 主办方与白名单管理(新建,目前缺失)
- 全平台活动总览 + 风险监控(超卖/支付失败/no-show 预警)
- 选题信号源:feed 配置 / 预检 / 同步状态(从「选题雷达」抽出)
- 集成配置中心:微信支付凭证、订阅模板、真机诊断、提醒扫描、定时任务(从「运营台」抽出)
- 数据导出器与配额池底层、密钥轮换、生产门禁状态(从「后台 IA」抽出)
- 收费与结算:单场工具费 / 票务抽成 / 订阅月费

**Loopin Studio（主办方端,按生命周期 4 阶段组织导航)**
```
📋 筹备期   选题雷达(去 feed 配置) → 赚钱测算 → 活动页Designer → 报名表配置 → 票种与收款 → 发布
📣 招募期   报名看板 · 报名审核/候补 · 推广物料 · Agent运营建议 · 渠道与UTM
📍 现场     签到台
🔄 复盘     复盘报告 · 会后反馈 · 资料包 · 下一场复办
⚙️ 我的     团队成员/权限(主办方自己的) · 主办方主页
```
顶栏放全局「当前活动」切换器,替换各页面各自的下拉。

### 后台框架重做
去掉 hero 落地页,换标准后台 shell:左侧分组导航(按 4 阶段)+ 顶栏(主办方切换 / 当前活动
切换 / 账号)+ 内容区(面包屑 + 数据密集)。现场签到单独做移动端/大屏适配。

### 补齐核心功能(stub → 完整)
- **报名看板**:报名/付费/待审核/候补趋势、渠道来源、票种销量、表单画像、保本进度、预计利润、no-show 风险、今日建议动作
- **报名审核**:批量通过/拒绝、状态筛选、详情抽屉、分页/搜索、候补批量转正、导出
- **现场签到**:已签/未签/候补分栏 + 实时计数、现场临时通过、标记嘉宾/赞助/VIP/工作人员、签到统计、大屏模式
- **可配置报名表**(几乎从零):字段构建器,类型 × 属性(必填/公开/仅主办方/审核参考),按活动类型推荐
- **票种与收款**(独立模块):免费/审核/付费票,早鸟价/邀请码票/库存,手动退款

## 三、分期实施

| 阶段 | 内容 | 产出 |
|---|---|---|
| **P0 地基** | 路由 + 角色网关 + 两套 Layout + 全局活动切换器。纯搬家不加功能 | 两端骨架分流可用,现有功能不回归 |
| **P1 IA 重组** | 8 个 view 按角色归位、Studio 按 4 阶段重排导航,巨型 view 拆分 | 主办方端不再看到平台配置 |
| **P2 补核心** | 报名看板/审核/签到三件套补齐 + 报名表构建器 + 票种模块 | 主办方能真正跑完一场 |
| **P3 平台端** | 主办方/白名单管理、全局总览、配置中心、收费结算 | 运营有专属控制台 |
| **P4 打磨** | 响应式、空态、权限细化、可用性回归 | 可试点交付 |

**关键取舍**:`packages/core`(盈亏/状态机/校验)和后端 API 不动——API 已相当齐全。本次是
前端表现层 IA 与 UI 重做 + 少量平台管理 API,不碰 C 端小程序。

---

## P0 地基 —— 任务清单

> 原则:**纯搬家,不加功能、不改 view 内部逻辑**。P0 只建路由/角色/布局/全局活动上下文这四块
> 地基,把现有 8 个 view 原样挂到新框架下,保证零功能回归。功能归属拆分和巨型 view 拆解留到 P1。
>
> 现状基线:`main.tsx` 直接渲染 `<App/>`;`App.tsx` 用 `useState<View>` 切 8 个 tab,
> `?view=` / `?invite=` 控制初始页;无路由库;无显式角色/会话,只有 localStorage 里
> `loopin.backofficeAdminToken` / `loopin.backofficeMemberToken` 两个 token 由 `api.ts` 注入 header。

### P0-1 引入路由
- [ ] 装 `react-router-dom` v6(workspace filter `@loopin/studio`)
- [ ] 用 **HashRouter**(FC 静态托管刷新不 404,省去后端 rewrite 配置;后续要 path 路由再换)
- [ ] `main.tsx` 包 Router;`App.tsx` 改为顶层路由表(替换 `useState<View>`)
- [ ] 路由结构:
  - `/admin/*` → `AdminLayout`
  - `/studio/*` → `StudioLayout`
  - `/` → 按当前角色重定向(admin→`/admin`,organizer→`/studio`)
- 验收:三条路由可访问,刷新不白屏

### P0-2 角色与会话模型(SessionContext)
- [ ] 定义 `Role = 'platform_admin' | 'organizer'`
- [ ] 新建 `src/session/SessionContext.tsx`:暴露 `role` / `organizerId` / `switchRole()`
- [ ] 过渡期角色推断:有 adminToken 视为可访问 `platform_admin`,否则 `organizer`(MVP 不做真登录,但留 `login()` 接口位)
- [ ] 把 `api.ts` 里 token 读写逻辑收敛进 session,view 不再各自读 localStorage
- 验收:`useSession()` 可在任意页拿到当前角色

### P0-3 角色网关(RequireRole)
- [ ] `<RequireRole role="platform_admin">` 包住 `/admin/*`
- [ ] 无权限重定向到 `/studio`(或登录占位页)
- [ ] 顶栏放**角色切换器**(开发期手动切,模拟真实分流;生产由登录态决定)
- 验收:organizer 角色访问 `/admin/*` 被挡

### P0-4 两套 Layout 骨架
- [ ] 抽公共 Shell:`<Sidebar>` / `<Topbar>` / `<ContentArea>`(含面包屑槽位)
- [ ] `AdminLayout`:左导航(平台分组占位)+ 顶栏(账号/角色)+ `<Outlet/>`
- [ ] `StudioLayout`:左导航(4 生命周期分组占位)+ 顶栏(主办方切换 + 当前活动切换 + 账号)+ `<Outlet/>`
- [ ] **删掉 hero header**(badge + 大营销标题),营销文案下放到登录/空态页
- 验收:两套布局有左导航 + 顶栏,视觉上是后台不是落地页

### P0-5 全局活动切换器(EventContext)
- [ ] 新建 `EventContext`:`currentEventId` + 活动列表 + `setCurrentEvent()`,持久化到 URL query / localStorage
- [ ] 提供 `useCurrentEvent()` hook
- [ ] 顶栏渲染活动选择器(Studio 端)
- 注:P0 只建 context + 顶栏 UI;各 view **暂保留**自身 select。让 view 消费 context、删掉本地 select 属 P1(避免 P0 改 view 内部)
- 验收:顶栏切活动,context 值变化(view 接入留 P1)

### P0-6 现有 8 view 原样迁移挂载
- [ ] `/studio/*` 下挂:`create` `dashboard` `review` `materials` `checkin` `topic-radar`,
      以及 `operations` `backoffice`(P1 再拆分归属,P0 先原位挂着)
- [ ] view 内部代码**不改**,只换挂载方式
- [ ] 兼容旧 URL:`?view=xxx` → 重定向到对应新路由;`?invite=` → 对应 team/邀请页
- 验收:8 个页面逐个打开,功能与重构前一致

### P0-7 api client 注入组织上下文
- [ ] `api.ts` 从 session 注入 `x-loopin-member-id` / organizer scope(保持 `x-loopin-admin-token` 兼容)
- [ ] 不破坏现有后台 IA 令牌校验
- 验收:带 member 身份的请求带上 member-id header,401/403 行为不变

### P0-8 验证 / 防回归
- [ ] `pnpm --filter @loopin/studio build` 通过
- [ ] `pnpm --filter @loopin/studio test`(utm 单测)仍过
- [ ] 8 个页面截图对比,关键交互(建活动发布、审核通过、签到、物料生成)手验
- [ ] 记录已知 P1 待办(巨型 view 拆分、view 接入 EventContext、功能归属)

### P0 完成定义(DoD)
两端骨架分流可用、视觉是标准后台、所有现有功能零回归;尚未做功能归属拆分与核心功能补齐
(留 P1/P2)。

---

## 进展记录

### 2026-06-08 · P0 完成
- 引入 react-router(HashRouter)、SessionContext(角色)、RequireRole(网关)、EventContext
  (全局当前活动)、Shell/StudioLayout/AdminLayout、路由包装器。
- 8 个视图原样迁移,旧 `?view=`/`?invite=` URL 兼容。
- 验证:studio build 通过、utm 单测 5/5、live smoke 截图逐页确认零回归;角色网关双向验证通过。
- 发现 2 个历史 tsc 错误(`utm.test.ts:23`、`Operations.tsx:585`),非本次引入,待 P1 顺手修 +
  把 build 脚本改 `tsc --noEmit && vite build`。

### 2026-06-08 · 设计系统改造(浅色中后台)
- **方向**:林晨拍板走 **Ant Design 脉络的浅色中后台**(放弃 Linear 深色方案)。
- **Token 层**(`styles.css :root`):中性灰底 `#f5f5f5` + 白卡片 `#fff` + `#e5e7eb` 细边框;
  文字三级灰阶 `rgba(0,0,0,.88/.45)`;品牌 **Loopin 靛蓝 `#4f46e5` 纯色**(`--brand2` 设为等于
  `--brand`,使旧渐变自动拍平为实色);语义色 `--good #16a34a` / `--warn #dc2626`;新增
  `--radius`/`--shadow-*` token。
- **去 AI 味**:杀掉所有紫青渐变、径向光晕、霓虹发光;青色全部并入靛蓝;卡片过度圆角 18px→10px。
- **执行**:用受控字面量映射(长后缀色先于基色,避免误伤)把 60+ 个深色态颜色重映射到浅底,
  备份在 `/tmp/styles.bak.css`、映射表 `/tmp/loopin-theme.sed`。
- 验证:运营台/赚钱计算器/选题雷达/报名审核/Admin 端逐页截图,对比度达标、无回归、console 0 错误。

### 2026-06-08 · P1 启动(EventContext 接入)
- ✅ Dashboard / Review / CheckIn 三个 stub 视图接入全局 `useCurrentEvent()`,删除各自重复的
  活动下拉(消除与顶栏切换器的冗余)。build + 单测通过。

### 2026-06-08 · 历史债 + 选题雷达拆分
- ✅ 修复 2 个历史 tsc 错误(`utm.test.ts` 加非空断言、`Operations.tsx` onClick 包箭头函数);
  build 脚本改为 `tsc --noEmit && vite build`,新增 `typecheck` script —— 类型错误从此挡在门外。
- ✅ **选题雷达角色拆分 + 聚焦重做**(同时满足"页面太嘈杂"和 P1):
  - 主办方端 `TopicRadar` 瘦身为聚焦流:**选题条件 → 选题卡片(payoff 前置) → 折叠式信号依据**。
    800 行 → ~340 行。
  - 运营能力(新增实时信号、外部来源优先级、外部 feed 预检/状态,需管理员令牌)迁到新建的
    平台端 `views/admin/TopicSignalsAdmin.tsx`,挂 `/admin/topic-feeds`。
### 2026-06-08 · 运营台拆分
- ✅ **Operations 角色拆分**:支付配置 / 活动提醒 / 微信真机诊断三块平台集成迁到新建的
  `views/admin/IntegrationsAdmin.tsx`(挂 `/admin/integrations`「集成配置中心」)。
  主办方运营台只留:汇总统计 + 每场活动概览卡(报名/候补/Agent 建议/复盘增长/引流路径/资料包)。
  Operations 1141 行 → 711 行;平台部分 464 行独立成面。tsc + build 通过,两端截图验证零回归。
### 2026-06-09 · 后台 IA 拆分（P1 收尾）
- ✅ **Backoffice 拆分并删除**(734 行原文件已删):
  - 平台部分 → `views/admin/DataAdmin.tsx`「后台数据」(挂 `/admin/backoffice`):管理员/成员令牌、
    配额池、数据导出器。
  - 主办方部分 → `views/TeamMembers.tsx`「我的团队」(挂 `/studio/team`):团队成员/角色/权限、
    邀请链接生成与接受、同频人物维护。`?invite=` 旧链接重定向到 `/studio/team` 并自动接受。
- 导航重构:StudioLayout 去掉「过渡」组,新增「总览·运营台」和「我的·团队」;AdminLayout 新增「后台数据」。

### ✅ P1 完成（2026-06-09）
角色归属彻底分离:
- **Admin 端**(平台运营)配置面已齐:集成配置中心、选题信号源、后台数据(+ 平台总览/主办方白名单/
  全平台监控/收费结算占位待 P3)。
- **Studio 端**(主办方)只剩自己的活,按生命周期组织:运营台 / 选题雷达 / 建活动 / 报名看板 /
  报名审核 / AI 物料 / 现场签到 / 我的团队。
- 全程 tsc + build + 单测通过,逐页截图零回归。

## P2 进行中(补核心功能深度)

### 2026-06-09 · 报名审核批量化 + 报名看板补全
- ✅ **报名审核**(99 行 stub → 281 行):状态筛选 tab(带计数)、多选 + 全选、**资格感知的批量
  通过/拒绝/转正**(Promise.allSettled 并发,按选中行状态启用对应按钮)、报名详情抽屉(全表单字段 +
  票种/订单/支付/候补/时间)、内联提示替代 `alert()`。无后端改动,客户端并发既有 approve/reject/promote。
- ✅ **报名看板**(94 行单卡 stub → 268 行):组合 `/dashboard`+`/registrations`+`/review` 三源,新增
  今日建议动作(按待审核/候补空位/保本差额/未签到推导)、票种销量、报名画像(职业 TOP + 公司/手机填写率)、
  渠道来源(UTM 归因)、引流漏斗、no-show 风险。
- 验证:build + tsc + 单测通过,真实数据逐项截图核对。

### 2026-06-09 · 现场签到补全
- ✅ **现场签到**(118 行 → 291 行):已签/未签/候补/待确认**分栏 + 实时计数**、应到/签到率统计栏、
  **大屏模式**(投屏用,巨幅已签到/应到 + 进度 + 最近签到 + 扫码框)、**现场临时通过**(submitted→
  通过并签到一键完成)、候补转正、扫码核销(保留)、**重点标记**(嘉宾/VIP/工作人员,设备本地
  localStorage,后端持久化 `RegistrationTag` 待补)。
- 验证:build + tsc + 单测通过,实测签到使 0/1·0% → 1/1·100%,大屏模式投屏就绪。

### 2026-06-09 · 可配置报名表构建器(P2,首个动后端的模块)
- ✅ **后端**(TDD):
  - core 新增 `validateFormSchema(schema)`(重复 key / 未知类型 / 选项缺失 / 依赖悬挂),+7 单测。
  - api 新增 `PUT /api/events/:id/form`(events:write 鉴权 → 校验 → `setEventForm` 落库),
    + 自清理 HTTP 测试(建活动→合法 200→GET 反映→非法 400→删数据)。
- ✅ **前端** `views/FormBuilder.tsx`(`/studio/form`,筹备期):字段编辑器(标识/类型/必填/可见性/
  选项/排序/删除)+ 套用推荐字段 + C 端实时预览 + 保存(前端 `validateFormSchema` 预检 + 后端权威)。
- 验证:core 62 / api 54 / studio 5 全绿;实测加载真实 schema → 编辑 → 保存「报名表已保存」。
- ⚠️ **基建坑(已记)**:`apps/api/.env` 的 `DATABASE_URL=file:./dev.db`,**api 集成测试直接跑在
  dev 库上**(globalSetup 只把 dev.db 复制成 test.db 当模板);测试会建删临时数据,跑完 dev 库的
  demo 数据可能被早先的 reset 清空,需 `pnpm --filter @loopin/api seed` 恢复。重启 dev API 才能
  加载新路由(`lsof -ti tcp:8787 | xargs kill -9` 杀干净旧进程)。

### 2026-06-09 · 修复 AI 物料 JSON 解析失败
- 现象:`/api/ai/materials` 报「LLM 返回的 JSON 解析失败（已重试）：Expected ',' or ']' after
  array element」——模型偶发少打逗号,旧 `extractJSON` 只做去围栏 + 截取 `{...}`,无修复能力。
- 修复:`llm.ts` 引入 `jsonrepair` 兜底(`JSON.parse` 失败 → `JSON.parse(jsonrepair(s))`),
  支持顶层数组、降温到 0.4、重试 3 次。`extractJSON` 导出 + 7 个单测(含"数组缺逗号"形态)。
- 验证:api 61 测试全绿;重启 dev API 后实测 `/ai/materials` 返回合法 JSON。

### 2026-06-09 · AI 物料 IA 重构 + 建活动向导 + 活动列表
用户反馈三点全部落实(顺序经用户修正:活动信息在前、盈亏测算在后;分享素材是发布后持续行为):
- ✅ **建活动改分步向导** `CreateEvent.tsx`:①活动信息 → ②盈亏测算 → ③配置落地页(AI) → ④发布。
  步骤条 + 上一步/下一步;②用①的票价实时算盈亏;④发布成功后设为当前活动 + 给「去配置分享素材」入口。
- ✅ **新增「已建活动列表」** `EventList.tsx`(`/studio/events`,设为 Studio 落地页):每场活动
  标题/时间地点/价格 + 报名/确认/容量 + 保本进度 + 「管理」(设为当前活动→运营台)。
- ✅ **AI 推广物料不再是独立菜单**:`Materials.tsx` 改为当前活动维度(去掉自带下拉,用
  `useCurrentEvent`),改名「分享素材」移到「招募期」,文案点明"发布后可持续重新生成"。
- 导航重排:总览(活动列表/运营台)/ 筹备期(选题雷达/建活动/报名表)/ 招募期(报名看板/报名审核/
  分享素材)/ 现场 / 我的。
- 验证:studio build + 5 单测通过,逐页截图(列表/向导①②/分享素材)零回归。

### 2026-06-09 · 票种与收款（首次动 schema 迁移）
- **迁移**:`TicketType.status`（active/archived，停售不硬删保历史订单）。改 sqlite + postgres 双
  schema，`db:push` 应用 dev，新增 supabase 迁移 `20260609000000_add_ticket_status.sql`。
- **后端**(TDD):
  - catalog 加 `listTicketTypes` / `updateTicketType` / `setTicketTypeStatus` / `ticketTypeEventId`。
  - registration 加 `refundOrder`（调 provider 退款 + 记账 refund_status/refundedAmountCents；
    全额退款连带 `cancel` 释放库存 + 取消报名）+ `RefundError`。
  - 路由:`GET/POST /events/:id/ticket-types`、`POST /ticket-types/:id/update|archive`、
    `POST /orders/:id/refund`；`/registrations` 补 orderId/退款字段。
  - 测试:票种 CRUD HTTP 测试 + 3 个退款服务测试(全额/部分/未支付)。api 61→65 全绿。
- **前端** `views/Tickets.tsx`(`/studio/tickets`,筹备期):票种增删改停售 + 手动退款表。
  实测退款使「已售 2→1、王小二 cancelled+full」,确定性正确。
- **顺带修 seed bug**:`seed.ts` 清理漏删 `Payment`(外键引用 Order),导致库里有支付记录时二次
  seed 必报 FK 错;已补 `payment.deleteMany()`。

### 2026-06-09 · 早鸟价/邀请码 + 现场标记落库（P2 收尾）
- **迁移** `20260609010000`：`TicketType` 加 `earlyBirdPriceCents`/`earlyBirdUntil`/`inviteCode`，
  `Registration` 加 `tag`。改双 schema + supabase 迁移 + `db:push`。
- **早鸟价**：core 新增 `effectiveTicketPriceCents(ticket, now)`（+4 单测）；reserve 用生效价算
  `amountCents`（截止前早鸟、之后原价）。
- **邀请码**：reserve 校验，配了 `inviteCode` 的票下单必须带对的码，否则 `InviteCodeError`(400)。
- **现场标记落库**：`setRegistrationTag`（guest/vip/staff，非法值清空）+ `POST /registrations/:id/tag`；
  CheckIn 从设备本地改为乐观更新 + 落库，多设备/会后可见。
- **测试**：core 62→66，api 65→68（早鸟/邀请码/标记 3 个服务测试）。
- **前端**：Tickets 加早鸟价/早鸟截止/邀请码字段（每票种 + 添加表单）；CheckIn 标记走 API。
- 验证：实测加早鸟票（99/199）、tag set vip 读回正确。

### ✅ P2 完成（2026-06-09）
核心三件套（审核批量化/看板补全/签到补全）+ 可配置报名表 + AI 物料 IA 重构 + 建活动向导 +
活动列表 + 票种与收款（CRUD/退款/早鸟/邀请码）+ 现场标记落库，全部完成。三端测试 66+68+5 全绿。

### 2026-06-09 · 顶栏标题去重 + 运营台重构 + 新增复盘页
- **修「主办方工作台」重复**:侧栏副标题 + 顶栏标题都写死。改顶栏为 `useActiveNavLabel` 按路由显示
  当前页名（活动列表/建活动/运营台…），侧栏保留品牌副标题。Admin 端同步。
- **逐页审查**:大部分页已优化；运营台是唯一过载页（堆全部活动 + 统计墙 + 8 条引流路径 + 复盘资料，
  与活动列表/看板/分享素材重叠）。
- **运营台重构**（711→168 行）:改成当前活动的运营指挥台——关键提醒 + 今日动作（带快捷入口）+
  Agent 运营建议 + 快捷链接。去掉全部活动堆叠、统计墙、引流路径、复盘内容。
- **引流路径**（8 渠道 UTM）迁入「分享素材」（推广一站式）。
- **新增「复盘」页** `Recap.tsx`（`/studio/recap`，新增生命周期「复盘」组）:引流漏斗 + 渠道复盘 +
  会后反馈 + 复邀话术 + 资料包。补上 spec ⑨缺失的生命周期末段。
- 各页单一职责不再重叠:活动列表(选)→看板(数据)→审核/签到(操作)→分享素材(推广+引流)→复盘(会后)
  →运营台(跨阶段指挥)。
- 验证:build + 5 单测通过,运营台/复盘/分享素材逐页截图，真实数据。

## P3 进行中（平台管理员端建设）

### 2026-06-09 · 主办方与白名单管理（P3 首个落地模块）
- **背景**:Admin 端四块占位里，主办方/白名单是唯一已有完整数据地基的——`Organizer.whitelisted`
  字段、`OrganizerMember`、`HostProfile` 早已在 schema，平台级鉴权 `BACKOFFICE_ADMIN_TOKEN`
  （`x-loopin-admin-token`，跨主办方全局放行）也现成。**无需动 schema、无需新建管理员令牌类型。**
  付费票/正式报名链路依赖 `whitelisted`，故先建它。
- **后端**(TDD,改 api,未动 core/schema):
  - `backoffice.ts` 加 `listOrganizers`(跨主办方列表，`_count` 聚合活动数/成员数)+
    `setOrganizerWhitelist`(404 守卫)。
  - 路由 `GET /api/admin/organizers`(`team:read`)、`POST /api/organizers/:id/whitelist`
    (`team:write`, body `{whitelisted}`)。
  - 自清理 HTTP 测试:建两主办方(含活动+成员)→ 未带令牌 401 → 列表计数核对 → 通过/撤销 →
    不存在 404。api 68→69 全绿，tsc 干净。
- **前端** `views/admin/OrganizersAdmin.tsx`(挂 `/admin/organizers`，替占位页):令牌输入(复用
  `loopin.backofficeAdminToken`)+ 状态筛选 tab(全部/已通过/待审核带计数)+ 主办方行(名称/白名单
  徽章/活动·成员计数/入驻日期)+ 通过审核·撤销白名单开关(乐观更新)。AdminLayout 去掉该项的
  `transitional` 标。复用 `reg-tabs`/`mini-btn`，新增 `.mini-btn.ghost` + `.organizer-*`/`.org-badge` 样式。
- **验证**:studio tsc/build/5 单测全绿;浏览器实测(平台管理员身份)列表渲染、点「通过审核」→ toast +
  徽章翻转 + tab 计数实时更新，端到端联动正确;dev 库测后已 reseed 回 1 主办方/1 活动/2 报名。
- **顺带修既有 bug(侧栏双高亮)**:`Shell.tsx` 的 NavLink 未传 `end`,父级路径(`/admin`、`/studio`)
  默认前缀匹配,会与当前子页同时高亮。改为自动检测「本身是其他导航项前缀」的项加 `end` 精确匹配
  (admin/studio 两套导航通用)。实测 `/admin/events` 仅「全平台活动监控」高亮、`/admin` 仅「平台总览」高亮。
  顶栏标题不受影响(本就用最长匹配 bestLen)。
- **下一轮**:HostProfile 编辑、手动新建主办方、主办方详情(旗下活动/成员钻取)。

### 2026-06-09 · 主办方详情钻取（P3 第二轮）
- **后端**(TDD,改 api):`backoffice.ts` 加 `getOrganizerDetail`(一次查回主办方 + `hostProfile` +
  旗下活动(`_count.registrations` 报名数 + 最低票价)+ 成员(复用 `publicMember`),404 守卫)。
  路由 `GET /api/admin/organizers/:id`(`team:read`)。自清理 HTTP 测试建「主办方+资料+活动+票种+
  用户+报名+成员」全链 → 401 / 详情形态(hostProfile.links 解析、活动 registrationCount=1、成员角色)/
  404。**api 69→70 全绿**,tsc 干净。
- **前端** `OrganizersAdmin.tsx` 改主从视图:列表行整块可点(`organizer-open` 按钮)→ 进详情;
  详情含「返回列表」+ 白名单开关 + 三段(主办方资料 bio/links、旗下活动 状态/日期/报名数/最低价、
  团队成员 角色/状态/邮箱)。白名单切换在列表/详情双向同步;HostProfile.links 兼容数组与对象两种 JSON 形态。
- **验证**:studio tsc/build/5 单测全绿;浏览器实测点 `Loopin × AI 产品社区` → 详情正确渲染
  (资料「尚未创建」、活动「AI 产品人深夜局·上海 / 已发布 / 2 人报名 / 最低 ¥199」、成员「主办方管理员 /
  admin / 已启用」),返回列表正常。
- ⚠️ 复现既有坑:改了 api 路由后 dev API 需重启(`lsof -ti tcp:8787 | xargs kill -9` 后重跑)才加载新路由。

### 2026-06-09 · 主办方资料编辑 + 手动新建主办方（P3 第三轮，主办方详情收尾）
- **后端**(TDD,改 api):
  - `createOrganizer`(名称必填校验 + truncate 80,whitelisted 默认 false)→ `POST /api/admin/organizers`
    (`team:write`),返回列表行形态(计数 0)。
  - `upsertHostProfile`(按 `organizerId` @unique upsert bio/avatarUrl/links,links 存 JSON,404 守卫)→
    `PUT /api/organizers/:id/host-profile`(`team:write`)。
  - 自清理 HTTP 测试:新建(401/空名 400/正常 200 计数 0/列表可见)+ 资料 upsert(create 分支 → 详情反映
    → update 分支证明 upsert → 401 → 404)。**api 70→72 全绿**,tsc 干净。
- **前端** `OrganizersAdmin.tsx`:
  - 列表头加「新建主办方」→ 内联表单(名称 + 「直接加入白名单」勾选 + 回车提交),成功后置顶入列表。
  - 详情「主办方资料」段加「编辑/完善资料」→ 表单(简介 textarea / 头像 URL / 链接 textarea,每行
    「标签|网址」,前端 `textToLinks`↔`linksToText` 互转)+ 保存/取消,保存走 PUT 后就地更新详情。
  - `api.ts` 补 `put` 方法。链接渲染兼容数组/对象两种历史 JSON 形态。
- **验证**:studio tsc/build/5 单测全绿;浏览器实测:新建「UI测试主办方」(勾白名单)→ toast + 置顶;
  钻入 → 编辑资料(简介 + 头像 + 官网/小红书两条链接)→ 保存 → toast「资料已保存」+ 渲染正确;
  curl 复核落库(bio + links JSON 持久化)。测试主办方已清理,dev 库恢复 1 主办方/1 活动/2 报名。
- ✅ **主办方详情这块完成**:列表 + 白名单审核 + 详情钻取(资料/活动/成员)+ 资料编辑 + 手动新建。

### 2026-06-09 · 跨主办方总览与监控（P3 第四轮）+ 占位文案同步
- **占位清理**:`AdminPlaceholder.tsx` 从「六块全列」改成只兜底真正没建的（收费与结算）+ 未知路由，
  文案改为「该模块建设中」。
- **平台总览**(`/admin` 首页,替 AdminPlaceholder):
  - 后端 `getPlatformOverview`(`groupBy` 活动/报名按状态,`aggregate` 已支付订单算 GMV=amount−refunded)→
    `GET /api/admin/overview`(`team:read`)。自清理测试用 before/after **增量断言**(避开全局聚合脆弱性)。
  - 前端 KPI 仪表盘:主办方/活动/报名/GMV 四卡 + 待办(待审核主办方·报名,带跳转)+ 活动状态分布 + 快捷入口。
- **全平台活动监控**(`/admin/events`,替占位,去 `transitional` 标):
  - 后端 `listPlatformEvents`:跨主办方活动 + 按状态计数(已确认=approved+checked_in)+ 容量(任一配额
    不限量则整体 null)+ **风险识别**(超卖=已确认>容量;待支付=reserved&unpaid 订单;待审核=submitted;
    缺席=已结束且 approved−checkedIn)→ `GET /api/admin/events`(`team:read`)。测试造容量1但2通过的超卖活动断言。
  - 前端:筛选 tab(全部/有风险/超卖)+ 活动行(主办方链接/状态/风险徽章/报名·容量/已确认/候补),超卖行标红。
- **测试**:api 72→74 全绿,tsc 干净;studio tsc/build/5 单测全绿。
- **验证**:浏览器实测——总览四卡(主办方1/活动1/报名2/GMV¥398)+ 待办/状态分布正确;监控页造「超卖演示活动」
  (容量1·3报名·2通过·1待审核)→ 行标红 + 徽章「超卖」「待审核 1」,tab「超卖 1」,导航单高亮。临时数据已清,
  dev 库恢复 1 主办方/1 活动/2 报名。

### ✅ P3 进度
平台总览 / 主办方与白名单 / 全平台活动监控 三块已建,集成配置/选题信号源/后台数据(P1 已建)。
Admin 端只剩 **收费与结算**(`/admin/billing`,需新建账务模型:单场工具费 / 票务抽成 / 订阅月费)未建。

### 2026-06-09 · C 端主办方主页（HostProfile 落地消费）
- **动因**:Admin 建了 HostProfile 编辑,但 C 端活动详情只把主办方当**纯文本**(`主办 XXX`),
  HostProfile 数据是孤岛。主办方是活动天然的"串联维度"(看完一场 → 逛主办方 → 关注 → 复访),补上闭环。
- **后端**(TDD,公开接口无需令牌):
  - social.ts 新增 `getOrganizerPublic` → `GET /api/organizers/:id/public`:主办方公开资料(name + bio/
    头像/links)+ **仅已发布**活动(按 startAt 升序,复用活动卡字段),404 守卫。
  - `GET /api/events/:id` 的 `event` 拼入 `hostProfile`(供详情页展示摘要 + 跳转)。
  - 测试:公开页(资料 + links 解析 + 只含 published 活动 + 404)+ 详情带 hostProfile。api 74→75 全绿。
- **小程序**:
  - 新增 `pages/organizer/index`(主办方主页:头像/名称/简介/链接 chip + 主办的活动列表,点活动进详情),
    注册进 app.json;wxss `@import` 复用 events 卡片样式。
  - 活动详情「主办 XXX」改为**可点**(带 › 箭头)→ `openOrganizer` 跳主办方主页;event setData 补 organizerId/hostBio。
  - 链接在小程序内点击**复制到剪贴板**(外链不能直跳,合规兜底)。
- **seed 增强**:给演示主办方补 HostProfile(简介 + 公众号/小红书两条链接),让 C 端页开箱可演示;
  seed 清理段补 `hostProfile.deleteMany()`(外键引用 Organizer,先删),二次 seed 验证无 FK 报错。
- **验证**:api 75 全绿 + tsc 干净;curl 实测 `/organizers/:id/public` 返回完整资料 + 1 活动、详情带
  hostProfile;小程序 JS `node --check` 通过、app.json/页面 json 合法。⚠️ 小程序 UI 需微信开发者工具实机验,
  本轮未跑(无 Playwright 通道)。
- **下一步可选**:"关注主办方"(扩 InterestSubscription 加 organizer 维度 + 新活动触达)。

## P3 候选（未来）
- 平台管理员端建设:~~主办方/白名单管理~~(✅ 已建)、全平台监控、收费结算（Admin 端其余仍占位）。
- 向导发布后「分享素材/活动页文案」可继续编辑并落库（Material/EventPage 持久化）。
- 微信支付真实退款接入（当前仅 mock provider 可退）。
- 测试库隔离：api 集成测试目前直接跑 dev 库，应给独立测试库或测后自动 reseed。
