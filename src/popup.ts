// Permavault one-click popup: sign in with an Arweave keyfile, record the
// current tab with the existing engine, package the WACZ and upload it to
// the Permavault vault.

import { LitElement, html, css, svg } from "lit";

import {
  BEHAVIOR_WAIT_LOAD,
  BEHAVIOR_READY_START,
  BEHAVIOR_RUNNING,
  BEHAVIOR_PAUSED,
  BEHAVIOR_DONE,
} from "./consts";

import {
  getStoredSession,
  signInWithJwk,
  signOut,
  VAULT_HOME,
} from "./pv/auth";

import { getBalance, uploadWacz, openWsForJob, getCaptureJob, makePermanent } from "./pv/api";

import { loadPending, savePending, clearPending, type LargeCaptureState } from "./pv/pending";

import { startEmailGrant, loadEmailGrant, exchangeEmailGrant, type EmailGrant } from "./pv/extensionAuth";
import { quoteLargeCapture, checkoutLargeCapture, coveringLargePayment, largeCheckoutState, uploadLargeCapture, ServerRefusal, PAYMENT_GONE } from "./pv/largeCapture";
import { ARTICLE_BYTES, VAULT_SETUP_MESSAGE, getPrivateVault, lockArticle, stagePrivateArticle, type LockedArticle } from "./pv/privateArticle";
import { getLocalOption, setLocalOption, removeLocalOption } from "./localstorage";

// Lucide icons (lucide 0.460), inline so the popup loads nothing else. Their
// stroke comes from the .ic styles (K5 Graphite, option I).
const ICONS = {
  alert: svg`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>`,
  check: svg`<path d="M20 6 9 17l-5-5"></path>`,
  chevron: svg`<path d="m9 18 6-6-6-6"></path>`,
  clock: svg`<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>`,
  download: svg`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line>`,
  external: svg`<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>`,
  folder: svg`<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path>`,
  globe: svg`<circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path>`,
  hourglass: svg`<path d="M5 22h14"></path><path d="M5 2h14"></path><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"></path><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"></path>`,
  info: svg`<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>`,
  key: svg`<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"></path><path d="m21 2-9.6 9.6"></path><circle cx="7.5" cy="15.5" r="5.5"></circle>`,
  lock: svg`<rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>`,
  mail: svg`<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>`,
  package: svg`<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"></path><path d="M12 22V12"></path><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"></path><path d="m7.5 4.27 9 5.15"></path>`,
  record: svg`<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="1"></circle>`,
  refresh: svg`<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path>`,
  upload: svg`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" x2="12" y1="3" y2="15"></line>`,
};

type IconName = keyof typeof ICONS;

function icon(name: IconName, size = 16, extra = "") {
  const cls = `ic${size <= 14 ? " small" : ""}${extra ? ` ${extra}` : ""}`;
  return html`<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

const STANDARD_BYTES = 100 * 1024 * 1024;

// Download API served by the extension background service worker (bg.js
// importScripts sw.js, see src/sw/main.ts and src/sw/api.ts). This mirrors
// apiPrefix ("./w/api") from the replaywebpage package; duplicated here so
// the popup bundle does not pull in the whole replay UI.
const WACZ_API_PREFIX = "./w/api";

// Give up on the progress WebSocket after this long and show the fallback
const WS_FALLBACK_TIMEOUT = 120000;
const JOB_POLL_INTERVAL = 5000;

const LOCAL_CAPTURE_NOTICE = `Save to this browser only?

It stays in this browser. Nothing is uploaded.
Sign in later to make it permanent.`;

const CAPTURE_DESTINATION_NOTICE = `Save this page?

Saves the page exactly as you see it, including anything you're signed in to see.
Up to 10 MB: free for 7 days, then $0.99 to make permanent.
Once permanent, anyone with its link can view it.

Only save pages you have the right to share.`;

const PRIVATE_CAPTURE_NOTICE = `Save this page privately?

Sealed on this device before upload. Only your vault can open it.
Up to 10 MB: free for 7 days, then $1.99 to make permanent.

A readable copy also stays in this browser's local library.`;

// Backend expiry timestamps use SQLite UTC or ISO 8601 with a timezone.
export function serverExpiryDate(value: string): Date | null {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const canonical = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value);
  const normalized = canonical ? value.replace(" ", "T") + "Z" : hasZone ? value : "";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The web app's wording for a temporary save (captureStatus/formatDeadline):
 * the time left first, then the moment in the reader's own time.
 */
export function temporaryLine(expiry: Date, now = Date.now()): string {
  const ms = expiry.getTime() - now;
  if (ms <= 0) return "Temporary · ending now";
  const hours = Math.floor(ms / 3600000);
  const left = hours < 1 ? "under an hour" : hours <= 48 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${Math.floor(hours / 24)} days`;
  const moment = expiry.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return `Temporary · ${left} left, until ${moment}`;
}

// ===========================================================================
class PermavaultPopup extends LitElement {
  // Type-space declarations for Lit reactive props and internals (the
  // upstream codebase used per-line @ts-expect-error spam for these).
  declare emailGrant: EmailGrant | null;
  declare largeState: LargeCaptureState | null;
  declare largeBusy: boolean;
  declare largeQuote: number | null;
  declare stagedExpiresAt: string;
  declare checkoutBusy: boolean;
  declare phase: string;
  declare destinationAccepted: boolean;
  declare privateSelected: boolean;
  declare privateVaultReady: boolean;
  declare privateVaultMessage: string;
  declare privateArticle: LockedArticle | null;
  declare startingCapture: boolean;
  declare pendingAccount: string | null;
  declare walletAddress: string;
  declare accountEmail: string;
  declare balance: number;
  declare balanceUnlimited: boolean;
  declare balanceLoaded: boolean;
  declare signingIn: boolean;
  declare keyError: string;
  declare keyFileName: string;
  declare pastedKey: string;
  declare pageUrl: string;
  declare pageTitle: string;
  declare canRecord: boolean;
  declare recording: boolean;
  declare stopping: boolean;
  declare waitingForStart: boolean;
  declare behaviorState: string;
  declare behaviorMsg: string;
  declare numPending: number;
  declare failureMsg: string | null;
  declare uploadPercent: number | null;
  declare uploadStage: string;
  declare doneKind: string;
  declare uploadId: string;
  declare errorMsg: string;
  declare port: any;
  declare tabId: number;
  declare collId: string;
  declare capturedPageUrl: string;
  declare autoStopSent: boolean;
  declare stopRequested: boolean;
  declare wasRecording: boolean;
  declare waczBlob: Blob | null;
  declare waczFilename: string;
  declare sourceUrl: string;
  declare screenshotDataUrl: string | null;
  declare jobWs: WebSocket | null;
  declare jobTimer: ReturnType<typeof setTimeout> | null;
  declare jobPollTimer: ReturnType<typeof setTimeout> | null;
  declare jobTrackingCancel: (() => void) | null;
  constructor() {
    super();

    // ui state machine:
    // loading -> signed-out -> idle -> capturing -> packaging -> uploading
    //   -> done | server-not-ready | out-of-captures | error
    this.emailGrant = null;
    this.largeState = null;
    this.largeBusy = false;
    this.largeQuote = null;
    this.stagedExpiresAt = "";
    this.checkoutBusy = false;
    this.phase = "loading";
    this.destinationAccepted = false;
    this.privateSelected = false;
    this.privateVaultReady = false;
    this.privateVaultMessage = "";
    this.privateArticle = null;
    this.startingCapture = false;
    this.pendingAccount = null;

    this.walletAddress = "";
    this.accountEmail = "";
    this.balance = 0;
    this.balanceUnlimited = false;
    this.balanceLoaded = false;

    this.signingIn = false;
    this.keyError = "";
    this.keyFileName = "";
    this.pastedKey = "";

    this.pageUrl = "";
    this.pageTitle = "";
    this.canRecord = false;

    this.recording = false;
    this.stopping = false;
    this.waitingForStart = false;
    this.behaviorState = BEHAVIOR_WAIT_LOAD;
    this.behaviorMsg = "";
    this.numPending = 0;
    this.failureMsg = null;

    this.uploadPercent = null;
    this.uploadStage = "";
    this.doneKind = "";
    this.uploadId = "";
    this.errorMsg = "";

    // non-reactive internals
    this.port = null;
    this.tabId = 0;
    this.collId = "";
    this.capturedPageUrl = "";
    this.autoStopSent = false;
    this.stopRequested = false;
    this.wasRecording = false;
    this.waczBlob = null;
    this.waczFilename = "";
    this.sourceUrl = "";
    this.screenshotDataUrl = null;
    this.jobWs = null;
    this.jobTimer = null;
    this.jobPollTimer = null;
    this.jobTrackingCancel = null;
  }

  static get properties() {
    return {
      emailGrant: { type: Object }, largeState: { type: Object },
      largeBusy: { type: Boolean }, largeQuote: { type: Number },
      stagedExpiresAt: { type: String },
      checkoutBusy: { type: Boolean },
      pendingAccount: { type: String },
      privateSelected: { type: Boolean }, privateVaultReady: { type: Boolean }, privateVaultMessage: { type: String },
      phase: { type: String },

      walletAddress: { type: String },
      accountEmail: { type: String },
      balance: { type: Number },
      balanceUnlimited: { type: Boolean },
      balanceLoaded: { type: Boolean },

      signingIn: { type: Boolean },
      keyError: { type: String },
      keyFileName: { type: String },
      pastedKey: { type: String },

      pageUrl: { type: String },
      pageTitle: { type: String },
      canRecord: { type: Boolean },

      recording: { type: Boolean },
      stopping: { type: Boolean },
      waitingForStart: { type: Boolean },
      behaviorState: { type: String },
      behaviorMsg: { type: String },
      numPending: { type: Number },
      failureMsg: { type: String },

      uploadPercent: { type: Object },
      uploadStage: { type: String },
      doneKind: { type: String },
      uploadId: { type: String },
      errorMsg: { type: String },
    };
  }

  firstUpdated() {
    try {
      this.connectPort();
    } catch {
      // Let the popup load if its first connection fails. The next message
      // opens a fresh port.
      this.port = null;
    }
    void this.initSession();
  }

  // -----------------------------------------------------------------------
  // session

  async initSession() {
    this.emailGrant = await loadEmailGrant();
    const session = await getStoredSession();
    if (session) {
      this.walletAddress = session.walletAddress;
      this.accountEmail = session.email || "";
      this.phase = "idle";
      void this.refreshBalance();
      void this.refreshPrivateVault();
    } else {
      this.walletAddress = "";
      this.accountEmail = "";
      this.phase = "signed-out";
    }
    try {
      this.privateSelected = (await getLocalOption("pvPendingPrivacy")) === "private";
      const pending = await loadPending();
      if (pending) {
        this.largeState = pending.large || null;
        this.largeQuote = this.largeState?.amountCents ?? null;
        this.pendingAccount = pending.account;
        this.waczBlob = pending.blob;
        this.waczFilename = pending.filename;
        this.sourceUrl = pending.sourceUrl;
        this.screenshotDataUrl = pending.screenshotDataUrl;
        if (pending.privateArticle) {
          this.privateSelected = true;
          this.privateArticle = { ...pending.privateArticle, blob: pending.blob, filename: pending.filename };
        }
        if (pending.submitted && !pending.large && !this.pendingAccountMismatch) {
          this.doneKind = "finishing";
          this.phase = "done";
        } else {
          // Another account's package is download-only until its owner signs in.
          this.destinationAccepted = false;
          this.phase = "review-capture";
        }
      }
    } catch (_e) {
      this.errorMsg = "We couldn't reopen your last capture. Open your local library to download it.";
    }
    // The background recorder may answer before account and pending-package
    // storage finish loading. Keep its live state when that happens.
    if (this.recording) {
      this.phase = "capturing";
      this.wasRecording = true;
      this.capturedPageUrl = this.pageUrl;
    }
  }

  async refreshPrivateVault() {
    try {
      await getPrivateVault(this.walletAddress);
      this.privateVaultReady = true;
      this.privateVaultMessage = "";
    } catch (error) {
      this.privateVaultReady = false;
      this.privateVaultMessage = error instanceof Error ? error.message : "Can't reach your Private Vault right now. Try again soon.";
    }
  }

  async onEmailSignIn() {
    this.keyError = "";
    this.signingIn = true;
    try {
      this.emailGrant = await startEmailGrant();
      this.openTab(this.emailGrant.approvalUrl);
    } catch (error) { this.keyError = error instanceof Error ? error.message : "Couldn't start sign-in. Try again."; }
    finally { this.signingIn = false; }
  }

  async onCheckEmailSignIn() {
    if (this.signingIn) return;
    this.signingIn = true;
    this.keyError = "";
    try {
      this.emailGrant = await loadEmailGrant();
      if (!this.emailGrant) throw new Error("This sign-in request has ended. Start again.");
      if (await exchangeEmailGrant()) {
        this.emailGrant = null;
        this.destinationAccepted = false;
        await this.initSession();
      } else this.keyError = "Waiting for approval on the website.";
    } catch (error) { this.keyError = error instanceof Error ? error.message : "Couldn't check sign-in. Try again."; }
    finally { this.signingIn = false; }
  }

  async refreshBalance() {
    try {
      const res = await getBalance();
      this.balance = typeof res.balance === "number" ? res.balance : 0;
      this.balanceUnlimited = !!res.unlimited;
      this.balanceLoaded = true;
    } catch (_e) {
      // leave the balance line hidden, the archive attempt will surface any
      // real problem (like running out of captures) on its own
      this.balanceLoaded = false;
    }
  }

  // @ts-expect-error - TS7006 - Parameter 'text' implicitly has an 'any' type.
  async signInWithKeyText(text) {
    this.keyError = "";

    let jwk;
    try {
      jwk = JSON.parse(text);
    } catch (_e) {
      this.keyError = "That isn't a key file. Choose the .json file you sign in with.";
      return;
    }

    this.signingIn = true;
    try {
      const session = await signInWithJwk(jwk);
      this.walletAddress = session?.walletAddress || "";
      this.pastedKey = "";
      this.destinationAccepted = false;
      await this.initSession();
      void this.refreshBalance();
    } catch (_e) {
      this.keyError = "Sign-in didn't work. Check your connection and use the key you sign in with on the website.";
    } finally {
      this.signingIn = false;
    }
  }

  async onSignOut() {
    this.closeJobChannel();
    await signOut();
    this.walletAddress = "";
    this.accountEmail = "";
    this.balanceLoaded = false;
    this.privateVaultReady = false;
    // Keep an unfinished package visible so a local-only capture cannot
    // silently replace it after the account changes.
    this.phase = this.recording ? "capturing" : this.waczBlob ? "review-capture" : "signed-out";
  }

  // -----------------------------------------------------------------------
  // background port

  connectPort() {
    const port = chrome.runtime.connect({ name: "popup-port" });
    this.port = port;

    port.onMessage.addListener((message: any) => {
      if (this.port === port) this.onMessage(message);
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      if (this.phase === "capturing" && this.waitingForStart && !this.wasRecording) {
        this.captureStartUnconfirmed("The capture didn't start. Check your local library before trying again.");
      }
    });

    if (this.tabId) {
      port.postMessage({ tabId: this.tabId, type: "startUpdates" });
      return port;
    }

    // @ts-expect-error - TS7006 - Parameter 'tabs' implicitly has an 'any' type.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length) {
        this.tabId = tabs[0].id;
        this.pageUrl = tabs[0].url || "";
        this.pageTitle = tabs[0].title || "";
        this.updateCanRecord();
        try {
          this.sendMessage({ tabId: this.tabId, type: "startUpdates" });
        } catch {
          // Recording can still retry a fresh connection after the user clicks.
          this.port = null;
        }
      }
    });
    return port;
  }

  // @ts-expect-error - TS7006 - Parameter 'message' implicitly has an 'any' type.
  sendMessage(message) {
    try {
      (this.port || this.connectPort()).postMessage(message);
    } catch {
      // postMessage throws synchronously for a disconnected runtime Port.
      // Re-register the tab before retrying so the background handler has
      // the correct tabId when it receives startRecording.
      this.port = null;
      this.connectPort().postMessage(message);
    }
  }

  // @ts-expect-error - TS7006 - Parameter 'message' implicitly has an 'any' type.
  onMessage(message) {
    switch (message.type) {
      case "status":
        this.onStatus(message);
        break;

      case "collections":
        // collections are managed for us, nothing to do
        break;

      case "startRecordingFailed":
        if (this.phase === "capturing" && !this.wasRecording) {
          this.captureStartUnconfirmed("The capture didn't start. Check your local library before trying again.");
        }
        break;
    }
  }

  // @ts-expect-error - TS7006 - Parameter 'message' implicitly has an 'any' type.
  onStatus(message) {
    this.recording = message.recording;
    this.stopping = message.stopping;
    this.behaviorState = message.behaviorState;
    this.behaviorMsg = message.behaviorData?.msg || "";
    this.numPending = message.numPending || 0;
    this.failureMsg = message.failureMsg;

    if (message.collId) {
      this.collId = message.collId;
    }

    if (message.pageUrl) {
      this.pageUrl = message.pageUrl;
      this.updateCanRecord();
      if (this.phase === "capturing") {
        this.capturedPageUrl = message.pageUrl;
      }
    }

    // a recording started elsewhere (context menu, reopened popup)
    if ((this.phase === "idle" || this.phase === "signed-out") && message.recording) {
      this.phase = "capturing";
      this.capturedPageUrl = message.pageUrl || this.pageUrl;
    }

    if (this.phase !== "capturing") {
      return;
    }

    if (message.firstPageStarted) {
      this.waitingForStart = false;
    }

    if (message.recording) {
      this.wasRecording = true;
    }

    if (message.failureMsg) {
      this.phase = "error";
      this.errorMsg = "This page couldn't be saved. Try again, or try another page.";
      return;
    }

    // autopilot finished, stop the capture
    if (
      message.recording &&
      !message.stopping &&
      message.behaviorState === BEHAVIOR_DONE &&
      !this.autoStopSent
    ) {
      this.autoStopSent = true;
      this.sendMessage({ type: "stopRecording" });
    }

    // recording fully stopped, package and upload
    if (
      this.wasRecording &&
      !message.recording &&
      !message.stopping
    ) {
      void this.packageAndUpload();
    }
  }

  updateCanRecord() {
    this.canRecord =
      !!this.pageUrl &&
      (this.pageUrl === "about:blank" ||
        this.pageUrl.startsWith("http:") ||
        this.pageUrl.startsWith("https:"));
  }

  // -----------------------------------------------------------------------
  // capture flow

  captureStartUnconfirmed(message: string) {
    this.waitingForStart = false;
    this.phase = "error";
    this.errorMsg = message;
  }

  async onArchiveClick() {
    if (this.startingCapture) return;
    this.startingCapture = true;
    let pending: Awaited<ReturnType<typeof loadPending>>;
    try {
      pending = await loadPending();
    } catch {
      this.phase = "error";
      this.errorMsg = "We couldn't reopen your last capture. Open your local library to download it.";
      this.startingCapture = false;
      return;
    }
    if (this.waczBlob || pending) {
      if (pending && !this.waczBlob) {
        this.waczBlob = pending.blob;
        this.waczFilename = pending.filename;
        this.sourceUrl = pending.sourceUrl;
        this.pendingAccount = pending.account;
      }
      this.errorMsg = "Finish or set aside your last capture first. It's safe in your local library.";
      this.phase = "review-capture";
      this.startingCapture = false;
      return;
    }
    const signedIn = Boolean(this.walletAddress);
    const privateRequested = signedIn && this.privateSelected;
    if (!window.confirm(privateRequested ? PRIVATE_CAPTURE_NOTICE : signedIn ? CAPTURE_DESTINATION_NOTICE : LOCAL_CAPTURE_NOTICE)) {
      this.startingCapture = false;
      return;
    }
    try {
      if (privateRequested) await getPrivateVault(this.walletAddress);
      await setLocalOption("pvPendingPrivacy", privateRequested ? "private" : "public");
    } catch (error) {
      this.errorMsg = error instanceof Error ? error.message : "This capture couldn't start. Nothing was sent.";
      this.startingCapture = false;
      return;
    }
    this.destinationAccepted = signedIn;
    this.pendingAccount = this.walletAddress;
    this.capturedPageUrl = this.pageUrl;
    this.autoStopSent = false;
    this.stopRequested = false;
    this.wasRecording = false;
    this.waitingForStart = true;
    this.phase = "capturing";

    // Grab the viewport now, before autorun scrolling moves it: this shot
    // becomes the exhibit PDF on the server. Optional, failure is fine.
    if (!privateRequested) this.captureViewportScreenshot();

    try {
      this.sendMessage({
        type: "startRecording",
        url: this.pageUrl,
        autorun: true,
      });
    } catch {
      this.captureStartUnconfirmed("The capture didn't start. Check your local library before trying again.");
    } finally {
      this.startingCapture = false;
    }
  }

  captureViewportScreenshot() {
    this.screenshotDataUrl = null;
    // @ts-expect-error - TS7006 - Parameter 'tabs' implicitly has an 'any' type.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs.length || chrome.runtime.lastError) {
        return;
      }
      chrome.tabs.captureVisibleTab(
        tabs[0].windowId,
        { format: "png" },
        // @ts-expect-error - TS7006 - Parameter 'dataUrl' implicitly has an 'any' type.
        (dataUrl) => {
          if (chrome.runtime.lastError || !dataUrl) {
            // restricted page (chrome://, Web Store, etc.): proceed without
            return;
          }
          this.screenshotDataUrl = dataUrl;
        },
      );
    });
  }

  onStopClick() {
    this.stopRequested = true;
    this.sendMessage({ type: "stopRecording" });
  }

  async packageAndUpload() {
    if (this.phase !== "capturing") {
      return;
    }

    this.phase = "packaging";

    try {
      const collId = this.collId;
      if (!collId) {
        throw new Error("no collection for this capture");
      }

      const dlUrl = new URL(
        `${WACZ_API_PREFIX}/c/${collId}/dl?format=wacz&pages=all`,
        window.location.href,
      ).href;

      const resp = await fetch(dlUrl);
      if (!resp.ok) {
        throw new Error(`wacz download failed: ${resp.status}`);
      }

      this.waczBlob = await resp.blob();
      this.waczFilename = this.makeFilename();
      this.sourceUrl = this.capturedPageUrl || this.pageUrl;
      if (this.privateSelected) {
        if (!this.walletAddress) throw new Error("Sign in to save this page privately.");
        if (this.pendingAccount !== this.walletAddress) throw new Error("You switched accounts, so nothing was sent. Sign in to the account that saved it.");
        const vault = await getPrivateVault(this.walletAddress);
        this.privateArticle = await lockArticle(this.waczBlob, vault);
        this.waczBlob = this.privateArticle.blob;
        this.waczFilename = this.privateArticle.filename;
        this.sourceUrl = "";
        this.screenshotDataUrl = null;
      }
    } catch (e) {
      if (!this.privateSelected) console.warn(e);
      this.phase = "error";
      this.errorMsg = this.privateSelected && e instanceof Error ? e.message
        : "The page was recorded but couldn't be prepared. It's safe in your local library.";
      return;
    }

    try {
      await this.persistPending();
    } catch (_e) {
      this.phase = "error";
      this.errorMsg = "We couldn't keep this capture for payment. Download it from your local library first.";
      return;
    }
    if (!this.walletAddress || (!this.privateSelected && (this.waczBlob?.size ?? 0) > ARTICLE_BYTES)) {
      this.phase = "review-capture";
      return;
    }
    await this.uploadCapture();
  }

  async persistPending(submitted = false) {
    if (!this.waczBlob) return;
    if (this.pendingAccount === null) this.pendingAccount = this.walletAddress;
    await savePending({ blob: this.waczBlob, filename: this.waczFilename,
      sourceUrl: this.sourceUrl, screenshotDataUrl: this.screenshotDataUrl,
      account: this.pendingAccount, submitted, ...(this.largeState ? { large: this.largeState } : {}),
      ...(this.privateArticle ? { privateArticle: {
        vaultId: this.privateArticle.vaultId, recipient: this.privateArticle.recipient,
        plaintextSize: this.privateArticle.plaintextSize,
        sealedManifest: this.privateArticle.sealedManifest, anchorSha256: this.privateArticle.anchorSha256,
        operationId: this.privateArticle.operationId,
      } } : {}) });
  }

  /**
   * PV-536: forget this package's payment and checkout, so the next press
   * finds a usable payment or opens a new checkout. The package stays.
   */
  private releaseLargePayment(state: LargeCaptureState) {
    Object.assign(state, { orderId: undefined, checkoutSessionId: undefined, checkoutUrl: undefined, amountCents: undefined,
      paidEarlier: undefined, checkoutOperationId: crypto.randomUUID(), operationId: crypto.randomUUID() });
    this.largeQuote = null;
  }

  async onLargeCapture() {
    if (this.largeBusy || !this.waczBlob || !this.walletAddress || this.pendingAccountMismatch) return;
    this.largeBusy = true;
    this.errorMsg = "";
    this.phase = "review-capture";
    try {
      if (!this.destinationAccepted) {
        if (!window.confirm(CAPTURE_DESTINATION_NOTICE)) return;
        this.destinationAccepted = true;
      }
      if (!this.largeState) {
        this.largeState = { account: this.walletAddress, operationId: crypto.randomUUID(), checkoutOperationId: crypto.randomUUID() };
        await this.persistPending();
      }
      const state = this.largeState;
      if (!state.sessionId && !state.orderId) {
        // PV-536: this package's own unused payment is used, after asking.
        const covering = await coveringLargePayment(this.waczBlob.size, this.walletAddress);
        if (covering) {
          if (!window.confirm("Already paid for. An earlier payment covers this capture. Upload it now?")) return;
          Object.assign(state, { orderId: covering, paidEarlier: true });
          this.largeQuote = null;
          await this.persistPending();
        }
      }
      if (!state.sessionId) {
        const quote = state.orderId ? { amountCents: state.amountCents || 0, included: false } : await quoteLargeCapture(this.waczBlob.size, this.walletAddress);
        this.largeQuote = quote.amountCents;
        if (!quote.included) {
          if (!state.orderId) {
            // PV-575 row 3: nothing is shown above the payment; the no-refund
            // rule lives in Terms section 6.
            const price = `$${(quote.amountCents / 100).toFixed(2)}`;
            if (!window.confirm(`Make this capture permanent for ${price}?\n\nPriced by size, paid once. No subscription. Checkout opens in a new tab.`)) return;
            const checkout = await checkoutLargeCapture(this.waczBlob.size, state);
            // A checkout of our own never carries an earlier payment's flag.
            Object.assign(state, { paidEarlier: undefined }, checkout);
            if ("paidEarlier" in checkout) this.largeQuote = null;
            await this.persistPending();
            if (!("paidEarlier" in checkout)) {
              this.largeQuote = state.amountCents ?? null;
              this.openTab(state.checkoutUrl!);
              return;
            }
          }
          if (!state.paidEarlier) {
            const checkout = await largeCheckoutState(state);
            if (checkout === "closed") {
              // PV-536: that checkout closed unpaid; the next press opens a new one.
              this.releaseLargePayment(state);
              await this.persistPending();
              this.errorMsg = "That checkout closed without payment, so nothing was charged. Press See price to try again.";
              return;
            }
            if (checkout !== "paid") {
              this.errorMsg = "Waiting for your payment. Finish checkout, then press Upload now.";
              return;
            }
          }
        }
      }
      this.phase = "uploading";
      const result = await uploadLargeCapture({ blob: this.waczBlob, filename: this.waczFilename,
        sourceUrl: this.sourceUrl, screenshotDataUrl: this.screenshotDataUrl, account: this.walletAddress },
        state, () => this.persistPending(true), percent => { this.uploadPercent = percent; });
      if (result.status === 202 && result.json.jobId) void this.trackUploadJob(result.json.jobId);
      else this.completeCapture(result.json);
    } catch (error) {
      this.phase = "review-capture";
      if (error instanceof ServerRefusal && error.code && PAYMENT_GONE.has(error.code) && this.largeState && !this.largeState.sessionId) {
        // PV-536: the payment it was to use was used or taken meanwhile. Let it
        // go, so the next press looks again instead of repeating the refusal.
        this.releaseLargePayment(this.largeState);
        await this.persistPending();
        this.errorMsg = "That earlier payment is already in use. Nothing more was charged. Press See price to check again.";
      } else {
        this.errorMsg = error instanceof Error ? error.message : "Upload paused. Your capture is kept in this browser. Press Upload now to resume.";
      }
    } finally { this.largeBusy = false; }
  }

  async onClaimLocalCapture() {
    if (this.pendingAccount !== "" || !this.walletAddress) return;
    if (!window.confirm("Add this capture to your account? It's saved as a regular capture.")) return;
    this.pendingAccount = this.walletAddress;
    this.destinationAccepted = false;
    await this.persistPending();
  }

  get pendingAccountMismatch() {
    return this.pendingAccount !== null && this.pendingAccount !== this.walletAddress;
  }

  async uploadCapture() {
    if (!this.walletAddress) {
      this.phase = "review-capture";
      return;
    }
    if (this.pendingAccountMismatch) {
      this.phase = "review-capture";
      return;
    }
    // A reopened popup can resume a recording it did not start. Never let
    // that path bypass the destination disclosure before sending any bytes.
    if (!this.destinationAccepted) {
      if (!window.confirm(this.privateSelected ? PRIVATE_CAPTURE_NOTICE : CAPTURE_DESTINATION_NOTICE)) {
        this.phase = "error";
        this.errorMsg = "Cancelled. Your capture is in your local library.";
        return;
      }
      this.destinationAccepted = true;
    }
    if (!this.privateSelected && this.waczBlob && this.waczBlob.size > STANDARD_BYTES && this.walletAddress) {
      await this.onLargeCapture();
      return;
    }
    if (!this.walletAddress) {
      this.phase = "review-capture";
      return;
    }
    this.phase = "uploading";
    this.uploadPercent = null;
    this.uploadStage = "";

    if (!this.waczBlob) {
      this.phase = "error";
      this.errorMsg = "This capture is no longer open here. Save the page again.";
      return;
    }
    if (this.privateSelected && !this.privateArticle) {
      this.phase = "error";
      this.errorMsg = "This page couldn't be sealed, so nothing was sent. It's in your local library.";
      return;
    }

    let result;
    try {
      if (this.privateSelected) {
        await this.persistPending(true);
        result = await stagePrivateArticle(this.privateArticle!, this.walletAddress);
      } else {
      let screenshotBlob: Blob | null = null;
      if (this.screenshotDataUrl) {
        try {
          screenshotBlob = await (await fetch(this.screenshotDataUrl)).blob();
        } catch (_e) {
          // unreadable data URL: upload without an exhibit shot
        }
      }
      await this.persistPending(true);
      result = await uploadWacz(
        this.waczBlob,
        this.waczFilename,
        this.sourceUrl,
        screenshotBlob,
        this.walletAddress,
      );
      }
    } catch (_e) {
      // The request may have reached the server. Never invite a blind retry.
      this.doneKind = "finishing";
      this.phase = "done";
      return;
    }

    const { status, json } = result;

    if (status === 202 && json?.jobId) {
      this.trackUploadJob(json.jobId);
      return;
    }

    if (status >= 200 && status < 300 && json) {
      this.completeCapture(json);
      return;
    }
    if (status >= 500) {
      this.doneKind = "finishing";
      this.phase = "done";
      return;
    }
    await this.persistPending(false);
    switch (status) {
      case 400:
        this.phase = "error";
        this.errorMsg = "Permavault couldn't accept this capture. It's safe in your local library.";
        break;

      case 402:
        if (this.privateSelected) {
          this.phase = "error";
          this.errorMsg = "This private save didn't go through. Check History before trying again.";
        } else {
          this.balance = typeof json?.balance === "number" ? json.balance : 0;
          this.phase = "out-of-captures";
        }
        break;

      case 409:
        this.phase = "error";
        this.errorMsg = "Another capture is still saving. Try again in a moment.";
        break;

      default:
        this.phase = "error";
        this.errorMsg = "The upload didn't go through. Your capture is safe in your local library.";
    }
  }

  // @ts-expect-error - TS7006 - Parameter 'jobId' implicitly has an 'any' type.
  async trackUploadJob(jobId) {
    this.closeJobChannel();
    let settled = false;
    let cancelled = false;
    const account = this.walletAddress;
    let checking: Promise<void> | null = null;
    const cancel = () => { cancelled = true; };
    this.jobTrackingCancel = cancel;
    const active = () => !settled && !cancelled && this.jobTrackingCancel === cancel;

    // @ts-expect-error - TS7006 - Parameter 'fn' implicitly has an 'any' type.
    const finish = (fn) => {
      if (active()) {
        settled = true;
        fn();
      }
    };

    const fallbackToFinishing = () =>
      finish(() => {
        // the upload was accepted, it will land in the vault on its own
        this.doneKind = "finishing";
        this.phase = "done";
        this.closeJobChannel();
      });

    const checkDurableStatus = async () => {
      if (!active()) return;
      if (checking) return checking;
      const pending = (async () => {
        try {
          const job = await getCaptureJob(jobId, account);
          if (!active() || this.walletAddress !== account) return;
          const result = job.result;
          if ((job.status === "staged" || job.status === "succeeded") &&
              typeof result?.uploadId === "string") {
            finish(() => {
              this.completeCapture({
                uploadId: result.uploadId || undefined,
                staged: job.status === "staged",
                stagedExpiresAt: result.stagedExpiresAt || undefined,
                txId: result.txId || undefined,
                alreadyArchived: result.alreadyArchived,
              });
              this.closeJobChannel();
              void this.refreshBalance();
            });
          } else if (job.status === "failed") {
            finish(() => {
              this.phase = "error";
              this.errorMsg = "Permavault couldn't finish this capture. It's safe in your local library.";
              this.closeJobChannel();
            });
          }
        } catch (_e) {
          // A status lookup can fail while the live channel still succeeds.
        }
      })();
      checking = pending;
      await pending;
      if (checking === pending) checking = null;
    };

    const pollDurableStatus = async () => {
      await checkDurableStatus();
      if (active() && this.walletAddress === account) {
        this.jobPollTimer = setTimeout(pollDurableStatus, JOB_POLL_INTERVAL);
      }
    };

    // The ticket request itself can stall, so arm durable recovery before
    // waiting for the live progress channel.
    this.jobPollTimer = setTimeout(pollDurableStatus, JOB_POLL_INTERVAL);
    this.jobTimer = setTimeout(fallbackToFinishing, WS_FALLBACK_TIMEOUT);

    try {
      const ws = await openWsForJob(jobId, {
        onStage: (stage) => {
          if (!active()) return;
          this.uploadStage = stage || "";
        },
        onProgress: (percent) => {
          if (!active()) return;
          this.uploadPercent = typeof percent === "number" ? percent : null;
        },
        onComplete: (data) =>
          finish(() => {
            this.completeCapture(data);
            this.closeJobChannel();
            void this.refreshBalance();
          }),
        onError: (data) =>
          finish(() => {
            if (!this.privateSelected) console.warn("upload job failed", data);
            this.phase = "error";
            this.errorMsg =
              "Permavault couldn't finish this capture. It's safe in your local library.";
            this.closeJobChannel();
          }),
        onWsError: () => { void checkDurableStatus(); },
      });
      if (!active()) { ws.close(); return; }
      this.jobWs = ws;
    } catch (_e) {
      // The authenticated job lookup still works without a progress channel.
      void checkDurableStatus();
      return;
    }

    if (!active()) this.closeJobChannel();
  }

  completeCapture(data: { uploadId?: string; staged?: boolean; stagedExpiresAt?: string; txId?: string; alreadyArchived?: boolean }) {
    this.uploadId = data.uploadId || "";
    this.stagedExpiresAt = data.stagedExpiresAt || "";
    this.doneKind = data.staged === true ? "staged"
      : data.txId ? (data.alreadyArchived === true ? "existing" : "vault") : "finishing";
    this.phase = "done";
    // Keep the bytes until the user explicitly moves on, including uncertain outcomes.
  }

  async onMakePermanent() {
    if (this.checkoutBusy || !this.uploadId) return;
    // PV-470: a private save is a paid private capture, so the customer first
    // confirms we may start straight away, on the save's own page in
    // Permavault, where that acknowledgement is shown and recorded. The server
    // refuses a private checkout without it.
    if (this.privateSelected) {
      this.openTab(`${VAULT_HOME}/view/${this.uploadId}`);
      return;
    }
    this.checkoutBusy = true;
    this.errorMsg = "";
    try { this.openTab(await makePermanent(this.uploadId)); }
    catch (error) { this.errorMsg = error instanceof Error ? error.message : "Checkout didn't open. Check History to continue."; }
    finally { this.checkoutBusy = false; }
  }

  onDownloadCapture() {
    if (!this.waczBlob) return;
    const url = URL.createObjectURL(this.waczBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = this.waczFilename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  closeJobChannel() {
    this.jobTrackingCancel?.();
    this.jobTrackingCancel = null;
    if (this.jobPollTimer) {
      clearTimeout(this.jobPollTimer);
      this.jobPollTimer = null;
    }
    if (this.jobTimer) {
      clearTimeout(this.jobTimer);
      this.jobTimer = null;
    }
    if (this.jobWs) {
      try {
        this.jobWs.close();
      } catch (_e) {
        // already closed
      }
      this.jobWs = null;
    }
  }

  onTryAgain() {
    if (this.privateSelected && !this.privateArticle) {
      // The raw WACZ is still in the local library. Start a fresh Private
      // capture instead of retrying with bytes that were never locked.
      this.resetForNext();
      return;
    }
    if (this.waczBlob) {
      // the capture is still in memory, retry the upload only
      void this.uploadCapture();
      return;
    }
    this.resetForNext();
  }

  onArchiveAnother() {
    this.resetForNext();
  }

  async onSetAsidePending() {
    if (!window.confirm("Set aside this capture? It stays in your local library. If it was already sent, check History.")) return;
    try {
      await clearPending();
    } catch {
      this.errorMsg = "We couldn't set aside your last capture. Open your local library to download it.";
      return;
    }
    this.resetForNext(false);
    if (!this.walletAddress) this.phase = "signed-out";
  }

  resetForNext(clearStoredPending = true) {
    this.largeState = null;
    this.largeQuote = null;
    if (clearStoredPending) void clearPending();
    void removeLocalOption("pvPendingPrivacy");
    this.stagedExpiresAt = "";
    this.closeJobChannel();
    this.destinationAccepted = false;
    this.privateArticle = null;
    this.pendingAccount = null;
    this.phase = "idle";
    this.waczBlob = null;
    this.waczFilename = "";
    this.sourceUrl = "";
    this.screenshotDataUrl = null;
    this.uploadId = "";
    this.doneKind = "";
    this.uploadPercent = null;
    this.uploadStage = "";
    this.errorMsg = "";
    this.autoStopSent = false;
    this.stopRequested = false;
    this.wasRecording = false;
    this.waitingForStart = false;
    this.refreshTabInfo();
    void this.refreshBalance();
  }

  refreshTabInfo() {
    // @ts-expect-error - TS7006 - Parameter 'tabs' implicitly has an 'any' type.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length) {
        this.pageUrl = tabs[0].url || "";
        this.pageTitle = tabs[0].title || "";
        this.updateCanRecord();
      }
    });
  }

  makeFilename() {
    let host = "page";
    try {
      host = new URL(this.capturedPageUrl || this.pageUrl).hostname || "page";
    } catch (_e) {
      // keep default
    }
    host = host.replace(/[^a-z0-9.-]+/gi, "").replace(/^\.+|\.+$/g, "");
    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    return `${host || "page"}-${ts}.wacz`;
  }

  // -----------------------------------------------------------------------
  // links

  // @ts-expect-error - TS7006 - Parameter 'url' implicitly has an 'any' type.
  openTab(url) {
    chrome.tabs.create({ url });
  }

  onOpenVault() {
    this.openTab(VAULT_HOME);
  }

  onOpenHistory() {
    this.openTab(`${VAULT_HOME}/history`);
  }

  onOpenLibrary() {
    this.openTab(chrome.runtime.getURL("index.html"));
  }

  onViewInVault() {
    if (this.uploadId) {
      this.openTab(`${VAULT_HOME}/view/${this.uploadId}`);
    }
  }

  onBuyCaptures() {
    this.openTab(VAULT_HOME);
  }

  // @ts-expect-error - TS7006 - Parameter 'event' implicitly has an 'any' type.
  async onKeyFile(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }
    this.keyFileName = file.name;
    const text = await file.text();
    await this.signInWithKeyText(text);
  }

  // @ts-expect-error - TS7006 - Parameter 'event' implicitly has an 'any' type.
  onPasteKey(event) {
    this.pastedKey = event.currentTarget.value;
  }

  onSignInClick() {
    void this.signInWithKeyText(this.pastedKey);
  }

  // -----------------------------------------------------------------------
  // display helpers

  get shortWallet() {
    const wallet = this.walletAddress || "";
    return wallet.length > 12
      ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
      : wallet;
  }

  get balanceLine() {
    if (!this.balanceLoaded) {
      return "";
    }
    if (this.balanceUnlimited) {
      return "Captures included";
    }
    return `${this.balance} ${this.balance === 1 ? "capture" : "captures"} left`;
  }

  get outOfCaptures() {
    return this.balanceLoaded && !this.balanceUnlimited && this.balance <= 0;
  }

  get captureStatusLine() {
    if (this.waitingForStart) {
      return "Starting… the page will reload.";
    }
    if (this.stopping || this.stopRequested) {
      return "Finishing up…";
    }
    switch (this.behaviorState) {
      case BEHAVIOR_WAIT_LOAD:
        return "Loading the page…";
      case BEHAVIOR_DONE:
        return "Finishing up…";
      case BEHAVIOR_RUNNING:
        return this.behaviorMsg || "Saving the page…";
      case BEHAVIOR_READY_START:
        return "Getting the page ready…";
      case BEHAVIOR_PAUSED:
        return this.behaviorMsg || "Paused.";
      default:
        return this.behaviorMsg || "Saving the page…";
    }
  }

  get accountLabel() {
    return this.accountEmail || "Signed in";
  }

  /** The main button on the package screen says what it will do next. */
  get packageButtonLabel() {
    const size = this.waczBlob?.size || 0;
    if (this.privateSelected) return "Save privately";
    if (size > STANDARD_BYTES) {
      const paying = this.largeState?.orderId || this.largeState?.paidEarlier;
      if (this.largeBusy && !paying) return "Getting your price…";
      return paying || this.balanceUnlimited ? "Upload now" : "See price";
    }
    if (size > ARTICLE_BYTES) return this.balanceUnlimited ? "Upload now" : "Use 1 capture and save";
    return "Save this page";
  }

  // -----------------------------------------------------------------------
  // styles

  static get styles() {
    return css`
      :host {
        --pv-ink: #1d1d1f;
        --pv-ink2: #3a3a3c;
        --pv-muted: #56565b;
        --pv-icon-muted: #86868b;
        --pv-accent: #48484a;
        --pv-fill: rgba(118, 118, 128, 0.12);
        --pv-fill2: rgba(118, 118, 128, 0.08);
        --pv-line: rgba(0, 0, 0, 0.08);
        --pv-ok: #28a745;
        --pv-fail-bg: #fdecec;
        --pv-fail-ink: #b42318;
        --pv-card-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04), 0 18px 40px -22px rgba(0, 0, 0, 0.22);
        --pv-dark-card: radial-gradient(90% 70% at 0% 0%, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0) 60%),
          radial-gradient(120% 90% at 100% 100%, rgba(142, 142, 147, 0.35) 0%, rgba(0, 0, 0, 0) 70%),
          linear-gradient(155deg, #2c2c2e 0%, #1c1c1e 100%);

        display: block;
        font-family:
          -apple-system,
          BlinkMacSystemFont,
          "SF Pro Text",
          "Geist",
          system-ui,
          "Segoe UI",
          Roboto,
          "Helvetica Neue",
          Arial,
          sans-serif;
        font-size: 14px;
        line-height: 1.45;
        letter-spacing: -0.006em;
        color: var(--pv-ink);
        -webkit-font-smoothing: antialiased;
        background:
          radial-gradient(70% 55% at 100% 0%, rgba(199, 201, 209, 0.55) 0%, rgba(199, 201, 209, 0) 70%),
          radial-gradient(60% 50% at 0% 0%, rgba(218, 219, 224, 0.45) 0%, rgba(218, 219, 224, 0) 70%),
          linear-gradient(180deg, #e3e4e8 0%, #eff0f2 42%, #f5f5f7 100%);
      }

      * {
        box-sizing: border-box;
      }

      .app {
        display: flex;
        flex-direction: column;
        min-height: 200px;
      }

      /* Lucide icons, option I: hairline strokes with square ends. */
      .ic {
        flex: none;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.5;
        stroke-linecap: square;
        stroke-linejoin: miter;
      }

      .ic.small {
        stroke-width: 1.75;
      }

      .ic.solid {
        fill: currentColor;
      }

      header {
        margin: 8px 8px 0;
        height: 50px;
        flex: none;
        padding: 0 8px 0 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(40px) saturate(1.8);
        box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.09), inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 10px 24px -16px rgba(0, 0, 0, 0.3);
      }

      .brand {
        display: block;
        height: 22px;
        width: auto;
        margin: 0 -3px;
        flex: none;
      }

      .account {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
      }

      .wallet {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12.5px;
        color: var(--pv-muted);
      }

      .info {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        flex: none;
        vertical-align: middle;
        border-radius: 50%;
        color: var(--pv-icon-muted);
        cursor: help;
      }

      .info:hover,
      .info:focus-visible {
        color: var(--pv-ink2);
      }

      main {
        flex: 1;
        min-height: 0;
        padding: 10px 10px 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      footer {
        flex: none;
        padding: 10px;
        display: flex;
        gap: 8px;
      }

      button {
        font: inherit;
        letter-spacing: -0.008em;
        cursor: pointer;
        border: 0;
      }

      button:disabled {
        opacity: 0.45;
        cursor: default;
      }

      button:focus-visible,
      .file-button:focus-within,
      .private-choice:focus-within,
      summary:focus-visible,
      .info:focus-visible {
        outline: 2px solid var(--pv-accent);
        outline-offset: 2px;
      }

      .primary,
      .secondary,
      .tint {
        width: 100%;
        height: 44px;
        padding: 0 20px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border-radius: 9px;
        font-size: 14.5px;
        font-weight: 560;
        white-space: nowrap;
        text-decoration: none;
      }

      .primary {
        color: #fff;
        background: linear-gradient(180deg, #333336 0%, #1d1d1f 60%, #18181a 100%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 0 0.5px #000, 0 1px 3px -1px rgba(0, 0, 0, 0.25);
      }

      .primary.dark {
        background:
          radial-gradient(90% 140% at 0% 0%, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0) 60%),
          linear-gradient(180deg, #303033 0%, #161618 100%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 0 0 0.5px #000, 0 4px 10px -6px rgba(0, 0, 0, 0.4);
      }

      .primary:not(:disabled):hover {
        background: linear-gradient(180deg, #3a3a3d 0%, #262628 60%, #1d1d1f 100%);
      }

      /* The icon sits in its own compartment behind a hairline. */
      .primary .lead {
        width: 44px;
        height: 44px;
        margin-left: -20px;
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.2);
      }

      .secondary {
        color: var(--pv-ink);
        background: linear-gradient(180deg, #fff 0%, #f8f8f9 100%);
        box-shadow: inset 0 0 0 1px rgba(29, 29, 31, 0.28), 0 1px 1px rgba(0, 0, 0, 0.04);
      }

      .secondary:not(:disabled):hover,
      .tint:not(:disabled):hover {
        background: #f1f1f3;
      }

      .tint {
        color: var(--pv-ink);
        background: linear-gradient(180deg, #f4f4f6 0%, #ededf0 100%);
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
      }

      .tint.medium {
        height: 36px;
        padding: 0 12px;
        border-radius: 7px;
        font-size: 13.5px;
      }

      .tint.small {
        width: auto;
        height: 30px;
        padding: 0 11px;
        flex: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 510;
      }

      .stack {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .card {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: var(--pv-card-shadow);
      }

      .card.tight {
        padding: 12px 16px;
      }

      .tile {
        width: 36px;
        height: 36px;
        flex: none;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(72, 72, 74, 0.1);
        color: var(--pv-accent);
      }

      .hero {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding-top: 4px;
        text-align: center;
      }

      .hero-tile {
        width: 48px;
        height: 48px;
        flex: none;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--pv-ink);
        background: linear-gradient(180deg, #fff 0%, #f2f2f5 100%);
        box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.1), inset 0 1px 0 #fff, 0 8px 18px -10px rgba(0, 0, 0, 0.3);
      }

      .hero-tile.small {
        width: 40px;
        height: 40px;
        border-radius: 7px;
      }

      .hero-tile.ok {
        color: #fff;
        background: linear-gradient(180deg, #34c759 0%, #248a3d 100%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 10px 22px -10px rgba(36, 138, 61, 0.55);
      }

      .hero-tile.temp {
        color: var(--pv-ink);
        background: linear-gradient(180deg, #ffc23d 0%, #e6a100 100%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 10px 22px -10px rgba(230, 161, 0, 0.55);
      }

      .hero-tile.fail {
        color: #fff;
        background: linear-gradient(180deg, #e5484d 0%, #b42318 100%);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 10px 22px -10px rgba(180, 35, 24, 0.5);
      }

      .hero-tile.glass {
        color: #fff;
        background: rgba(255, 255, 255, 0.16);
        box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .panel-title {
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Geist", system-ui, sans-serif;
        font-size: 18px;
        line-height: 23px;
        font-weight: 700;
        letter-spacing: -0.02em;
      }

      .panel-sub {
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2px;
        font-size: 13px;
        line-height: 18px;
        color: var(--pv-muted);
      }

      /* A dark band across the top of a card, for a private result. */
      .band {
        margin: -16px -16px 0;
        padding: 22px 16px 18px;
        border-radius: 16px 16px 0 0;
        background: var(--pv-dark-card);
        color: #fff;
      }

      .band .panel-sub {
        color: rgba(255, 255, 255, 0.86);
      }

      .band .info {
        color: rgba(255, 255, 255, 0.8);
      }

      .review-head {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .review-head .panel-title {
        flex: 1;
        justify-content: flex-start;
        font-size: 17px;
        line-height: 22px;
        text-align: left;
      }

      .facts {
        display: flex;
        flex-direction: column;
      }

      .fact {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        padding: 8px 0;
      }

      .fact + .fact {
        border-top: 0.5px solid var(--pv-line);
      }

      .fact-label {
        flex: none;
        font-size: 12.5px;
        color: var(--pv-muted);
      }

      .fact-value {
        min-width: 0;
        font-size: 13px;
        text-align: right;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .line {
        margin: 0;
        display: flex;
        align-items: flex-start;
        gap: 2px;
        font-size: 12.5px;
        line-height: 17px;
        color: var(--pv-ink2);
      }

      .line.kept {
        gap: 8px;
      }

      .line.kept .ic {
        margin-top: 1px;
        color: var(--pv-ok);
        stroke-width: 2.4;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .more {
        overflow: hidden;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
      }

      .more button {
        width: 100%;
        min-height: 38px;
        padding: 0 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        background: transparent;
        color: var(--pv-ink);
        font-size: 13px;
        font-weight: 500;
        text-align: left;
      }

      .more button + button {
        box-shadow: inset 0 0.5px 0 rgba(0, 0, 0, 0.08);
      }

      .more button:hover {
        background: var(--pv-fill2);
      }

      .more .ic {
        color: var(--pv-muted);
      }

      .more .label {
        flex: 1;
      }

      .more .chev {
        color: var(--pv-icon-muted);
      }

      .link {
        padding: 0;
        background: none;
        color: var(--pv-ink2);
        font-size: 12.5px;
        font-weight: 500;
        text-decoration: underline;
        text-decoration-color: rgba(0, 0, 0, 0.25);
        text-underline-offset: 2px;
      }

      .link:hover {
        color: var(--pv-ink);
      }

      .tagline {
        margin: 0;
        font-size: 14.5px;
        line-height: 20px;
        color: var(--pv-ink);
      }

      .helper {
        margin: -4px 0 0;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 2px;
        font-size: 12.5px;
        line-height: 17px;
        color: var(--pv-muted);
      }

      .code-box {
        padding: 12px;
        border-radius: 14px;
        background: var(--pv-fill2);
        font-size: 12.5px;
        line-height: 17px;
        color: var(--pv-ink2);
        text-align: center;
      }

      .code-box strong {
        display: block;
        margin: 4px 0;
        font: 600 22px ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.14em;
        color: var(--pv-ink);
      }

      details {
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.6);
        box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08);
      }

      summary {
        min-height: 40px;
        padding: 0 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-radius: 14px;
        list-style: none;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        color: var(--pv-ink2);
      }

      summary::-webkit-details-marker {
        display: none;
      }

      summary .start {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      summary .start .ic {
        color: var(--pv-muted);
      }

      summary .chev {
        color: var(--pv-icon-muted);
        transition: transform 0.15s ease;
      }

      details[open] summary .chev {
        transform: rotate(90deg);
      }

      .details-body {
        padding: 0 14px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .file-button {
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border-radius: 12px;
        border: 1px dashed rgba(0, 0, 0, 0.22);
        background: #fff;
        font-size: 13.5px;
        font-weight: 600;
        cursor: pointer;
      }

      .file-button input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }

      .file-name {
        font-size: 12px;
        color: var(--pv-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .or {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        color: var(--pv-muted);
      }

      .or::before,
      .or::after {
        content: "";
        flex: 1;
        height: 0.5px;
        background: var(--pv-line);
      }

      textarea {
        width: 100%;
        padding: 10px 12px;
        border: 0;
        border-radius: 12px;
        background: var(--pv-fill2);
        font: 400 12px ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--pv-ink);
        resize: vertical;
      }

      .error-text {
        margin: 0;
        padding: 11px 13px;
        border-radius: 12px;
        background: var(--pv-fail-bg);
        font-size: 13px;
        line-height: 18px;
        color: var(--pv-fail-ink);
      }

      .page-card {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .page-text {
        flex: 1;
        min-width: 0;
      }

      .page-title {
        font-size: 14.5px;
        line-height: 19px;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .page-url {
        font-size: 12.5px;
        line-height: 17px;
        color: var(--pv-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .balance-row {
        display: flex;
        justify-content: flex-end;
        padding-top: 12px;
        border-top: 0.5px solid var(--pv-line);
      }

      .balance {
        height: 26px;
        padding: 0 11px;
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        background: linear-gradient(180deg, #fff 0%, #f6f6f8 100%);
        box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.13), 0 1px 2px rgba(0, 0, 0, 0.06), inset 0 1px 0 #fff;
        font-size: 12.5px;
        font-weight: 600;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }

      .private-choice {
        position: relative;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px 12px 12px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: var(--pv-card-shadow);
        cursor: pointer;
      }

      .private-choice.on {
        background: var(--pv-dark-card);
        color: #fff;
        box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 12px 26px -12px rgba(0, 0, 0, 0.5);
      }

      .private-choice input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
      }

      .private-choice .tile {
        background: var(--pv-fill2);
        color: var(--pv-ink2);
      }

      .private-choice.on .tile {
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
        box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.3);
      }

      .private-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .private-text strong {
        font-size: 14.5px;
        font-weight: 600;
      }

      .private-text small {
        font-size: 12.5px;
        line-height: 17px;
        color: var(--pv-muted);
      }

      .private-choice.on .private-text small {
        color: rgba(255, 255, 255, 0.84);
      }

      .switch {
        width: 42px;
        height: 26px;
        flex: none;
        padding: 2px;
        display: flex;
        justify-content: flex-start;
        border-radius: 999px;
        background: rgba(120, 120, 128, 0.32);
        transition: background 0.15s ease;
      }

      .switch::after {
        content: "";
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2), 0 0 0 0.5px rgba(0, 0, 0, 0.04);
      }

      .private-choice.on .switch {
        justify-content: flex-end;
        background: #fff;
      }

      .private-choice.on .switch::after {
        background: #1c1c1e;
        box-shadow: none;
      }

      .note {
        margin: 0;
        font-size: 12.5px;
        line-height: 17px;
        color: var(--pv-muted);
        text-align: center;
      }

      .status-block {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 14px 0 6px;
        text-align: center;
      }

      .status-text {
        font-size: 15px;
        font-weight: 600;
      }

      .sub-status {
        font-size: 12.5px;
        color: var(--pv-muted);
        font-variant-numeric: tabular-nums;
      }

      .ring {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fff;
        box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 10px 22px -12px rgba(0, 0, 0, 0.35);
      }

      .spinner {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2.6px solid var(--pv-fill);
        border-top-color: var(--pv-accent);
        animation: pv-spin 0.9s linear infinite;
      }

      @keyframes pv-spin {
        to {
          transform: rotate(360deg);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .spinner {
          animation-duration: 2.4s;
        }
      }

      .progress {
        width: 100%;
        height: 6px;
        border-radius: 999px;
        background: var(--pv-fill);
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        border-radius: 999px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0) 60%),
          linear-gradient(90deg, #a1a1a6 0%, #636366 55%, #3a3a3c 100%);
        transition: width 0.3s ease;
      }
    `;
  }

  // -----------------------------------------------------------------------
  // render

  render() {
    if (this.phase === "loading") {
      return html``;
    }

    return html`
      <div class="app">
        ${this.renderHeader()}
        <main>
          ${this.renderMain()}
        </main>
        ${this.renderFooter()}
      </div>
    `;
  }

  renderHeader() {
    const signedIn = Boolean(this.walletAddress);

    return html`
      <header>
        <img class="brand" src="./permavault-logo.svg" alt="Permavault" />
        ${signedIn
          ? html`
              <div class="account">
                <span class="wallet" title="${this.accountLabel}">${this.accountLabel}</span>
                <button class="tint small" @click=${this.onSignOut}>
                  Sign out
                </button>
              </div>
            `
          : ""}
      </header>
    `;
  }

  renderFooter() {
    return html`
      <footer>
        <button class="tint medium" @click=${this.onOpenVault}>${icon("external", 16)}Open Permavault</button>
        <button class="tint medium" @click=${this.onOpenLibrary}>${icon("folder", 16, "solid")}Local library</button>
      </footer>
    `;
  }

  /** A short detail behind an (i), so the screen itself stays short. */
  info(text: string) {
    return html`<span class="info" role="img" tabindex="0" aria-label="${text}" title="${text}">${icon("info", 15)}</span>`;
  }

  /** The main action: its icon sits in a compartment of its own. */
  lead(name: IconName) {
    return html`<span class="lead">${icon(name, 18)}</span>`;
  }

  /** The big tile at the top of a result card. */
  heroTile(name: IconName, tone = "") {
    return html`<span class="hero-tile ${tone}" aria-hidden="true">${icon(name, 22)}</span>`;
  }

  renderMain() {
    switch (this.phase) {
      case "signed-out":
        return this.renderSignedOut();

      case "idle":
        return this.renderIdle();

      case "review-capture":
        return this.renderReview();

      case "capturing":
        return this.renderCapturing();

      case "packaging":
        return html`
          ${this.pageUrl ? this.renderPageCard() : ""}
          <section class="card">
            <div class="status-block" role="status">
              <span class="ring"><span class="spinner"></span></span>
              <div class="status-text">${this.privateSelected ? "Sealing in your browser…" : "Preparing your capture…"}</div>
            </div>
          </section>
        `;

      case "uploading":
        return this.renderUploading();

      case "done":
        return this.renderDone();

      case "out-of-captures":
        return html`
          <section class="card">
            <div class="hero">
              ${this.heroTile("package")}
              <div class="panel-title">No captures left</div>
              <p class="panel-sub">Your page is safe in this browser.</p>
            </div>
            <div class="stack">
              <button class="primary" @click=${this.onBuyCaptures}>
                ${this.lead("external")}Buy captures
              </button>
              <button class="secondary" @click=${this.onTryAgain}>
                ${icon("refresh", 18)}Try again
              </button>
            </div>
          </section>
        `;

      case "error":
      default:
        return html`
          <section class="card">
            <div class="hero">
              ${this.heroTile("alert", "fail")}
              <div class="panel-title">We couldn't finish this</div>
              <p class="panel-sub">
                ${this.errorMsg || "Your page is safe in this browser."}
              </p>
            </div>
            <div class="stack">
              <button class="primary" @click=${this.onTryAgain}>
                ${this.lead("refresh")}Try again
              </button>
              <button class="secondary" @click=${this.onOpenLibrary}>${icon("folder", 18)}Open local library</button>
            </div>
          </section>
        `;
    }
  }

  renderReview() {
    const size = this.waczBlob?.size || 0;
    const large = !this.privateSelected && size > STANDARD_BYTES;
    // A capture saved before signing in can be added to the account now
    // signed in; one saved under another account stays download-only here.
    const claimable = this.pendingAccount === "" && Boolean(this.walletAddress);
    const otherAccount = this.pendingAccountMismatch && !claimable && Boolean(this.walletAddress);
    const canUpload = Boolean(this.walletAddress) && !this.pendingAccountMismatch;
    let line: unknown = "";
    if (!this.walletAddress) line = "Sign in to make it permanent, or download it.";
    else if (claimable) line = "You saved this before signing in. Add it to this account to make it permanent.";
    else if (otherAccount) line = html`Saved under another account. Sign in to it to upload. ${this.info("Nothing is spent on this account.")}`;
    else if (this.privateSelected) line = "Sealed and ready. Free for 7 days, then $1.99 to make permanent.";
    else if (large) line = "";
    else if (size > ARTICLE_BYTES) line = this.balanceUnlimited ? "Saved permanently. Anyone with its link can view it."
      : html`Over 10 MB, so this uses 1 prepaid capture ($4.99 each). ${this.info("Saved permanently. Anyone with its link can view it.")}`;
    else line = "Free for 7 days, then $0.99 to make permanent.";
    const keepsUntilPaid = canUpload && large && !this.balanceUnlimited && !this.largeState?.orderId && !this.largeState?.paidEarlier;
    return html`<section class="card">
      <div class="review-head">
        ${this.heroTile("package", "small")}
        <div class="panel-title">Your capture is ready</div>
        ${large ? this.info("Over 100 MB, so it is priced by size. Closing the popup pauses the upload; reopen it to carry on.") : ""}
      </div>
      <div class="facts">
        ${this.sourceUrl && !this.privateSelected ? html`<div class="fact"><span class="fact-label">Page:</span><span class="fact-value" title="${this.sourceUrl}">${this.sourceUrl}</span></div>` : ""}
        <div class="fact"><span class="fact-label">Size:</span><span class="fact-value">${(size / 1024 / 1024).toFixed(2)} MB</span></div>
        ${this.largeQuote !== null && !this.largeState?.paidEarlier ? html`<div class="fact"><span class="fact-label">Total:</span><strong class="fact-value">$${(this.largeQuote / 100).toFixed(2)}</strong></div>` : ""}
      </div>
      ${line ? html`<p class="line"><span>${line}</span></p>` : ""}
      ${keepsUntilPaid ? html`<p class="line kept">${icon("check", 14)}Kept in this browser until you pay.</p>` : ""}
      ${this.largeState?.paidEarlier ? html`<p class="line kept">${icon("check", 14)}An earlier payment covers this. Nothing more to pay.</p>` : ""}
      ${this.errorMsg ? html`<p class="error-text">${this.errorMsg}</p>` : ""}
      <div class="stack">
        ${claimable ? html`<button class="primary" @click=${this.onClaimLocalCapture}>Add to my account</button>` : ""}
        ${canUpload
          ? html`<button class="primary ${this.privateSelected ? "dark" : ""}" ?disabled=${this.largeBusy} @click=${this.uploadCapture}>${this.privateSelected ? this.lead("lock") : ""}${this.packageButtonLabel}</button>` : ""}
        ${this.largeState?.checkoutUrl && canUpload ? html`<button class="secondary" @click=${() => this.openTab(this.largeState!.checkoutUrl!)}>${icon("external", 18)}Reopen checkout</button>` : ""}
        ${!this.walletAddress ? html`<button class="primary" @click=${this.onEmailSignIn}>${this.lead("mail")}Sign in with email</button>${this.renderEmailGrant()}` : ""}
      </div>
    </section>
    <div class="more">
      <button @click=${this.onDownloadCapture}>${icon("download", 16)}<span class="label">${this.privateSelected ? "Download sealed copy" : "Download this capture"}</span>${icon("chevron", 14, "small chev")}</button>
      <button title="It stays in your local library." @click=${this.onSetAsidePending}>${icon("record", 16)}<span class="label">Set aside this capture</span>${icon("chevron", 14, "small chev")}</button>
    </div>`;
  }

  renderEmailGrant() {
    return this.emailGrant ? html`<p class="code-box">Enter this code on the website: <strong>${this.emailGrant.userCode}</strong>. Only approve a request you started here.</p>
      <button class="secondary" ?disabled=${this.signingIn} @click=${this.onCheckEmailSignIn}>${icon("check", 18)}I've approved it</button>` : "";
  }

  renderSignedOut() {
    return html`
      <section class="card">
        <p class="tagline">
          Save any page, with proof anyone can check.
        </p>
        <button class="primary" ?disabled=${this.signingIn} @click=${this.onEmailSignIn}>${this.lead("mail")}Sign in with email</button>
        <p class="helper">How sign-in works ${this.info("Sign in on the website, then enter the code shown here to approve this extension.")}</p>
        ${this.renderEmailGrant()}
      </section>
      <button class="secondary" ?disabled=${!this.canRecord} @click=${this.onArchiveClick}>${icon("download", 18)}Save to this browser only</button>
      <details><summary><span class="start">${icon("key", 15)}Sign in with a key file</span>${icon("chevron", 14, "small chev")}</summary>
      <div class="details-body">
      <label class="file-button">
        <input
          type="file"
          accept=".json,application/json"
          @change=${this.onKeyFile}
        />
        ${icon("upload", 15)}${this.signingIn ? "Signing in..." : "Choose key file"}
      </label>
      ${this.keyFileName
        ? html`<div class="file-name">${this.keyFileName}</div>`
        : ""}
      <div class="or">or paste its contents</div>
      <textarea
        rows="3"
        placeholder="Paste the contents of your key file"
        aria-label="Paste the contents of your key file"
        .value=${this.pastedKey}
        @input=${this.onPasteKey}
      ></textarea>
      <button
        class="primary"
        ?disabled=${this.signingIn || !this.pastedKey.trim()}
        @click=${this.onSignInClick}
      >
        ${this.signingIn ? "Signing in..." : "Sign in"}
      </button>
      <p class="helper">
        How key-file sign-in works ${this.info("Your key file is sent securely. Permavault keeps an encrypted copy while you are signed in, and this browser saves it to renew your sign-in.")}
      </p></div></details>
      ${this.keyError
        ? html`<p class="error-text">${this.keyError}</p>`
        : ""}
    `;
  }

  /** The page being saved: its title and address. */
  renderPageCard(extra: unknown = "") {
    return html`
      <section class="card ${extra ? "" : "tight"}">
        <div class="page-card">
          <span class="tile" aria-hidden="true">${icon("globe", 17)}</span>
          <div class="page-text">
            <div class="page-title" title="${this.pageTitle}">
              ${this.pageTitle || "Current page"}
            </div>
            <div class="page-url" title="${this.pageUrl}">
              ${this.pageUrl}
            </div>
          </div>
        </div>
        ${extra}
      </section>
    `;
  }

  renderIdle() {
    return html`
      ${this.renderPageCard(this.balanceLine
        ? html`<div class="balance-row"><span class="balance">${this.balanceLine}</span></div>`
        : "")}
      <label class="private-choice ${this.privateSelected ? "on" : ""}">
        <input type="checkbox" role="switch" .checked=${this.privateSelected}
          @change=${(event: Event) => { this.privateSelected = (event.target as HTMLInputElement).checked; this.errorMsg = ""; }} />
        <span class="tile" aria-hidden="true">${icon("lock", 16)}</span>
        <span class="private-text"><strong>Private</strong><small>Sealed before upload. Only your vault can open it.</small></span>
        <span class="switch" aria-hidden="true"></span>
      </label>
      <p class="note"><button class="link" @click=${() => this.openTab(`${VAULT_HOME}/private`)}>How Private works</button></p>
      ${this.privateSelected && !this.privateVaultReady ? html`<p class="note">${this.privateVaultMessage || "Checking your Private Vault…"} ${this.privateVaultMessage === VAULT_SETUP_MESSAGE ? html`<button class="link" @click=${() => this.openTab(`${VAULT_HOME}/settings`)}>Set up Private Vault</button>` : ""}</p>` : ""}
      ${this.errorMsg ? html`<p class="error-text">${this.errorMsg}</p>` : ""}
      <button
        class="primary ${this.privateSelected ? "dark" : ""}"
        ?disabled=${!this.canRecord}
        @click=${this.onArchiveClick}
      >
        ${this.lead(this.privateSelected ? "lock" : "record")}${this.privateSelected ? "Save privately" : "Save this page"}
      </button>
      ${!this.canRecord
        ? html`<p class="note">This kind of page can't be saved.</p>`
        : ""}
      ${this.outOfCaptures && !this.privateSelected
        ? html`<p class="note">Pages up to 10 MB still save free for 7 days.</p>`
        : ""}
    `;
  }

  renderCapturing() {
    return html`
      ${this.pageUrl ? this.renderPageCard() : ""}
      <section class="card">
        <div class="status-block" role="status">
          <span class="ring"><span class="spinner"></span></span>
          <div class="status-text">${this.captureStatusLine}</div>
          ${this.numPending > 0
            ? html`<div class="sub-status">
                ${this.numPending} ${this.numPending === 1 ? "item" : "items"} left
              </div>`
            : ""}
        </div>
        <button
          class="secondary"
          ?disabled=${this.stopping || this.stopRequested}
          @click=${this.onStopClick}
        >
          ${icon("check", 18)}Finish now
        </button>
      </section>
    `;
  }

  renderUploading() {
    return html`
      <section class="card">
        <div class="status-block" role="status">
          ${this.uploadPercent === null
            ? html`<span class="ring"><span class="spinner"></span></span>`
            : this.heroTile("upload")}
          <div class="status-text">
            ${this.uploadStage === "processing"
              ? "Finishing on Permavault…"
              : "Sending to Permavault…"}
          </div>
        </div>
        ${this.uploadPercent !== null
          ? html`
              <div class="progress" role="progressbar" aria-valuenow="${this.uploadPercent}" aria-valuemin="0" aria-valuemax="100">
                <div
                  class="progress-fill"
                  style="width: ${this.uploadPercent}%"
                ></div>
              </div>
              <div class="sub-status note">${this.uploadPercent}%</div>
            `
          : ""}
        ${this.largeState?.orderId || this.largeState?.paidEarlier ? html`<p class="line kept">${icon("check", 14)}Paid. Keep this popup open until it finishes.</p>` : ""}
      </section>
    `;
  }

  renderDone() {
    const another = html`<button class="tint medium" @click=${this.onArchiveAnother}>${icon("record", 16)}Save another page</button>`;
    if (this.doneKind === "staged") {
      const expiry = serverExpiryDate(this.stagedExpiresAt);
      const tip = this.info(this.privateSelected
        ? "Make it permanent before then, or it is deleted. It stays sealed; only your vault can open it."
        : "Make it permanent before then, or it is deleted. Once permanent, anyone with its link can view it.");
      return html`
        <section class="card">
          <div class="hero ${this.privateSelected ? "band" : ""}">
            ${this.heroTile(this.privateSelected ? "lock" : "clock", this.privateSelected ? "glass" : "temp")}
            <div class="panel-title">${this.privateSelected ? "Saved privately for 7 days" : "Saved free for 7 days"}</div>
            <p class="panel-sub">
              <span>${expiry ? temporaryLine(expiry) : "Check History for when this save expires."}</span>
              ${tip}
            </p>
          </div>
          <div class="stack">
            ${this.uploadId ? html`<button class="primary ${this.privateSelected ? "dark" : ""}" title="${this.privateSelected ? "Opens Permavault to confirm and pay." : ""}" ?disabled=${this.checkoutBusy} @click=${this.onMakePermanent}>${this.privateSelected ? html`${this.lead("external")}Make permanent for $1.99` : "Make permanent for $0.99"}</button>` : ""}
            ${this.errorMsg ? html`<p class="error-text">${this.errorMsg}</p>` : ""}
            <button class="secondary" @click=${this.onOpenHistory}>View in History</button>
          </div>
        </section>
        ${another}
      `;
    }
    if (this.doneKind === "vault" || this.doneKind === "existing") {
      return html`
        <section class="card">
          <div class="hero">
            ${this.heroTile("check", "ok")}
            <div class="panel-title">${this.doneKind === "existing" ? "Already saved permanently" : "Sent to permanent storage"}
              ${this.info(this.privateSelected
                ? "It stays sealed. Open it from History with your Private Vault."
                : "Its link can take a few minutes to work. History shows storage and proof status.")}</div>
          </div>
          <button class="primary ${this.privateSelected ? "dark" : ""}" @click=${this.onViewInVault}>
            ${this.privateSelected ? this.lead("lock") : ""}Open in Permavault
          </button>
        </section>
        ${another}
      `;
    }

    return html`
      <section class="card">
        <div class="hero">
          ${this.heroTile("hourglass")}
          <div class="panel-title">Check History for the result</div>
          <p class="panel-sub">
            <span>We could not confirm it here.</span> ${this.info("History shows whether it finished, any 7-day deadline, and its proof.")}
          </p>
        </div>
        <button class="primary" @click=${this.onOpenHistory}>View in History</button>
      </section>
      ${another}
    `;
  }
}

customElements.define("wr-popup-viewer", PermavaultPopup);

export { PermavaultPopup };
