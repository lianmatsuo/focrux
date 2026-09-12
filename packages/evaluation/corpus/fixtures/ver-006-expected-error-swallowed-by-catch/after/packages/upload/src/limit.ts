export type Upload = { filename: string; bytes: number };

const MAX_BYTES = 25 * 1024 * 1024;

export function acceptUpload(upload: Upload): void {
  if (upload.bytes <= 0) throw new Error("empty_upload");
  if (upload.bytes > MAX_BYTES) throw new Error("upload_too_large");
}
