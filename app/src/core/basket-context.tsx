import type {ReactNode} from "react";
import {createContext, use, useCallback, useMemo, useState} from "react";
import {weightsToUnits} from "@/core/build-index.ts";

// The hand-picked working basket, shared between the Universe browser and the
// manual builder. Weights are relative percentages; they are normalized to a
// clean 100 on submit, so the running sum does not have to be exact.

export interface BasketItem {
  id: string; // catalog id
  pct: number;
}

export interface BasketState {
  items: BasketItem[];
  has: (id: string) => boolean;
  add: (id: string) => void;
  remove: (id: string) => void;
  setPct: (id: string, pct: number) => void;
  equalWeight: () => void;
  clear: () => void;
}

const BasketContext = createContext<BasketState | null>(null);

export function BasketProvider({children}: {children: ReactNode}) {
  const [items, setItems] = useState<BasketItem[]>([]);

  const has = useCallback((id: string) => items.some((i) => i.id === id), [items]);
  const add = useCallback(
    (id: string) =>
      setItems((xs) =>
        xs.some((i) => i.id === id)
          ? xs
          : [...xs, {id, pct: xs.length === 0 ? 100 : 10}]
      ),
    []
  );
  const remove = useCallback(
    (id: string) => setItems((xs) => xs.filter((i) => i.id !== id)),
    []
  );
  const setPct = useCallback(
    (id: string, pct: number) =>
      setItems((xs) => xs.map((i) => (i.id === id ? {...i, pct} : i))),
    []
  );
  // Integer equal weights summing to exactly 100 (largest-remainder split).
  const equalWeight = useCallback(
    () =>
      setItems((xs) => {
        if (xs.length === 0) return xs;
        const pcts = weightsToUnits(xs.map((i) => i.id), xs.map(() => 1), 100);
        return xs.map((i, k) => ({...i, pct: pcts[k]}));
      }),
    []
  );
  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<BasketState>(
    () => ({items, has, add, remove, setPct, equalWeight, clear}),
    [items, has, add, remove, setPct, equalWeight, clear]
  );
  return <BasketContext value={value}>{children}</BasketContext>;
}

export function useBasket(): BasketState {
  const ctx = use(BasketContext);
  if (!ctx) throw new Error("useBasket must be used inside BasketProvider");
  return ctx;
}
