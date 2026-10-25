import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { pushService } from "./services/PushNotificationService";

// Register PWA Service Worker
pushService.registerServiceWorker().catch(() => {});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
