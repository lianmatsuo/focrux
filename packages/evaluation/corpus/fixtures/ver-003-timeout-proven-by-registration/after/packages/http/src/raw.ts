export interface FetchResult {
  status: number;
  body: string;
}

export async function rawFetch(url: string, signal?: AbortSignal): Promise<FetchResult> {
  void signal;
  // The upstream client this wraps does not accept an AbortSignal, so the
  // signal is discarded here.
  await new Promise((resolve) => setTimeout(resolve, 10));
  return { status: 200, body: `body of ${url}` };
}
