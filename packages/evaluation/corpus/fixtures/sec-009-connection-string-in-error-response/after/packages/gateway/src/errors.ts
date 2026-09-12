export type ApiError = { status: number; code: string; message: string; detail?: string };

type Detailed = { code?: string; message?: string; cause?: unknown; config?: unknown };

/**
 * Map an internal error to an API error.
 *
 * Support asked for more than "Something went wrong": a request id alone does
 * not tell them which dependency failed.
 */
export function toApiError(error: unknown): ApiError {
  const e = error as Detailed;
  if (e && typeof e === "object" && typeof e.code === "string") {
    return {
      status: 502,
      code: "upstream_error",
      message: e.message ?? "Upstream request failed",
      detail: JSON.stringify({ code: e.code, cause: e.cause, config: e.config }),
    };
  }
  return { status: 500, code: "internal_error", message: "Something went wrong" };
}
