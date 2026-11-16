/** Shared helpers for the end-to-end tests in `scripts/test-*.mts`. */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { z } from "zod";
import { ADMIN_COOKIE_NAME, sessionToken } from "../lib/admin-token.ts";

for (const file of [".env.local", ".env.sandbox.local"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3006";

const TURN_TIMEOUT = 120_000;

export const adminPassword = process.env.ADMIN_PASSWORD ?? "";
assert.ok(adminPassword, "ADMIN_PASSWORD is not set in .env.local");

const adminCookie = `${ADMIN_COOKIE_NAME}=${sessionToken(adminPassword)}`;

export function userMessage(text: string) {
  return {
    messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] }],
  };
}

/** Sends one chat turn and returns the whole streamed response as text. */
export async function chatTurn(text: string, options: { admin?: boolean; baseUrl?: string } = {}) {
  const path = options.admin ? "/api/admin/chat" : "/api/chat";
  const headers = new Headers({ "content-type": "application/json" });
  if (options.admin) headers.set("cookie", adminCookie);

  const response = await fetch(`${options.baseUrl ?? BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(userMessage(text)),
    signal: AbortSignal.timeout(TURN_TIMEOUT),
  });
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  return { body: await response.text(), runId: response.headers.get("x-workflow-run-id") };
}

// The fields of the UI stream chunks that the tests read.

const chunkSchema = z.object({
  type: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  errorText: z.string().optional(),
  output: z
    .object({
      status: z.string().optional(),
      products: z.array(z.object({ id: z.string() })).optional(),
    })
    .optional(),
});

type Chunk = z.infer<typeof chunkSchema>;

/** Parsed `data:` chunks of one turn. */
export function chunks(stream: string): Chunk[] {
  return stream
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => chunkSchema.parse(JSON.parse(line.slice(6))));
}

/** Tool names from the chunks of one turn. */
export function toolNames(stream: string): string[] {
  return chunks(stream).flatMap((chunk) => (chunk.type === "tool-input-start" && chunk.toolName ? [chunk.toolName] : []));
}

/** Outputs and error texts of the calls to one tool in a turn. Fails when there is none. */
export function callsOf(stream: string, tool: string) {
  const all = chunks(stream);
  const ids = new Set(
    all.filter((chunk) => chunk.type === "tool-input-start" && chunk.toolName === tool).map((chunk) => chunk.toolCallId),
  );
  const calls = all.filter(
    (chunk) => (chunk.type === "tool-output-available" || chunk.type === "tool-output-error") && ids.has(chunk.toolCallId),
  );
  assert.ok(calls.length > 0, `expected a ${tool} call`);
  return calls;
}
