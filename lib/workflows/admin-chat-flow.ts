import { type ModelCallStreamPart, WorkflowAgent } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { adminInstructions } from "@/lib/admin-agent";
import { loadMemoryStep } from "@/lib/admin-sandbox-tools";
import { adminTools } from "@/lib/admin-tools";
import { getChatModel } from "@/lib/ai/gateway";
import { todayUtc } from "@/lib/dates";

/** One admin chat turn as a durable run. It works like `chatFlow` with the admin tools and prompt. */
export async function adminChatFlow(messages: UIMessage[]) {
  "use workflow";

  // The workflow clock is deterministic, so a replay keeps the same date.
  const today = todayUtc();

  // Each turn reads the memory file, so notes saved earlier in the same
  // conversation count too.
  const memory = await loadMemoryStep();

  const agent = new WorkflowAgent({
    model: getChatModel(),
    instructions: adminInstructions(today, memory),
    tools: adminTools,
    stopWhen: isStepCount(12),
  });

  const result = await agent.stream({
    // A stopped turn can leave a tool call without a result in the history.
    messages: await convertToModelMessages(messages, {
      tools: adminTools,
      ignoreIncompleteToolCalls: true,
    }),
    writable: getWritable<ModelCallStreamPart>(),
  });

  return { steps: result.steps.length };
}
