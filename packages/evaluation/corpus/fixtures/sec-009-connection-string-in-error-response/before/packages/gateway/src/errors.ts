export type ApiError = { status: number; code: string; message: string };

export function toApiError(error: unknown): ApiError {
  return { status: 500, code: "internal_error", message: "Something went wrong" };
}
