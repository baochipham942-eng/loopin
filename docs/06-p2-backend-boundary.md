# P2 后端接口边界（报名表构建器 / 票种与收款）

> 2026-06-09。P2 前两块(审核批量化、看板补全、现场签到)是纯前端已完成。
> 剩两块要动后端,本文盘清"前端要什么 / 现有 API 能支撑什么 / 后端缺什么",供拍板。

## 一、可配置报名表构建器

**前端要做**:字段列表编辑器(增/删/改/排序)、每字段配置(类型 × 必填 × 可见性 × 选项 × 依赖 × 校验)、
按活动类型 `recommendFields` 一键套用、实时预览 + 调 `/api/form/validate` 校验。

**现有 API 已支撑**:
- `packages/core/form-schema.ts` 模型**完整**:11 种 `FieldType`(text/phone/single_select/multi_select/
  textarea/profession_tag/city/company/wechat/number/date)、`visibility`(public/organizer_only/
  audit_reference)、`dependsOn`、`validation`、`belongsTo`、`askDuringCheckin`、`recommendFields(eventType)`。
- `GET /api/events/:id` 已返回 `formSchema`。
- `POST /api/form/validate` 已能按 schema 校验值。
- `POST /api/events` 建活动时落一份 `RegistrationForm`。

**后端缺**:
- ⛔ **更新已发布活动报名表的路由** —— `PUT /api/events/:id/form { schema: RegistrationFormSchema }`,
  写 `RegistrationForm.schema`,落库前用 core 校验 schema 合法性(字段 key 唯一、依赖引用存在等)。

**工作量**:**小**。1 个写路由 + schema 合法性校验,core 类型直接复用。
**结论**:性价比最高,建议先做。前端是大头,后端只补一个写接口。

---

## 二、票种与收款

**前端要做**:多票种管理(免费/审核/付费、早鸟价、邀请码票)、库存(绑定 Quota 配额池)、手动退款。

**现有 API 已支撑**:
- `TicketType`(name/kind=free|approval|paid/priceCents)+ `Quota`(capacity/used)+ `TicketTypeQuota` 多对多绑定。
- `POST /api/events` 建活动时创建**一个**票种(`createTicketTypeWithQuota`)。
- `GET /api/events/:id` 返回 `ticketTypes` 列表;`POST /api/quotas/:id/update` 改配额容量。
- `POST /api/orders/:id/complete`(mock 成交)、`/cancel`(回滚)、微信支付 `prepare/status/notify`。
- `Order` 已有 `refund_status`(none/partial/full)、`refundedAmountCents`、`payment_status` 字段。

**后端缺**:
1. ⛔ **票种 CRUD** —— 当前只能在建活动时建一个票种。需:
   - `POST /api/events/:id/ticket-types`(新增票种 + 绑定/新建配额)
   - `POST /api/ticket-types/:id/update`(改名/价格/kind)
   - `POST /api/ticket-types/:id/archive`(停售,不硬删以保历史订单)
2. ⛔ **手动退款路由** —— `POST /api/orders/:id/refund { amountCents }`:写 `refund_status`/
   `refundedAmountCents`,释放配额。mock 下直接置位;真实微信支付需接退款 API(可二期)。
   字段已在,逻辑/路由缺。
3. ⚠️ **早鸟价 / 邀请码** —— `TicketType` 缺列。要加 `earlyBirdPriceCents`/`earlyBirdUntil`、
   `inviteCode`,涉及 schema 迁移。**建议作为后续**,先不做。

**工作量**:**中**。票种 CRUD + 退款路由是核心且不大(复用既有 quota/order 服务);早鸟/邀请码要改
schema + Supabase 迁移,单独排。

---

## 建议节奏

| 顺序 | 内容 | 后端改动 | 性价比 |
|---|---|---|---|
| 1 | 报名表构建器 | 1 个写路由 | 高(前端为主) |
| 2 | 票种 CRUD + 手动退款 | 3-4 个路由,复用既有服务 | 中高(覆盖免费/审核/付费 + 退款) |
| 3 | 早鸟价 / 邀请码票 | schema 迁移 + 价格计算 | 中(高级项,可延后) |

确定性系统(支付/退款/库存/状态机)按 `docs/01` 必须后端权威,前端只做配置和触发,不在前端算钱。
