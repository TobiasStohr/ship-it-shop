import { tool } from "ai";
import { getStepMetadata } from "workflow";
import { getRun, start } from "workflow/api";
import { HookConflictError } from "workflow/errors";
import { z } from "zod";
import {
  ApiRequestError,
  getCategories,
  getOrder,
  getProductById,
  getProducts,
  getProductStock,
} from "@/lib/api";
import { formatPrice } from "@/lib/format";
import { guard } from "@/lib/tool-guard";
import { CATEGORY_SLUGS, type Order, type Product } from "@/lib/types";
import { returnFlow, type ReturnRequest } from "@/lib/workflows/return-flow";

/**
 * Shopping agent tools. Each `execute` runs as a durable workflow step.
 * Tools return small DTOs for the model and the UI. Expected outcomes (no
 * results, unknown product or order) are data. Failures throw a short message
 * without request details.
 */

const MAX_RESULTS = 12;

export type ProductSummary = {
  id: string;
  slug: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  priceFormatted: string;
  image: string | null;
  url: string;
};

export type ProductDetails = ProductSummary & {
  description: string;
  tags: string[];
  stock: { count: number; inStock: boolean; lowStock: boolean } | null;
};

type SearchProductsOutput = {
  query: string | null;
  category: string | null;
  /** All matches. `products` holds the page from `offset`. */
  total: number;
  offset: number;
  products: ProductSummary[];
};

type ProductDetailsOutput =
  | { status: "found"; product: ProductDetails }
  | { status: "not_found"; idOrSlug: string };

type CategoriesOutput = {
  categories: { slug: string; name: string; productCount: number }[];
};

type OrderLine = {
  productId: string;
  name: string;
  quantity: number;
  priceFormatted: string;
};

export type OrderDetailsOutput =
  | {
      status: "found";
      order: {
        id: string;
        status: string;
        returnable: boolean;
        placedAt: string;
        totalFormatted: string;
        items: OrderLine[];
      };
    }
  | { status: "not_found"; orderId: string };

export type ReturnOrderOutput =
  | {
      status: "started";
      orderId: string;
      runId: string;
      items: { productId: string; name: string; quantity: number }[];
      itemValueFormatted: string;
    }
  | { status: "already_in_progress"; orderId: string; runId: string }
  | { status: "not_found"; orderId: string }
  | { status: "not_eligible"; orderId: string; orderStatus: string }
  | { status: "invalid_items"; orderId: string; message: string };

type SearchInput = {
  query?: string;
  category?: (typeof CATEGORY_SLUGS)[number];
  featured?: boolean;
  limit: number;
  offset: number;
};

const orderRef = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "Use the order id, e.g. 11111");

const productRef = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9_-]+$/i, "Use a product id or slug");

async function searchProductsStep(input: SearchInput): Promise<SearchProductsOutput> {
  "use step";
  return guard(async () => {
    const products = await searchCatalog(input);
    return {
      query: input.query ?? null,
      category: input.category ?? null,
      total: products.length,
      offset: input.offset,
      products: products.slice(input.offset, input.offset + input.limit).map(toSummary),
    };
  });
}
searchProductsStep.maxRetries = 2;

async function getAllCategoriesStep(): Promise<CategoriesOutput> {
  "use step";
  return guard(async () => {
    const categories = await getCategories();
    return {
      categories: categories.map(({ slug, name, productCount }) => ({ slug, name, productCount })),
    };
  });
}
getAllCategoriesStep.maxRetries = 2;

async function getProductDetailsStep({ idOrSlug }: { idOrSlug: string }): Promise<ProductDetailsOutput> {
  "use step";
  return guard(async () => {
    let product: Product;
    try {
      product = await getProductById(idOrSlug);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        return { status: "not_found", idOrSlug };
      }
      throw err;
    }

    // Stock is optional detail. A failed stock call still returns the product.
    const stock = await getProductStock(product.id).catch(() => null);

    return {
      status: "found",
      product: {
        ...toSummary(product),
        description: product.description,
        tags: product.tags,
        stock: stock && { count: stock.stock, inStock: stock.inStock, lowStock: stock.lowStock },
      },
    };
  });
}
getProductDetailsStep.maxRetries = 2;

/** Order lookup for returns. The output leaves out the email address. */
async function getOrderDetailsStep({ orderId }: { orderId: string }): Promise<OrderDetailsOutput> {
  "use step";
  return guard(async () => {
    const order = await findOrder(orderId);
    if (!order) return { status: "not_found", orderId };
    return {
      status: "found",
      order: {
        id: order.id,
        status: order.status,
        returnable: order.status === "fulfilled",
        placedAt: order.createdAt,
        totalFormatted: formatPrice(order.total, order.currency),
        items: order.items.map((item) => ({
          productId: item.productId,
          name: item.product?.name ?? item.productId,
          quantity: item.quantity,
          priceFormatted: formatPrice(item.unitPrice, order.currency),
        })),
      },
    };
  });
}
getOrderDetailsStep.maxRetries = 2;

/**
 * Checks the order, then starts the return workflow and returns at once.
 * The start hook token allows one active return workflow per order, so a
 * retry of this step or a repeated request reuses the running workflow.
 */
async function returnOrderStep(input: {
  orderId: string;
  reason: string;
  items: { productId: string; quantity: number }[];
}): Promise<ReturnOrderOutput> {
  "use step";
  return guard(async () => {
    const order = await findOrder(input.orderId);
    if (!order) return { status: "not_found", orderId: input.orderId };
    if (order.status !== "fulfilled") {
      return { status: "not_eligible", orderId: order.id, orderStatus: order.status };
    }

    const selection = selectReturnLines(order, input.items);
    if (!selection.ok) {
      return { status: "invalid_items", orderId: order.id, message: selection.message };
    }
    const { lines } = selection;

    const request: ReturnRequest = {
      orderId: order.id,
      reason: input.reason,
      items: lines.map(({ productId, quantity }) => ({ productId, quantity })),
    };
    const itemValue = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const summary = {
      orderId: order.id,
      items: lines.map(({ productId, name, quantity }) => ({ productId, name, quantity })),
      itemValueFormatted: formatPrice(itemValue, order.currency),
    };

    try {
      const run = await start(returnFlow, [request], {
        experimental_hook: { token: `return:${order.id}` },
      });
      return { status: "started", runId: run.runId, ...summary };
    } catch (err) {
      if (!HookConflictError.is(err)) throw err;
      if (err.conflictingRunId && (await startedByThisStep(err.conflictingRunId))) {
        return { status: "started", runId: err.conflictingRunId, ...summary };
      }
      // The running return may hold other items, so this request echoes none.
      return { status: "already_in_progress", orderId: order.id, runId: err.conflictingRunId ?? "unknown" };
    }
  });
}
returnOrderStep.maxRetries = 2;

// An earlier attempt of this step started the run when the run is newer than
// the first attempt. `stepStartedAt` keeps the time of the first attempt.
async function startedByThisStep(runId: string): Promise<boolean> {
  const { attempt, stepStartedAt } = getStepMetadata();
  if (attempt === 1) return false;
  try {
    return (await getRun(runId).createdAt) >= stepStartedAt;
  } catch {
    return false;
  }
}

// Defined after the steps. The workflow build turns each step into an
// assignment, which does not hoist like a function declaration.
export const shoppingTools = {
  searchProducts: tool({
    description:
      "Search the Ship It Shop catalog. Use a short keyword query such as 'hoodie' or 'mug', a category, or both. Returns at most 12 products per call with price and link. `total` counts all matches. Use `offset` to show the next products.",
    inputSchema: z.object({
      query: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe("Keywords from the product name, description or tags"),
      category: z
        .enum(CATEGORY_SLUGS)
        .optional()
        .describe("Category slug. Call getAllCategories if unsure."),
      featured: z.boolean().optional().describe("Only featured products"),
      limit: z.number().int().min(1).max(MAX_RESULTS).default(6),
      offset: z.number().int().min(0).max(100).default(0).describe("Skip this many matches"),
    }),
    execute: searchProductsStep,
  }),

  getAllCategories: tool({
    description: "List all product categories with their slug, name and product count.",
    inputSchema: z.object({}),
    execute: getAllCategoriesStep,
  }),

  getProductDetails: tool({
    description:
      "Get the full details and live stock of one product by id (e.g. 'hoodie_001') or slug (e.g. 'black-pullover-hoodie'). Use an id or slug from searchProducts.",
    inputSchema: z.object({ idOrSlug: productRef }),
    execute: getProductDetailsStep,
  }),

  getOrderDetails: tool({
    description:
      "Look up an order by id: status, whether it can be returned, and its items with product ids. Call it before returnOrder.",
    inputSchema: z.object({ orderId: orderRef }),
    execute: getOrderDetailsStep,
  }),

  returnOrder: tool({
    description:
      "Start a return for a delivered order. Needs the order id, the reason, and the items to return with product ids from getOrderDetails. The return runs in the background and the customer gets the decision by email.",
    inputSchema: z.object({
      orderId: orderRef,
      reason: z.string().trim().min(3).max(500),
      items: z
        .array(
          z.object({
            productId: productRef,
            quantity: z.number().int().min(1).max(20),
          }),
        )
        .min(1)
        .max(20)
        .describe("The items to return, with product ids from getOrderDetails"),
    }),
    execute: returnOrderStep,
  }),
};

type ReturnLine = { productId: string; name: string; quantity: number; unitPrice: number };

function selectReturnLines(
  order: Order,
  requested: { productId: string; quantity: number }[],
): { ok: true; lines: ReturnLine[] } | { ok: false; message: string } {
  const byId = new Map(order.items.map((item) => [item.productId, item]));
  const nameOf = (productId: string) => byId.get(productId)?.product?.name ?? productId;

  // The model can list one product twice, so quantities are summed first.
  const wanted = new Map<string, number>();
  for (const { productId, quantity } of requested) {
    wanted.set(productId, (wanted.get(productId) ?? 0) + quantity);
  }

  const lines: ReturnLine[] = [];
  for (const [productId, quantity] of wanted) {
    const item = byId.get(productId);
    if (!item) return { ok: false, message: `Order ${order.id} does not contain ${productId}.` };
    if (quantity > item.quantity) {
      return { ok: false, message: `Order ${order.id} has only ${item.quantity} of ${productId}.` };
    }
    lines.push({ productId, name: nameOf(productId), quantity, unitPrice: item.unitPrice });
  }
  return { ok: true, lines };
}

/**
 * The API matches the whole query as one phrase. When a phrase with several
 * words finds nothing, search each word and keep the products that match the
 * most words.
 */
async function searchCatalog(params: {
  query?: string;
  category?: string;
  featured?: boolean;
}): Promise<Product[]> {
  const base = { category: params.category, featured: params.featured, limit: 100 };
  const direct = await getProducts({ ...base, search: params.query });
  if (direct.length > 0 || !params.query) return direct;

  const words = [...new Set(params.query.toLowerCase().split(/\s+/))].filter(
    (word) => word.length >= 3,
  );
  if (words.length < 2) return [];

  const perWord = await Promise.all(
    words.map((word) => getProducts({ ...base, search: word })),
  );
  const hits = new Map<string, { product: Product; count: number }>();
  for (const product of perWord.flat()) {
    const entry = hits.get(product.id) ?? { product, count: 0 };
    entry.count++;
    hits.set(product.id, entry);
  }
  const best = Math.max(0, ...[...hits.values()].map((hit) => hit.count));
  return [...hits.values()]
    .filter((hit) => hit.count === best)
    .map((hit) => hit.product);
}

/** Returns null for an unknown order id. */
async function findOrder(orderId: string): Promise<Order | null> {
  try {
    return await getOrder(orderId);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}

function toSummary(product: Product): ProductSummary {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    price: product.price,
    currency: product.currency,
    priceFormatted: formatPrice(product.price, product.currency),
    image: product.images[0] ?? null,
    url: `/products/${product.slug}`,
  };
}
