import { Navigate } from "react-router-dom";
import { useSession, type Role } from "./SessionContext.js";
import type { ReactNode } from "react";

/**
 * 角色网关（P0 地基）。把不属于当前角色的路由挡掉并重定向。
 * 平台管理员端要求 role===platform_admin；越权回主办方端。
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const session = useSession();
  if (session.role !== role) {
    const fallback = role === "platform_admin" ? "/studio" : "/admin";
    return <Navigate to={fallback} replace />;
  }
  return <>{children}</>;
}
