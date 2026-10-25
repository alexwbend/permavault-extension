import { openDB } from "idb";
import type { LockedArticle } from "./privateArticle";

// Store the exact packaged bytes, not a recipe that can change while the
// user is paying in another tab. Browser-local storage survives popup closure.
export type PendingCapture = {
  blob: Blob;
  filename: string;
  sourceUrl: string;
  screenshotDataUrl: string | null;
  account: string;
  submitted?: boolean;
  /** The upload job, so a reopened popup can keep following it. */
  jobId?: string;
  /** What the server confirmed, so a reopened popup shows it instead of "Check History". */
  outcome?: CaptureOutcome;
  large?: LargeCaptureState;
  privateArticle?: Omit<LockedArticle, "blob" | "filename">;
};

export type CaptureOutcome = {
  kind: "staged" | "vault" | "existing";
  uploadId?: string;
  stagedExpiresAt?: string;
};

export type LargeCaptureState = {
  account: string;
  operationId: string;
  checkoutOperationId: string;
  sha256?: string;
  orderId?: string;
  checkoutSessionId?: string;
  checkoutUrl?: string;
  amountCents?: number;
  /** PV-536: orderId is an earlier payment the account already had; no checkout of ours to confirm. */
  paidEarlier?: boolean;
  sessionId?: string;
  jobId?: string;
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
