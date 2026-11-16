"use client";

import { AgentChat } from "@/components/agent-chat";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
} from "@/components/ui/sidebar";

export function AgentSidebar() {
  return (
    <Sidebar
      side="right"
      collapsible="offcanvas"
      role="complementary"
      aria-label="Shopping assistant"
    >
      <SidebarHeader>
        <h2 className="px-2 py-1.5 text-sm font-semibold">
          Ship It Shop Agent
        </h2>
      </SidebarHeader>
      <SidebarContent className="overflow-hidden p-0">
        <AgentChat />
      </SidebarContent>
    </Sidebar>
  );
}
