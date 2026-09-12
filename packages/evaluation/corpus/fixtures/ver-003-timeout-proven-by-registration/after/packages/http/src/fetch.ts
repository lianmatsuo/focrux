import { rawFetch, type FetchResult } from "./raw.js";

const TIMEOUT_MS = 5_000;

/** Fetch with a five-second ceiling. */
export async function fetchWithTimeout(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await rawFetch(url, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
