/**
 * Failure tests. Runs against a production server (`pnpm build && pnpm start -p 3006`).
 *
 * Covers invalid input on the chat routes, a missing record and an empty
 * search result. The API-down case needs a second server whose store API is
 * unreachable, so it runs only when API_DOWN_BASE_URL is set.
 *
 *   pnpm test:failures
 *   API_BASE_URL=http://127.0.0.1:9 pnpm start -p 3005    # second shell, for the API-down case
 *   API_DOWN_BASE_URL=http://localhost:3005 pnpm test:failures
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { BASE_URL, callsOf, chatTurn, chunks, userMessage } from "./test-helpers.mts";

const errorSchema = z.object({ error: z.string() });

async function postChat(body: string) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return { status: response.status, json: errorSchema.parse(await response.json()) };
}

describe("invalid input", { concurrency: true }, () => {
  it("rejects a body that is not JSON", async () => {
    const { status, json } = await postChat("{not json");
    assert.equal(status, 400);
    assert.equal(json.error, "Invalid JSON.");
  });

  it("rejects messages that are not UI messages", async () => {
    const { status, json } = await postChat(JSON.stringify({ messages: [{ role: "user" }] }));
    assert.equal(status, 400);
    assert.equal(json.error, "Invalid messages.");
  });

  it("rejects a body over 200 KB", async () => {
    const { status } = await postChat(JSON.stringify(userMessage("x".repeat(210_000))));
    assert.equal(status, 413);
  });

  it("rejects a malformed run id", async () => {
    const response = await fetch(`${BASE_URL}/api/chat/not-a-run/stream`);
    assert.equal(response.status, 400);
  });

  it("returns 404 for an unknown run", async () => {
    const response = await fetch(`${BASE_URL}/api/chat/wrun_00000000000000000000000000/stream`);
    assert.equal(response.status, 404);
  });

  it("rejects a negative startIndex", async () => {
    const { runId } = await chatTurn("Say hi in one word.");
    const response = await fetch(`${BASE_URL}/api/chat/${runId}/stream?startIndex=-1`);
    assert.equal(response.status, 400);
  });
});

describe("agent results", { concurrency: true }, () => {
  it("reports a missing order as not found", async () => {
    const { body } = await chatTurn("Show me the details of order 99999.");
    const lookups = callsOf(body, "getOrderDetails");
    assert.ok(lookups.every((call) => call.output?.status === "not_found"));
  });

  it("returns an empty list for a search without matches", async () => {
    const { body } = await chatTurn("Do you sell a flux capacitor? Search the catalog.");
    for (const search of callsOf(body, "searchProducts")) {
      assert.deepEqual(search.output?.products, [], "expected no products");
    }
  });
});

describe("store API down", { skip: !process.env.API_DOWN_BASE_URL }, () => {
  it("fails the tool call and still finishes the turn", async () => {
    const { body } = await chatTurn("Search the catalog for hoodies.", {
      baseUrl: process.env.API_DOWN_BASE_URL,
    });
    const searches = callsOf(body, "searchProducts");
    assert.ok(searches.every((call) => call.errorText !== undefined), "expected tool errors");
    assert.ok(chunks(body).some((chunk) => chunk.type === "finish"), "expected the turn to finish");
  });
});
