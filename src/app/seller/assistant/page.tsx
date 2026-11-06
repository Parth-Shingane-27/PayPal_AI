import { ChatPanel } from "@/components/ChatPanel";

export const metadata = { title: "Assistant" };

export default function AssistantPage() {
  return (
    <ChatPanel
      title="Assistant"
      agent={null}
      placeholder="Ask anything about your shop. A new conversation is routed to the Listing, Treasury or Operations agent and stays with it."
    />
  );
}
