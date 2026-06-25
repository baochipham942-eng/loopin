import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * 会话与角色模型（P0 地基）。
 *
 * Loopin 后台服务两类用户：
 * - platform_admin：平台运营，管主办方白名单、集成配置、全局监控
 * - organizer：主办方，管自己的活动生命周期
 *
 * P0 过渡期不接真实登录：角色由「是否配置了管理员令牌」推断可用性，
 * 并允许在顶栏手动切换以模拟真实分流。token 仍沿用既有 localStorage key
 * （与 Backoffice 视图保持一致，完整收敛留到 P1），这里只做读取与角色派生。
 */

export type Role = "platform_admin" | "organizer";

const ADMIN_TOKEN_KEY = "loopin.backofficeAdminToken";
const ROLE_KEY = "loopin.session.role";
const ORGANIZER_KEY = "loopin.session.organizerId";

function read(key: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(key)?.trim() ?? "";
}

function adminTokenPresent(): boolean {
  return read(ADMIN_TOKEN_KEY).length > 0;
}

interface SessionValue {
  role: Role;
  /** 当前是否具备进入平台管理员端的条件（已配置管理员令牌） */
  canBeAdmin: boolean;
  /** 主办方标识，P0 过渡期可空，注入到 API 组织上下文 */
  organizerId: string;
  setRole: (role: Role) => void;
  setOrganizerId: (id: string) => void;
  /** 预留：接入真实登录后由后端会话决定角色 */
  login: (payload: { role: Role; organizerId?: string }) => void;
  logout: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

function initialRole(): Role {
  const saved = read(ROLE_KEY);
  if (saved === "platform_admin" || saved === "organizer") return saved as Role;
  return "organizer";
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => initialRole());
  const [organizerId, setOrganizerIdState] = useState<string>(() => read(ORGANIZER_KEY));

  const setRole = useCallback((next: Role) => {
    setRoleState(next);
    if (typeof window !== "undefined") window.localStorage.setItem(ROLE_KEY, next);
  }, []);

  const setOrganizerId = useCallback((id: string) => {
    setOrganizerIdState(id);
    if (typeof window === "undefined") return;
    const trimmed = id.trim();
    if (trimmed) window.localStorage.setItem(ORGANIZER_KEY, trimmed);
    else window.localStorage.removeItem(ORGANIZER_KEY);
  }, []);

  const login = useCallback(
    (payload: { role: Role; organizerId?: string }) => {
      setRole(payload.role);
      if (payload.organizerId !== undefined) setOrganizerId(payload.organizerId);
    },
    [setRole, setOrganizerId],
  );

  const logout = useCallback(() => {
    setRole("organizer");
    setOrganizerId("");
  }, [setRole, setOrganizerId]);

  const value = useMemo<SessionValue>(
    () => ({
      role,
      canBeAdmin: adminTokenPresent(),
      organizerId,
      setRole,
      setOrganizerId,
      login,
      logout,
    }),
    [role, organizerId, setRole, setOrganizerId, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession 必须在 SessionProvider 内使用");
  return ctx;
}
