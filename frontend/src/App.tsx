import React, { useState, useEffect } from "react";
import ChatPage from "@/pages/ChatPage";
import IdentitySetup from "@/components/IdentitySetup";
import { useIdentity } from "@/hooks/useIdentity";
import { pushService } from "@/services/PushNotificationService";

export default function App() {
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

  return (
    <div className="h-screen w-screen overflow-hidden bg-wa-dark text-wa-body font-sans select-none flex flex-col">
      {/* Cryptographic Identity Onboarding (Shown once on first visit) */}
      {status === "none" && (
        <IdentitySetup
          onComplete={async (alias) => {
            await create(alias);
          }}
        />
      )}

      {/* Primary Work Environment: WhatsApp Web Post-Quantum Messenger */}
      <ChatPage
        identity={identity}
        canInstall={canInstall}
        onPromptInstall={() => pushService.promptInstallPwa()}
        onAliasChange={setAlias}
        onExportIdentity={exportJSON}
        onDestroyIdentity={destroy}
      />
    </div>
  );
}
