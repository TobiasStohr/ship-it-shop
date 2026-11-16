"use client";

import { isStaticToolUIPart } from "ai";
import { DurableChat } from "@/components/durable-chat";
import { ShoppingToolPartView } from "@/components/agent-ui/shopping-tool-part";
import type { ShoppingAgentUIMessage } from "@/lib/agent";

const SUGGESTIONS = [
  "Show me hoodies",
  "What categories do you have?",
  "Is the black pullover hoodie in stock?",
];

export function AgentChat() {
  return (
    <DurableChat<ShoppingAgentUIMessage>
      api="/api/chat"
      storageKey="ship-it-shop:chat"
      suggestions={SUGGESTIONS}
      emptyTitle="Ask about products"
      emptyDescription="Search the catalog, compare items, check stock or start a return."
      placeholder="Ask about products or returns"
      inputLabel="Message the shopping assistant"
      renderPart={(part) => (isStaticToolUIPart(part) ? <ShoppingToolPartView part={part} /> : null)}
    />
  );
}
