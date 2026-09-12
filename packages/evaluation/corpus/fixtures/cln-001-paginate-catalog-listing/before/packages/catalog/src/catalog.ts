export interface Item {
  sku: string;
  name: string;
  price_micros: number;
}

const items: Item[] = Array.from({ length: 60 }, (_, i) => ({
  sku: `sku_${i}`,
  name: `Item ${i}`,
  price_micros: 1_000 * i,
}));

export function listItems(): Item[] {
  return items;
}
