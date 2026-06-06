import { useState } from "react";
import { CreateEvent } from "./views/CreateEvent.js";
import { Dashboard } from "./views/Dashboard.js";
import { CheckIn } from "./views/CheckIn.js";
import { Materials } from "./views/Materials.js";

type View = "create" | "dashboard" | "checkin" | "materials";

const TABS: { key: View; label: string }[] = [
  { key: "create", label: "建活动" },
  { key: "dashboard", label: "报名看板" },
  { key: "materials", label: "AI 物料" },
  { key: "checkin", label: "现场签到" },
];

export function App() {
  const [view, setView] = useState<View>("create");

  return (
    <div className="page">
      <header className="hero">
        <span className="badge">Loopin Studio</span>
        <h1>主办方控制台</h1>
        <p className="sub">先算这场能不能赚钱，再一键发布、追报名、现场签到。</p>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab ${view === t.key ? "tab-on" : ""}`} onClick={() => setView(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {view === "create" && <CreateEvent />}
      {view === "dashboard" && <Dashboard />}
      {view === "materials" && <Materials />}
      {view === "checkin" && <CheckIn />}

      <footer className="foot">Loopin · Find your people. Join the moment.</footer>
    </div>
  );
}
