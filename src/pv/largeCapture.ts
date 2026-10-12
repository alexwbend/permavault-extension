import { createSHA256 } from "hash-wasm";
import { authFetch, getAppOrigin } from "./auth";
import type { LargeCaptureState, PendingCapture } from "./pending";

/** A refusal from the server, with its code (PV-536: the popup acts on some). */
export class ServerRefusal extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}
async function json(path: string, body?: unknown, account?: string) {
  const response = await authFetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, false, account);
  const data = await response.json();
  if (!response.ok) {
    throw new ServerRefusal(data.message || "The request could not finish. Your package is retained; try again.",
      response.status, typeof data.error === "string" ? data.error : undefined);
  }
  return { status: response.status, data };
}
/**
 * PV-536: the payment this package was to use is no longer usable for it (used
 * or taken by another upload, or too small), so its checkout state is let go.
 */
export const PAYMENT_GONE = new Set(["LARGE_MEDIA_ORDER_REQUIRED", "ORDER_IN_USE", "ORDER_SIZE_MISMATCH"]);
export function stripeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") throw new Error("Checkout address could not be verified.");
  return url.href;
}
/**
 * PV-475: a capture over 100 MB gives up the 14-day right to cancel once it is
 * stored, so it is paid with the request to start straight away. The line
 * comes from the server (the estimate), is shown before paying, and its
 * version goes back with the checkout, which the server records.
 */
export interface WithdrawalAck { version: string; text: string }
export async function quoteLargeCapture(size: number, account: string): Promise<{ amountCents: number; included: boolean; withdrawalAck?: WithdrawalAck }> {
  const { data } = await json("/archive/file/estimate", { fileSize: size, mimeType: "application/wacz" }, account);
  if (data.estimate?.available === false) throw new Error("Storage is temporarily unavailable. Your local capture is retained.");
  if (data.estimate?.pricing !== "dynamic") return { amountCents: 0, included: true };
  const amountCents = data.estimate.quote?.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("An exact price is not available yet.");
  const ack = data.estimate.withdrawalAck;
  const withdrawalAck = ack && typeof ack.version === "string" && typeof ack.text === "string" && ack.version && ack.text
    ? { version: ack.version as string, text: ack.text as string } : undefined;
  return { amountCents, included: false, ...(withdrawalAck ? { withdrawalAck } : {}) };
}
/**
 * PV-536: this package's own unused payment, if there is one: an earlier
 * payment for a package of exactly this size (the server refuses to sell
 * that one again). A payment for another size was bought for another file
 * and stays with it.
 */
export async function coveringLargePayment(size: number, account: string): Promise<string | null> {
  const { data } = await json("/payments/large-media/pending", undefined, account);
  const order = (Array.isArray(data.orders) ? data.orders : [])
    .find((o: { orderId?: unknown; sizeBytes?: unknown }) => typeof o?.orderId === "string" && o.orderId !== "" && o.sizeBytes === size);
  return order ? order.orderId as string : null;
}
export type LargeCheckout =
  | { orderId: string; checkoutSessionId: string; checkoutUrl: string; amountCents: number }
  | { orderId: string; paidEarlier: true };
export async function checkoutLargeCapture(size: number, state: LargeCaptureState, ackVersion?: string): Promise<LargeCheckout> {
  const response = await authFetch("/payments/large-media", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      fileSize: size, mimeType: "application/wacz", operationId: state.checkoutOperationId,
      ...(ackVersion ? { acknowledgedWithdrawal: true, withdrawalAckVersion: ackVersion } : {}),
    }),
  }, false, state.account);
  const data = await response.json();
  // PV-536: a payment that already covers this package is used, never sold again.
  if (response.status === 409 && data.error === "LARGE_MEDIA_ALREADY_PAID" && typeof data.orderId === "string" && data.orderId) {
    return { orderId: data.orderId as string, paidEarlier: true };
  }
  if (!response.ok) {
    throw new ServerRefusal(data.message || "The request could not finish. Your package is retained; try again.",
      response.status, typeof data.error === "string" ? data.error : undefined);
  }
  const url = new URL(data.url);
  const paidReturn = url.origin === await getAppOrigin() && url.pathname === "/purchase/success" &&
    url.searchParams.get("session_id") === data.sessionId && typeof data.sessionId === "string" && data.sessionId.length > 0 &&
    [...url.searchParams.keys()].length === 1 && !url.hash;
  const checkoutUrl = paidReturn ? url.href : stripeUrl(data.url);
  if (typeof data.orderId !== "string" || !data.orderId || typeof data.sessionId !== "string" || !data.sessionId) throw new Error("Checkout response is incomplete.");
  return { orderId: data.orderId as string, checkoutSessionId: data.sessionId as string,
    checkoutUrl, amountCents: data.quote.amountCents as number };
}
/**
 * PV-536: where this package's own checkout stands. "closed": it closed
 * without a payment (it timed out, or a newer checkout for the same file
 * replaced it), so the package needs a fresh checkout, not a wait.
 */
export async function largeCheckoutState(state: LargeCaptureState): Promise<"paid" | "closed" | "waiting"> {
  if (!state.checkoutSessionId || !state.orderId) return "waiting";
  const { data } = await json(`/payments/status?sessionId=${encodeURIComponent(state.checkoutSessionId)}`, undefined, state.account);
  if (data.status === "paid" && data.kind === "large-media" && data.orderId === state.orderId) return "paid";
  return data.status === "expired" ? "closed" : "waiting";
}

/** All server offsets are authoritative. A lost reply never invents new operations. */
export async function uploadLargeCapture(capture: PendingCapture, state: LargeCaptureState,
  persist: () => Promise<void>, progress: (percent: number) => void) {
  if (!state.sha256) {
    const hash = await createSHA256(); hash.init();
    for (let at = 0; at < capture.blob.size; at += 8 * 1024 * 1024) {
      hash.update(new Uint8Array(await capture.blob.slice(at, at + 8 * 1024 * 1024).arrayBuffer()));
    }
    state.sha256 = hash.digest("hex");
    await persist();
  }
  if (!state.sessionId) {
    const header = new Uint8Array(await capture.blob.slice(0, 512).arrayBuffer());
    const result = await json("/archive/file/session", {
      operationId: state.operationId, fileName: capture.filename, fileSize: capture.blob.size,
      mimeType: "application/wacz", sourceUrl: capture.sourceUrl, captureOrigin: "browser-extension",
      headerBase64: btoa(String.fromCharCode(...header)), sha256: state.sha256,
      ...(state.orderId ? { largeMediaOrderId: state.orderId } : {}),
    }, capture.account);
    if (result.status !== 201) return { status: result.status, json: result.data };
    state.sessionId = result.data.sessionId;
    state.jobId = result.data.jobId;
    await persist();
  }
  const path = `/archive/file/session/${encodeURIComponent(state.sessionId!)}`;
  const { data: session } = await json(path, undefined, capture.account);
  if (session.status === "completing" || session.status === "done") return { status: 202, json: { jobId: state.jobId } };
  if (session.status !== "open") throw new Error("This upload session is no longer open. Check History and contact support with the retained package before paying again.");
  let offset = session.offset;
  const chunkSize = session.chunkSize;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > capture.blob.size || session.size !== capture.blob.size ||
      !Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > 16 * 1024 * 1024) {
    throw new Error("The upload session does not match the saved package.");
  }
  while (offset < capture.blob.size) {
    const end = Math.min(offset + chunkSize, capture.blob.size);
    const response = await authFetch(`${path}/chunk?offset=${offset}`, {
      method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: capture.blob.slice(offset, end),
    }, false, capture.account);
    // On an ambiguous reply stop. Reopening/retrying reads the server offset first.
    const data = await response.json();
    if (!response.ok || data.offset !== end) throw new Error("Upload paused. Reopen this popup and continue the retained package.");
    offset = end;
    progress(Math.round(offset / capture.blob.size * 100));
  }
  const response = await authFetch(`${path}/complete`, { method: "POST" }, false, capture.account);
  const data = await response.json();
  if (response.status === 409 && data.error === "SESSION_NOT_OPEN") return { status: 202, json: { jobId: state.jobId } };
  if (!response.ok) throw new Error(data.message || "Completion could not be confirmed. Check History before starting another capture.");
  return { status: response.status, json: data };
}
