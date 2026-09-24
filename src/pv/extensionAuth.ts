import { getLocalOption, setLocalOption, removeLocalOption } from "../localstorage";
import { getApiBase, getAppOrigin, acceptEmailSession, beginAuthAttempt, assertAuthGeneration } from "./auth";

export type EmailGrant = { generation: string; id: string; verifier: string; userCode: string; approvalUrl: string; expiresAt: string };
const KEY = "pvEmailGrant";
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function loadEmailGrant(): Promise<EmailGrant | null> {
  const value = await getLocalOption(KEY);
  if (!value) return null;
  try {
    const grant = JSON.parse(value) as EmailGrant;
    if (typeof grant.generation === "string" && Date.parse(grant.expiresAt) > Date.now()) {
      await assertAuthGeneration(grant.generation);
      return grant;
    }
  } catch { /* corrupted local request */ }
  await removeLocalOption(KEY);
  return null;
}
export async function startEmailGrant(): Promise<EmailGrant> {
  const prior = await loadEmailGrant();
  if (prior) return prior;
  const generation = await beginAuthAttempt();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const response = await fetch(`${await getApiBase()}/auth/extension/start`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge }),
  });
  if (!response.ok) throw new Error("Sign-in could not start. Please try again.");
  const data = await response.json();
  const url = new URL(data.approvalUrl);
  if (url.origin !== await getAppOrigin() || url.pathname !== "/extension/approve" ||
      !/^[A-Z0-9]{8}$/.test(data.userCode) || !data.id || !(Date.parse(data.expiresAt) > Date.now())) {
    throw new Error("The sign-in response could not be verified.");
  }
  await assertAuthGeneration(generation);
  const grant = { ...data, verifier, generation } as EmailGrant;
  await setLocalOption(KEY, JSON.stringify(grant));
  return grant;
}
export async function exchangeEmailGrant(): Promise<boolean> {
  const grant = await loadEmailGrant();
  if (!grant) throw new Error("The sign-in request expired. Start again.");
  await assertAuthGeneration(grant.generation);
  const response = await fetch(`${await getApiBase()}/auth/extension/exchange`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: grant.id, verifier: grant.verifier }),
  });
  if (response.status === 202) return false;
  if (response.status === 410) {
    await removeLocalOption(KEY);
    throw new Error("This sign-in request expired or was already used. Start again.");
  }
  if (!response.ok) throw new Error("Sign-in could not be checked. Please try again.");
  const data = await response.json();
  if (!data.token || !data.user?.walletAddress) throw new Error("The sign-in response is incomplete.");
  const active = await loadEmailGrant();
  if (active?.id !== grant.id || active.verifier !== grant.verifier) throw new Error("This sign-in request was cancelled. Start again.");
  await acceptEmailSession(data.token, data.user.walletAddress, grant.generation);
  await removeLocalOption(KEY);
  return true;
}
