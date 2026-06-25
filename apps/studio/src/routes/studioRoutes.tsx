import { useNavigate, useLocation } from "react-router-dom";
import { CreateEvent, type CreateEventDraft } from "../views/CreateEvent.js";
import { TopicRadar } from "../views/TopicRadar.js";
import { Operations } from "../views/Operations.js";

/**
 * 路由包装器（P0 地基）。
 * 视图内部不改，原有的跨页跳转回调（App 里的 useState 切换）在这里翻译成 router 跳转。
 */

export function CreateEventRoute() {
  const location = useLocation();
  const draft = (location.state as { draft?: CreateEventDraft } | null)?.draft ?? null;
  return <CreateEvent initialDraft={draft} />;
}

export function TopicRadarRoute() {
  const navigate = useNavigate();
  return <TopicRadar onUseTopic={(draft) => navigate("/studio/create", { state: { draft } })} />;
}

export function OperationsRoute() {
  const navigate = useNavigate();
  // Operations 的 onNavigate 取值与现有 view key 一致，直接映射到 /studio/<view>
  return <Operations onNavigate={(view) => navigate(`/studio/${view}`)} />;
}
