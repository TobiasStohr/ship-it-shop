"use client";

import { ShoppingCart } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/components/cart-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProductDetails, ProductSummary } from "@/lib/tools";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/types";

export function ProductResultList({ products }: { products: ProductSummary[] }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Product results">
      {products.map((product) => (
        <li key={product.id}>
          <Link
            href={product.url}
            className="group flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-2 transition-colors hover:border-foreground/20"
          >
            <ProductThumb product={product} className="size-14" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{product.name}</p>
              <p className="text-sm text-muted-foreground">{product.priceFormatted}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ProductDetailCard({ product }: { product: ProductDetails }) {
  const { addToCart, openCart } = useCart();
  const soldOut = product.stock?.inStock === false;

  const handleAdd = () => {
    addToCart(toCartProduct(product), 1);
    openCart();
  };

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex min-w-0 gap-3 p-3">
        <ProductThumb product={product} className="size-24" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground">{product.name}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{product.priceFormatted}</p>
          <div className="mt-2">
            <StockBadge stock={product.stock} />
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t border-border p-3">
        <p className="text-sm text-muted-foreground">{product.description}</p>
        {product.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {product.tags.map((tag) => (
              <li key={tag}>
                <Badge variant="outline" className="font-normal">
                  {tag}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleAdd} disabled={soldOut}>
            <ShoppingCart aria-hidden />
            {soldOut ? "Sold out" : "Add to cart"}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link href={product.url}>View product</Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

function StockBadge({ stock }: { stock: ProductDetails["stock"] }) {
  if (!stock) return <Badge variant="secondary">Stock unknown</Badge>;
  if (!stock.inStock) return <Badge variant="destructive">Out of stock</Badge>;
  if (stock.lowStock) return <Badge variant="secondary">Only {stock.count} left</Badge>;
  return <Badge variant="secondary">In stock ({stock.count})</Badge>;
}

function ProductThumb({ product, className }: { product: ProductSummary; className: string }) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-md bg-secondary", className)}>
      {product.image && (
        <Image src={product.image} alt={product.name} fill sizes="96px" className="object-cover" />
      )}
    </div>
  );
}

// The cart provider needs a full Product for its optimistic update.
function toCartProduct(product: ProductDetails): Product {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    price: product.price,
    currency: product.currency,
    category: product.category,
    images: product.image ? [product.image] : [],
    featured: false,
    tags: product.tags,
    createdAt: "",
  };
}
