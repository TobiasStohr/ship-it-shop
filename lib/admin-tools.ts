import { tool } from "ai";
import { z } from "zod";
import {
  ApiRequestError,
  getBackOfficeReturns,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
  getProducts,
  getStoreConfig,
} from "@/lib/api";
import { endOfDay } from "@/lib/dates";
import { formatPrice } from "@/lib/format";
import { sandboxTools } from "@/lib/admin-sandbox-tools";
import { guard } from "@/lib/tool-guard";
import { shoppingTools } from "@/lib/tools";

/**
 * Admin agent tools. All are read-only and run as durable workflow steps.
 * Outputs are small DTOs with counts computed here, so the model does not
 * add up long lists. Customer emails stay out of every output.
 */

const FETCH_LIMIT = 500;
const PREVIEW_CHARS = 160;

const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const TICKET_CATEGORIES = [
  "shipping",
  "returns",
  "product_quality",
  "sizing",
  "billing",
  "payment",
  "account",
  "other",
] as const;
const RETURN_STATUSES = ["pending", "processing", "completed"] as const;
const RETURN_DECISIONS = ["approved", "rejected", "needs_info"] as const;

type DateRange = { from?: string; to?: string };

type TicketRow = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  relatedOrderId: string | null;
  assignee: string | null;
  preview: string;
  lastMessageAt: string;
};

type SupportTicketsOutput = {
  range: { from: string; to: string };
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  /** True when the range has more rows than one fetch returns. */
  truncated: boolean;
  tickets: TicketRow[];
};

type ReturnRow = {
  id: string;
  orderId: string;
  items: { productId: string; name: string; quantity: number }[];
  reason: string;
  status: string;
  decision: string | null;
  refundFormatted: string | null;
  notes: string | null;
  order: { status: string; totalFormatted: string } | null;
  createdAt: string;
  processedAt: string | null;
};

type ReturnsHistoryOutput = {
  range: { from: string; to: string };
  total: number;
  byDecision: Record<string, number>;
  refundedFormatted: string;
  topReturnedProducts: { productId: string; name: string; units: number }[];
  truncated: boolean;
  returns: ReturnRow[];
};

type StockRow = {
  productId: string;
  name: string;
  category: string;
  stock: number;
  inStock: boolean;
  lowStock: boolean;
};

// The counts cover this page only. `pagination.total` counts all products.
type InventoryStockOutput = {
  lowStockOnPage: number;
  outOfStockOnPage: number;
  pagination: { page: number; totalPages: number; total: number; hasNextPage: boolean };
  rows: StockRow[];
};

type SalesRow = {
  productId: string;
  name: string;
  category: string;
  unitsSold: number;
  ordersCount: number;
  revenueFormatted: string;
};

type SalesAnalyticsOutput =
  | {
      status: "found";
      range: { from: string; to: string };
      days: number;
      totals: { unitsSold: number; ordersCount: number; revenueFormatted: string };
      productCount: number;
      rows: SalesRow[];
    }
  | { status: "not_found"; productId: string };

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a valid date");

const dateRange = {
  from: isoDate.optional().describe("Start date, YYYY-MM-DD (UTC). Default: 30 days before `to`."),
  to: isoDate.optional().describe("End date, YYYY-MM-DD (UTC), inclusive. Default: today."),
};

const rangeIsOrdered = (value: DateRange) => !value.from || !value.to || value.from <= value.to;
const RANGE_MESSAGE = { message: "`from` must not be after `to`", path: ["from"] };

async function getSupportTicketsStep(
  input: DateRange & {
    status?: (typeof TICKET_STATUSES)[number];
    priority?: (typeof TICKET_PRIORITIES)[number];
    category?: (typeof TICKET_CATEGORIES)[number];
    assignee?: string;
    limit: number;
  },
): Promise<SupportTicketsOutput> {
  "use step";
  return guard(async () => {
    const { limit, ...filters } = input;
    const { data, meta } = await getBackOfficeSupportTickets({
      ...filters,
      to: endOfDay(input.to),
      limit: FETCH_LIMIT,
    });
    const newestFirst = data.toSorted((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return {
      range: { from: meta.from, to: meta.to },
      total: data.length,
      byStatus: countBy(data, (t) => t.status),
      byPriority: countBy(data, (t) => t.priority),
      byCategory: countBy(data, (t) => t.category),
      truncated: data.length >= FETCH_LIMIT,
      tickets: newestFirst.slice(0, limit).map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        category: t.category,
        relatedOrderId: t.relatedOrderId,
        assignee: t.assignee,
        preview: t.messagePreview.slice(0, PREVIEW_CHARS),
        lastMessageAt: t.lastMessageAt,
      })),
    };
  });
}
getSupportTicketsStep.maxRetries = 2;

async function getReturnsHistoryStep(
  input: DateRange & {
    status?: (typeof RETURN_STATUSES)[number];
    decision?: (typeof RETURN_DECISIONS)[number];
    limit: number;
  },
): Promise<ReturnsHistoryOutput> {
  "use step";
  return guard(async () => {
    const { limit, ...filters } = input;
    const [{ data, meta }, names, config] = await Promise.all([
      getBackOfficeReturns({ ...filters, to: endOfDay(input.to), limit: FETCH_LIMIT }),
      productNames(),
      getStoreConfig(),
    ]);
    const money = (cents: number) => formatPrice(cents, config.currency);
    const nameOf = (id: string) => names.get(id) ?? id;

    const units = new Map<string, number>();
    for (const ret of data) {
      for (const item of ret.items) units.set(item.productId, (units.get(item.productId) ?? 0) + item.quantity);
    }
    const refunded = data.reduce((sum, ret) => sum + (ret.refundAmount ?? 0), 0);
    const newestFirst = data.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      range: { from: meta.from, to: meta.to },
      total: data.length,
      byDecision: countBy(data, (r) => r.decision ?? "undecided"),
      refundedFormatted: money(refunded),
      topReturnedProducts: [...units]
        .toSorted((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([productId, count]) => ({ productId, name: nameOf(productId), units: count })),
      truncated: data.length >= FETCH_LIMIT,
      returns: newestFirst.slice(0, limit).map((r) => ({
        id: r.id,
        orderId: r.orderId,
        items: r.items.map((item) => ({ ...item, name: nameOf(item.productId) })),
        reason: r.reason,
        status: r.status,
        decision: r.decision,
        refundFormatted: r.refundAmount === null ? null : money(r.refundAmount),
        notes: r.notes,
        order: r.order ? { status: r.order.status, totalFormatted: money(r.order.total) } : null,
        createdAt: r.createdAt,
        processedAt: r.processedAt,
      })),
    };
  });
}
getReturnsHistoryStep.maxRetries = 2;

async function getInventoryStockStep(input: {
  lowStock?: boolean;
  inStock?: boolean;
  productIds?: string[];
  page: number;
  limit: number;
}): Promise<InventoryStockOutput> {
  "use step";
  return guard(async () => {
    const { data, meta } = await getBackOfficeStock(input);
    const rows = data
      .map((entry) => ({
        productId: entry.productId,
        name: entry.product.name,
        category: entry.product.category,
        stock: entry.stock,
        inStock: entry.inStock,
        lowStock: entry.lowStock,
      }))
      .toSorted((a, b) => a.stock - b.stock);
    return {
      lowStockOnPage: rows.filter((row) => row.lowStock).length,
      outOfStockOnPage: rows.filter((row) => !row.inStock).length,
      pagination: {
        page: meta.pagination.page,
        totalPages: meta.pagination.totalPages,
        total: meta.pagination.total,
        hasNextPage: meta.pagination.hasNextPage,
      },
      rows,
    };
  });
}
getInventoryStockStep.maxRetries = 2;

async function getSalesAnalyticsStep(
  input: DateRange & { productId?: string; limit: number },
): Promise<SalesAnalyticsOutput> {
  "use step";
  return guard(async () => {
    try {
      const { data, meta } = await getBackOfficeSales({
        from: input.from,
        to: endOfDay(input.to),
        productId: input.productId,
      });
      const money = (cents: number) => formatPrice(cents, meta.currency);
      return {
        status: "found",
        range: { from: meta.from, to: meta.to },
        days: meta.days,
        totals: {
          unitsSold: meta.totals.unitsSold,
          ordersCount: meta.totals.ordersCount,
          revenueFormatted: money(meta.totals.revenue),
        },
        productCount: data.length,
        rows: data.slice(0, input.limit).map((row) => ({
          productId: row.productId,
          name: row.product.name,
          category: row.product.category,
          unitsSold: row.unitsSold,
          ordersCount: row.ordersCount,
          revenueFormatted: money(row.revenue),
        })),
      };
    } catch (err) {
      if (input.productId && err instanceof ApiRequestError && err.status === 404) {
        return { status: "not_found", productId: input.productId };
      }
      throw err;
    }
  });
}
getSalesAnalyticsStep.maxRetries = 2;

// Defined after the steps. The workflow build turns each step into an
// assignment, which does not hoist like a function declaration.
export const adminTools = {
  searchProducts: shoppingTools.searchProducts,
  getAllCategories: shoppingTools.getAllCategories,
  ...sandboxTools,

  getSupportTickets: tool({
    description:
      "Read support tickets in a date range with counts by status, priority and category, and the newest tickets. `truncated` means the range has more tickets than one fetch returns. Read-only.",
    inputSchema: z
      .object({
        ...dateRange,
        status: z.enum(TICKET_STATUSES).optional(),
        priority: z.enum(TICKET_PRIORITIES).optional(),
        category: z.enum(TICKET_CATEGORIES).optional(),
        assignee: z
          .string()
          .regex(/^[a-z0-9_.@-]{1,60}$/i)
          .optional()
          .describe("Only tickets assigned to this person, as shown in `assignee`"),
        limit: z.number().int().min(1).max(50).default(10).describe("How many tickets to list"),
      })
      .refine(rangeIsOrdered, RANGE_MESSAGE),
    execute: getSupportTicketsStep,
  }),

  getReturnsHistory: tool({
    description:
      "Read customer returns in a date range with counts by decision, the refunded total, the most returned products, and the newest returns with order and refund details. `truncated` means the range has more returns than one fetch returns. Read-only.",
    inputSchema: z
      .object({
        ...dateRange,
        status: z.enum(RETURN_STATUSES).optional(),
        decision: z.enum(RETURN_DECISIONS).optional(),
        limit: z.number().int().min(1).max(50).default(10).describe("How many returns to list"),
      })
      .refine(rangeIsOrdered, RANGE_MESSAGE),
    execute: getReturnsHistoryStep,
  }),

  getInventoryStock: tool({
    description:
      "Read live stock for all products or some product ids, sorted from lowest stock within a page. Low stock means 1 to 5 units. Check `pagination.hasNextPage` for more products. Read-only.",
    inputSchema: z.object({
      lowStock: z.boolean().optional().describe("true: only low stock. false: exclude low stock"),
      inStock: z.boolean().optional().describe("true: only in stock. false: only sold out"),
      productIds: z
        .array(z.string().regex(/^[a-z0-9_-]{1,60}$/i))
        .min(1)
        .max(50)
        .optional(),
      page: z.number().int().min(1).default(1).describe("Page of results, from 1"),
      limit: z.number().int().min(1).max(100).default(50).describe("Products per page"),
    }),
    execute: getInventoryStockStep,
  }),

  getSalesAnalytics: tool({
    description:
      "Read sales in a date range: totals and products sorted by units sold, with orders and revenue. Data covers about the last 180 days. Read-only.",
    inputSchema: z
      .object({
        ...dateRange,
        productId: z.string().regex(/^[a-z0-9_-]{1,60}$/i).optional(),
        limit: z.number().int().min(1).max(50).default(10).describe("How many products to list"),
      })
      .refine(rangeIsOrdered, RANGE_MESSAGE),
    execute: getSalesAnalyticsStep,
  }),
};

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return Object.fromEntries(counts);
}

async function productNames(): Promise<Map<string, string>> {
  const products = await getProducts({ limit: 100 });
  return new Map(products.map((product) => [product.id, product.name]));
}
