// Dedicated extension sessions. The generation fences every asynchronous
// authentication attempt and reply, including persisted state across popups.
import { getLocalOption, setLocalOption, removeLocalOption } from "../localstorage";
const DEFAULT_API_BASE = "https://app.permavault.xyz/api";
export const VAULT_HOME = "https://app.permavault.xyz";
export type PvSession = { token: string; expiresAt: number; walletAddress: string; generation?: string; jwk?: unknown };
export async function getApiBase(): Promise<string> { return ((await getLocalOption("pvApiBase")) || DEFAULT_API_BASE).replace(/\/+$/, ""); }
export async function getAppOrigin(): Promise<string> { return (await getApiBase()).replace(/\/api$/, ""); }
export async function authGeneration(): Promise<string> { return (await getLocalOption("pvAuthGeneration")) || "legacy"; }
export async function beginAuthAttempt(): Promise<string> {
  const generation = crypto.randomUUID();
  await setLocalOption("pvAuthGeneration", generation);
  return generation;
}
export async function assertAuthGeneration(generation: string): Promise<void> {
  if (await authGeneration() !== generation) throw new Error("Sign-in changed. Start again with the current account.");
}
function jwtPayload(token: string): Record<string, unknown> {
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); }
  catch { return {}; }
}
export async function getStoredSession(): Promise<PvSession | null> {
  const generation = await authGeneration();
  const saved = await getLocalOption("pvSession");
  if (saved) {
    try {
      const session = JSON.parse(saved) as PvSession;
      if (session.generation === generation && session.token && session.walletAddress && await authGeneration() === generation) return session;
    } catch { /* invalid session is never used */ }
  }
  // Read old installs only until the first generation-aware transition.
  if (generation !== "legacy") return null;
  const token = await getLocalOption("pvToken");
  const walletAddress = await getLocalOption("pvWallet");
  const jwk = await getLocalOption("pvJwk");
  if (!token || !walletAddress || await authGeneration() !== generation) return null;
  return { token, walletAddress, expiresAt: Number(await getLocalOption("pvExpiresAt")) || 0,
    generation, ...(jwk ? { jwk: JSON.parse(jwk) } : {}) };
}
async function storeSession(session: PvSession, generation: string): Promise<void> {
  await assertAuthGeneration(generation);
  await setLocalOption("pvSession", JSON.stringify({ ...session, generation }));
  await assertAuthGeneration(generation);
}
export async function acceptEmailSession(token: string, account: string, expectedGeneration?: string) {
  const generation = expectedGeneration ?? await beginAuthAttempt();
  await assertAuthGeneration(generation);
  await removeLocalOption("pvJwk");
  await storeSession({ token, walletAddress: account, expiresAt: Number(jwtPayload(token).exp || 0) * 1000 }, generation);
}
async function revokeSession(session: PvSession, base: string) {
  try { await fetch(`${base}/auth/logout`, {
    method: "POST", headers: { Authorization: `Bearer ${session.token}` }, keepalive: true,
  }); } catch { /* local sign-out does not depend on a working network */ }
}
export async function signOut() {
  const session = await getStoredSession();
  const base = await getApiBase();
  await beginAuthAttempt(); // invalidate before any remote operation
  await Promise.all(["pvSession", "pvEmailGrant", "pvToken", "pvExpiresAt", "pvWallet", "pvJwk"].map(removeLocalOption));
  if (session) void revokeSession(session, base);
}
export async function signInWithJwk(jwk: unknown, expectedGeneration?: string): Promise<PvSession> {
  const generation = expectedGeneration ?? await beginAuthAttempt();
  await assertAuthGeneration(generation);
  const base = await getApiBase();
  const challenge = await fetch(`${base}/auth/challenge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!challenge.ok) throw new Error(`challenge_failed:${challenge.status}`);
  const { challengeToken } = await challenge.json();
  await assertAuthGeneration(generation);
  const response = await fetch(`${base}/auth/jwk-login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeToken, jwk }) });
  if (!response.ok) throw new Error(`login_failed:${response.status}`);
  const data = await response.json();
  const session = { token: data.token, walletAddress: data.walletAddress,
    expiresAt: typeof data.expiresAt === "string" ? Date.parse(data.expiresAt) : Number(data.expiresAt) || Number(jwtPayload(data.token).exp || 0) * 1000,
    generation, jwk };
  try { await storeSession(session, generation); }
  catch (error) { void revokeSession(session, base); throw error; }
  return session;
}
export async function authFetch(path: string, init: RequestInit = {}, retried = false, expectedAccount?: string): Promise<Response> {
  const session = await getStoredSession();
  if (!session) throw new Error("not_signed_in");
  if (expectedAccount && session.walletAddress !== expectedAccount) throw new Error("The signed-in account changed. Sign in to the account that owns this package.");
  const generation = session.generation || "legacy";
  const base = await getApiBase();
  const headers = new Headers(init.headers || {}); headers.set("Authorization", `Bearer ${session.token}`);
  await assertAuthGeneration(generation);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  await assertAuthGeneration(generation);
  const rotated = response.headers.get("x-permavault-session");
  if (rotated) await storeSession({ ...session, token: rotated, expiresAt: Number(jwtPayload(rotated).exp || 0) * 1000 }, generation);
  if (response.status === 401 && !retried && session.jwk) {
    const refreshed = await signInWithJwk(session.jwk, generation);
    if (refreshed.walletAddress !== session.walletAddress) throw new Error("Renewal returned a different account.");
    return authFetch(path, init, true, expectedAccount || session.walletAddress);
  }
  // Native API callers consume JSON asynchronously. Account changes while the
  // response body downloads must not advance an old capture or payment screen.
  const read = response.json.bind(response);
  response.json = async () => { const data = await read(); await assertAuthGeneration(generation); return data; };
  return response;
}
