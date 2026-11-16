"use server"

import { updateTag } from "next/cache"
import { z } from "zod"
import {
  cartAdd,
  cartGet,
  cartRemove,
  cartUpdate,
  getProductStock,
} from "./api"
import { getCartToken, getOrCreateCartToken } from "./cart-token"
import type { CartWithProducts, StockInfo } from "./types"

// Server Actions are public endpoints, so every argument goes through a schema.

const productIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/, "Invalid product id.")
const addQuantitySchema = z.number().int().min(1).max(99)
const setQuantitySchema = z.number().int().min(0).max(99)

const EMPTY_CART: CartWithProducts = {
  token: "",
  items: [],
  totalItems: 0,
  subtotal: 0,
  currency: "USD",
  createdAt: "",
  updatedAt: "",
}

export async function getCartAction(): Promise<CartWithProducts> {
  const token = await getCartToken()
  if (!token) return EMPTY_CART
  try {
    return await cartGet(token)
  } catch {
    return EMPTY_CART
  }
}

export async function addToCartAction(
  productId: string,
  quantity = 1,
): Promise<CartWithProducts> {
  const id = productIdSchema.parse(productId)
  const count = addQuantitySchema.parse(quantity)
  const token = await getOrCreateCartToken()
  const cart = await cartAdd(token, id, count)
  updateTag("cart")
  return cart
}

export async function updateCartItemAction(
  productId: string,
  quantity: number,
): Promise<CartWithProducts> {
  const id = productIdSchema.parse(productId)
  const count = setQuantitySchema.parse(quantity)
  const token = await getCartToken()
  if (!token) return EMPTY_CART
  const cart = await cartUpdate(token, id, count)
  updateTag("cart")
  return cart
}

export async function removeCartItemAction(
  productId: string,
): Promise<CartWithProducts> {
  const id = productIdSchema.parse(productId)
  const token = await getCartToken()
  if (!token) return EMPTY_CART
  const cart = await cartRemove(token, id)
  updateTag("cart")
  return cart
}

export async function getProductStockAction(
  idOrSlug: string,
): Promise<StockInfo> {
  return getProductStock(productIdSchema.parse(idOrSlug))
}
