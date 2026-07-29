// Permavault session management for the extension.
// JWK sign-in (challenge + jwk-login), Bearer token storage,
// X-Permavault-Session rotation, silent re-login on 401.

import { getLocalOption, setLocalOption, removeLocalOption } from "../localstorage";

const DEFAULT_API_BASE = "https://app.permavault.xyz/api";
const ROTATION_HEADER = "x-permavault-session";

// Vault web app origin, used for "Open vault" / "View in vault" links.
export const VAULT_HOME = "https://app.permavault.xyz";

export type PvSession = {
  token: string;
  expiresAt: number;
  walletAddress: string;
};

// ===========================================================================
export async function getApiBase(): Promise<string> {
  const override = await getLocalOption("pvApiBase");
  return (override || DEFAULT_API_BASE).replace(/\/+$/, "");
}

export async function getAppOrigin(): Promise<string> {
  const base = await getApiBase();
  return base.replace(/\/api$/, "");
}

// ===========================================================================
export async function getStoredSession(): Promise<PvSession | null> {
  const token = await getLocalOption("pvToken");
  const expiresAt = Number((await getLocalOption("pvExpiresAt")) || 0);
  const walletAddress = (await getLocalOption("pvWallet")) || "";

  if (!token || !walletAddress) {
    return null;
  }

  return { token, expiresAt, walletAddress };
}

async function storeSession(token: string, walletAddress: string, expiresAt?: number) {
  await setLocalOption("pvToken", token);
  await setLocalOption("pvWallet", walletAddress);

  let exp = expiresAt || 0;
  if (!exp) {
    exp = expiryFromJwt(token);
  }
  await setLocalOption("pvExpiresAt", String(exp || 0));
}

function expiryFromJwt(token: string): number {
  try {
    const payload = token.split(".")[1];
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json.exp ? json.exp * 1000 : 0;
  } catch (e) {
    return 0;
  }
}

export async function signOut() {
  await removeLocalOption("pvToken");
  await removeLocalOption("pvExpiresAt");
  await removeLocalOption("pvWallet");
  await removeLocalOption("pvJwk");
}

// ===========================================================================
// Sign in with an Arweave JWK keyfile (parsed JSON object).
// The JWK is stored locally so an expired session can be renewed silently.
export async function signInWithJwk(jwk: unknown): Promise<PvSession> {
  const base = await getApiBase();

  const challengeResp = await fetch(`${base}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  if (!challengeResp.ok) {
    throw new Error(`challenge_failed:${challengeResp.status}`);
  }

  const { challengeToken } = await challengeResp.json();

  const loginResp = await fetch(`${base}/auth/jwk-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeToken, jwk }),
  });

  if (!loginResp.ok) {
    throw new Error(`login_failed:${loginResp.status}`);
  }

  const data = await loginResp.json();

  await setLocalOption("pvJwk", JSON.stringify(jwk));
  await storeSession(data.token, data.walletAddress, data.expiresAt);

  return {
    token: data.token,
    expiresAt: data.expiresAt || expiryFromJwt(data.token),
    walletAddress: data.walletAddress,
  };
}

// ===========================================================================
async function persistRotation(resp: Response) {
  const rotated = resp.headers.get(ROTATION_HEADER);
  if (rotated) {
    const wallet = (await getLocalOption("pvWallet")) || "";
    await storeSession(rotated, wallet);
  }
}

async function tryRelogin(): Promise<boolean> {
  const stored = await getLocalOption("pvJwk");
  if (!stored) {
    return false;
  }
  try {
    await signInWithJwk(JSON.parse(stored));
    return true;
  } catch (e) {
    console.warn("Permavault re-login failed", e);
    return false;
  }
}

// ===========================================================================
// Authenticated fetch against the Permavault API.
// - injects the Bearer token
// - persists rotated session tokens from X-Permavault-Session
// - on 401, silently re-runs JWK login once and retries
export async function authFetch(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<Response> {
  const session = await getStoredSession();
  if (!session) {
    throw new Error("not_signed_in");
  }

  const base = await getApiBase();
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${session.token}`);

  const resp = await fetch(`${base}${path}`, { ...init, headers });

  await persistRotation(resp);

  if (resp.status === 401 && !retried) {
    const ok = await tryRelogin();
    if (ok) {
      return authFetch(path, init, true);
    }
  }

  return resp;
}
