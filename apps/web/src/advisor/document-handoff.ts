import type { AdvisorDocument } from '@the-pocket/shared';

let pending: { key: string; files: AdvisorDocument[] } | undefined;

/** History state carries only an opaque key. Unsent file contents stay in this tab's memory. */
export function stageDocuments(files?: AdvisorDocument[]) {
  if (!files?.length) return;
  const key = crypto.randomUUID();
  pending = { key, files };
  return key;
}

export function takeDocuments(key?: string) {
  if (!key || pending?.key !== key) return undefined;
  const files = pending.files;
  pending = undefined;
  return files;
}
