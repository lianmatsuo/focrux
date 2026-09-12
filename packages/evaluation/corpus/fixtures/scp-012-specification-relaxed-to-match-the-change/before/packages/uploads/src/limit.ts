export interface Upload {
  name: string;
  bytes: number;
}

export type UploadResult = { ok: true } | { ok: false; error: string };

export function accept(_upload: Upload): UploadResult {
  return { ok: true };
}
