import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App.js";
import "./styles.css";

// HashRouter：Studio 为独立静态包，部署在 FC custom domain，
// hash 路由刷新不会 404，免去服务端 rewrite 配置。
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
