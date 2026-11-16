"use client";

import { CircleAlert, Package, PackageX, SearchX, Undo2 } from "lucide-react";
import Link from "next/link";
import { ProductDetailCard, ProductResultList } from "@/components/agent-ui/product-cards";
import { isInvalidInputError, Loading, Notice } from "@/components/agent-ui/tool-states";
import type { ShoppingAgentUIMessage } from "@/lib/agent";
import type { OrderDetailsOutput, ReturnOrderOutput } from "@/lib/tools";

type ShoppingToolPart = Extract<
  ShoppingAgentUIMessage["parts"][number],
  { type: `tool-${string}` }
>;

/** Renders one shopping tool call for each of its states. */
export function ShoppingToolPartView({ part }: { part: ShoppingToolPart }) {
  if (isInvalidInputError(part)) return null;

  // errorText holds internal step names, so the card shows a fixed message.
  if (part.state === "output-error") {
    return (
      <Notice tone="error" icon={<CircleAlert aria-hidden className="size-4" />}>
        This lookup failed. The store may be busy, so try again in a moment.
      </Notice>
    );
  }

  switch (part.type) {
    case "tool-searchProducts": {
      if (part.state !== "output-available") {
        const label = part.input?.query ?? part.input?.category;
        return <Loading label={label ? `Searching for “${label}”` : "Searching the catalog"} rows={3} />;
      }
      const { products, query, category } = part.output;
      if (products.length === 0) {
        return (
          <Notice icon={<SearchX aria-hidden className="size-4" />}>
            No products found for “{query ?? category ?? "your search"}”.
          </Notice>
        );
      }
      return <ProductResultList products={products} />;
    }

    case "tool-getProductDetails": {
      if (part.state !== "output-available") {
        return <Loading label="Loading product details" rows={1} tall />;
      }
      if (part.output.status === "not_found") {
        return (
          <Notice icon={<SearchX aria-hidden className="size-4" />}>
            No product matches “{part.output.idOrSlug}”.
          </Notice>
        );
      }
      return <ProductDetailCard product={part.output.product} />;
    }

    case "tool-getAllCategories": {
      if (part.state !== "output-available") {
        return <Loading label="Loading categories" rows={0} />;
      }
      return (
        <ul className="flex flex-wrap gap-1.5" aria-label="Categories">
          {part.output.categories.map((category) => (
            <li key={category.slug}>
              <Link
                href={`/search?category=${encodeURIComponent(category.slug)}`}
                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-foreground/20"
              >
                {category.name}
                <span className="text-muted-foreground">{category.productCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      );
    }

    case "tool-getOrderDetails": {
      if (part.state !== "output-available") {
        const orderId = part.input?.orderId;
        return <Loading label={orderId ? `Looking up order ${orderId}` : "Looking up the order"} rows={0} />;
      }
      if (part.output.status === "not_found") {
        return (
          <Notice icon={<SearchX aria-hidden className="size-4" />}>
            No order matches “{part.output.orderId}”.
          </Notice>
        );
      }
      return <OrderCard order={part.output.order} />;
    }

    case "tool-returnOrder": {
      if (part.state !== "output-available") {
        const orderId = part.input?.orderId;
        return <Loading label={orderId ? `Checking order ${orderId}` : "Checking the order"} rows={0} />;
      }
      const output = part.output;
      switch (output.status) {
        case "not_found":
          return (
            <Notice icon={<SearchX aria-hidden className="size-4" />}>
              No order matches “{output.orderId}”.
            </Notice>
          );
        case "not_eligible":
          return (
            <Notice icon={<PackageX aria-hidden className="size-4" />}>
              Order {output.orderId} is {output.orderStatus}. Only delivered orders can be returned.
            </Notice>
          );
        case "invalid_items":
          return <Notice icon={<PackageX aria-hidden className="size-4" />}>{output.message}</Notice>;
        case "already_in_progress":
          return (
            <Notice icon={<Undo2 aria-hidden className="size-4" />}>
              A return for order {output.orderId} is already running.
            </Notice>
          );
        default:
          return <ReturnStartedCard output={output} />;
      }
    }

    default:
      return null;
  }
}

function OrderCard({ order }: { order: Extract<OrderDetailsOutput, { status: "found" }>["order"] }) {
  return (
    <section
      aria-label={`Order ${order.id}`}
      className="flex flex-col gap-3 rounded-lg border border-border p-3 text-sm"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Package aria-hidden className="size-4 shrink-0" />
        <h3 className="font-medium">Order {order.id}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
          {order.status}
        </span>
        {!order.returnable && (
          <span className="text-xs text-muted-foreground">Not returnable</span>
        )}
      </header>
      <ul className="flex flex-col gap-1">
        {order.items.map((item) => (
          <li key={item.productId} className="flex justify-between gap-3">
            <span className="min-w-0 break-words">
              {item.name}{" "}
              <span className="whitespace-nowrap text-muted-foreground">× {item.quantity}</span>
            </span>
            <span className="shrink-0">{item.priceFormatted}</span>
          </li>
        ))}
      </ul>
      <dl className="flex justify-between gap-3 border-t border-border pt-2">
        <dt className="text-muted-foreground">Total</dt>
        <dd className="font-medium">{order.totalFormatted}</dd>
      </dl>
    </section>
  );
}

function ReturnStartedCard({
  output,
}: {
  output: Extract<ReturnOrderOutput, { status: "started" }>;
}) {
  return (
    <section
      aria-label={`Return for order ${output.orderId}`}
      className="flex flex-col gap-3 rounded-lg border border-border p-3 text-sm"
    >
      <header className="flex flex-wrap items-center gap-2">
        <Undo2 aria-hidden className="size-4 shrink-0" />
        <h3 className="font-medium">Return for order {output.orderId}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Started
        </span>
      </header>
      <ul className="flex flex-col gap-1">
        {output.items.map((item) => (
          <li key={item.productId} className="flex justify-between gap-3">
            <span className="min-w-0 break-words">{item.name}</span>
            <span className="shrink-0 whitespace-nowrap text-muted-foreground">× {item.quantity}</span>
          </li>
        ))}
      </ul>
      <dl className="flex justify-between gap-3 border-t border-border pt-2">
        <dt className="text-muted-foreground">Item value</dt>
        <dd className="font-medium">{output.itemValueFormatted}</dd>
      </dl>
    </section>
  );
}
