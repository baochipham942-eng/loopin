import { Outlet } from "react-router-dom";
import { Sidebar, Topbar, ContentArea, useActiveNavLabel, type NavGroup } from "./Shell.js";
import { RoleSwitcher, AccountChip } from "./widgets.js";

/**
 * 平台管理员控制台布局（P0 地基）。
 * 实际平台功能（主办方/白名单管理、全局总览、配置中心、收费结算）在 P3 建设；
 * P0 仅建骨架与导航占位，并提供占位页说明。
 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: "运营总览",
    items: [
      { to: "/admin", label: "平台总览" },
      { to: "/admin/organizers", label: "主办方与白名单" },
      { to: "/admin/events", label: "全平台活动监控" },
    ],
  },
  {
    title: "平台配置",
    items: [
      { to: "/admin/integrations", label: "集成配置中心" },
      { to: "/admin/topic-feeds", label: "选题信号源" },
      { to: "/admin/backoffice", label: "后台数据" },
      { to: "/admin/billing", label: "收费与结算", transitional: true },
    ],
  },
];

export function AdminLayout() {
  const pageTitle = useActiveNavLabel(NAV_GROUPS, "控制台");
  return (
    <div className="shell">
      <Sidebar brand="Loopin Admin" subtitle="平台运营控制台" groups={NAV_GROUPS} />
      <div className="shell-main">
        <Topbar title={pageTitle}>
          <RoleSwitcher />
          <AccountChip />
        </Topbar>
        <ContentArea>
          <Outlet />
        </ContentArea>
      </div>
    </div>
  );
}
