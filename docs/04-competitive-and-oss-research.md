# Loopin 竞品 & 开源调研：可借鉴报告

> 2026-06-06 · 4 路并行调研综合。每路均实地抓取官网/文档/源码，非记忆推断。
> 本报告的核心价值在 **第四节**——把调研结论对照 Loopin **已落地的 `packages/core` 与 Prisma schema** 逐条查漏，给出可执行改造清单。

## 调研对象

| 路 | 对象 | 看什么 |
|---|---|---|
| 商业产品 | Luma / 活动行 / Partiful / Eventbrite / Meetup | 产品设计、商业模式、差异化空白 |
| 开源架构 | **Hi.Events**（PHP/Laravel，业务最同构） | 数据模型 / 票务正确性 / 状态机 |
| 开源 B 端 | **Pretix**（Python/Django，主办方侧标杆）+ Attendize | 表单引擎 / 配额 / 支付抽象 / 后台 IA |
| 微信生态 | TDesign 模板 / TurboActivityFee / WXAPP-REGISTER / WeiXin_QianDao | C 端页面 / 登录·支付·签到三链路 |

---

## 一、三个最关键战略结论

### 1. B 端「算账」是真空——Loopin 最硬的差异化点
盈亏测算工具满地都是（SwarmTix/Billettera/Airmeet…），但**全是脱离交易闭环的第三方获客页**：主办方要离开报名平台去别处算、算完手填票价回来。**没有任何一家把"这场能不能赚钱"嵌进发布→定价→招募→结算的主流程。** 这比 AI 更具防御性——AI 物料 Eventbrite 已在追、门槛不高；而"算账+招募闭环"是产品 know-how。
→ Loopin Studio 把盈亏测算做成**建活动第一步**（建页前就给回本线 + 定价建议），是别人没占的山头。我们已实现的 `packages/core/budget.ts` 正是这个山头的地基。

### 2. C 端「同频社交」两种范式已被验证，国内是空位
- **Partiful = 即时在场感**：RSVP 即见 guest list，看到熟人已报名触发"social snowball"裂变；叠加共享相册、评论/反应。做单场氛围与熟人裂变。
- **Luma = 持续关系网**：订阅兴趣日历 + 朋友动态 feed，把单次活动串成可持续社群。
- **Meetup**：把"看到同频的人"做成付费墙（免费用户看不到完整成员），证明这是强付费需求（但付费墙伤社区）。
- **国内活动行几乎不碰社交**。
→ Loopin 把"雪球裂变 + 兴趣订阅"两范式搬到国内年轻人市场，再加**"按人/按讲师发现"**（现有平台都是按活动找，没人做按人找），是清晰差异化。

### 3. AI 没人做到「端到端出整套物料」
Eventbrite 已用 AI 补简介/配图/文案并验证有效（社交广告 CPC −17%、提速 30%），说明需求真实且被市场接受。但行业停在"补字段"，**没人做"一键生成完整活动页 + 全套招募物料 + 复盘报告"**。
→ Loopin 的 AI 要打的不是"有没有 AI"（会被追平），而是 **AI + 算账 + 招募闭环三位一体**——单点可模仿，组合才是壁垒。

---

## 二、C 端可借鉴（微信小程序 + 体验）

### 2.1 信息架构与页面链路
- **页面链路**（TurboActivityFee 验证）：活动列表 → 详情 → 报名表单 → 报名成功/我的报名。正是我们 C 端要的主干。
- **一个详情页/报名页用 `?id=活动id` 承载所有活动**（WXAPP-REGISTER），别一活动一套页。
- **自定义 tabbar**（TDesign）：原生 tabbar 受限，自绘方便做红点/动效/主题色。UI 组件直接对标 TDesign miniprogram 组件库，省自撸成本。

### 2.2 报名表单：schema 后端下发、前端动态渲染 ⭐
WXAPP-REGISTER 的范式 = 表单字段由后端下发（`{id,type,prop,option必填,selects[]}`），前端遍历动态生成 + 提交前校验。**这正是我们 ADR-005 的方向，已在 `packages/core/form-schema.ts` 起步**，但要补强（见第四节）。最高 ROI：运营后台配字段，C 端零改码。

### 2.3 预留式结账 + 超卖防护（学 Hi.Events）
- 选票即建 `RESERVED` 单 + 15min 倒计时（`reserved_until`），库存即时占用——避免"填完表发现没票了"。
- 可售 = 上限 − 已售 − 未过期预留；过期惰性回收（查询时排除过期单）。
- 匿名 `session_id` 让未登录也能进结账、并能清理废单——对小程序"先选后授权"友好。

### 2.4 微信三条特有链路的自建后端写法（FC + Supabase 版）
> 我们走自建后端，**不能用云开发的免签名捷径**，三条都得自己实现。

- **登录 + 手机号**：前端 `wx.login()` 拿 code → 后端 `code2session` 换 openid+session_key；手机号用新版 `button open-type=getPhoneNumber` 拿 code → 后端调 V3 `phonenumber/getphonenumber`（或旧版 session_key AES 解 encryptedData）。后端签发自家 JWT 存 storage（对标 WeiXin_QianDao 的 `wid`）。
- **支付（第一版 mock，真实接法预留）**：自建必须走**微信支付 V3**——后端 `/v3/pay/transactions/jsapi` 拿 `prepay_id` → 商户私钥二次签名组 `wx.requestPayment` 参数 → **回调用平台证书验签 + AES-GCM 解密 → 校验金额 → 改支付流水状态**。回调验签是绕不开的一环。
- **签到核销四步**（WeiXin_QianDao）：`wx.scanCode` → 解析 payload → 带核销员身份请求后端 → modal 结果。⚠️ **反面教训：它用 `substring(29,33)` 按位置硬切二维码极脆弱**——我们必须用结构化 payload（`aid=x&token=y` 或 JSON）。防重核销下沉后端：状态机 + 数据库唯一索引兜底。

### 2.5 同频社交机制（学 Partiful + Luma）
- 报名零摩擦：手机号验证、无需下载、RSVP 自动加日历。
- **RSVP 即见 guest list 的雪球机制**（Partiful）——同频裂变最低成本引擎。
- 兴趣日历订阅 + 朋友动态 feed（Luma）——C 端留存关键。
- 公开参与者信息须用户主动授权（已在我们 spec 体验原则里）。

---

## 三、B 端可借鉴（Loopin Studio）

### 3.1 Question 表单引擎（Pretix + Hi.Events 双印证）⭐
两家不约而同把"问题"做成一等公民，远超简单字段表：
- **字段类型枚举**：文本/多行/数字/日期/时间/单选/多选/布尔/电话/国家/文件…
- **正交可见性开关**（不是单一 boolean）：`required` / `hidden`（仅后台）/ `ask_during_checkin`（购票不问、核销才问，如餐食）/ `show_during_checkin` / `print_on_invoice`。
- **依赖条件**（条件字段）：`dependency_question` + `dependency_values`，**用 option 的 identifier 而非 value 关联**（改文案不断链）。
- **belongs_to 两级粒度**（Hi.Events）：`ORDER`（整单问一次，如发票抬头）vs `ATTENDEE`（每人各问，如餐食）。
- 问题 ↔ 票种**多对多**（VIP 票才问停车需求）。答案存 JSON（兼容多选/地址/结构化）。

### 3.2 Quota 配额池：把库存从票种里抽出来（Pretix 口碑最硬的设计）⭐
- 库存单位是 **Quota** 不是 Item：独立配额实体 + 与票种/变体**多对多**挂载。
- 解决"早鸟+标准共享 100 名额""多票种共享场地总量""子场次独立库存"——票种自带 stock 字段迟早撞墙。
- 可用量实时把 **已付 + 待付 + 购物车占位 + 阻塞券** 全算进占用。
- `close_when_sold_out` 售罄永久关闭，**防退款回流被黄牛刷**。
- Hi.Events 三层叠加：价格档级库存 + 跨票种共享池（capacity_assignments）+ 活动总量兜底。

### 3.3 订单三状态分离（Hi.Events 最干净的设计）⭐
把订单拆成三个**正交**维度，别揉进一个大枚举：
- `orderStatus`：RESERVED / COMPLETED / CANCELLED / ABANDONED
- `paymentStatus`：独立
- `refundStatus`：NO_REFUND / PARTIALLY_REFUNDED / REFUNDED

Pretix 同思路：主状态 4 态极简（pending/paid/expired/canceled），把"审核(require_approval)""线下付款(valid_if_pending)""支付/退款明细"拆成正交标志 + 子状态机。

### 3.4 报名记录独立于订单（attendee != order）
一单多人时，每个 attendee 有独立 `status`（ACTIVE/CHECKED_IN/CANCELLED）和二维码 publicId，签到/退款精确到人。**我们现在的 Registration 已是 per-attendee（对的），但 Order 是单 status（要拆）。**

### 3.5 价格快照思想
order/orderItem 存下单时价格快照（`point_in_time_data` JSONB）——主办方事后改价不污染历史单与对账。

### 3.6 候补（Hi.Events waitlist）
`position`（排队序号）+ `offer_token`（放票一次性令牌）+ `offer_expires_at`（抢购时限，过期顺延下一位）。候补绑在库存层（价格档），与库存粒度对齐。免费活动"满员候补"标准解。

### 3.7 PaymentProvider 抽象（Pretix，接微信支付直接参考）⭐
抽一个 `PaymentProvider` interface：`identifier / prepare / confirm / refund / webhookHandler / calcFee`。微信支付只是一个实现。**Pretix 已踩好的纪律**：
- `prepare()` 阶段**绝不动钱**（只发起/跳转）；
- `confirm()` 在**异步回调验证后**才调（别拿同步返回当确认）；
- 退款是**独立子状态机**。

### 3.8 签到 CheckinList + 规则引擎（Pretix）
- CheckinList 配置维度：收哪些票种 / 待支付能否进 / 允许多次入场 / 出场后可再进 / 定时全签出。
- 规则引擎（JsonLogic）：时间窗（带分钟容差）/ 已入场次数 / 距上次入场分钟数 / 按闸口匹配。
- 离线扫码：**nonce 幂等**（重复上传只产一条记录）+ 客户端规则复刻 + 服务端 force 补录。
- 短期 Web 扫码先抄配置维度即可。

### 3.9 后台信息架构（Pretix organizer backend）
Orders / Products(票种) / **Quotas（独立菜单）** / Check-in / Waiting List / Exporters(PDF·Excel·CSV) / Vouchers / Settings；组织层做 团队权限（按活动范围控权）+ API Token。

---

## 四、对照 Loopin 现有代码的查漏与改造清单 ★本报告重点

> 把上面结论落到我们**已经写好**的 `packages/core` 和 `apps/api/prisma/schema.prisma`。按优先级排序。

### P0（影响数据模型，越早改越省）

| # | 现状 | 问题 | 改造 | 依据 |
|---|---|---|---|---|
| 1 | `Order.status` 单枚举（pending/paid/refunded/cancelled） | 收款/退款/订单生命周期揉在一起，部分退款无法表达 | 拆成 `orderStatus`(reserved/completed/cancelled/abandoned) + `paymentStatus` + `refundStatus`(none/partial/refunded) 三个正交字段；`registration.ts` 增 reserved 相关流转 | Hi.Events §3.3 / Pretix |
| 2 | `TicketType.stock/sold` 库存挂票种 | 无法"多票种共享名额/总量封顶/子场次独立"，且并发易超卖 | 新增 **`Quota` 模型**（capacity/used）+ `TicketTypeQuota` 多对多；可用量 = 上限 − 已售 − **未过期预留**；扣减用 `UPDATE...WHERE used+N<=cap` 条件原子更新 + DB CHECK 约束 | Pretix §3.2 / Hi.Events 超卖坑 |
| 3 | `Order` 无预留概念 | "填完表没票了"；并发超卖 | 加 `reservedUntil`；选票即建 reserved 单占库存；可售查询排除过期单 + 兜底定时 job 置 abandoned | Hi.Events §2.3 |
| 4 | `form-schema.ts` 字段较扁平 | 缺条件字段、缺购票/核销分离、缺单/人粒度 | 加 `belongsTo`(order\|attendee)、`dependsOn`+`dependsOnValues`(用 identifier)、`askDuringCheckin`、按类型校验规则；options 升级为 `{id,identifier,label}` | Pretix §3.1 / Hi.Events questions |

> 我们已有的、被验证是对的，**保留**：报名记录 per-attendee 状态机（§3.4）、报名表 schema 驱动（§2.2）、`visibility` 含 audit_reference、付费 mock 与真实解耦（ADR-003 正好对应"支付逻辑可演进"）。

### P1（接库阶段做）
5. **价格快照**：Order/OrderItem 存下单时金额快照（JSON），防改价污染历史。
6. **候补模型**：waitlist 加 `position + offerToken + offerExpiresAt`（我们 Registration 已有 waitlisted 状态，补这套放票回收机制）。
7. **PaymentProvider interface**：即便第一版 mock，也按 `prepare/confirm/refund/webhook` 分阶段抽象，mock 是它的一个实现，真微信支付替换不动上层。
8. **盈亏测算嵌入建活动流程**：`BudgetPlan` 表已在 schema；把 `budget.ts` 接成"建活动第一步"，并把结果快照存库（差异化主线）。

### P2（功能扩展）
9. CheckinList 配置维度 + 结构化二维码 payload（别学 substring 切位）+ 防重唯一索引。
10. 后台 IA 按 Pretix：Quotas 独立菜单、Exporters、团队权限按活动范围。
11. 同频社交：guest list 雪球 + 兴趣订阅 feed + 按讲师/人发现。

---

## 五、商业模式 & 定位

| 产品 | 收费 | 抽成/价 |
|---|---|---|
| Luma | 平台费 + 订阅 | 免费 5%，Plus $69/mo 降 0% |
| 活动行 | 票务抽成 + 企业增值 | ~10% 量级 |
| Partiful | 不变现 | 100% 免费 |
| Eventbrite | 买家付服务费 | 3.7%+$1.79/票 + 2.9% |
| Meetup | 双边订阅 | $16.49–35/月/群 + 会员费 |

**规律**：年轻向产品（Partiful/Luma）用"免费/极低费率"换增长，Luma 再用**订阅去抽成**做高黏主办方转化。Loopin 主打年轻人 → **定价对标 Luma（低费率 + 订阅），而非 Eventbrite/活动行高抽成**。与我们 spec 的 Monetization（单场工具费 99/199/499 + 白名单付费抽成 3-8% + 订阅）一致，且"工具费"正好对应我们的算账/AI/物料价值，比纯抽成更早能收钱。

---

## 六、优先级建议（MVP 抄什么 / 缓什么 / 别抄什么）

**MVP 就抄（高 ROI 低成本）：**
1. 表单 Question 引擎三件套（多对多 + 正交可见性 + identifier 依赖）→ 改 `form-schema.ts`
2. 订单三状态分离 + 报名 per-attendee（我们已对一半）→ 改 `registration.ts` + schema
3. Quota 配额池 + 预留式结账 + 条件原子扣减（避开 Hi.Events 超卖坑）→ 加 schema
4. 盈亏测算嵌入建活动主流程（差异化主线，地基已有）
5. C 端页面链路 + schema 动态渲染 + 自定义 tabbar + TDesign 组件
6. 微信三链路按自建后端写法预留接口

**缓一缓（接库/增长阶段）：** 价格快照、候补放票机制、PaymentProvider 真实微信支付、CheckinList 规则引擎、同频社交（雪球/订阅/按人发现）。

**别抄（对 Loopin 是过度设计）：**
- Hi.Events / Pretix 那套 **Stripe Connect 分账 + VAT/invoice/application_fee** 重支付体系——我们第一版 mock + 后续单一商户号，不做自动分账（与 spec 一致）。
- Pretix 的**插件系统**（signal/entry points）——早期不必，但支付/导出/通知**预留 hook 风格注册点**即可。
- 云开发范式（免签名支付/CloudID 解密）——我们走 FC 自建后端，用不上。

---

## 附：信息来源（均实抓）

- **Hi.Events**：github.com/HiEventsDev/hi.events（develop 分支，~108 migrations 逐文件核对）
- **Pretix**：docs.pretix.eu（questions/quotas/items/orders/checkin/payment provider/plugins 资源页）+ pretix.eu 功能页；Attendize：github.com/Attendize/Attendize（migrations 实读）
- **微信生态**：TDesignOteam/tdesign-miniprogram-starter-apply、dearancelan/TurboActivityFee（passport_service.js/pay_model.js 实读）、TCloudBase/WXAPP-REGISTER（index.js 实读）、zhengcloudtao/WeiXin_QianDao（login/actcode/verification.js 实读）
- **商业产品**：Luma(pricing/discover/help)、Partiful(help)、活动行(management/price)、Eventbrite(organizer pricing/AI blog)、Meetup(订阅/会员)、SwarmTix/Billettera 测算器、lemonvite Partiful-vs-Luma 对比

> 诚实标注：Pretix check-in `rules` 的完整 JsonLogic schema 官方标注"非稳定 API"，落地前需读 `pretix/base/services/checkin.py` 源码确认；TurboActivityFee 的 `unifiedOrder` 逐行实现未定位到确切文件，支付部分基于实读的 pay_model 字段 + 云开发标准写法，正文已标明。
