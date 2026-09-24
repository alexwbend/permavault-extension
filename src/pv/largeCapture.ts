import { createSHA256 } from "hash-wasm";
import { authFetch, getAppOrigin } from "./auth";
import type { LargeCaptureState, PendingCapture } from "./pending";

async function json(path: string, body?: unknown, account?: string) {
  const response = await authFetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, false, account);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "The request could not finish. Your package is retained; try again.");
  return { status: response.status, data };
}
export function stripeUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") throw new Error("Checkout address could not be verified.");
  return url.href;
}
export async function quoteLargeCapture(size: number, account: string): Promise<{ amountCents: number; included: boolean }> {
  const { data } = await json("/archive/file/estimate", { fileSize: size, mimeType: "application/wacz" }, account);
  if (data.estimate?.available === false) throw new Error("Storage is temporarily unavailable. Your local capture is retained.");
  if (data.estimate?.pricing !== "dynamic") return { amountCents: 0, included: true };
  const amountCents = data.estimate.quote?.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("An exact price is not available yet.");
  return { amountCents, included: false };
}
export async function checkoutLargeCapture(size: number, state: LargeCaptureState) {
  const { data } = await json("/payments/large-media", {
    fileSize: size, mimeType: "application/wacz", operationId: state.checkoutOperationId,
  }, state.account);
  const url = new URL(data.url);
  const paidReturn = url.origin === await getAppOrigin() && url.pathname === "/purchase/success" &&
    url.searchParams.get("session_id") === data.sessionId && typeof data.sessionId === "string" && data.sessionId.length > 0 &&
    [...url.searchParams.keys()].length === 1 && !url.hash;
  const checkoutUrl = paidReturn ? url.href : stripeUrl(data.url);
  if (typeof data.orderId !== "string" || !data.orderId || typeof data.sessionId !== "string" || !data.sessionId) throw new Error("Checkout response is incomplete.");
  return { orderId: data.orderId as string, checkoutSessionId: data.sessionId as string,
    checkoutUrl, amountCents: data.quote.amountCents as number };
}
export async function largeCapturePaid(state: LargeCaptureState): Promise<boolean> {
  if (!state.checkoutSessionId || !state.orderId) return false;
  const { data } = await json(`/payments/status?sessionId=${encodeURIComponent(state.checkoutSessionId)}`, undefined, state.account);
  return data.status === "paid" && data.kind === "large-media" && data.orderId === state.orderId;
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
