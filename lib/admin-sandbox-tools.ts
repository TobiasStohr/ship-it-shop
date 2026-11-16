import { tool } from "ai";
import { RetryableError } from "workflow";
import { z } from "zod";
import {
  getBackOfficeReturns,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
  getProducts,
  getStoreConfig,
} from "@/lib/api";
import { endOfDay, todayUtc } from "@/lib/dates";
import { appendMemory, DATA_DIR, readMemory, runBash, writeDataFiles } from "@/lib/admin-sandbox";
import { backoff, guard } from "@/lib/tool-guard";

/**
 * Admin-only sandbox tools. `loadStoreData` copies store data into the
 * sandbox as JSON files, `bash` computes on them, and `saveMemory` appends a
 * note to the memory file. The shop agent never gets these tools.
 */

const DATASETS = ["products", "stock", "sales", "returns", "tickets"] as const;
type Dataset = (typeof DATASETS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const ROW_LIMIT = 500;

// Returns and tickets come from paged endpoints and stop at ROW_LIMIT rows.
const CAPPED = new Set<Dataset>(["returns", "tickets"]);

const SCHEMAS = {
  products: "id, name, category, priceCents, tags[]",
  stock: "productId, name, category, stock, inStock, lowStock (1-5 units)",
  sales: "productId, name, category, unitsSold, ordersCount, revenueCents (one row per product for the range)",
  returns: "id, orderId, items[{productId, quantity}], reason, status, decision (approved|rejected|needs_info|null), refundCents, createdAt",
  tickets: "id, subject, status, priority, category, relatedOrderId, relatedReturnId, assignee, createdAt, lastMessageAt",
} satisfies Record<Dataset, string>;

type LoadStoreDataOutput = {
  fetchedAt: string;
  range: { from: string; to: string };
  files: { path: string; rows: number; truncated: boolean; fields: string }[];
};

async function loadStoreDataStep(input: {
  datasets: Dataset[];
  from?: string;
  to?: string;
}): Promise<LoadStoreDataOutput> {
  "use step";
  return guard(async () => {
    const to = input.to ?? todayUtc();
    const from = input.from ?? new Date(Date.parse(to) - 30 * DAY_MS).toISOString().slice(0, 10);
    const range = { from, to: endOfDay(to) };
    const datasets = [...new Set(input.datasets)];

    const [{ currency }, rows] = await Promise.all([
      getStoreConfig(),
      Promise.all(datasets.map((name) => fetchDataset(name, range))),
    ]);
    const fetchedAt = new Date().toISOString();
    const files = datasets.map((name, i) => ({ name: `${name}.json`, content: JSON.stringify(rows[i]) }));
    files.push({
      name: "README.md",
      content: [
        `Fetched ${fetchedAt}. Sales, returns and tickets cover ${from} to ${to} (UTC).`,
        ...datasets.map((name) => `- ${name}.json: ${SCHEMAS[name]}`),
        `Money fields end in Cents and are ${currency} cents. Print money as f"{cents / 100:,.2f} ${currency}".`,
        `Returns and tickets hold at most ${ROW_LIMIT} rows. A file with ${ROW_LIMIT} rows may be cut.`,
        "",
      ].join("\n"),
    });
    await inSandbox(() => writeDataFiles(files));

    return {
      fetchedAt,
      range: { from, to },
      files: datasets.map((name, i) => ({
        path: `${DATA_DIR}/${name}.json`,
        rows: rows[i].length,
        truncated: CAPPED.has(name) && rows[i].length >= ROW_LIMIT,
        fields: SCHEMAS[name],
      })),
    };
  });
}
loadStoreDataStep.maxRetries = 2;

// A command can change files, so a failed command does not run again by itself.
async function bashStep({ command }: { command: string }) {
  "use step";
  return guard(() => inSandbox(() => runBash(command)));
}
bashStep.maxRetries = 0;

async function saveMemoryStep({ note }: { note: string }) {
  "use step";
  return guard(async () => {
    const entries = await inSandbox(() => appendMemory(note, todayUtc()));
    return { saved: note, entries };
  });
}
saveMemoryStep.maxRetries = 1;

export type MemoryState = { status: "ok"; text: string } | { status: "unavailable" };

/**
 * Reads the memory file for the prompt. A sandbox failure must not break the
 * chat, so it returns "unavailable" and the agent works without memory.
 */
export async function loadMemoryStep(): Promise<MemoryState> {
  "use step";
  try {
    return { status: "ok", text: await readMemory() };
  } catch (err) {
    console.error("[memory] read failed:", err instanceof Error ? err.message : err);
    return { status: "unavailable" };
  }
}
loadMemoryStep.maxRetries = 0;

// Defined after the steps. The workflow build turns each step into an
// assignment, which does not hoist like a function declaration.
export const sandboxTools = {
  loadStoreData: tool({
    description: `Copy store data into the sandbox as JSON files under ${DATA_DIR}/ so bash can compute on it. Call it before bash when the data is missing or older than this conversation. Sales, returns and tickets use the date range (default: last 30 days). Customer emails are not included.`,
    inputSchema: z
      .object({
        datasets: z.array(z.enum(DATASETS)).min(1).max(DATASETS.length),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD (UTC)"),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD (UTC), inclusive"),
      })
      .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "`from` must not be after `to`" }),
    execute: loadStoreDataStep,
  }),

  bash: tool({
    description: `Run a bash command in the admin sandbox (no network). The data files are in ${DATA_DIR}/ under the working directory, so use relative paths such as ${DATA_DIR}/sales.json. Use python3 (standard library) or node to join and aggregate them. Print a compact result. Output is cut at 6000 characters. Commands stop after 60 seconds.`,
    inputSchema: z.object({ command: z.string().min(1).max(4000) }),
    execute: bashStep,
  }),

  saveMemory: tool({
    description:
      "Append one short note to the long-term memory that the next admin conversations read. Save preferences, definitions and decisions the admin states, not raw numbers.",
    inputSchema: z.object({ note: z.string().trim().min(5).max(300) }),
    execute: saveMemoryStep,
  }),
};

/**
 * Sandbox failures reach the model as one fixed message. They retry with
 * backoff up to the step's maxRetries, because most are a slow resume.
 */
async function inSandbox<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    console.error("[sandbox] call failed:", cause instanceof Error ? cause.message : cause);
    throw new RetryableError("The sandbox is not available right now.", backoff());
  }
}

async function fetchDataset(name: Dataset, range: { from: string; to: string }): Promise<unknown[]> {
  switch (name) {
    case "products":
      return (await getProducts({ limit: 100 })).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        priceCents: p.price,
        tags: p.tags,
      }));
    case "stock":
      return (await getBackOfficeStock({ limit: 200 })).data.map((s) => ({
        productId: s.productId,
        name: s.product.name,
        category: s.product.category,
        stock: s.stock,
        inStock: s.inStock,
        lowStock: s.lowStock,
      }));
    case "sales":
      return (await getBackOfficeSales(range)).data.map((s) => ({
        productId: s.productId,
        name: s.product.name,
        category: s.product.category,
        unitsSold: s.unitsSold,
        ordersCount: s.ordersCount,
        revenueCents: s.revenue,
      }));
    case "returns":
      return (await getBackOfficeReturns({ ...range, limit: ROW_LIMIT })).data.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        items: r.items,
        reason: r.reason,
        status: r.status,
        decision: r.decision,
        refundCents: r.refundAmount,
        createdAt: r.createdAt,
      }));
    case "tickets":
      return (await getBackOfficeSupportTickets({ ...range, limit: ROW_LIMIT })).data.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        category: t.category,
        relatedOrderId: t.relatedOrderId,
        relatedReturnId: t.relatedReturnId,
        assignee: t.assignee,
        createdAt: t.createdAt,
        lastMessageAt: t.lastMessageAt,
      }));
  }
}
