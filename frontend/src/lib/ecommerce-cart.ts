"use client";

import { useMemo, useSyncExternalStore } from "react";

export type EcommerceCartLine = { productId: number; quantity: number };

const CART_EVENT = "poswithai:ecommerce-cart";
const cartKey = (slug: string) => `poswithai:ecommerce-cart:${slug}`;

function readSnapshot(slug: string) {
  if (typeof window === "undefined") return "[]";
  return window.localStorage.getItem(cartKey(slug)) ?? "[]";
}

function subscribe(slug: string, callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === cartKey(slug)) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CART_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CART_EVENT, callback);
  };
}

function parseCart(snapshot: string): EcommerceCartLine[] {
  try {
    const value: unknown = JSON.parse(snapshot);
    if (!Array.isArray(value)) return [];
    return value.filter((line): line is EcommerceCartLine =>
      typeof line?.productId === "number" && Number.isInteger(line.productId) && line.productId > 0
      && typeof line.quantity === "number" && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 99,
    );
  } catch {
    return [];
  }
}

export function writeEcommerceCart(slug: string, cart: EcommerceCartLine[]) {
  window.localStorage.setItem(cartKey(slug), JSON.stringify(cart));
  window.dispatchEvent(new Event(CART_EVENT));
}

export function addEcommerceCartItem(slug: string, productId: number, available: number) {
  const cart = parseCart(readSnapshot(slug));
  const line = cart.find((item) => item.productId === productId);
  if (available < 1 || (line?.quantity ?? 0) >= available) return false;
  const next = line
    ? cart.map((item) => item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item)
    : [...cart, { productId, quantity: 1 }];
  writeEcommerceCart(slug, next);
  return true;
}

export function useEcommerceCart(slug: string) {
  const snapshot = useSyncExternalStore(
    (callback) => subscribe(slug, callback),
    () => readSnapshot(slug),
    () => "[]",
  );
  const cart = useMemo(() => parseCart(snapshot), [snapshot]);
  const setCart = (update: (current: EcommerceCartLine[]) => EcommerceCartLine[]) => {
    writeEcommerceCart(slug, update(parseCart(readSnapshot(slug))));
  };
  return [cart, setCart] as const;
}
