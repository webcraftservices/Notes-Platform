import { Topbar } from "@/components/shell/topbar";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { AIChatPanel } from "@/components/ai/ai-chat-panel";

export default function AssistantPage() {
  return (
    <>
      <Topbar>
        <Breadcrumbs trail={[{ label: "AI Assistant" }]} />
      </Topbar>
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <AIChatPanel
            scope={{}}
            emptyStateHint="Questions are answered using everything indexed across your workspace, with clickable sources."
          />
        </div>
      </main>
    </>
  );
}

