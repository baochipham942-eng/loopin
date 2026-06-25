import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { listTopicSignals, listTopicSignalsFromDb, suggestTopics } from "../src/services/topic-radar.js";
import { syncTopicSignalsFromFeeds, topicSignalFeedSources, topicSignalFeedStatus } from "../src/services/topic-signal-sync.js";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";

describe("选题雷达", () => {
  beforeEach(async () => {
    await prisma.topicSignal.deleteMany();
  });

  it("按行业/城市/人群生成可带入盈亏测算的选题", () => {
    const suggestions = suggestTopics({
      industry: "AI",
      city: "上海",
      audience: "产品经理",
      format: "工作坊",
      limit: 5,
    });

    expect(suggestions).toHaveLength(5);
    expect(suggestions[0].title).toContain("AI");
    expect(suggestions[0].city).toBe("上海");
    expect(suggestions[0].budgetPreset.ticketPriceCents).toBeGreaterThan(0);
    expect(suggestions[0].budgetPreset.targetAttendees).toBeGreaterThan(0);
    expect(suggestions[0].budgetResult.breakEvenAttendees).not.toBeNull();
    expect(suggestions[0].eventPageSeed.audience).toContain("产品经理");
    expect(suggestions[0].source).toBe("manual_seed_v1+market_signal_v1");
    expect(suggestions[0].confidence).toBeGreaterThan(60);
    expect(suggestions[0].marketSignals.length).toBeGreaterThan(0);
    expect(suggestions[0].sourceBreakdown.map((source) => source.source)).toContain("manual_seed_v1");
  });

  it("外部信号会参与排序并进入来源拆解", () => {
    const suggestions = suggestTopics({
      industry: "健康",
      city: "上海",
      audience: "HR",
      format: "圆桌",
      limit: 1,
      externalSignals: [
        {
          id: "wellness-hr-roundtable",
          source: "partner_feed",
          label: "合作方活动源",
          topic: "AI 产品人深夜局",
          city: "上海",
          industries: ["AI", "产品"],
          audiences: ["HR", "产品经理"],
          formats: ["圆桌"],
          heat: 99,
          evidence: "合作方近期 HR 和产品经理报名集中在 AI 转型圆桌。",
          opportunity: "适合做跨职能闭门局。",
          updatedAt: "2026-06-07",
        },
      ],
    });

    expect(suggestions[0].id).toBe("ai-product-night");
    expect(suggestions[0].marketSignals[0]).toMatchObject({ id: "wellness-hr-roundtable", source: "partner_feed" });
    expect(suggestions[0].sourceBreakdown.find((source) => source.source === "partner_feed")?.hits).toBe(1);
  });

  it("返回可筛选的市场信号目录", () => {
    const catalog = listTopicSignals({ industry: "AI", city: "上海", audience: "产品经理", limit: 4 });

    expect(catalog.signals).toHaveLength(4);
    expect(catalog.signals[0].matchScore).toBeGreaterThan(0);
    expect(catalog.signals[0].matchedFields.length).toBeGreaterThan(0);
    expect(catalog.sources.length).toBeGreaterThan(0);
    expect(catalog.sources[0].topEvidence.length).toBeGreaterThan(0);
    expect(catalog.facets.industries).toContain("AI");
    expect(catalog.facets.sources).toContain("public_event_sample");
    expect(catalog.updatedAt).toBe("2026-06-07");
  });

  it("API 返回选题建议列表", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/topic-radar/suggestions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ industry: "出海", city: "深圳", limit: 3 }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.suggestions).toHaveLength(3);
      expect(body.suggestions[0].city).toBe("深圳");
      expect(body.suggestions[0].potentialGuests.length).toBeGreaterThan(0);
      expect(body.suggestions[0].sourceBreakdown.length).toBeGreaterThan(1);
      expect(body.suggestions[0].marketSignals.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("API 返回市场信号目录", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/topic-radar/signals?industry=AI&city=%E4%B8%8A%E6%B5%B7&limit=3",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.signals).toHaveLength(3);
      expect(body.signals[0].matchScore).toBeGreaterThan(0);
      expect(body.sources.length).toBeGreaterThan(0);
      expect(body.facets.cities).toContain("上海");
    } finally {
      await app.close();
    }
  });

  it("API 可写入实时信号并参与选题排序", async () => {
    const app = await buildApp();
    try {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/topic-radar/signals",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          id: "operator-ai-workshop",
          source: "studio_live_feed",
          label: "运营录入",
          topic: "AI Agent 工作流实战局",
          city: "上海",
          industries: ["AI", "产品"],
          audiences: ["产品经理"],
          formats: ["工作坊"],
          heat: 97,
          evidence: "运营从社群报名意向收集到 AI Agent 工作流需求升温。",
          opportunity: "适合尽快做小班实战局。",
        }),
      });

      expect(createRes.statusCode).toBe(200);
      expect(createRes.json().signal).toMatchObject({
        id: "operator-ai-workshop",
        source: "studio_live_feed",
        heat: 97,
      });

      const catalogRes = await app.inject({
        method: "GET",
        url: "/api/topic-radar/signals?source=studio_live_feed&limit=1",
      });
      expect(catalogRes.statusCode).toBe(200);
      expect(catalogRes.json().signals[0]).toMatchObject({
        id: "operator-ai-workshop",
        source: "studio_live_feed",
        matchedFields: ["热度"],
      });

      const suggestionsRes = await app.inject({
        method: "POST",
        url: "/api/topic-radar/suggestions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ industry: "AI", city: "上海", audience: "产品经理", format: "工作坊", limit: 3 }),
      });
      expect(suggestionsRes.statusCode).toBe(200);
      const body = suggestionsRes.json();
      expect(
        body.suggestions.some((suggestion: { sourceBreakdown: { source: string }[] }) =>
          suggestion.sourceBreakdown.some((source) => source.source === "studio_live_feed")
        )
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("可从外部 JSON feed 同步 TopicSignal 并幂等更新", async () => {
    const fetcher = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        signals: [
          {
            id: "partner-ai-agent-signal",
            source: "partner_topic_api",
            label: "合作方 API",
            topic: "AI Agent 工作流实战局",
            city: "上海",
            industry: "AI、产品",
            audience: "产品经理",
            format: "工作坊",
            heat: "93",
            evidence: "合作方报名意向 API 显示 AI Agent 工作流需求上升。",
            opportunity: "适合接成连续工作坊。",
          },
        ],
      }),
    });

    const first = await syncTopicSignalsFromFeeds(prisma, {
      urls: ["https://partner.example.com/topic-signals.json"],
      fetcher,
    });
    const second = await syncTopicSignalsFromFeeds(prisma, {
      urls: ["https://partner.example.com/topic-signals.json"],
      fetcher,
    });

    expect(first).toMatchObject({ configured: true, feeds: 1, synced: 1, failed: 0 });
    expect(second).toMatchObject({ configured: true, feeds: 1, synced: 1, failed: 0 });
    await expect(prisma.topicSignal.count({ where: { source: "partner_topic_api" } })).resolves.toBe(1);

    const catalog = await listTopicSignalsFromDb(prisma, { source: "partner_topic_api", limit: 1 });
    expect(catalog.signals[0]).toMatchObject({
      id: "partner-ai-agent-signal",
      source: "partner_topic_api",
      matchScore: 93,
    });
  });

  it("真实 API feed 描述符支持鉴权、嵌套列表和字段映射", async () => {
    const oldToken = process.env.PARTNER_TOPIC_TOKEN;
    const oldPartner = process.env.PARTNER_TOPIC_NAME;
    process.env.PARTNER_TOPIC_TOKEN = "topic_secret";
    process.env.PARTNER_TOPIC_NAME = "partner-luma";

    try {
      const feeds = topicSignalFeedSources(JSON.stringify({
        feeds: [
          {
            url: "https://partner.example.com/api/events",
            source: "partner_luma_api",
            label: "合作方活动 API",
            auth: { type: "bearer", env: "PARTNER_TOPIC_TOKEN" },
            headers: { "X-Partner": "env:PARTNER_TOPIC_NAME" },
            itemsPath: "data.events",
            fieldMap: {
              externalId: "uid",
              topic: "name",
              city: "location.city",
              industries: "category",
              audiences: "targetAudience",
              formats: "eventType",
              heat: "stats.popularity",
              evidence: "intro",
              opportunity: "insight",
              capturedAt: "updatedAt",
            },
          },
        ],
      }));
      const fetcher = async (url: string, init?: { headers?: Record<string, string>; method?: string }) => {
        expect(url).toBe("https://partner.example.com/api/events");
        expect(init?.method).toBe("GET");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer topic_secret",
          "X-Partner": "partner-luma",
        });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: {
              events: [
                {
                  uid: "luma-ai-founder-salon",
                  name: "AI 创始人同频沙龙",
                  location: { city: "上海" },
                  category: ["AI", "创业"],
                  targetAudience: "创始人",
                  eventType: "沙龙",
                  stats: { popularity: 88 },
                  intro: "合作方活动 API 显示 AI 创始人小范围交流需求升温。",
                  insight: "适合做成闭门同频局。",
                  updatedAt: "2026-06-08",
                },
              ],
            },
          }),
        };
      };

      const result = await syncTopicSignalsFromFeeds(prisma, { feeds, fetcher });
      expect(result).toMatchObject({ configured: true, feeds: 1, synced: 1, failed: 0 });

      const catalog = await listTopicSignalsFromDb(prisma, { source: "partner_luma_api", limit: 1 });
      expect(catalog.signals[0]).toMatchObject({
        id: "luma-ai-founder-salon",
        source: "partner_luma_api",
        label: "合作方活动 API",
        topic: "AI 创始人同频沙龙",
        city: "上海",
        industries: expect.arrayContaining(["AI", "创业"]),
        audiences: ["创始人"],
        formats: ["沙龙"],
        matchScore: 88,
      });
    } finally {
      if (oldToken === undefined) delete process.env.PARTNER_TOPIC_TOKEN;
      else process.env.PARTNER_TOPIC_TOKEN = oldToken;
      if (oldPartner === undefined) delete process.env.PARTNER_TOPIC_NAME;
      else process.env.PARTNER_TOPIC_NAME = oldPartner;
    }
  });

  it("feed 配置状态会暴露缺失 env 且不泄露密钥", () => {
    const oldToken = process.env.PARTNER_TOPIC_TOKEN;
    const oldHeader = process.env.PARTNER_TOPIC_NAME;
    delete process.env.PARTNER_TOPIC_TOKEN;
    process.env.PARTNER_TOPIC_NAME = "partner-luma";

    try {
      const status = topicSignalFeedStatus(JSON.stringify({
        feeds: [
          {
            url: "https://partner.example.com/api/events?token=secret-token",
            source: "partner_luma_api",
            label: "合作方活动 API",
            auth: { type: "bearer", env: "PARTNER_TOPIC_TOKEN" },
            headers: { "X-Partner": "env:PARTNER_TOPIC_NAME" },
            itemsPath: "data.events",
            fieldMap: { topic: "name", city: "location.city" },
          },
        ],
      }));

      expect(status).toMatchObject({
        configured: true,
        feeds: 1,
        valid: 1,
        invalid: 0,
        authRequired: 1,
        authReady: 0,
        missingAuthEnv: ["PARTNER_TOPIC_TOKEN"],
      });
      expect(status.feedStatuses[0]).toMatchObject({
        url: "https://partner.example.com/api/events?token=***",
        host: "partner.example.com",
        source: "partner_luma_api",
        method: "GET",
        auth: {
          required: true,
          ready: false,
          env: "PARTNER_TOPIC_TOKEN",
          envPresent: false,
          inlineToken: false,
        },
        headers: {
          total: 1,
          envRefs: ["PARTNER_TOPIC_NAME"],
          missingEnvRefs: [],
        },
        itemsPath: "data.events",
        fieldMap: ["topic", "city"],
      });
      expect(JSON.stringify(status)).not.toContain("secret-token");
      expect(JSON.stringify(status)).not.toContain("partner-luma");
    } finally {
      if (oldToken === undefined) delete process.env.PARTNER_TOPIC_TOKEN;
      else process.env.PARTNER_TOPIC_TOKEN = oldToken;
      if (oldHeader === undefined) delete process.env.PARTNER_TOPIC_NAME;
      else process.env.PARTNER_TOPIC_NAME = oldHeader;
    }
  });

  it("文档里的真实 feed descriptor 示例可直接解析成配置", () => {
    const oldHuodongxingKey = process.env.HUODONGXING_TOPIC_API_KEY;
    const oldHuodongxingPartner = process.env.HUODONGXING_TOPIC_PARTNER_ID;
    const oldPartnerToken = process.env.PARTNER_TOPIC_TOKEN;
    process.env.HUODONGXING_TOPIC_API_KEY = "topic_secret";
    process.env.HUODONGXING_TOPIC_PARTNER_ID = "partner-001";
    process.env.PARTNER_TOPIC_TOKEN = "partner_secret";

    try {
      const raw = readFileSync(new URL("../../../docs/topic-signal-feed.descriptor.example.json", import.meta.url), "utf8");
      const feeds = topicSignalFeedSources(raw);
      const status = topicSignalFeedStatus(raw);

      expect(feeds).toHaveLength(3);
      expect(feeds[0]).toMatchObject({
        url: "https://partner.example.com/huodongxing/events",
        source: "huodongxing_partner_api",
        auth: { type: "apiKey", env: "HUODONGXING_TOPIC_API_KEY" },
        itemsPath: "data.events",
        fieldMap: {
          externalId: ["uid", "id", "eventId"],
          topic: ["name", "title"],
          heat: ["stats.popularity", "stats.registrations", "registrations", "views"],
        },
      });
      expect(status).toMatchObject({
        configured: true,
        feeds: 3,
        valid: 3,
        invalid: 0,
        authRequired: 2,
        authReady: 2,
        missingAuthEnv: [],
      });
      expect(JSON.stringify(status)).not.toContain("topic_secret");
      expect(JSON.stringify(status)).not.toContain("partner_secret");
      expect(JSON.stringify(status)).not.toContain("partner-001");
    } finally {
      if (oldHuodongxingKey === undefined) delete process.env.HUODONGXING_TOPIC_API_KEY;
      else process.env.HUODONGXING_TOPIC_API_KEY = oldHuodongxingKey;
      if (oldHuodongxingPartner === undefined) delete process.env.HUODONGXING_TOPIC_PARTNER_ID;
      else process.env.HUODONGXING_TOPIC_PARTNER_ID = oldHuodongxingPartner;
      if (oldPartnerToken === undefined) delete process.env.PARTNER_TOPIC_TOKEN;
      else process.env.PARTNER_TOPIC_TOKEN = oldPartnerToken;
    }
  });

  it("后台可读取当前 feed 配置状态", async () => {
    const oldFeeds = process.env.TOPIC_SIGNAL_FEED_URLS;
    const oldToken = process.env.PARTNER_TOPIC_TOKEN;
    const oldBackoffice = process.env.BACKOFFICE_ADMIN_TOKEN;
    process.env.TOPIC_SIGNAL_FEED_URLS = JSON.stringify({
      feeds: [
        {
          url: "https://partner.example.com/api/events?api_key=secret-token",
          source: "partner_luma_api",
          label: "合作方活动 API",
          auth: { type: "bearer", env: "PARTNER_TOPIC_TOKEN" },
          fieldMap: { topic: "name" },
        },
      ],
    });
    process.env.PARTNER_TOPIC_TOKEN = "topic_secret";
    process.env.BACKOFFICE_ADMIN_TOKEN = "topic-status-token";
    const app = await buildApp();

    try {
      const unauthorized = await app.inject({ method: "GET", url: "/api/admin/topic-signal-feeds/status" });
      expect(unauthorized.statusCode).toBe(401);

      const res = await app.inject({
        method: "GET",
        url: "/api/admin/topic-signal-feeds/status",
        headers: { "x-loopin-admin-token": "topic-status-token" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        configured: true,
        envVar: "TOPIC_SIGNAL_FEED_URLS",
        feeds: 1,
        valid: 1,
        invalid: 0,
        authRequired: 1,
        authReady: 1,
        missingAuthEnv: [],
      });
      expect(res.json().feedStatuses[0]).toMatchObject({
        url: "https://partner.example.com/api/events?api_key=***",
        auth: { ready: true, envPresent: true },
      });
      expect(res.body).not.toContain("topic_secret");
      expect(res.body).not.toContain("secret-token");
    } finally {
      if (oldFeeds === undefined) delete process.env.TOPIC_SIGNAL_FEED_URLS;
      else process.env.TOPIC_SIGNAL_FEED_URLS = oldFeeds;
      if (oldToken === undefined) delete process.env.PARTNER_TOPIC_TOKEN;
      else process.env.PARTNER_TOPIC_TOKEN = oldToken;
      if (oldBackoffice === undefined) delete process.env.BACKOFFICE_ADMIN_TOKEN;
      else process.env.BACKOFFICE_ADMIN_TOKEN = oldBackoffice;
      await app.close();
    }
  });

  it("后台可预检真实 API feed 描述符且不落库", async () => {
    const oldToken = process.env.PARTNER_TOPIC_TOKEN;
    const oldBackoffice = process.env.BACKOFFICE_ADMIN_TOKEN;
    const oldFetch = globalThis.fetch;
    process.env.PARTNER_TOPIC_TOKEN = "topic_secret";
    process.env.BACKOFFICE_ADMIN_TOKEN = "topic-preview-token";
    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toBe("https://partner.example.com/api/events");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer topic_secret" });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: {
            events: [
              {
                uid: "preview-ai-builder-night",
                name: "AI Builder 闭门夜谈",
                location: { city: "上海" },
                category: ["AI", "开发者"],
                targetAudience: "独立开发者",
                eventType: "沙龙",
                stats: { popularity: 91 },
                intro: "合作方 API 显示开发者对 AI Builder 活动兴趣升高。",
                insight: "适合先做小范围闭门夜谈。",
                updatedAt: "2026-06-08",
              },
            ],
          },
        }),
      } as Response;
    }) as typeof fetch;

    const app = await buildApp();
    const payload = {
      raw: JSON.stringify({
        feeds: [
          {
            url: "https://partner.example.com/api/events",
            source: "partner_preview_api",
            label: "合作方预检 API",
            auth: { type: "bearer", env: "PARTNER_TOPIC_TOKEN" },
            itemsPath: "data.events",
            fieldMap: {
              externalId: "uid",
              topic: "name",
              city: "location.city",
              industries: "category",
              audiences: "targetAudience",
              formats: "eventType",
              heat: "stats.popularity",
              evidence: "intro",
              opportunity: "insight",
              capturedAt: "updatedAt",
            },
          },
        ],
      }),
      sampleSize: 1,
    };

    try {
      const unauthorized = await app.inject({
        method: "POST",
        url: "/api/admin/topic-signal-feeds/preview",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(payload),
      });
      expect(unauthorized.statusCode).toBe(401);

      const res = await app.inject({
        method: "POST",
        url: "/api/admin/topic-signal-feeds/preview",
        headers: { "content-type": "application/json", "x-loopin-admin-token": "topic-preview-token" },
        payload: JSON.stringify(payload),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        configured: true,
        feeds: 1,
        ok: 1,
        failed: 0,
        previews: [
          {
            url: "https://partner.example.com/api/events",
            source: "partner_preview_api",
            label: "合作方预检 API",
            ok: true,
            count: 1,
            sample: [
              {
                id: "preview-ai-builder-night",
                topic: "AI Builder 闭门夜谈",
                city: "上海",
                heat: 91,
              },
            ],
          },
        ],
      });
      await expect(prisma.topicSignal.count({ where: { source: "partner_preview_api" } })).resolves.toBe(0);
    } finally {
      if (oldToken === undefined) delete process.env.PARTNER_TOPIC_TOKEN;
      else process.env.PARTNER_TOPIC_TOKEN = oldToken;
      if (oldBackoffice === undefined) delete process.env.BACKOFFICE_ADMIN_TOKEN;
      else process.env.BACKOFFICE_ADMIN_TOKEN = oldBackoffice;
      globalThis.fetch = oldFetch;
      await app.close();
    }
  });
});
