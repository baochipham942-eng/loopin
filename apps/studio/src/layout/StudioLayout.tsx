import { Outlet } from "react-router-dom";
import { Sidebar, Topbar, ContentArea, useActiveNavLabel, type NavGroup } from "./Shell.js";
import { RoleSwitcher, EventSwitcher, AccountChip } from "./widgets.js";

/**
 * 主办方工作台布局（P0 地基）。
 * 导航按活动生命周期 4 阶段分组。运营台/后台 IA 暂以「过渡」分组原位挂载，
 * 其功能归属拆分（平台 vs 主办方）留到 P1。
 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: "总览",
    items: [
      { to: "/studio/events", label: "活动列表" },
      { to: "/studio/operations", label: "运营台" },
    ],
  },
  {
    title: "📋 筹备期",
    items: [
      { to: "/studio/topic-radar", label: "选题雷达" },
      { to: "/studio/create", label: "建活动" },
      { to: "/studio/form", label: "报名表" },
      { to: "/studio/tickets", label: "票种与收款" },
    ],
  },
  {
    title: "📣 招募期",
    items: [
      { to: "/studio/dashboard", label: "报名看板" },
      { to: "/studio/review", label: "报名审核" },
      { to: "/studio/materials", label: "分享素材" },
    ],
  },
  {
    title: "📍 现场",
    items: [{ to: "/studio/checkin", label: "现场签到" }],
  },
  {
    title: "🔄 复盘",
    items: [{ to: "/studio/recap", label: "复盘" }],
  },
  {
    title: "👥 我的",
    items: [{ to: "/studio/team", label: "团队成员" }],
  },
];

export function StudioLayout() {
  const pageTitle = useActiveNavLabel(NAV_GROUPS, "工作台");
  return (
    <div className="shell">
      <Sidebar brand="Loopin Studio" subtitle="主办方工作台" groups={NAV_GROUPS} />
      <div className="shell-main">
        <Topbar title={pageTitle}>
          <EventSwitcher />
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
