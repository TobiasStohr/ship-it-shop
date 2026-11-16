import type {
  ApiError,
  BackOfficeDateRangeMeta,
  BackOfficeReturnDecision,
  BackOfficeReturnStatus,
  BackOfficeSalesMeta,
  BackOfficeStockMeta,
  CartWithProducts,
  CategorySlug,
  Category,
  PaginationMeta,
  Product,
  ProductSalesRow,
  Promotion,
  StockEntry,
  StockInfo,
  StoreConfig,
  SupportTicket,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
  Order,
  RefundPreauthorization,
  Return,
} from "./types";

const API_BASE_URL =
  process.env.API_BASE_URL ??
  "https://vercel-agentic-swag-store-api.vercel.app/api";
const PROTECTION_BYPASS = process.env.BYPASS_SECRET ?? "";
const REQUEST_TIMEOUT_MS = 10_000;

// Read endpoints revalidate after 5 minutes.
const DEFAULT_REVALIDATE = 300;

interface RequestOptions {
  method?: string;
  body?: unknown;
  cartToken?: string;
  cache?: RequestCache;
  next?: { revalidate?: number; tags?: string[] };
  /** Sent as `Idempotency-Key` on writes that a workflow step may retry. */
  idempotencyKey?: string;
}

interface ApiSuccess<T, M = { pagination?: PaginationMeta }> {
  success: true;
  data: T;
  meta?: M;
}

interface ApiFailure {
  success: false;
  error: ApiError;
}

interface CreateReturnInput {
  orderId: string;
  items: { productId: string; quantity: number }[];
  reason: string;
  /** Webhook URL for the return decision. */
  callback?: string;
}

type ApiResult<T, M = { pagination?: PaginationMeta }> =
  | ApiSuccess<T, M>
  | ApiFailure;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    /** The API's own validation text for a 4xx. It holds no URL or header. */
    readonly safeDetail?: string,
  ) {
    super(message);
  }
}

async function readEnvelope<T, M>(res: Response): Promise<ApiResult<T, M> | undefined> {
  try {
    // JUSTIFICATION: the store API wraps every JSON body in the ApiResult envelope
    // (OpenAPI spec). Callers check `success` before they read `data`.
    return (await res.json()) as ApiResult<T, M>;
  } catch {
    return undefined;
  }
}

/** Sends one request and returns the success envelope or throws ApiRequestError. */
async function send<T, M>(path: string, options: RequestOptions = {}): Promise<ApiSuccess<T, M>> {
  const { method = "GET", body, cartToken, cache, next, idempotencyKey } = options;

  const headers = new Headers({ "x-vercel-protection-bypass": PROTECTION_BYPASS });
  if (cartToken) headers.set("x-cart-token", cartToken);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  if (body !== undefined) headers.set("content-type", "application/json");

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache,
      next,
      // A hung call fails as a network error, so the step retries.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    console.error(`[api] ${method} ${path} network error:`, cause instanceof Error ? cause.message : cause);
    throw new ApiRequestError(0, "NETWORK_ERROR", `Network request failed: ${method} ${path}`);
  }

  const json = await readEnvelope<T, M>(res);
  if (!res.ok || !json || !json.success) throw failure(res, json, `${method} ${path}`);
  return json;
}

function failure<T, M>(res: Response, json: ApiResult<T, M> | undefined, label: string): ApiRequestError {
  const apiErr = json && !json.success ? json.error : undefined;
  const error = new ApiRequestError(
    res.status,
    apiErr?.code,
    apiErr?.message ?? `API request failed: ${res.status} ${label}`,
    res.status < 500 ? apiErr?.message : undefined,
  );
  // Callers expect some 404s (no active promotion), so those stay out of the log.
  if (res.status !== 404) {
    console.error(`[api] ${label} failed:`, { status: error.status, code: error.code, message: error.message });
  }
  return error;
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  return (await send<T, { pagination?: PaginationMeta }>(path, options)).data;
}

/** Returns `data` and `meta` for back-office endpoints whose meta carries ranges, totals or paging. */
async function requestWithMeta<T, M>(
  path: string,
  options?: RequestOptions,
): Promise<{ data: T; meta: M }> {
  const json = await send<T, M>(path, options);
  if (json.meta === undefined) {
    console.error(`[api] ${path} failed: response has no meta`);
    throw new ApiRequestError(200, undefined, `API response missing meta: ${path}`);
  }
  return { data: json.data, meta: json.meta };
}

type QueryValue = string | number | boolean | string[] | undefined;

// Builds `path?query`. Skips unset values, empty strings, empty lists and 0.
// Lists join with commas and booleans become "true" or "false".
function withQuery<P extends { [K in keyof P]?: QueryValue }>(path: string, params: P): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries<QueryValue>(params)) {
    if (value === undefined || value === "" || value === 0) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) qs.set(key, value.join(","));
      continue;
    }
    qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

export interface GetProductsParams {
  page?: number;
  limit?: number;
  category?: CategorySlug | string;
  search?: string;
  featured?: boolean;
}

export async function getProducts(
  params: GetProductsParams = {},
): Promise<Product[]> {
  console.log("[getProducts]", params);
  const path = withQuery("/products", params);
  return request<Product[]>(path, {
    next: { revalidate: DEFAULT_REVALIDATE, tags: ["products"] },
  });
}

export async function getProductById(idOrSlug: string): Promise<Product> {
  return request<Product>(`/products/${encodeURIComponent(idOrSlug)}`, {
    next: {
      revalidate: DEFAULT_REVALIDATE,
      tags: ["products", `product:${idOrSlug}`],
    },
  });
}

export async function getCategories(): Promise<Category[]> {
  console.log("[getCategories]");
  return request<Category[]>("/categories", {
    next: { revalidate: DEFAULT_REVALIDATE, tags: ["categories"] },
  });
}

export async function getPromotion(): Promise<Promotion | null> {
  try {
    return await request<Promotion>("/promotions", {
      next: { revalidate: 60, tags: ["promotion"] },
    });
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) return null;
    throw err;
  }
}

export async function getStoreConfig(): Promise<StoreConfig> {
  return request<StoreConfig>("/store/config", {
    next: { revalidate: DEFAULT_REVALIDATE, tags: ["store-config"] },
  });
}

export async function getProductStock(idOrSlug: string): Promise<StockInfo> {
  return request<StockInfo>(`/products/${encodeURIComponent(idOrSlug)}/stock`, {
    cache: "no-store",
  });
}

export async function cartCreate(): Promise<{
  token: string;
  cart: CartWithProducts;
}> {
  const res = await fetch(`${API_BASE_URL}/cart/create`, {
    method: "POST",
    headers: {
      "x-vercel-protection-bypass": PROTECTION_BYPASS,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      undefined,
      `cartCreate failed: ${res.status}`,
    );
  }
  const token = res.headers.get("x-cart-token") ?? "";
  const json = await readEnvelope<CartWithProducts, undefined>(res);
  if (!json?.success) {
    throw new ApiRequestError(res.status, json?.error.code, json?.error.message ?? "cartCreate failed");
  }
  return { token: token || json.data.token, cart: json.data };
}

export async function cartGet(token: string): Promise<CartWithProducts> {
  return request<CartWithProducts>("/cart", {
    cartToken: token,
    cache: "no-store",
  });
}

export async function cartAdd(
  token: string,
  productId: string,
  quantity: number = 1,
): Promise<CartWithProducts> {
  return request<CartWithProducts>("/cart", {
    method: "POST",
    cartToken: token,
    body: { productId, quantity },
    cache: "no-store",
  });
}

export async function cartUpdate(
  token: string,
  productId: string,
  quantity: number,
): Promise<CartWithProducts> {
  return request<CartWithProducts>(`/cart/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    cartToken: token,
    body: { quantity },
    cache: "no-store",
  });
}

export async function cartRemove(
  token: string,
  productId: string,
): Promise<CartWithProducts> {
  return request<CartWithProducts>(`/cart/${encodeURIComponent(productId)}`, {
    method: "DELETE",
    cartToken: token,
    cache: "no-store",
  });
}

export async function getOrder(id: string): Promise<Order> {
  return request<Order>(`/orders/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
}

export async function createReturn(
  input: CreateReturnInput,
  idempotencyKey?: string,
): Promise<Return> {
  return request<Return>("/returns", {
    method: "POST",
    body: input,
    cache: "no-store",
    idempotencyKey,
  });
}

export async function getReturn(id: string): Promise<Return> {
  return request<Return>(`/returns/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
}

export async function notifyReturnInProcess(orderId: string): Promise<void> {
  // In production this would hit your email provider.
  console.log(
    `[returnOrder] 📧 told customer their return for order ${orderId} is being processed`,
  );
}

export async function preauthorizeRefund(
  orderId: string,
  idempotencyKey?: string,
): Promise<RefundPreauthorization> {
  return request<RefundPreauthorization>("/refunds/preauthorize", {
    method: "POST",
    body: { orderId },
    cache: "no-store",
    idempotencyKey,
  });
}

// Back-office reads feed the admin agent and use `cache: "no-store"`.

export interface GetBackOfficeReturnsParams {
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to 30 days before `to`. */
  from?: string;
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to now. */
  to?: string;
  status?: BackOfficeReturnStatus;
  decision?: BackOfficeReturnDecision;
  /** 1–500, default 25. */
  limit?: number;
}

export async function getBackOfficeReturns(
  params: GetBackOfficeReturnsParams = {},
): Promise<{ data: Return[]; meta: BackOfficeDateRangeMeta }> {
  const path = withQuery("/back-office/returns", params);
  return requestWithMeta<Return[], BackOfficeDateRangeMeta>(path, {
    cache: "no-store",
  });
}

export interface GetBackOfficeSupportTicketsParams {
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to 30 days before `to`. */
  from?: string;
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to now. */
  to?: string;
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
  category?: SupportTicketCategory;
  /** Staff username (e.g. `alex`). Unassigned tickets are excluded when set. */
  assignee?: string;
  /** 1–500, default 25. */
  limit?: number;
}

export async function getBackOfficeSupportTickets(
  params: GetBackOfficeSupportTicketsParams = {},
): Promise<{ data: SupportTicket[]; meta: BackOfficeDateRangeMeta }> {
  const path = withQuery("/back-office/support-tickets", params);
  return requestWithMeta<SupportTicket[], BackOfficeDateRangeMeta>(path, {
    cache: "no-store",
  });
}

export interface GetBackOfficeStockParams {
  /** Restrict to specific product IDs. Joined as a comma-separated list. */
  productIds?: string[];
  /** When set, filters to (or excludes) products with 1–5 units in stock. */
  lowStock?: boolean;
  /** When set, filters to (or excludes) products with at least one unit. */
  inStock?: boolean;
  /** 1-based page number, default 1. */
  page?: number;
  /** 1–200, default 50. */
  limit?: number;
}

export async function getBackOfficeStock(
  params: GetBackOfficeStockParams = {},
): Promise<{ data: StockEntry[]; meta: BackOfficeStockMeta }> {
  const path = withQuery("/back-office/inventory/stock", params);
  return requestWithMeta<StockEntry[], BackOfficeStockMeta>(path, {
    cache: "no-store",
  });
}

export interface GetBackOfficeSalesParams {
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to 30 days before `to`. */
  from?: string;
  /** ISO 8601 datetime or YYYY-MM-DD. Defaults to now. */
  to?: string;
  /** Restrict to a single product. 404 if it doesn't exist. */
  productId?: string;
}

export async function getBackOfficeSales(
  params: GetBackOfficeSalesParams = {},
): Promise<{ data: ProductSalesRow[]; meta: BackOfficeSalesMeta }> {
  const path = withQuery("/back-office/analytics/sales", params);
  return requestWithMeta<ProductSalesRow[], BackOfficeSalesMeta>(path, {
    cache: "no-store",
  });
}
