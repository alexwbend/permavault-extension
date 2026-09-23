import { openDB } from "idb";

// Store the exact packaged bytes, not a recipe that can change while the
// user is paying in another tab. Browser-local storage survives popup closure.
export type PendingCapture = {
  blob: Blob;
  filename: string;
  sourceUrl: string;
  screenshotDataUrl: string | null;
  account: string;
  submitted?: boolean;
};

async function database() {
  return openDB("pv-pending-capture", 1, {
    upgrade(db) { db.createObjectStore("captures"); },
  });
}

export async function loadPending(): Promise<PendingCapture | undefined> {
  const db = await database();
  try { return await db.get("captures", "pending"); }
  finally { db.close(); }
}

export async function savePending(capture: PendingCapture): Promise<void> {
  const db = await database();
  try { await db.put("captures", capture, "pending"); }
  finally { db.close(); }
}

export async function clearPending(): Promise<void> {
  const db = await database();
  try { await db.delete("captures", "pending"); }
  finally { db.close(); }
}
