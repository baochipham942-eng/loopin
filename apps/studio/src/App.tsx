import { Routes, Route, Navigate } from "react-router-dom";
import { SessionProvider, useSession } from "./session/SessionContext.js";
import { EventProvider } from "./event/EventContext.js";
import { RequireRole } from "./session/RequireRole.js";
import { StudioLayout } from "./layout/StudioLayout.js";
import { AdminLayout } from "./layout/AdminLayout.js";
import { AdminPlaceholder } from "./views/AdminPlaceholder.js";
import { TopicSignalsAdmin } from "./views/admin/TopicSignalsAdmin.js";
import { IntegrationsAdmin } from "./views/admin/IntegrationsAdmin.js";
import { Dashboard } from "./views/Dashboard.js";
import { Review } from "./views/Review.js";
import { Materials } from "./views/Materials.js";
import { CheckIn } from "./views/CheckIn.js";
import { TeamMembers } from "./views/TeamMembers.js";
import { FormBuilder } from "./views/FormBuilder.js";
import { EventList } from "./views/EventList.js";
import { Tickets } from "./views/Tickets.js";
import { Recap } from "./views/Recap.js";
import { DataAdmin } from "./views/admin/DataAdmin.js";
import { OrganizersAdmin } from "./views/admin/OrganizersAdmin.js";
import { PlatformOverview } from "./views/admin/PlatformOverview.js";
import { EventsMonitor } from "./views/admin/EventsMonitor.js";
import { CreateEventRoute, TopicRadarRoute, OperationsRoute } from "./routes/studioRoutes.js";

const STUDIO_VIEWS = ["events", "operations", "topic-radar", "create", "form", "tickets", "dashboard", "review", "materials", "checkin", "recap", "team"];

/** 兼容旧 URL（?view= / ?invite=）并按角色落地。 */
function RootRedirect() {
  const { role } = useSession();
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  if (params.get("invite")) return <Navigate to="/studio/team" replace />;
  const view = params.get("view");
  if (view === "backoffice") return <Navigate to="/studio/team" replace />;
  if (view && STUDIO_VIEWS.includes(view)) return <Navigate to={`/studio/${view}`} replace />;
  return <Navigate to={role === "platform_admin" ? "/admin" : "/studio"} replace />;
}

export function App() {
  return (
    <SessionProvider>
      <EventProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />

          <Route
            path="/admin"
            element={
              <RequireRole role="platform_admin">
                <AdminLayout />
              </RequireRole>
            }
          >
            <Route index element={<PlatformOverview />} />
            <Route path="organizers" element={<OrganizersAdmin />} />
            <Route path="events" element={<EventsMonitor />} />
            <Route path="integrations" element={<IntegrationsAdmin />} />
            <Route path="topic-feeds" element={<TopicSignalsAdmin />} />
            <Route path="backoffice" element={<DataAdmin />} />
            <Route path="*" element={<AdminPlaceholder />} />
          </Route>

          <Route path="/studio" element={<StudioLayout />}>
            <Route index element={<Navigate to="/studio/events" replace />} />
            <Route path="events" element={<EventList />} />
            <Route path="operations" element={<OperationsRoute />} />
            <Route path="team" element={<TeamMembers />} />
            <Route path="backoffice" element={<Navigate to="/studio/team" replace />} />
            <Route path="topic-radar" element={<TopicRadarRoute />} />
            <Route path="create" element={<CreateEventRoute />} />
            <Route path="form" element={<FormBuilder />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="review" element={<Review />} />
            <Route path="materials" element={<Materials />} />
            <Route path="checkin" element={<CheckIn />} />
            <Route path="recap" element={<Recap />} />
          </Route>

          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </EventProvider>
    </SessionProvider>
  );
}
