"use client";

import { useOrchestration } from "@/hooks/use-orchestration";
import { Header } from "@/components/pavan/header";
import { ChatPanel } from "@/components/pavan/chat-panel";
import { PreviewPanel } from "@/components/pavan/preview-panel";
import { StatusPanel } from "@/components/pavan/status-panel";
import { ArtifactsPanel } from "@/components/pavan/artifacts-panel";
import { SettingsDialog } from "@/components/pavan/settings-dialog";
import { LogsDialog } from "@/components/pavan/logs-dialog";

export default function Home() {
  useOrchestration();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <Header />

      {/* Main split: chat (primary) | side rail (preview + status + artifacts) */}
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Chat — the primary surface */}
        <section className="flex min-h-0 flex-1 flex-col border-b border-border lg:border-b-0 lg:border-r">
          <ChatPanel />
        </section>

        {/* Side rail */}
        <aside className="flex min-h-0 flex-col lg:w-[420px] xl:w-[460px] lg:shrink-0">
          {/* Preview takes the most vertical space */}
          <div className="flex min-h-0 flex-1 flex-col border-b border-border">
            <PreviewPanel />
          </div>

          {/* Status + Artifacts share the lower region */}
          <div className="grid min-h-0 grid-rows-2 border-b border-border">
            <div className="min-h-0 border-b border-border">
              <StatusPanel />
            </div>
            <div className="min-h-0">
              <ArtifactsPanel />
            </div>
          </div>
        </aside>
      </main>

      <SettingsDialog />
      <LogsDialog />
    </div>
  );
}
