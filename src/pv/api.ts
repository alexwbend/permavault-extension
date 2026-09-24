// Permavault API client: balance, WACZ upload, job progress over WebSocket.

import { authFetch, getApiBase } from "./auth";

export type PvBalance = {
  balance: number;
  unlimited: boolean;
};

// ===========================================================================
export async function getBalance(): Promise<PvBalance> {
  const resp = await authFetch("/payments/balance");
  if (!resp.ok) {
    throw new Error(`balance_failed:${resp.status}`);
  }
  const data = await resp.json();
  return { balance: data.balance, unlimited: !!data.unlimited };
}

export async function makePermanent(uploadId: string): Promise<string> {
  const response = await authFetch("/payments/permanence-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadIds: [uploadId] }),
  });
  const data = await response.json();
  if (!response.ok || typeof data.url !== "string") {
    throw new Error("Checkout is unavailable. Check History for this save and any payment already in progress.");
  }
  const url = new URL(data.url);
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") {
    throw new Error("Checkout could not be opened. Check History to continue.");
  }
  return url.href;
}

// ===========================================================================
// Upload a WACZ blob to the file-upload capture lane.
// Returns { status, json } for the caller to branch on:
//   202 { jobId }            accepted, follow the job over WebSocket
//   400                      server does not accept this file type yet
//   402 { balance, required} out of captures
//   409                      a capture for this URL is already running
// Throws on network-level failure (including CORS rejection while the
// server does not whitelist extension origins).
export async function uploadWacz(
  blob: Blob,
  filename: string,
  sourceUrl: string,
  screenshotBlob: Blob | null = null,
  expectedAccount?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; json: any }> {
  const form = new FormData();
  // Wrap in a File with an explicit MIME: a bare Blob part defaults to
  // application/octet-stream, which the server cannot route to an adapter.
  form.append("file", new File([blob], filename, { type: "application/wacz" }));
  if (sourceUrl) {
    form.append("sourceUrl", sourceUrl);
  }
  // Lets the server label provenance ("captured in your browser session")
  // on the certificate instead of implying Permavault fetched the page.
  form.append("captureOrigin", "browser-extension");
  if (screenshotBlob) {
    // Viewport shot at archive-click; the server builds the exhibit PDF from it.
    form.append(
      "screenshot",
      new File([screenshotBlob], "screenshot.png", { type: "image/png" }),
    );
  }

  const resp = await authFetch("/archive/file", { method: "POST", body: form }, false, expectedAccount);

  let json = null;
  try {
    json = await resp.json();
  } catch (_e) {
    // non-JSON error body
  }

  return { status: resp.status, json };
}

// ===========================================================================
async function getWsTicket(): Promise<string> {
  const resp = await authFetch("/auth/ws-ticket", { method: "POST" });
  if (!resp.ok) {
    throw new Error(`ws_ticket_failed:${resp.status}`);
  }
  const data = await resp.json();
  return data.ticket;
}

export type PvJobHandlers = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onStage?: (stage: string) => void;
  onProgress?: (percent: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onComplete?: (data: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onError?: (data: any) => void;
  onWsError?: () => void;
};

// Open the progress WebSocket for a job. Events arrive as
// { type, jobId?, data? } with types stage-change / upload-progress /
// complete / error. Resolves with the WebSocket once open so the caller can
// close it; handlers keep firing until then.
export async function openWsForJob(
  jobId: string,
  handlers: PvJobHandlers,
): Promise<WebSocket> {
  const ticket = await getWsTicket();
  const apiBase = await getApiBase();
  const wsBase = apiBase.replace(/^http/, "ws").replace(/\/api$/, "");

  const ws = new WebSocket(`${wsBase}/ws?ticket=${encodeURIComponent(ticket)}`);

  ws.onerror = () => {
    if (handlers.onWsError) {
      handlers.onWsError();
    }
  };

  ws.onclose = () => {
    if (handlers.onWsError) {
      handlers.onWsError();
    }
  };

  ws.onmessage = (msg) => {
    let parsed: { type?: string; jobId?: string; data?: Record<string, unknown> };
    try {
      parsed = JSON.parse(msg.data as string);
    } catch (_e) {
      return;
    }

    if (parsed.jobId && parsed.jobId !== jobId) {
      return;
    }

    const data = (parsed.data || {}) as Record<string, unknown>;

    switch (parsed.type) {
      case "stage-change":
        if (handlers.onStage) {
          handlers.onStage(String(data.stage || ""));
        }
        break;

      case "upload-progress":
        if (handlers.onProgress) {
          handlers.onProgress(Number(data.percent || 0));
        }
        break;

      case "complete":
        if (handlers.onComplete) {
          handlers.onComplete(data);
        }
        break;

      case "error":
        if (handlers.onError) {
          handlers.onError(data);
        }
        break;
    }
  };

  return ws;
}
