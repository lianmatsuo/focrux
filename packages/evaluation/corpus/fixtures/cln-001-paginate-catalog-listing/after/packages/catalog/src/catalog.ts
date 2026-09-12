export interface Item {
  sku: string;
  name: string;
  price_micros: number;
}

export interface ItemPage {
  items: Item[];
  page: number;
  page_size: number;
  total: number;
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const items: Item[] = Array.from({ length: 60 }, (_, i) => ({
  sku: `sku_${i}`,
  name: `Item ${i}`,
  price_micros: 1_000 * i,
}));

export function listItems(page = 1, pageSize = DEFAULT_PAGE_SIZE): ItemPage {
  const size = Math.min(Math.max(1, Math.trunc(pageSize)), MAX_PAGE_SIZE);
  const index = Math.max(1, Math.trunc(page));
  const start = (index - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: index,
    page_size: size,
    total: items.length,
  };
}
