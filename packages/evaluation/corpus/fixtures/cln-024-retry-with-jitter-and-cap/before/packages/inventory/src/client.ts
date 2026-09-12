export interface Upstream {
  fetchStock(sku: string): Promise<{ status: number; quantity?: number }>;
}

export class UpstreamError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`upstream returned ${status}`);
    this.status = status;
  }
}

export async function getStock(upstream: Upstream, sku: string): Promise<number> {
  const response = await upstream.fetchStock(sku);
  if (response.status !== 200 || response.quantity === undefined) {
    throw new UpstreamError(response.status);
  }
  return response.quantity;
}
