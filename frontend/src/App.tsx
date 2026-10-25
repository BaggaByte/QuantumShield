import React, { useState, useEffect } from "react";
import LandingPage from "@/pages/LandingPage";
import ChatPage from "@/pages/ChatPage";
import Preloader from "@/components/Preloader";
import IdentitySetup from "@/components/IdentitySetup";
import { useIdentity } from "@/hooks/useIdentity";
import { pushService } from "@/services/PushNotificationService";
import { api } from "@/services/api";

export default function App() {
  const [showPreloader, setShowPreloader] = useState(true);
  const [view, setView] = useState<"landing" | "chat">(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (url.searchParams.get("app") === "true" || window.location.hash.includes("room=")) {
        return "chat";
      }
    }
    return "landing";
  });

  const [canInstall, setCanInstall] = useState(false);
  const { identity, status, create, setAlias, exportJSON, destroy } = useIdentity();

  useEffect(() => {
    setCanInstall(pushService.canInstallPwa());
    const onCanInstall = () => setCanInstall(true);
    const onInstalled = () => setCanInstall(false);

    window.addEventListener("qs-can-install-pwa", onCanInstall);
    window.addEventListener("qs-pwa-installed", onInstalled);

    return () => {
      window.removeEventListener("qs-can-install-pwa", onCanInstall);
      window.removeEventListener("qs-pwa-installed", onInstalled);
    };
  }, []);

  const handleLaunchApp = () => {
    setView("chat");
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("app", "true");
      window.history.pushState({}, "", url.toString());
    } catch {
      // Ignore URL history errors in embedded contexts
    }
  };

  const handleBackToHome = () => {
    setView("landing");
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("app");
      window.history.pushState({}, "", url.toString());
    } catch {
      // Ignore URL history errors in embedded contexts
    }
  };

  const handleCreateRoom = async () => {
    try {
      const res = await api.createRoom();
      window.location.hash = `room=${res.room_id}`;
      handleLaunchApp();
    } catch (err) {
      console.error("Instant room creation error:", err);
      handleLaunchApp();
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-wa-dark text-wa-body font-sans select-none flex flex-col relative">
      {/* Brand Logo Preloader Splash Screen */}
      {showPreloader && (
        <Preloader onFinish={() => setShowPreloader(false)} duration={1400} />
      )}

      {/* Cryptographic Identity Onboarding (Shown once on first visit in chat mode) */}
      {view === "chat" && status === "none" && (
        <IdentitySetup
          onComplete={async (alias) => {
            await create(alias);
          }}
        />
      )}

      {/* Main View Router: High-Conversion Landing Page vs Production Chat App */}
      {view === "landing" ? (
        <div className="h-full w-full overflow-y-auto overflow-x-hidden">
          <LandingPage
            onLaunchApp={handleLaunchApp}
            onCreateRoom={handleCreateRoom}
          />
        </div>
      ) : (
        <ChatPage
          identity={identity}
          canInstall={canInstall}
          onPromptInstall={() => pushService.promptInstallPwa()}
          onAliasChange={setAlias}
          onExportIdentity={exportJSON}
          onDestroyIdentity={destroy}
          onBackToHome={handleBackToHome}
        />
      )}
    </div>
  );
}
