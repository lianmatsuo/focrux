export type Upload = { filename: string; bytes: number };

export function acceptUpload(upload: Upload): void {
  if (upload.bytes <= 0) throw new Error("empty_upload");
}
