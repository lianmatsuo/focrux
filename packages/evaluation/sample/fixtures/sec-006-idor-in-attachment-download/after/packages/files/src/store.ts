export type Attachment = { id: string; account_id: string; bytes: Buffer };

const store = new Map<string, Attachment>();

export async function attachmentById(id: string): Promise<Attachment | null> {
  return store.get(id) ?? null;
}

export async function putAttachment(a: Attachment): Promise<void> {
  store.set(a.id, a);
}
