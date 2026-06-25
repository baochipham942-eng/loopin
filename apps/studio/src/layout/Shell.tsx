import { NavLink, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

/** 后台壳层公共组件（P0 地基）：左侧分组导航 + 顶栏 + 内容区。 */

/** 取当前路由对应的导航项标题（顶栏用），避免和侧栏副标题重复。最长前缀匹配。 */
export function useActiveNavLabel(groups: NavGroup[], fallback = ""): string {
  const { pathname } = useLocation();
  let best = "";
  let bestLen = -1;
  for (const g of groups) {
    for (const item of g.items) {
      const matches = pathname === item.to || pathname.startsWith(item.to + "/");
      if (matches && item.to.length > bestLen) { best = item.label; bestLen = item.to.length; }
    }
  }
  return best || fallback;
}

export interface NavItem {
  to: string;
  label: string;
  /** 过渡期标记：P1 会迁移/拆分的入口 */
  transitional?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export function Sidebar({ brand, subtitle, groups }: { brand: string; subtitle?: string; groups: NavGroup[] }) {
  // 父级路径（如 /admin、/studio）是其他项的前缀，NavLink 默认前缀匹配会导致它和当前子页同时高亮；
  // 给这类「被嵌套」的项加 end，使其只在精确匹配时 active。
  const allTargets = groups.flatMap((group) => group.items.map((item) => item.to));
  const isParentPath = (to: string) => allTargets.some((other) => other !== to && other.startsWith(to + "/"));
  return (
    <aside className="shell-sidebar">
      <div className="shell-brand">
        <span className="shell-brand-name">{brand}</span>
        {subtitle && <span className="shell-brand-sub">{subtitle}</span>}
      </div>
      <nav className="shell-nav">
        {groups.map((group) => (
          <div className="shell-nav-group" key={group.title}>
            <div className="shell-nav-title">{group.title}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={isParentPath(item.to)}
                className={({ isActive }) => `shell-nav-link ${isActive ? "is-active" : ""}`}
              >
                <span>{item.label}</span>
                {item.transitional && <span className="shell-nav-tag">P1</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

export function Topbar({ title, children }: { title?: ReactNode; children?: ReactNode }) {
  return (
    <header className="shell-topbar">
      <div className="shell-topbar-title">{title}</div>
      <div className="shell-topbar-actions">{children}</div>
    </header>
  );
}

export function ContentArea({ children }: { children: ReactNode }) {
  return <main className="shell-content">{children}</main>;
}
