import { type ModelCallStreamPart, WorkflowAgent } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { SHOPPING_INSTRUCTIONS } from "@/lib/agent";
import { getChatModel } from "@/lib/ai/gateway";
import { shoppingTools } from "@/lib/tools";

/**
 * One chat turn as a durable run. Model calls and tool calls are steps, so a
 * crash or a timeout resumes the turn where it stopped. The client reads the
 * run stream and can reconnect to it after a refresh.
 */
export async function chatFlow(messages: UIMessage[]) {
  "use workflow";

  const agent = new WorkflowAgent({
    model: getChatModel(),
    instructions: SHOPPING_INSTRUCTIONS,
    tools: shoppingTools,
    stopWhen: isStepCount(8),
  });

  const result = await agent.stream({
    // A stopped turn can leave a tool call without a result in the history.
    messages: await convertToModelMessages(messages, {
      tools: shoppingTools,
      ignoreIncompleteToolCalls: true,
    }),
    writable: getWritable<ModelCallStreamPart>(),
  });

  return { steps: result.steps.length };
}
