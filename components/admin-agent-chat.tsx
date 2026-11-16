"use client";

import { isStaticToolUIPart } from "ai";
import { AdminToolPartView } from "@/components/agent-ui/admin-tool-part";
import { DurableChat } from "@/components/durable-chat";
import type { AdminAgentUIMessage } from "@/lib/admin-agent";
import { ADMIN_CHAT_STORAGE_KEY } from "@/lib/admin-chat-storage";

const SUGGESTIONS = [
  "Show me low-stock items",
  "What were yesterday's top sellers?",
  "Summarize this week's revenue",
  "Which products have the highest return rates?",
  "Which low-stock products are top sellers?",
  "Which urgent support tickets are open?",
];

export function AdminAgentChat() {
  return (
    <DurableChat<AdminAgentUIMessage>
      api="/api/admin/chat"
      storageKey={ADMIN_CHAT_STORAGE_KEY}
      suggestions={SUGGESTIONS}
      emptyTitle="Ask about the store"
      emptyDescription="Stock, sales, returns and support tickets. Store data is read-only. A sandbox computes joins and rates."
      placeholder="Ask the admin agent…"
      inputLabel="Message the admin agent"
      renderPart={(part) => (isStaticToolUIPart(part) ? <AdminToolPartView part={part} /> : null)}
    />
  );
}
