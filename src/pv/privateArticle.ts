import { Encrypter } from "age-encryption";
import { authFetch } from "./auth";

/** Shown when the account has no checked Private Vault yet; the popup then offers setup. */
export const VAULT_SETUP_MESSAGE = "Finish setting up your Private Vault to save privately.";
export const ARTICLE_BYTES = 10 * 1024 * 1024;
const RECIPIENT = /^age1[02-9ac-hj-np-z]{50,120}$/u;

export type PrivateVault = { id: string; recipient: string; formatVersion: "age-v1" };

export type LockedArticle = {
  blob: Blob;
  filename: string;
  vaultId: string;
  recipient: string;
  plaintextSize: number;
  sealedManifest: string;
  anchorSha256: string;
  operationId: string;
};

const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function encrypt(recipient: string, bytes: Uint8Array): Promise<Uint8Array> {
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  return encrypter.encrypt(bytes);
}

/** Always read the active recipient again before locking: a vault can be replaced after sign-in. */
export async function getPrivateVault(account?: string): Promise<PrivateVault> {
  const response = await authFetch("/vault/recipient", {}, false, account);
  if (!response.ok) {
    if (response.status === 404 || response.status === 409) throw new Error(VAULT_SETUP_MESSAGE);
    throw new Error("Can't reach your Private Vault right now. Nothing was sent. Try again soon.");
  }
  const data = await response.json();
  const vault = data?.vault;
  if (!vault || typeof vault.id !== "string" || !RECIPIENT.test(vault.recipient) || vault.formatVersion !== "age-v1") {
    throw new Error("We couldn't confirm your Private Vault, so nothing was sent.");
  }
  return vault;
}

/** Build the private-1.0 commitment used by the web app, then lock both WACZ and manifest. */
export async function lockArticle(blob: Blob, vault: PrivateVault): Promise<LockedArticle> {
  if (blob.size === 0 || blob.size > ARTICLE_BYTES) throw new Error("Private saves go up to 10 MB. This page is in your local library.");
  if (!RECIPIENT.test(vault.recipient)) throw new Error("Can't reach your Private Vault right now. Nothing was sent. Try again soon.");
  const plaintext = new Uint8Array(await blob.arrayBuffer());
  // WACZ is ZIP. This validates the extension's own packaging before we hide it.
  if (plaintext.length < 4 || plaintext[0] !== 0x50 || plaintext[1] !== 0x4b || plaintext[2] !== 0x03 || plaintext[3] !== 0x04) {
    throw new Error("This capture couldn't be read, so nothing was sent. Save the page again.");
  }
  const plaintextSha256 = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", plaintext as BufferSource)));
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const manifest = {
    schemaVersion: "private-1.0",
    generator: { name: "permavault", version: __AWP_VERSION__ },
    algorithm: "sha256",
    capture: { captureId: crypto.randomUUID(), capturedAtUtc: new Date().toISOString(), clockSource: "capture device browser clock" },
    privacyNonce: toHex(nonce),
    files: [{ name: "browser-article.wacz", role: "primary", sha256: plaintextSha256, sizeBytes: plaintext.length }],
    mimeType: "application/wacz",
  };
  const serialized = new TextEncoder().encode(`${JSON.stringify(canonical(manifest), null, 2)}\n`);
  const preimage = new Uint8Array(nonce.length + serialized.length);
  preimage.set(nonce);
  preimage.set(serialized, nonce.length);
  const anchorSha256 = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", preimage as BufferSource)));
  const [ciphertext, sealedManifest] = await Promise.all([
    encrypt(vault.recipient, plaintext),
    encrypt(vault.recipient, serialized),
  ]);
  return {
    blob: new Blob([ciphertext as BlobPart], { type: "application/octet-stream" }),
    filename: `private-article-${crypto.randomUUID()}.age`,
    vaultId: vault.id,
    recipient: vault.recipient,
    plaintextSize: plaintext.length,
    sealedManifest: toBase64(sealedManifest),
    anchorSha256,
    operationId: crypto.randomUUID(),
  };
}

/** No title, source URL, screenshot or plaintext hash enters this request. */
export async function stagePrivateArticle(article: LockedArticle, account: string): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const current = await getPrivateVault(account);
  if (current.id !== article.vaultId || current.recipient !== article.recipient) {
    throw new Error("Your Private Vault changed, so this capture can't be sent. Save the page again.");
  }
  const form = new FormData();
  form.append("file", new File([article.blob], article.filename, { type: "application/octet-stream" }));
  form.append("visibility", "private");
  form.append("privateArticleSave", "true");
  form.append("captureOrigin", "browser-extension");
  form.append("vaultId", article.vaultId);
  form.append("plaintextSize", String(article.plaintextSize));
  form.append("contentTypeOriginal", "application/wacz");
  form.append("clientValidated", "true");
  form.append("sealedManifest", article.sealedManifest);
  form.append("anchorSha256", article.anchorSha256);
  form.append("operationId", article.operationId);
  const response = await authFetch("/archive/file", { method: "POST", body: form }, false, account);
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
  } catch { /* A non-JSON error is still a refusal. */ }
  return { status: response.status, json };
}
