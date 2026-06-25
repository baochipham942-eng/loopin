import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../api.js";

/**
 * 全局「当前活动」上下文（P0 地基）。
 *
 * 现状各视图各自维护一个活动下拉，体验割裂。P0 在顶栏建一个全局活动切换器，
 * 把选中的活动沉淀到这里并持久化。注意：P0 只建 context + 顶栏 UI，
 * 各视图暂时保留自身的 select，接入 useCurrentEvent 删除本地 select 留到 P1。
 */

export interface EventLite {
  id: string;
  title: string;
}

const CURRENT_EVENT_KEY = "loopin.session.currentEventId";

function readCurrent(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(CURRENT_EVENT_KEY)?.trim() ?? "";
}

interface EventValue {
  events: EventLite[];
  currentEventId: string;
  currentEvent: EventLite | null;
  loading: boolean;
  setCurrentEvent: (id: string) => void;
  refresh: () => void;
}

const EventContext = createContext<EventValue | null>(null);

export function EventProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<EventLite[]>([]);
  const [currentEventId, setCurrentEventIdState] = useState<string>(() => readCurrent());
  const [loading, setLoading] = useState(false);

  const setCurrentEvent = useCallback((id: string) => {
    setCurrentEventIdState(id);
    if (typeof window === "undefined") return;
    if (id) window.localStorage.setItem(CURRENT_EVENT_KEY, id);
    else window.localStorage.removeItem(CURRENT_EVENT_KEY);
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    api
      .get("/events")
      .then((r: { events?: EventLite[] }) => {
        const list = r.events ?? [];
        setEvents(list);
        // 当前选中失效或未选时，回退到第一场
        setCurrentEventIdState((prev) => {
          if (prev && list.some((e) => e.id === prev)) return prev;
          const fallback = list[0]?.id ?? "";
          if (typeof window !== "undefined") {
            if (fallback) window.localStorage.setItem(CURRENT_EVENT_KEY, fallback);
            else window.localStorage.removeItem(CURRENT_EVENT_KEY);
          }
          return fallback;
        });
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const currentEvent = useMemo(
    () => events.find((e) => e.id === currentEventId) ?? null,
    [events, currentEventId],
  );

  const value = useMemo<EventValue>(
    () => ({ events, currentEventId, currentEvent, loading, setCurrentEvent, refresh }),
    [events, currentEventId, currentEvent, loading, setCurrentEvent, refresh],
  );

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
}

export function useCurrentEvent(): EventValue {
  const ctx = useContext(EventContext);
  if (!ctx) throw new Error("useCurrentEvent 必须在 EventProvider 内使用");
  return ctx;
}
