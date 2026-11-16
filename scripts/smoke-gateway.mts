/**
 * Streams one answer with one tool call through the gateway that
 * MODEL_GATEWAY selects. Run with `pnpm smoke:gateway`.
 */
import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";
import { getChatModel, getModelGateway } from "../lib/ai/gateway.ts";

const started = Date.now();
let toolCalls = 0;
let textDeltas = 0;
let errors = 0;

const result = streamText({
  model: getChatModel(),
  instructions:
    "You are a store assistant. Use the tool for stock questions. Answer in one short sentence.",
  prompt: "How many black hoodies are in stock?",
  stopWhen: isStepCount(3),
  tools: {
    getStock: tool({
      description: "Get the stock count for a product name",
      inputSchema: z.object({ product: z.string() }),
      execute: async ({ product }) => {
        toolCalls++;
        return { product, stock: 42 };
      },
    }),
  },
});

for await (const part of result.fullStream) {
  if (part.type === "text-delta") textDeltas++;
  if (part.type === "error") errors++;
}

const answer = await result.text;
const ok = errors === 0 && toolCalls > 0 && textDeltas > 0 && answer.includes("42");

console.log(
  JSON.stringify({ gateway: getModelGateway(), ok, toolCalls, textDeltas, ms: Date.now() - started, answer }),
);
process.exit(ok ? 0 : 1);
