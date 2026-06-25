import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../src/app.js";

describe("FC custom runtime routes", () => {
  it("/initialize returns ready status", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: "/initialize" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it("/invoke accepts timer payload", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/invoke",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ task: "health" }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, task: "health" });
    } finally {
      await app.close();
    }
  });

  it("/invoke can run topic signal sync without configured feeds", async () => {
    const oldFeeds = process.env.TOPIC_SIGNAL_FEED_URLS;
    delete process.env.TOPIC_SIGNAL_FEED_URLS;
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/invoke",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ task: "syncTopicSignals" }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        ok: true,
        task: "syncTopicSignals",
        configured: false,
        feeds: 0,
        synced: 0,
        failed: 0,
        errors: [],
      });
    } finally {
      if (oldFeeds === undefined) delete process.env.TOPIC_SIGNAL_FEED_URLS;
      else process.env.TOPIC_SIGNAL_FEED_URLS = oldFeeds;
      await app.close();
    }
  });

  it("/api/admin/sync-topic-signals uses configured feed list", async () => {
    const oldFeeds = process.env.TOPIC_SIGNAL_FEED_URLS;
    process.env.TOPIC_SIGNAL_FEED_URLS = "";
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "POST", url: "/api/admin/sync-topic-signals" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ configured: false, feeds: 0, synced: 0 });
    } finally {
      if (oldFeeds === undefined) delete process.env.TOPIC_SIGNAL_FEED_URLS;
      else process.env.TOPIC_SIGNAL_FEED_URLS = oldFeeds;
      await app.close();
    }
  });

  it("/api/notifications/config reflects subscribe template env", async () => {
    const oldAppId = process.env.WX_APPID;
    const oldAppSecret = process.env.WX_APPSECRET;
    const oldTemplate = process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
    process.env.WX_APPID = "wx_test_app";
    process.env.WX_APPSECRET = "test_secret";
    process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID = "tmpl_test_event_reminder";
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/notifications/config" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        enabled: true,
        configured: {
          wechat: true,
          eventReminder: true,
        },
        templates: { eventReminder: "tmpl_test_event_reminder" },
      });
    } finally {
      if (oldAppId === undefined) delete process.env.WX_APPID;
      else process.env.WX_APPID = oldAppId;
      if (oldAppSecret === undefined) delete process.env.WX_APPSECRET;
      else process.env.WX_APPSECRET = oldAppSecret;
      if (oldTemplate === undefined) delete process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
      else process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID = oldTemplate;
      await app.close();
    }
  });

  it("exposes backoffice quotas, exporters and organizer team members", async () => {
    const oldBackofficeToken = process.env.BACKOFFICE_ADMIN_TOKEN;
    const oldAppId = process.env.WX_APPID;
    const oldAppSecret = process.env.WX_APPSECRET;
    const oldTemplate = process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
    process.env.BACKOFFICE_ADMIN_TOKEN = "test-backoffice-token";
    process.env.WX_APPID = "wx_test_app";
    process.env.WX_APPSECRET = "test_secret";
    process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID = "tmpl_test_event_reminder";
    const app = await buildApp();
    const adminHeaders = { "x-loopin-admin-token": "test-backoffice-token" };
    const adminJsonHeaders = { "content-type": "application/json", ...adminHeaders };
    try {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/events",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          title: `后台 IA 测试活动 ${Date.now()}`,
          city: "上海",
          startAt: "2026-06-14T19:00:00+08:00",
          venue: "Loopin Space",
          ticket: { name: "标准票", kind: "paid", priceCents: 19900, capacity: 1 },
          formSchema: {
            fields: [
              { key: "name", label: "姓名", type: "text", required: true, visibility: "organizer_only" },
              { key: "phone", label: "手机号", type: "phone", required: true, visibility: "organizer_only" },
              {
                key: "profession",
                label: "职业标签",
                type: "profession_tag",
                required: false,
                visibility: "public",
                options: [
                  { value: "pm", label: "产品经理" },
                  { value: "founder", label: "创始人" },
                ],
              },
              { key: "company", label: "公司/项目", type: "company", required: false, visibility: "public" },
              {
                key: "source",
                label: "从哪里知道的",
                type: "single_select",
                required: false,
                visibility: "organizer_only",
                options: [{ value: "wechat_group", label: "微信群" }],
              },
              { key: "note", label: "备注", type: "textarea", required: false, visibility: "organizer_only" },
            ],
          },
        }),
      });
      expect(createRes.statusCode).toBe(200);
      const created = createRes.json() as { eventId: string; ticketTypeId: string; quotaId: string; organizerId: string };

      const eventListRes = await app.inject({ method: "GET", url: "/api/events" });
      expect(eventListRes.statusCode).toBe(200);
      expect(eventListRes.json().events.find((event: { id: string; organizerId?: string }) => event.id === created.eventId)?.organizerId).toBe(created.organizerId);

      const unauthorizedQuotaRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/quotas` });
      expect(unauthorizedQuotaRes.statusCode).toBe(401);

      const quotaRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/quotas`, headers: adminHeaders });
      expect(quotaRes.statusCode).toBe(200);
      expect(quotaRes.json().quotas[0]).toMatchObject({ id: created.quotaId, capacity: 1, used: 0, available: 1 });

      const quotaUpdateRes = await app.inject({
        method: "POST",
        url: `/api/quotas/${created.quotaId}/update`,
        headers: adminJsonHeaders,
        payload: JSON.stringify({ name: "总名额", capacity: 2 }),
      });
      expect(quotaUpdateRes.statusCode).toBe(200);
      expect(quotaUpdateRes.json().quota).toMatchObject({ id: created.quotaId, name: "总名额", capacity: 2, available: 2 });

      const firstRegRes = await app.inject({
        method: "POST",
        url: "/api/register",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          eventId: created.eventId,
          ticketTypeId: created.ticketTypeId,
          userId: "backoffice_export_user_1",
          formValues: {
            name: "林晨",
            phone: "13800138001",
            profession: ["pm"],
            company: "增长品牌实验室",
            source: "wechat_group",
            note: "可以分享真实案例",
          },
        }),
      });
      expect(firstRegRes.statusCode).toBe(200);
      const firstReg = firstRegRes.json() as { registrationId: string; orderId: string };

      const completeRes = await app.inject({
        method: "POST",
        url: `/api/orders/${firstReg.orderId}/complete`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({}),
      });
      expect(completeRes.statusCode).toBe(200);

      const shrinkQuotaRes = await app.inject({
        method: "POST",
        url: `/api/quotas/${created.quotaId}/update`,
        headers: adminJsonHeaders,
        payload: JSON.stringify({ capacity: 1 }),
      });
      expect(shrinkQuotaRes.statusCode).toBe(200);

      const waitlistRes = await app.inject({
        method: "POST",
        url: "/api/register",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          eventId: created.eventId,
          ticketTypeId: created.ticketTypeId,
          userId: "backoffice_export_user_2",
          formValues: { name: "候补用户", phone: "13800138002", profession: ["founder"] },
        }),
      });
      expect(waitlistRes.statusCode).toBe(200);
      expect(waitlistRes.json()).toMatchObject({ status: "waitlisted", waitlist: { position: 1 } });

      const unauthorizedRegistrationsRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/registrations` });
      expect(unauthorizedRegistrationsRes.statusCode).toBe(401);

      const registrationsRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/registrations`, headers: adminHeaders });
      expect(registrationsRes.statusCode).toBe(200);
      expect(registrationsRes.json().registrations.some((reg: { id: string }) => reg.id === firstReg.registrationId)).toBe(true);

      const approvalCreateRes = await app.inject({
        method: "POST",
        url: "/api/events",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          title: `后台审核测试活动 ${Date.now()}`,
          city: "上海",
          startAt: "2026-06-16T19:00:00+08:00",
          ticket: { name: "审核票", kind: "approval", priceCents: 0, capacity: 3 },
        }),
      });
      expect(approvalCreateRes.statusCode).toBe(200);
      const approvalCreated = approvalCreateRes.json() as { eventId: string; ticketTypeId: string };

      const approvalRegRes = await app.inject({
        method: "POST",
        url: "/api/register",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          eventId: approvalCreated.eventId,
          ticketTypeId: approvalCreated.ticketTypeId,
          userId: "backoffice_approval_user",
          formValues: { name: "审核用户", phone: "13800138004" },
        }),
      });
      expect(approvalRegRes.statusCode).toBe(200);
      expect(approvalRegRes.json()).toMatchObject({ status: "submitted", requiresApproval: true });
      const approvalReg = approvalRegRes.json() as { registrationId: string };

      const unauthorizedApproveRes = await app.inject({ method: "POST", url: `/api/registrations/${approvalReg.registrationId}/approve` });
      expect(unauthorizedApproveRes.statusCode).toBe(401);

      const unauthorizedMissingRegistrationRes = await app.inject({ method: "POST", url: "/api/registrations/reg_missing_for_auth/approve" });
      expect(unauthorizedMissingRegistrationRes.statusCode).toBe(401);

      const approveRes = await app.inject({ method: "POST", url: `/api/registrations/${approvalReg.registrationId}/approve`, headers: adminHeaders });
      expect(approveRes.statusCode).toBe(200);
      expect(approveRes.json().registration).toMatchObject({ id: approvalReg.registrationId, status: "approved" });

      const unauthorizedCheckinRes = await app.inject({ method: "POST", url: `/api/registrations/${approvalReg.registrationId}/checkin` });
      expect(unauthorizedCheckinRes.statusCode).toBe(401);

      const unauthorizedScanRes = await app.inject({
        method: "POST",
        url: "/api/checkin/scan",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ payload: "bad-payload" }),
      });
      expect(unauthorizedScanRes.statusCode).toBe(401);

      const checkinRes = await app.inject({ method: "POST", url: `/api/registrations/${approvalReg.registrationId}/checkin`, headers: adminHeaders });
      expect(checkinRes.statusCode).toBe(200);
      expect(checkinRes.json().registration).toMatchObject({ id: approvalReg.registrationId, status: "checked_in" });

      const feedbackRes = await app.inject({
        method: "POST",
        url: `/api/events/${created.eventId}/feedback`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          userId: "backoffice_export_user_1",
          registrationId: firstReg.registrationId,
          rating: 5,
          valuable: "真实案例最有价值",
          nextTopic: "AI Agent 商业化",
          roleInterest: "愿意作为嘉宾",
        }),
      });
      expect(feedbackRes.statusCode).toBe(200);

      const resourceRes = await app.inject({
        method: "POST",
        url: `/api/events/${created.eventId}/resources`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          title: "活动回放",
          type: "recording",
          url: "https://loopin.llmxy.xyz/demo/export-replay",
          description: "导出器测试资料",
        }),
      });
      expect(resourceRes.statusCode).toBe(200);

      const socialProfileRes = await app.inject({
        method: "POST",
        url: `/api/events/${created.eventId}/social-profiles`,
        headers: adminJsonHeaders,
        payload: JSON.stringify({
          name: "分享嘉宾",
          kind: "speaker",
          headline: "AI Agent 商业化实践者",
          bio: "长期实践 Agent 产品落地。",
          tags: ["AI Agent", "商业化", "产品经理"],
        }),
      });
      expect(socialProfileRes.statusCode).toBe(200);
      expect(socialProfileRes.json().profile).toMatchObject({ name: "分享嘉宾", kind: "speaker" });

      const socialRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/social` });
      expect(socialRes.statusCode).toBe(200);
      expect(socialRes.json().featured[0]).toMatchObject({ name: "分享嘉宾", headline: "AI Agent 商业化实践者" });
      expect(socialRes.json().interestSeed).toMatchObject({ city: "上海" });

      const subscribeRes = await app.inject({
        method: "POST",
        url: "/api/users/social_feed_user/interest-subscriptions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ topic: "AI Agent", city: "上海", sourceEventId: created.eventId }),
      });
      expect(subscribeRes.statusCode).toBe(200);
      expect(subscribeRes.json().subscription).toMatchObject({ topic: "AI Agent", city: "上海", status: "active" });

      const feedRes = await app.inject({ method: "GET", url: "/api/users/social_feed_user/interest-feed" });
      expect(feedRes.statusCode).toBe(200);
      expect(feedRes.json().subscriptions).toHaveLength(1);
      expect(feedRes.json().events.some((event: { id: string }) => event.id === created.eventId)).toBe(true);
      expect(feedRes.json().people.some((person: { name: string }) => person.name === "分享嘉宾")).toBe(true);

      const peopleRes = await app.inject({ method: "GET", url: "/api/discovery/people?tag=AI%20Agent&city=%E4%B8%8A%E6%B5%B7" });
      expect(peopleRes.statusCode).toBe(200);
      expect(peopleRes.json().people.some((person: { name: string }) => person.name === "分享嘉宾")).toBe(true);

      const diagnosticPhoneRes = await app.inject({
        method: "POST",
        url: "/api/auth/wechat/phone",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ userId: "wechat_diagnostic_user", phone: "13800138003" }),
      });
      expect(diagnosticPhoneRes.statusCode).toBe(200);

      const diagnosticLoginRes = await app.inject({
        method: "POST",
        url: "/api/auth/wechat/login",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ localUserId: "wechat_diagnostic_user", devOpenid: "openid_diagnostic_user" }),
      });
      expect(diagnosticLoginRes.statusCode).toBe(200);
      expect(diagnosticLoginRes.json()).toMatchObject({ userId: "wechat_diagnostic_user", openidBound: true });

      const diagnosticSubscriptionRes = await app.inject({
        method: "POST",
        url: "/api/notifications/event-reminder/subscriptions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ userId: "wechat_diagnostic_user", eventId: created.eventId, accepted: true }),
      });
      expect(diagnosticSubscriptionRes.statusCode).toBe(200);
      expect(diagnosticSubscriptionRes.json().subscription).toMatchObject({ eventId: created.eventId, status: "accepted" });

      const unauthorizedDiagnosticRes = await app.inject({
        method: "GET",
        url: `/api/events/${created.eventId}/notification-diagnostics?userId=wechat_diagnostic_user`,
      });
      expect(unauthorizedDiagnosticRes.statusCode).toBe(401);

      const diagnosticRes = await app.inject({
        method: "GET",
        url: `/api/events/${created.eventId}/notification-diagnostics?userId=wechat_diagnostic_user`,
        headers: adminHeaders,
      });
      expect(diagnosticRes.statusCode).toBe(200);
      expect(diagnosticRes.json()).toMatchObject({
        user: {
          userId: "wechat_diagnostic_user",
          openidBound: true,
          phoneBound: true,
          maskedPhone: "138****8003",
        },
        subscription: {
          userId: "wechat_diagnostic_user",
          eventId: created.eventId,
          status: "accepted",
        },
        readiness: {
          canSend: true,
          missing: [],
          alreadySent: false,
        },
      });
      expect(diagnosticRes.json().recentSubscriptions[0].user).toMatchObject({ userId: "wechat_diagnostic_user", openidBound: true });

      const unauthorizedTestReminderRes = await app.inject({
        method: "POST",
        url: `/api/events/${created.eventId}/notifications/test-reminder`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ userId: "wechat_diagnostic_user" }),
      });
      expect(unauthorizedTestReminderRes.statusCode).toBe(401);

      const configuredSecret = process.env.WX_APPSECRET;
      delete process.env.WX_APPSECRET;
      try {
        const testReminderRes = await app.inject({
          method: "POST",
          url: `/api/events/${created.eventId}/notifications/test-reminder`,
          headers: adminJsonHeaders,
          payload: JSON.stringify({ userId: "wechat_diagnostic_user" }),
        });
        expect(testReminderRes.statusCode).toBe(200);
        expect(testReminderRes.json()).toMatchObject({
          task: "sendEventReminderTest",
          configured: false,
          userId: "wechat_diagnostic_user",
          subscriptionId: diagnosticSubscriptionRes.json().subscription.id,
          sent: 0,
          skipped: 1,
          failed: 0,
          readiness: { canSend: false, missing: ["wechat"], alreadySent: false },
        });
      } finally {
        if (configuredSecret === undefined) delete process.env.WX_APPSECRET;
        else process.env.WX_APPSECRET = configuredSecret;
      }

      const exportersRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/exports`, headers: adminHeaders });
      expect(exportersRes.statusCode).toBe(200);
      expect(exportersRes.json().exporters.map((exporter: { key: string }) => exporter.key)).toEqual([
        "registrations_csv",
        "registrations_excel",
        "registrations_pdf",
        "waitlist_csv",
        "feedback_csv",
        "resources_csv",
      ]);

      const csvRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/exports/registrations.csv`, headers: adminHeaders });
      expect(csvRes.statusCode).toBe(200);
      expect(csvRes.headers["content-type"]).toContain("text/csv");
      expect(csvRes.body).toContain("registrationId");
      expect(csvRes.body).toContain("公司/项目(company)");
      expect(csvRes.body).toContain("从哪里知道的(source)");
      expect(csvRes.body).toContain("林晨");
      expect(csvRes.body).toContain("产品经理");
      expect(csvRes.body).toContain("增长品牌实验室");
      expect(csvRes.body).toContain("微信群");

      const excelRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/exports/registrations.xls`, headers: adminHeaders });
      expect(excelRes.statusCode).toBe(200);
      expect(excelRes.headers["content-type"]).toContain("application/vnd.ms-excel");
      expect(excelRes.body).toContain("<Workbook");
      expect(excelRes.body).toContain("公司/项目(company)");
      expect(excelRes.body).toContain("产品经理");
      expect(excelRes.body).toContain("微信群");

      const pdfRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/exports/registrations.pdf`, headers: adminHeaders });
      expect(pdfRes.statusCode).toBe(200);
      expect(pdfRes.headers["content-type"]).toContain("application/pdf");
      expect(pdfRes.headers["content-disposition"]).toContain("registrations.pdf");
      expect(pdfRes.body).toContain("%PDF-1.4");
      expect(pdfRes.body).toContain("/STSong-Light");
      expect(pdfRes.body).toContain(utf16Hex("报名名单"));
      expect(pdfRes.body).toContain(utf16Hex("公司/项目(company): 增长品牌实验室"));
      expect(pdfRes.body).toContain(utf16Hex("职业标签(profession): 产品经理"));

      const waitlistCsvRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/exports/waitlist.csv`, headers: adminHeaders });
      expect(waitlistCsvRes.statusCode).toBe(200);
      expect(waitlistCsvRes.body).toContain("waitlistId");
      expect(waitlistCsvRes.body).toContain("候补用户");

      const feedbackCsvRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/exports/feedback.csv`, headers: adminHeaders });
      expect(feedbackCsvRes.statusCode).toBe(200);
      expect(feedbackCsvRes.body).toContain("feedbackId");
      expect(feedbackCsvRes.body).toContain("AI Agent 商业化");

      const resourcesCsvRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/exports/resources.csv`, headers: adminHeaders });
      expect(resourcesCsvRes.statusCode).toBe(200);
      expect(resourcesCsvRes.body).toContain("resourceId");
      expect(resourcesCsvRes.body).toContain("活动回放");

      const memberRes = await app.inject({
        method: "POST",
        url: `/api/organizers/${created.organizerId}/team-members`,
        headers: adminJsonHeaders,
        payload: JSON.stringify({ name: "运营同学", email: "ops-test@loopin.local", role: "operator" }),
      });
      expect(memberRes.statusCode).toBe(200);
      const member = memberRes.json().member as { id: string; role: string; permissions: string[] };
      expect(member.role).toBe("operator");
      expect(member.permissions).toContain("registrations:write");

      const memberHeaders = { ...adminHeaders, "x-loopin-member-id": member.id };
      const memberQuotaRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/quotas`, headers: memberHeaders });
      expect(memberQuotaRes.statusCode).toBe(200);

      const otherCreateRes = await app.inject({
        method: "POST",
        url: "/api/events",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          title: `后台 IA 其他活动 ${Date.now()}`,
          city: "北京",
          startAt: "2026-06-15T19:00:00+08:00",
          ticket: { name: "标准票", kind: "paid", priceCents: 9900, capacity: 3 },
        }),
      });
      expect(otherCreateRes.statusCode).toBe(200);
      const otherCreated = otherCreateRes.json() as { eventId: string };
      const scopedOutRes = await app.inject({ method: "GET", url: `/api/events/${otherCreated.eventId}/quotas`, headers: memberHeaders });
      expect(scopedOutRes.statusCode).toBe(403);

      const memberTeamWriteRes = await app.inject({
        method: "POST",
        url: `/api/team-members/${member.id}/update`,
        headers: { "content-type": "application/json", ...memberHeaders },
        payload: JSON.stringify({ status: "disabled" }),
      });
      expect(memberTeamWriteRes.statusCode).toBe(403);

      const memberUpdateRes = await app.inject({
        method: "POST",
        url: `/api/team-members/${member.id}/update`,
        headers: adminJsonHeaders,
        payload: JSON.stringify({ status: "disabled" }),
      });
      expect(memberUpdateRes.statusCode).toBe(200);
      expect(memberUpdateRes.json().member).toMatchObject({ id: member.id, role: "operator", status: "disabled" });
      expect(memberUpdateRes.json().member.permissions).toContain("registrations:write");

      const memberPermissionRes = await app.inject({
        method: "POST",
        url: `/api/team-members/${member.id}/update`,
        headers: adminJsonHeaders,
        payload: JSON.stringify({ status: "active", permissions: ["events:read", "exports:read"] }),
      });
      expect(memberPermissionRes.statusCode).toBe(200);
      expect(memberPermissionRes.json().member).toMatchObject({ id: member.id, status: "active" });
      expect(memberPermissionRes.json().member.permissions).toEqual(["events:read", "exports:read"]);

      const membersRes = await app.inject({ method: "GET", url: `/api/organizers/${created.organizerId}/team-members`, headers: adminHeaders });
      expect(membersRes.statusCode).toBe(200);
      const savedMember = membersRes.json().members.find((row: { id: string }) => row.id === member.id);
      expect(savedMember?.status).toBe("active");
      expect(savedMember?.permissions).toEqual(["events:read", "exports:read"]);

      const invitationRes = await app.inject({
        method: "POST",
        url: `/api/organizers/${created.organizerId}/team-invitations`,
        headers: adminJsonHeaders,
        payload: JSON.stringify({
          name: "受邀运营",
          email: "invite-test@loopin.local",
          role: "operator",
          permissions: ["events:read", "exports:read"],
        }),
      });
      expect(invitationRes.statusCode).toBe(200);
      const invitation = invitationRes.json() as {
        member: { id: string; status: string; hasAccessToken: boolean; inviteExpiresAt: string };
        invitation: { token: string; url: string; expiresAt: string };
      };
      expect(invitation.member.status).toBe("invited");
      expect(invitation.member.hasAccessToken).toBe(false);
      expect(invitation.invitation.token).toMatch(/^lpi_/);
      expect(invitation.invitation.url).toContain("invite=");

      const acceptRes = await app.inject({
        method: "POST",
        url: "/api/team-invitations/accept",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ token: invitation.invitation.token }),
      });
      expect(acceptRes.statusCode).toBe(200);
      const accepted = acceptRes.json() as { memberToken: string; member: { id: string; status: string; hasAccessToken: boolean } };
      expect(accepted.memberToken).toMatch(/^lpm_/);
      expect(accepted.member).toMatchObject({ id: invitation.member.id, status: "active", hasAccessToken: true });

      const invitedMemberHeaders = { "x-loopin-member-token": accepted.memberToken };
      const invitedExportersRes = await app.inject({ method: "GET", url: `/api/events/${created.eventId}/exports`, headers: invitedMemberHeaders });
      expect(invitedExportersRes.statusCode).toBe(200);
      expect(invitedExportersRes.json().exporters.map((exporter: { key: string }) => exporter.key)).toContain("registrations_pdf");

      const invitedOtherExportersRes = await app.inject({ method: "GET", url: `/api/events/${otherCreated.eventId}/exports`, headers: invitedMemberHeaders });
      expect(invitedOtherExportersRes.statusCode).toBe(403);

      const invitedQuotaWriteRes = await app.inject({
        method: "POST",
        url: `/api/quotas/${created.quotaId}/update`,
        headers: { "content-type": "application/json", ...invitedMemberHeaders },
        payload: JSON.stringify({ capacity: 2 }),
      });
      expect(invitedQuotaWriteRes.statusCode).toBe(403);

      const reuseInviteRes = await app.inject({
        method: "POST",
        url: "/api/team-invitations/accept",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ token: invitation.invitation.token }),
      });
      expect(reuseInviteRes.statusCode).toBe(400);

      const postAcceptMembersRes = await app.inject({ method: "GET", url: `/api/organizers/${created.organizerId}/team-members`, headers: adminHeaders });
      const acceptedMember = postAcceptMembersRes.json().members.find((row: { id: string }) => row.id === invitation.member.id);
      expect(acceptedMember).toMatchObject({ status: "active", hasAccessToken: true, inviteExpiresAt: null });
    } finally {
      if (oldBackofficeToken === undefined) delete process.env.BACKOFFICE_ADMIN_TOKEN;
      else process.env.BACKOFFICE_ADMIN_TOKEN = oldBackofficeToken;
      if (oldAppId === undefined) delete process.env.WX_APPID;
      else process.env.WX_APPID = oldAppId;
      if (oldAppSecret === undefined) delete process.env.WX_APPSECRET;
      else process.env.WX_APPSECRET = oldAppSecret;
      if (oldTemplate === undefined) delete process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID;
      else process.env.WX_SUBSCRIBE_EVENT_TEMPLATE_ID = oldTemplate;
      await app.close();
    }
  });
});

describe("PUT /api/events/:id/form", () => {
  it("校验合法 schema 后落库，非法 schema 返回 400", async () => {
    const app = await buildApp();
    const db = new PrismaClient();
    let created: { eventId: string; ticketTypeId: string; quotaId: string; organizerId: string } | null = null;
    try {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/events",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          title: "表单构建器测试", city: "上海", startAt: new Date("2030-01-01T10:00:00Z").toISOString(),
          ticket: { name: "标准票", kind: "free", priceCents: 0, capacity: 50 },
        }),
      });
      expect(createRes.statusCode).toBe(200);
      created = createRes.json();

      // 合法 schema → 200 并落库
      const goodSchema = { fields: [
        { key: "name", label: "姓名", type: "text", required: true, visibility: "organizer_only" },
        { key: "phone", label: "手机号", type: "phone", required: true, visibility: "organizer_only" },
      ] };
      const okRes = await app.inject({
        method: "PUT", url: `/api/events/${created.eventId}/form`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ schema: goodSchema }),
      });
      expect(okRes.statusCode).toBe(200);
      expect(okRes.json().ok).toBe(true);

      // GET 详情应反映更新后的 schema
      const detail = await app.inject({ method: "GET", url: `/api/events/${created.eventId}` });
      expect(detail.json().formSchema.fields).toHaveLength(2);

      // 非法 schema（重复 key）→ 400
      const badRes = await app.inject({
        method: "PUT", url: `/api/events/${created.eventId}/form`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ schema: { fields: [
          { key: "dup", label: "A", type: "text", required: false, visibility: "public" },
          { key: "dup", label: "B", type: "text", required: false, visibility: "public" },
        ] } }),
      });
      expect(badRes.statusCode).toBe(400);
      expect(badRes.json().error).toBe("invalid_schema");
    } finally {
      if (created) {
        await db.registrationForm.deleteMany({ where: { eventId: created.eventId } });
        await db.ticketTypeQuota.deleteMany({ where: { ticketTypeId: created.ticketTypeId } });
        await db.ticketType.deleteMany({ where: { id: created.ticketTypeId } });
        await db.quota.deleteMany({ where: { id: created.quotaId } });
        await db.event.deleteMany({ where: { id: created.eventId } });
        await db.organizer.deleteMany({ where: { id: created.organizerId } });
      }
      await db.$disconnect();
      await app.close();
    }
  });
});

describe("票种 CRUD 路由", () => {
  it("加票种 → 列表 → 改价 → 停售", async () => {
    const app = await buildApp();
    const db = new PrismaClient();
    let eventId = "";
    let organizerId = "";
    try {
      const createRes = await app.inject({
        method: "POST", url: "/api/events",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          title: "票种测试", city: "上海", startAt: new Date("2030-02-01T10:00:00Z").toISOString(),
          ticket: { name: "标准票", kind: "paid", priceCents: 19900, capacity: 50 },
        }),
      });
      const created = createRes.json();
      eventId = created.eventId;
      organizerId = created.organizerId;

      // 加一个早鸟票
      const addRes = await app.inject({
        method: "POST", url: `/api/events/${eventId}/ticket-types`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ name: "早鸟票", kind: "paid", priceCents: 9900, capacity: 20 }),
      });
      expect(addRes.statusCode).toBe(200);
      const addedId = addRes.json().ticketTypeId;

      // 列表应有两个票种
      const listRes = await app.inject({ method: "GET", url: `/api/events/${eventId}/ticket-types` });
      expect(listRes.json().ticketTypes).toHaveLength(2);
      const early = listRes.json().ticketTypes.find((t: { id: string }) => t.id === addedId);
      expect(early).toMatchObject({ name: "早鸟票", priceCents: 9900, capacity: 20, status: "active" });

      // 改价 + 容量
      const upRes = await app.inject({
        method: "POST", url: `/api/ticket-types/${addedId}/update`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ priceCents: 12900, capacity: 30 }),
      });
      expect(upRes.statusCode).toBe(200);
      expect(upRes.json().ticketType.priceCents).toBe(12900);

      // 停售
      const archRes = await app.inject({
        method: "POST", url: `/api/ticket-types/${addedId}/archive`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({}),
      });
      expect(archRes.statusCode).toBe(200);
      expect(archRes.json().ticketType.status).toBe("archived");

      const after = await app.inject({ method: "GET", url: `/api/events/${eventId}/ticket-types` });
      expect(after.json().ticketTypes.find((t: { id: string }) => t.id === addedId).status).toBe("archived");
      expect(after.json().ticketTypes.find((t: { id: string }) => t.id === addedId).capacity).toBe(30);
    } finally {
      if (eventId) {
        const tickets = await db.ticketType.findMany({ where: { eventId }, select: { id: true } });
        await db.ticketTypeQuota.deleteMany({ where: { ticketTypeId: { in: tickets.map((t) => t.id) } } });
        await db.ticketType.deleteMany({ where: { eventId } });
        await db.quota.deleteMany({ where: { eventId } });
        await db.registrationForm.deleteMany({ where: { eventId } });
        await db.event.deleteMany({ where: { id: eventId } });
        if (organizerId) await db.organizer.deleteMany({ where: { id: organizerId } });
      }
      await db.$disconnect();
      await app.close();
    }
  });
});

describe("平台管理员 · 主办方与白名单", () => {
  it("列出全部主办方（带活动/成员计数）并切换白名单", async () => {
    const oldBackofficeToken = process.env.BACKOFFICE_ADMIN_TOKEN;
    process.env.BACKOFFICE_ADMIN_TOKEN = "test-backoffice-token";
    const app = await buildApp();
    const db = new PrismaClient();
    const adminHeaders = { "x-loopin-admin-token": "test-backoffice-token" };
    const adminJsonHeaders = { "content-type": "application/json", ...adminHeaders };
    const stamp = Date.now();
    let orgWithEventId = "";
    let orgEmptyId = "";
    let eventId = "";
    let memberId = "";
    try {
      const orgWithEvent = await db.organizer.create({ data: { name: `白名单测试-有活动 ${stamp}`, whitelisted: true } });
      orgWithEventId = orgWithEvent.id;
      const orgEmpty = await db.organizer.create({ data: { name: `白名单测试-待审核 ${stamp}`, whitelisted: false } });
      orgEmptyId = orgEmpty.id;
      const event = await db.event.create({
        data: { organizerId: orgWithEventId, title: `白名单活动 ${stamp}`, city: "上海", startAt: new Date("2030-03-01T10:00:00Z") },
      });
      eventId = event.id;
      const member = await db.organizerMember.create({
        data: { organizerId: orgWithEventId, name: "运营甲", role: "owner", permissions: JSON.stringify(["*"]) },
      });
      memberId = member.id;

      // 未带令牌 → 401
      const unauthorized = await app.inject({ method: "GET", url: "/api/admin/organizers" });
      expect(unauthorized.statusCode).toBe(401);

      // 带令牌 → 列表含两个主办方，计数正确
      const listRes = await app.inject({ method: "GET", url: "/api/admin/organizers", headers: adminHeaders });
      expect(listRes.statusCode).toBe(200);
      const organizers = listRes.json().organizers as Array<{ id: string; name: string; whitelisted: boolean; eventCount: number; memberCount: number }>;
      const withEvent = organizers.find((o) => o.id === orgWithEventId);
      const empty = organizers.find((o) => o.id === orgEmptyId);
      expect(withEvent).toMatchObject({ whitelisted: true, eventCount: 1, memberCount: 1 });
      expect(empty).toMatchObject({ whitelisted: false, eventCount: 0, memberCount: 0 });

      // 通过审核：把待审核主办方加入白名单
      const grantRes = await app.inject({
        method: "POST",
        url: `/api/organizers/${orgEmptyId}/whitelist`,
        headers: adminJsonHeaders,
        payload: JSON.stringify({ whitelisted: true }),
      });
      expect(grantRes.statusCode).toBe(200);
      expect(grantRes.json().organizer).toMatchObject({ id: orgEmptyId, whitelisted: true });
      expect((await db.organizer.findUnique({ where: { id: orgEmptyId } }))?.whitelisted).toBe(true);

      // 撤销白名单
      const revokeRes = await app.inject({
        method: "POST",
        url: `/api/organizers/${orgWithEventId}/whitelist`,
        headers: adminJsonHeaders,
        payload: JSON.stringify({ whitelisted: false }),
      });
      expect(revokeRes.statusCode).toBe(200);
      expect(revokeRes.json().organizer.whitelisted).toBe(false);

      // 不存在的主办方 → 404
      const notFound = await app.inject({
        method: "POST",
        url: "/api/organizers/__missing__/whitelist",
        headers: adminJsonHeaders,
        payload: JSON.stringify({ whitelisted: true }),
      });
      expect(notFound.statusCode).toBe(404);
    } finally {
      if (memberId) await db.organizerMember.deleteMany({ where: { id: memberId } });
      if (eventId) await db.event.deleteMany({ where: { id: eventId } });
      if (orgWithEventId) await db.organizer.deleteMany({ where: { id: orgWithEventId } });
      if (orgEmptyId) await db.organizer.deleteMany({ where: { id: orgEmptyId } });
      await db.$disconnect();
      await app.close();
      if (oldBackofficeToken === undefined) delete process.env.BACKOFFICE_ADMIN_TOKEN;
      else process.env.BACKOFFICE_ADMIN_TOKEN = oldBackofficeToken;
    }
  });

  it("钻取单个主办方：活动（带报名数）+ 成员 + 主办方资料", async () => {
    const oldBackofficeToken = process.env.BACKOFFICE_ADMIN_TOKEN;
    process.env.BACKOFFICE_ADMIN_TOKEN = "test-backoffice-token";
    const app = await buildApp();
    const db = new PrismaClient();
    const adminHeaders = { "x-loopin-admin-token": "test-backoffice-token" };
    const stamp = Date.now();
    let organizerId = "";
    let eventId = "";
    let ticketTypeId = "";
    let userId = "";
    let registrationId = "";
    let memberId = "";
    try {
      const organizer = await db.organizer.create({
        data: {
          name: `钻取测试主办方 ${stamp}`,
          whitelisted: true,
          hostProfile: { create: { bio: "专注 AI 产品社区", links: JSON.stringify([{ label: "官网", url: "https://loopin.example" }]) } },
        },
      });
      organizerId = organizer.id;
      const event = await db.event.create({
        data: { organizerId, title: `钻取活动 ${stamp}`, status: "draft", city: "上海", startAt: new Date("2030-04-01T10:00:00Z") },
      });
      eventId = event.id;
      const ticketType = await db.ticketType.create({ data: { eventId, name: "标准票", kind: "paid", priceCents: 19900 } });
      ticketTypeId = ticketType.id;
      const user = await db.user.create({ data: { nickname: "报名者甲" } });
      userId = user.id;
      const registration = await db.registration.create({
        data: { eventId, ticketTypeId, userId, status: "approved", formValues: JSON.stringify({ name: "甲" }) },
      });
      registrationId = registration.id;
      const member = await db.organizerMember.create({
        data: { organizerId, name: "运营乙", role: "owner", permissions: JSON.stringify(["*"]) },
      });
      memberId = member.id;

      // 未带令牌 → 401
      const unauthorized = await app.inject({ method: "GET", url: `/api/admin/organizers/${organizerId}` });
      expect(unauthorized.statusCode).toBe(401);

      // 带令牌 → 完整详情
      const res = await app.inject({ method: "GET", url: `/api/admin/organizers/${organizerId}`, headers: adminHeaders });
      expect(res.statusCode).toBe(200);
      const detail = res.json() as {
        organizer: { id: string; name: string; whitelisted: boolean };
        hostProfile: { bio: string; links: { label: string; url: string }[] } | null;
        events: { id: string; title: string; status: string; registrationCount: number }[];
        members: { id: string; name: string; role: string }[];
      };
      expect(detail.organizer).toMatchObject({ id: organizerId, whitelisted: true });
      expect(detail.hostProfile?.bio).toBe("专注 AI 产品社区");
      expect(detail.hostProfile?.links).toEqual([{ label: "官网", url: "https://loopin.example" }]);
      expect(detail.events).toHaveLength(1);
      expect(detail.events[0]).toMatchObject({ id: eventId, status: "draft", registrationCount: 1 });
      expect(detail.members.find((m) => m.id === memberId)).toMatchObject({ name: "运营乙", role: "owner" });

      // 不存在 → 404
      const notFound = await app.inject({ method: "GET", url: "/api/admin/organizers/__missing__", headers: adminHeaders });
      expect(notFound.statusCode).toBe(404);
    } finally {
      if (registrationId) await db.registration.deleteMany({ where: { id: registrationId } });
      if (memberId) await db.organizerMember.deleteMany({ where: { id: memberId } });
      if (ticketTypeId) await db.ticketType.deleteMany({ where: { id: ticketTypeId } });
      if (eventId) await db.event.deleteMany({ where: { id: eventId } });
      if (userId) await db.user.deleteMany({ where: { id: userId } });
      if (organizerId) {
        await db.hostProfile.deleteMany({ where: { organizerId } });
        await db.organizer.deleteMany({ where: { id: organizerId } });
      }
      await db.$disconnect();
      await app.close();
      if (oldBackofficeToken === undefined) delete process.env.BACKOFFICE_ADMIN_TOKEN;
      else process.env.BACKOFFICE_ADMIN_TOKEN = oldBackofficeToken;
    }
  });

  it("手动新建主办方", async () => {
    const oldBackofficeToken = process.env.BACKOFFICE_ADMIN_TOKEN;
    process.env.BACKOFFICE_ADMIN_TOKEN = "test-backoffice-token";
    const app = await buildApp();
    const db = new PrismaClient();
    const adminHeaders = { "x-loopin-admin-token": "test-backoffice-token" };
    const adminJsonHeaders = { "content-type": "application/json", ...adminHeaders };
    const stamp = Date.now();
    const name = `新建主办方 ${stamp}`;
    let createdId = "";
    try {
      // 未带令牌 → 401
      const unauthorized = await app.inject({
        method: "POST", url: "/api/admin/organizers",
        headers: { "content-type": "application/json" }, payload: JSON.stringify({ name }),
      });
      expect(unauthorized.statusCode).toBe(401);

      // 空名称 → 400
      const blank = await app.inject({
        method: "POST", url: "/api/admin/organizers",
        headers: adminJsonHeaders, payload: JSON.stringify({ name: "   " }),
      });
      expect(blank.statusCode).toBe(400);

      // 正常创建 → 200，计数为 0
      const created = await app.inject({
        method: "POST", url: "/api/admin/organizers",
        headers: adminJsonHeaders, payload: JSON.stringify({ name, whitelisted: false }),
      });
      expect(created.statusCode).toBe(200);
      const organizer = created.json().organizer as { id: string; name: string; whitelisted: boolean; eventCount: number; memberCount: number };
      createdId = organizer.id;
      expect(organizer).toMatchObject({ name, whitelisted: false, eventCount: 0, memberCount: 0 });

      // 列表里能查到
      const listRes = await app.inject({ method: "GET", url: "/api/admin/organizers", headers: adminHeaders });
      expect((listRes.json().organizers as { id: string }[]).some((o) => o.id === createdId)).toBe(true);
    } finally {
      if (createdId) await db.organizer.deleteMany({ where: { id: createdId } });
      await db.$disconnect();
      await app.close();
      if (oldBackofficeToken === undefined) delete process.env.BACKOFFICE_ADMIN_TOKEN;
      else process.env.BACKOFFICE_ADMIN_TOKEN = oldBackofficeToken;
    }
  });

  it("编辑主办方资料（HostProfile upsert）", async () => {
    const oldBackofficeToken = process.env.BACKOFFICE_ADMIN_TOKEN;
    process.env.BACKOFFICE_ADMIN_TOKEN = "test-backoffice-token";
    const app = await buildApp();
    const db = new PrismaClient();
    const adminHeaders = { "x-loopin-admin-token": "test-backoffice-token" };
    const adminJsonHeaders = { "content-type": "application/json", ...adminHeaders };
    const stamp = Date.now();
    let organizerId = "";
    try {
      const organizer = await db.organizer.create({ data: { name: `资料编辑测试 ${stamp}`, whitelisted: true } });
      organizerId = organizer.id;

      // 首次写入（create 分支）
      const first = await app.inject({
        method: "PUT", url: `/api/organizers/${organizerId}/host-profile`,
        headers: adminJsonHeaders,
        payload: JSON.stringify({ bio: "专注 AI 产品社区", avatarUrl: "https://cdn.example/a.png", links: [{ label: "官网", url: "https://loopin.example" }] }),
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().hostProfile).toMatchObject({ bio: "专注 AI 产品社区", avatarUrl: "https://cdn.example/a.png" });
      expect(first.json().hostProfile.links).toEqual([{ label: "官网", url: "https://loopin.example" }]);

      // 详情接口能反映
      const detail = await app.inject({ method: "GET", url: `/api/admin/organizers/${organizerId}`, headers: adminHeaders });
      expect(detail.json().hostProfile.bio).toBe("专注 AI 产品社区");

      // 再次写入（update 分支，证明 upsert）
      const second = await app.inject({
        method: "PUT", url: `/api/organizers/${organizerId}/host-profile`,
        headers: adminJsonHeaders, payload: JSON.stringify({ bio: "已更新简介", links: [] }),
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().hostProfile.bio).toBe("已更新简介");
      expect(await db.hostProfile.count({ where: { organizerId } })).toBe(1);

      // 未带令牌 → 401
      const unauthorized = await app.inject({
        method: "PUT", url: `/api/organizers/${organizerId}/host-profile`,
        headers: { "content-type": "application/json" }, payload: JSON.stringify({ bio: "x" }),
      });
      expect(unauthorized.statusCode).toBe(401);

      // 不存在的主办方 → 404
      const notFound = await app.inject({
        method: "PUT", url: "/api/organizers/__missing__/host-profile",
        headers: adminJsonHeaders, payload: JSON.stringify({ bio: "x" }),
      });
      expect(notFound.statusCode).toBe(404);
    } finally {
      if (organizerId) {
        await db.hostProfile.deleteMany({ where: { organizerId } });
        await db.organizer.deleteMany({ where: { id: organizerId } });
      }
      await db.$disconnect();
      await app.close();
      if (oldBackofficeToken === undefined) delete process.env.BACKOFFICE_ADMIN_TOKEN;
      else process.env.BACKOFFICE_ADMIN_TOKEN = oldBackofficeToken;
    }
  });
});

describe("平台管理员 · 跨主办方总览与监控", () => {
  it("平台总览：主办方/活动/报名/GMV 聚合（增量断言）", async () => {
    const oldBackofficeToken = process.env.BACKOFFICE_ADMIN_TOKEN;
    process.env.BACKOFFICE_ADMIN_TOKEN = "test-backoffice-token";
    const app = await buildApp();
    const db = new PrismaClient();
    const adminHeaders = { "x-loopin-admin-token": "test-backoffice-token" };
    const stamp = Date.now();
    let organizerId = "";
    let eventId = "";
    let ticketTypeId = "";
    let userId = "";
    let registrationId = "";
    let orderId = "";
    try {
      // 未带令牌 → 401
      const unauthorized = await app.inject({ method: "GET", url: "/api/admin/overview" });
      expect(unauthorized.statusCode).toBe(401);

      const before = (await app.inject({ method: "GET", url: "/api/admin/overview", headers: adminHeaders })).json();

      // 造一组已知数据：待审核主办方 + 草稿活动 + submitted 报名 + 已支付订单
      const organizer = await db.organizer.create({ data: { name: `总览测试 ${stamp}`, whitelisted: false } });
      organizerId = organizer.id;
      const event = await db.event.create({ data: { organizerId, title: `总览活动 ${stamp}`, status: "draft", city: "上海", startAt: new Date("2030-05-01T10:00:00Z") } });
      eventId = event.id;
      const ticketType = await db.ticketType.create({ data: { eventId, name: "标准票", kind: "paid", priceCents: 30000 } });
      ticketTypeId = ticketType.id;
      const user = await db.user.create({ data: { nickname: "总览报名者" } });
      userId = user.id;
      const registration = await db.registration.create({ data: { eventId, ticketTypeId, userId, status: "submitted", formValues: "{}" } });
      registrationId = registration.id;
      const order = await db.order.create({ data: { registrationId, amountCents: 30000, lifecycle: "completed", payment_status: "paid" } });
      orderId = order.id;

      const after = (await app.inject({ method: "GET", url: "/api/admin/overview", headers: adminHeaders })).json();

      expect(after.organizers.total - before.organizers.total).toBe(1);
      expect(after.organizers.pending - before.organizers.pending).toBe(1);
      expect(after.events.draft - before.events.draft).toBe(1);
      expect(after.events.total - before.events.total).toBe(1);
      expect(after.registrations.submitted - before.registrations.submitted).toBe(1);
      expect(after.registrations.total - before.registrations.total).toBe(1);
      expect(after.gmvCents - before.gmvCents).toBe(30000);
      expect(after.pending.review - before.pending.review).toBe(1);
      expect(after.pending.whitelist - before.pending.whitelist).toBe(1);
    } finally {
      if (orderId) await db.order.deleteMany({ where: { id: orderId } });
      if (registrationId) await db.registration.deleteMany({ where: { id: registrationId } });
      if (ticketTypeId) await db.ticketType.deleteMany({ where: { id: ticketTypeId } });
      if (eventId) await db.event.deleteMany({ where: { id: eventId } });
      if (userId) await db.user.deleteMany({ where: { id: userId } });
      if (organizerId) await db.organizer.deleteMany({ where: { id: organizerId } });
      await db.$disconnect();
      await app.close();
      if (oldBackofficeToken === undefined) delete process.env.BACKOFFICE_ADMIN_TOKEN;
      else process.env.BACKOFFICE_ADMIN_TOKEN = oldBackofficeToken;
    }
  });

  it("全平台活动监控：跨主办方列表 + 超卖风险识别", async () => {
    const oldBackofficeToken = process.env.BACKOFFICE_ADMIN_TOKEN;
    process.env.BACKOFFICE_ADMIN_TOKEN = "test-backoffice-token";
    const app = await buildApp();
    const db = new PrismaClient();
    const adminHeaders = { "x-loopin-admin-token": "test-backoffice-token" };
    const stamp = Date.now();
    let organizerId = "";
    let eventId = "";
    let quotaId = "";
    let ticketTypeId = "";
    const userIds: string[] = [];
    const regIds: string[] = [];
    try {
      // 未带令牌 → 401
      const unauthorized = await app.inject({ method: "GET", url: "/api/admin/events" });
      expect(unauthorized.statusCode).toBe(401);

      const organizer = await db.organizer.create({ data: { name: `监控测试主办方 ${stamp}`, whitelisted: true } });
      organizerId = organizer.id;
      const event = await db.event.create({ data: { organizerId, title: `监控活动 ${stamp}`, status: "published", city: "上海", startAt: new Date("2030-06-01T10:00:00Z") } });
      eventId = event.id;
      const quota = await db.quota.create({ data: { eventId, name: "总量", capacity: 1, used: 2 } });
      quotaId = quota.id;
      const ticketType = await db.ticketType.create({ data: { eventId, name: "标准票", kind: "approval", priceCents: 0 } });
      ticketTypeId = ticketType.id;
      // 2 个 approved 报名 → 超过 capacity 1 → 超卖
      for (let i = 0; i < 2; i += 1) {
        const user = await db.user.create({ data: { nickname: `监控报名者${i}` } });
        userIds.push(user.id);
        const reg = await db.registration.create({ data: { eventId, ticketTypeId, userId: user.id, status: "approved", formValues: "{}" } });
        regIds.push(reg.id);
      }

      const res = await app.inject({ method: "GET", url: "/api/admin/events", headers: adminHeaders });
      expect(res.statusCode).toBe(200);
      const events = res.json().events as Array<{
        id: string; organizer: string; status: string;
        registrationCount: number; approvedCount: number; capacity: number | null; oversold: boolean; risks: string[];
      }>;
      const row = events.find((e) => e.id === eventId);
      expect(row).toBeTruthy();
      expect(row).toMatchObject({ organizer: `监控测试主办方 ${stamp}`, status: "published", registrationCount: 2, approvedCount: 2, capacity: 1, oversold: true });
      expect(row!.risks).toContain("超卖");
    } finally {
      for (const id of regIds) await db.registration.deleteMany({ where: { id } });
      if (ticketTypeId) await db.ticketType.deleteMany({ where: { id: ticketTypeId } });
      if (quotaId) await db.quota.deleteMany({ where: { id: quotaId } });
      if (eventId) await db.event.deleteMany({ where: { id: eventId } });
      for (const id of userIds) await db.user.deleteMany({ where: { id } });
      if (organizerId) await db.organizer.deleteMany({ where: { id: organizerId } });
      await db.$disconnect();
      await app.close();
      if (oldBackofficeToken === undefined) delete process.env.BACKOFFICE_ADMIN_TOKEN;
      else process.env.BACKOFFICE_ADMIN_TOKEN = oldBackofficeToken;
    }
  });
});

describe("C 端 · 主办方主页", () => {
  it("主办方公开页：资料 + 仅已发布活动；详情页带 hostProfile", async () => {
    const app = await buildApp();
    const db = new PrismaClient();
    const stamp = Date.now();
    let organizerId = "";
    let publishedId = "";
    let draftId = "";
    try {
      const organizer = await db.organizer.create({
        data: {
          name: `公开页主办方 ${stamp}`,
          whitelisted: true,
          hostProfile: { create: { bio: "上海 AI 产品社区", avatarUrl: "https://cdn.example/a.png", links: JSON.stringify([{ label: "官网", url: "https://loopin.example" }]) } },
        },
      });
      organizerId = organizer.id;
      const published = await db.event.create({ data: { organizerId, title: `已发布活动 ${stamp}`, status: "published", city: "上海", venue: "Loopin Space", startAt: new Date("2030-08-01T10:00:00Z") } });
      publishedId = published.id;
      await db.ticketType.create({ data: { eventId: publishedId, name: "标准票", kind: "paid", priceCents: 19900 } });
      const draft = await db.event.create({ data: { organizerId, title: `草稿活动 ${stamp}`, status: "draft", city: "上海", startAt: new Date("2030-09-01T10:00:00Z") } });
      draftId = draft.id;

      // 公开页：无需令牌
      const res = await app.inject({ method: "GET", url: `/api/organizers/${organizerId}/public` });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        organizer: { id: string; name: string };
        hostProfile: { bio: string; avatarUrl: string; links: { label: string; url: string }[] } | null;
        events: { id: string; title: string; minPriceCents: number }[];
      };
      expect(body.organizer).toMatchObject({ id: organizerId, name: `公开页主办方 ${stamp}` });
      expect(body.hostProfile?.bio).toBe("上海 AI 产品社区");
      expect(body.hostProfile?.links).toEqual([{ label: "官网", url: "https://loopin.example" }]);
      // 只含已发布活动
      expect(body.events.map((e) => e.id)).toEqual([publishedId]);
      expect(body.events[0]).toMatchObject({ minPriceCents: 19900 });

      // 不存在 → 404
      const notFound = await app.inject({ method: "GET", url: "/api/organizers/__missing__/public" });
      expect(notFound.statusCode).toBe(404);

      // 活动详情现在带 hostProfile（供详情页展示主办方摘要 + 跳转）
      const detail = await app.inject({ method: "GET", url: `/api/events/${publishedId}` });
      expect(detail.statusCode).toBe(200);
      const ev = detail.json().event as { organizerId: string; organizer: string; hostProfile: { bio: string } | null };
      expect(ev.organizerId).toBe(organizerId);
      expect(ev.hostProfile?.bio).toBe("上海 AI 产品社区");
    } finally {
      if (publishedId) {
        await db.ticketType.deleteMany({ where: { eventId: publishedId } });
        await db.event.deleteMany({ where: { id: publishedId } });
      }
      if (draftId) await db.event.deleteMany({ where: { id: draftId } });
      if (organizerId) {
        await db.hostProfile.deleteMany({ where: { organizerId } });
        await db.organizer.deleteMany({ where: { id: organizerId } });
      }
      await db.$disconnect();
      await app.close();
    }
  });
});

function utf16Hex(value: string) {
  const hex: string[] = [];
  for (let i = 0; i < value.length; i += 1) hex.push(value.charCodeAt(i).toString(16).padStart(4, "0"));
  return hex.join("").toUpperCase();
}
