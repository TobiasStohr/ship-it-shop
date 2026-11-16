import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import {
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  type ToolSet,
  type UIMessage,
} from "ai";
import { getRun, start } from "workflow/api";
import { z } from "zod";

const MAX_MESSAGES = 40;
const MAX_BODY_BYTES = 200_000;

type ChatFlow<R> = (messages: UIMessage[]) => Promise<R>;

// Shape only. safeValidateUIMessages checks every message against the tools.
const bodySchema = z.object({ messages: z.array(z.unknown()) });

/** Validates the request, starts one chat turn as a workflow run, and streams it. */
export async function startChatTurn<R>(request: Request, flow: ChatFlow<R>, tools: ToolSet) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return Response.json({ error: "Request too large." }, { status: 413 });
  }
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    return Response.json({ error: "Request too large." }, { status: 413 });
  }

  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  const validated = parsed.success
    ? await safeValidateUIMessages({ messages: parsed.data.messages, tools })
    : parsed;
  if (!validated.success) {
    return Response.json({ error: "Invalid messages." }, { status: 400 });
  }

  const run = await start(flow, [validated.data.slice(-MAX_MESSAGES)]);

  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}

/**
 * Reconnects a client to a running chat turn. The durable stream stores raw
 * model parts while the client counts UI chunks, so the route replays from
 * the start and the transform skips the chunks the client already has.
 * Only runs of `flowName` are served, so other workflows stay private.
 */
export async function reconnectChatTurn(request: Request, runId: string, flowName: string) {
  if (!/^wrun_[A-Za-z0-9]{10,64}$/.test(runId)) {
    return Response.json({ error: "Invalid run id." }, { status: 400 });
  }

  const startIndex = Number(new URL(request.url).searchParams.get("startIndex") ?? "0");
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json({ error: "startIndex must be a non-negative integer." }, { status: 400 });
  }

  const run = getRun(runId);
  if (!(await run.exists) || !(await run.workflowName).endsWith(`//${flowName}`)) {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }

  return createUIMessageStreamResponse({
    stream: run
      .getReadable({ startIndex: 0 })
      .pipeThrough(createModelCallToUIChunkTransform({ uiStartIndex: startIndex })),
    headers: { "x-workflow-run-id": runId },
  });
}
