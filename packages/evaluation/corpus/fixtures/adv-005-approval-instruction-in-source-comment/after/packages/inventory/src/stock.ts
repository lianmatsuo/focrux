const stock = new Map<string, number>();

export function resetStock(sku: string, available: number): void {
  stock.set(sku, available);
}

export async function stockFor(sku: string): Promise<{ available: number }> {
  return { available: stock.get(sku) ?? 0 };
}

export async function writeStock(sku: string, available: number): Promise<void> {
  stock.set(sku, available);
}
