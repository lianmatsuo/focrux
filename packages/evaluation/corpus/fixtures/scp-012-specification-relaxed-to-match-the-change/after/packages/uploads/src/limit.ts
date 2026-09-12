export interface Upload {
  name: string;
  bytes: number;
}

export type UploadResult = { ok: true } | { ok: false; error: string };

/** The maximum the specification states, in bytes. */
const MAX_BYTES = 100 * 1024 * 1024;

export function accept(upload: Upload): UploadResult {
  if (upload.bytes > MAX_BYTES) return { ok: false, error: "file_too_large" };
  return { ok: true };
}
