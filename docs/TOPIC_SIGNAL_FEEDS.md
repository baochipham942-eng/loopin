# 选题雷达真实 Feed 接入

这条链路用于把合作方活动 API、公开活动样本或社群信号同步进 `TopicSignal`，再参与 Studio「选题雷达」排序。

## 来源优先级

首批建议分三层接，不要把所有公开网页都当成自动抓取对象。

| 优先级 | 来源 | 适合方式 | 价值 |
| --- | --- | --- | --- |
| P0 | 活动复盘、报名画像、兴趣订阅、社群反馈、合作方反馈 | Studio 录入或内部 API | 最贴近 Loopin 自己的人群，优先参与排序 |
| P1 | 活动行、活动家、Luma、Eventbrite、Meetup、合作方活动库 | 拿 API/导出样本后配置 feed descriptor | 看同城活动密度、主题重复度、票价和人群 |
| P2 | 小红书、公众号、即刻、知乎、Product Hunt、Hacker News、GitHub Trending | 人工筛样或运营半自动录入 | 适合补热点证据，不建议作为首批定时抓取源 |

活动行可以放进 P1，但要按「活动平台/合作方 API」处理：先拿真实 URL、字段样本和鉴权方式，再用预检确认能归一化成 `TopicSignal`。如果只有公开页面，先手工录入高质量样本，比做网页抓取更稳。

首批真实来源建议这样落：

- 活动行：放进活动平台来源，用来判断同城活动密度、热门主题、票价区间、报名热度和主办方类型；需要对方提供活动列表 API、导出样本或合作方 API 凭证。
- Luma / Eventbrite / Meetup：放进海外/英文 benchmark 来源，用来看 AI、创业、产品、设计类活动的主题表达、活动形式和嘉宾结构；优先用公开 API 或合作方导出，不把页面抓取作为第一版方案。
- 孵化器、联合办公、VC、垂直社群：放进合作方活动库，用于发现本地高质量人群和潜在联合主办方；字段不齐也可以先映射 `topic/city/heat/evidence` 四个核心字段。
- 小红书、公众号、即刻、知乎、B 站、掘金：放进内容趋势来源，先由运营挑样本录入；只有稳定关键词、作者名单或数据接口后，再考虑定时 feed。

选题来源和活动引流 UTM 分开看：`TopicSignal.source` 说明这个选题从哪里被发现，`utm_source` 说明用户从哪里进入报名。比如活动行可以既是选题来源 `huodongxing_partner_api`，也可以是投放渠道 `utm_source=huodongxing`。

在外部 API 凭证到位前，可以先配置一条自举 feed：

```json
{
  "feeds": [
    {
      "url": "https://loopin.llmxy.xyz/api/events",
      "source": "loopin_production_events",
      "label": "Loopin 生产活动",
      "itemsPath": "events",
      "fieldMap": {
        "externalId": "id",
        "topic": "title",
        "city": "city",
        "heat": "minPriceCents",
        "evidence": ["venue", "organizer"],
        "opportunity": "organizer",
        "capturedAt": "startAt"
      }
    }
  ]
}
```

这条只用于把当前生产活动列表接进同步器，证明 timer/API 链路可用；活动行、Luma、Eventbrite、Meetup 或合作方库拿到真实 URL/凭证后，继续追加到 `feeds` 数组即可。

## 配置材料

需要先拿到三样东西：

1. Feed URL，例如 `https://partner.example.com/api/events`
2. 返回结构，至少确认列表路径和标题、城市、分类、人群、形式、热度、摘要字段
3. 鉴权方式，优先用独立环境变量，不把 token 写进 `TOPIC_SIGNAL_FEED_URLS`

可从 [topic-signal-feed.descriptor.example.json](./topic-signal-feed.descriptor.example.json) 复制模板。若合作方还没开放公网或需要先对字段，可以让对方给一份脱敏响应样本，按 [topic-signal-feed.sample-response.example.json](./topic-signal-feed.sample-response.example.json) 的形状本地预检。真实配置里常见字段：

```json
{
  "url": "https://partner.example.com/huodongxing/events",
  "source": "huodongxing_partner_api",
  "label": "活动行活动 API",
  "auth": { "type": "apiKey", "env": "HUODONGXING_TOPIC_API_KEY" },
  "headers": { "X-Partner": "env:HUODONGXING_TOPIC_PARTNER_ID" },
  "itemsPath": "data.events",
  "fieldMap": {
    "externalId": ["uid", "id", "eventId"],
    "topic": ["name", "title"],
    "city": ["location.city", "cityName", "city"],
    "industries": ["category", "categoryName", "tags"],
    "audiences": ["targetAudience", "audience"],
    "formats": ["eventType", "typeName", "format"],
    "heat": ["stats.popularity", "stats.registrations", "registrations", "views"],
    "evidence": ["intro", "summary", "description"],
    "opportunity": ["insight", "recommendation"],
    "capturedAt": ["updatedAt", "startAt"]
  }
}
```

## 预检顺序

1. 拿到 descriptor 和一份脱敏样本响应后，先跑本地字段预检：

```bash
pnpm topic:feed-check -- \
  --descriptor docs/topic-signal-feed.descriptor.example.json \
  --sample docs/topic-signal-feed.sample-response.example.json \
  --feed-index 0
```

2. descriptor 里引用了鉴权 env 时，先在本机补齐，再跑 strict 配置检查：

```bash
HUODONGXING_TOPIC_API_KEY=xxx HUODONGXING_TOPIC_PARTNER_ID=yyy PARTNER_TOPIC_TOKEN=zzz \
pnpm topic:feed-check -- --descriptor docs/topic-signal-feed.descriptor.example.json --strict
```

3. 在 Studio「选题雷达」打开配置状态，确认 `BACKOFFICE_ADMIN_TOKEN` 可用。
4. 把 descriptor 粘到「真实 feed 预检」，先看标准化样本，不落库。
5. 样本字段正确后，把完整 JSON 配到 FC 环境变量 `TOPIC_SIGNAL_FEED_URLS`。
6. 同时配置 descriptor 里引用的鉴权变量，例如 `HUODONGXING_TOPIC_API_KEY`、`HUODONGXING_TOPIC_PARTNER_ID`、`PARTNER_TOPIC_TOKEN`。
7. 重跑 `pnpm production:readiness -- --json`，确认 `真实选题 feed` 不再是 `configured=false`。
8. 用后台令牌触发一次 `POST /api/admin/sync-topic-signals`，或等 `topic-signal-sync-timer` 定时同步。

## 字段约定

`externalId` 决定幂等更新，优先映射合作方稳定 ID；没有时同步器会用 URL、序号和内容 hash 生成兜底 ID。

`heat` 会影响选题排序，建议传 0-100 的热度或报名/浏览量这类可比较数字。

`industries`、`audiences`、`formats` 可以是数组，也可以是用中文顿号、逗号或斜杠分隔的字符串。

`evidence` 是给运营看的证据，`opportunity` 是可转成活动的机会判断；这两个字段越具体，Studio 里越好判断该不该做。
