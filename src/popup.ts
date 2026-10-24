// Permavault one-click popup: sign in with an Arweave keyfile, record the
// current tab with the existing engine, package the WACZ and upload it to
// the Permavault vault.

import { LitElement, html, css } from "lit";

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
        --pv-primary: #16352b;
        --pv-primary-soft: #f3f0e8;
        --pv-button: #16352b;
        --pv-button-hover: #23513e;
        --pv-text: #1b1b16;
        --pv-muted: #6b6a5f;
        --pv-border: #e7e2d3;

        display: block;
        font-family:
          system-ui,
          -apple-system,
          "Segoe UI",
          Roboto,
          "Helvetica Neue",
          Arial,
          sans-serif;
        font-size: 14px;
        line-height: 1.45;
        color: var(--pv-text);
        background: #fbf9f4;
      }

      * {
        box-sizing: border-box;
      }

      .app {
        display: flex;
        flex-direction: column;
        min-height: 200px;
      }

      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-bottom: 1px solid var(--pv-border);
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 16px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }

      .brand-mark {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }

      .account {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .wallet {
        max-width: 170px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: var(--pv-muted);
      }

      .info {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        margin-left: 2px;
        border-radius: 50%;
        border: 1px solid var(--pv-muted);
        color: var(--pv-muted);
        font-size: 11px;
        font-weight: 700;
        font-style: normal;
        line-height: 1;
        vertical-align: middle;
        cursor: help;
      }

      main {
        flex: 1;
        padding: 14px;
      }

      footer {
        display: flex;
        justify-content: center;
        gap: 6px;
        padding: 8px 14px 10px;
        border-top: 1px solid var(--pv-border);
        font-size: 12px;
        color: var(--pv-muted);
      }

      button {
        font: inherit;
        cursor: pointer;
        border-radius: 10px;
        border: 1px solid transparent;
      }

      button:disabled {
        opacity: 0.55;
        cursor: default;
      }

      .primary {
        display: block;
        width: 100%;
        padding: 10px 14px;
        background: var(--pv-button);
        color: #fff;
        font-weight: 600;
        border: none;
      }

      .primary:not(:disabled):hover {
        background: var(--pv-button-hover);
      }

      .primary.big {
        padding: 13px 14px;
        font-size: 15px;
      }

      .private-choice {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px;
        margin: 12px 0;
        border: 1px solid var(--pv-border);
        border-radius: 8px;
        background: var(--pv-primary-soft);
        cursor: pointer;
      }

      .private-choice input { accent-color: var(--pv-primary); margin-top: 3px; }
      .private-choice span { display: flex; flex-direction: column; gap: 2px; }
      .private-choice strong { font-weight: 700; }
      .private-choice small { color: var(--pv-muted); line-height: 1.4; }

      .secondary {
        display: block;
        width: 100%;
        padding: 9px 14px;
        margin-top: 8px;
        background: #fbf9f4;
        color: var(--pv-text);
        border-color: var(--pv-border);
      }

      .secondary:not(:disabled):hover {
        background: var(--pv-primary-soft);
      }

      .link {
        background: none;
        border: none;
        padding: 0;
        color: var(--pv-muted);
        font-size: 12px;
        text-decoration: underline;
      }

      .link:hover {
        color: var(--pv-text);
      }

      .link.signout {
        text-decoration: none;
      }

      .tagline {
        margin: 2px 0 14px;
        color: var(--pv-muted);
      }

      .file-button {
        display: block;
        width: 100%;
        padding: 10px 14px;
        text-align: center;
        background: var(--pv-primary-soft);
        border: 1px dashed var(--pv-primary);
        border-radius: 10px;
        cursor: pointer;
        font-weight: 600;
      }

      .file-button input {
        display: none;
      }

      .file-name {
        margin-top: 6px;
        font-size: 12px;
        color: var(--pv-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .or {
        margin: 12px 0 6px;
        font-size: 12px;
        color: var(--pv-muted);
        text-align: center;
      }

      textarea {
        width: 100%;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        padding: 8px;
        border: 1px solid var(--pv-border);
        border-radius: 10px;
        resize: vertical;
        margin-bottom: 10px;
      }

      .helper {
        margin: 10px 0 0;
        font-size: 12px;
        color: var(--pv-muted);
      }

      .error-text {
        margin: 10px 0 0;
        font-size: 12px;
        color: hsl(0, 65%, 45%);
      }

      .page-card {
        border: 1px solid var(--pv-border);
        border-radius: 10px;
        padding: 10px 12px;
        margin-bottom: 12px;
      }

      .page-title {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .page-url {
        font-size: 12px;
        color: var(--pv-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .balance {
        margin-bottom: 12px;
        font-size: 13px;
        color: var(--pv-muted);
      }

      .note {
        margin: 10px 0 0;
        font-size: 13px;
        color: var(--pv-muted);
        text-align: center;
      }

      .status-block {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 18px 6px;
        text-align: center;
      }

      .status-text {
        font-weight: 600;
      }

      .sub-status {
        font-size: 12px;
        color: var(--pv-muted);
      }

      .spinner {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 3px solid var(--pv-primary-soft);
        border-top-color: var(--pv-button);
        animation: pv-spin 0.9s linear infinite;
      }

      @keyframes pv-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .progress {
        width: 100%;
        height: 8px;
        border-radius: 999px;
        background: var(--pv-primary-soft);
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: var(--pv-button);
        border-radius: 999px;
        transition: width 0.3s ease;
      }

      .panel {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        text-align: center;
      }

      .panel-title {
        font-size: 16px;
        font-weight: 700;
        margin: 6px 0 6px;
      }

      .panel-sub {
        margin: 0 0 14px;
        font-size: 13px;
        color: var(--pv-muted);
      }

      .done-mark {
        align-self: center;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: var(--pv-primary);
        color: #fff;
        font-size: 19px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 4px;
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
        <div class="brand">
          <img class="brand-mark" src="./permavault-mark.svg" alt="" />
          <span>Permavault</span>
        </div>
        ${signedIn
          ? html`
              <div class="account">
                <span class="wallet" title="${this.accountLabel}">${this.accountLabel}</span>
                <button class="link signout" @click=${this.onSignOut}>
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
        <button class="link" @click=${this.onOpenVault}>Open Permavault</button>
        <span>&middot;</span>
        <button class="link" @click=${this.onOpenLibrary}>Local library</button>
      </footer>
    `;
  }

  /** A short detail behind an (i), so the screen itself stays short. */
  info(text: string) {
    return html`<span class="info" role="img" tabindex="0" aria-label="${text}" title="${text}">i</span>`;
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
          <div class="status-block">
            <div class="spinner"></div>
            <div class="status-text">${this.privateSelected ? "Sealing in your browser…" : "Preparing your capture…"}</div>
          </div>
        `;

      case "uploading":
        return this.renderUploading();

      case "done":
        return this.renderDone();

      case "out-of-captures":
        return html`
          <div class="panel">
            <div class="panel-title">No captures left</div>
            <p class="panel-sub">Your page is safe in this browser.</p>
            <button class="primary" @click=${this.onBuyCaptures}>
              Buy captures
            </button>
            <button class="secondary" @click=${this.onTryAgain}>
              Try again
            </button>
          </div>
        `;

      case "error":
      default:
        return html`
          <div class="panel">
            <div class="panel-title">We couldn't finish this</div>
            <p class="panel-sub">
              ${this.errorMsg || "Your page is safe in this browser."}
            </p>
            <button class="primary" @click=${this.onTryAgain}>
              Try again
            </button>
            <button class="secondary" @click=${this.onOpenLibrary}>Open local library</button>
          </div>
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
    return html`<div class="panel">
      <div class="panel-title">Your capture is ready ${large ? this.info("Over 100 MB, so it is priced by size. Closing the popup pauses the upload; reopen it to carry on.") : ""}</div>
      ${this.sourceUrl && !this.privateSelected ? html`<p class="panel-sub">Page: ${this.sourceUrl}</p>` : ""}
      <p class="panel-sub">Size: ${(size / 1024 / 1024).toFixed(2)} MB</p>
      ${line ? html`<p class="panel-sub">${line}</p>` : ""}
      ${keepsUntilPaid ? html`<p class="panel-sub">Kept in this browser until you pay.</p>` : ""}
      ${this.largeState?.paidEarlier ? html`<p>An earlier payment covers this. Nothing more to pay.</p>` : ""}
      ${this.largeQuote !== null && !this.largeState?.paidEarlier ? html`<p>Total: $${(this.largeQuote / 100).toFixed(2)}</p>` : ""}
      ${this.errorMsg ? html`<p class="error-text">${this.errorMsg}</p>` : ""}
      ${claimable ? html`<button class="primary" @click=${this.onClaimLocalCapture}>Add to my account</button>` : ""}
      ${canUpload
        ? html`<button class="primary" ?disabled=${this.largeBusy} @click=${this.uploadCapture}>${this.packageButtonLabel}</button>` : ""}
      ${this.largeState?.checkoutUrl && canUpload ? html`<button class="secondary" @click=${() => this.openTab(this.largeState!.checkoutUrl!)}>Reopen checkout</button>` : ""}
      ${!this.walletAddress ? html`<button class="primary" @click=${this.onEmailSignIn}>Sign in with email</button>${this.renderEmailGrant()}` : ""}
      <button class="secondary" @click=${this.onDownloadCapture}>${this.privateSelected ? "Download sealed copy" : "Download this capture"}</button>
      <button class="secondary" title="It stays in your local library." @click=${this.onSetAsidePending}>Set aside this capture</button>
    </div>`;
  }

  renderEmailGrant() {
    return this.emailGrant ? html`<p class="helper">Enter this code on the website: <strong>${this.emailGrant.userCode}</strong>. Only approve a request you started here.</p>
      <button class="secondary" ?disabled=${this.signingIn} @click=${this.onCheckEmailSignIn}>I've approved it</button>` : "";
  }

  renderSignedOut() {
    return html`
      <p class="tagline">
        Save any page, with proof anyone can check.
      </p>
      <button class="primary" ?disabled=${this.signingIn} @click=${this.onEmailSignIn}>Sign in with email</button>
      <p class="helper">How sign-in works ${this.info("Sign in on the website, then enter the code shown here to approve this extension.")}</p>
      ${this.renderEmailGrant()}
      <button class="secondary" ?disabled=${!this.canRecord} @click=${this.onArchiveClick}>Save to this browser only</button>
      <details><summary>Sign in with a key file</summary>
      <label class="file-button">
        <input
          type="file"
          accept=".json,application/json"
          @change=${this.onKeyFile}
        />
        ${this.signingIn ? "Signing in..." : "Choose key file"}
      </label>
      ${this.keyFileName
        ? html`<div class="file-name">${this.keyFileName}</div>`
        : ""}
      <div class="or">or paste its contents</div>
      <textarea
        rows="4"
        placeholder="Paste the contents of your key file"
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
      </p></details>
      ${this.keyError
        ? html`<p class="error-text">${this.keyError}</p>`
        : ""}
    `;
  }

  renderIdle() {
    return html`
      <div class="page-card">
        <div
          class="page-title"
          title="${this.pageTitle}"
        >
          ${this.pageTitle || "Current page"}
        </div>
        <div
          class="page-url"
          title="${this.pageUrl}"
        >
          ${this.pageUrl}
        </div>
      </div>
      ${this.balanceLine
        ? html`<div class="balance">${this.balanceLine}</div>`
        : ""}
      <label class="private-choice">
        <input type="checkbox" .checked=${this.privateSelected}
          @change=${(event: Event) => { this.privateSelected = (event.target as HTMLInputElement).checked; this.errorMsg = ""; }} />
        <span><strong>Private</strong><small>Sealed before upload. Only your vault can open it.</small></span>
      </label>
      <p class="note"><button class="link" @click=${() => this.openTab(`${VAULT_HOME}/private`)}>How Private works</button></p>
      ${this.privateSelected && !this.privateVaultReady ? html`<p class="note">${this.privateVaultMessage || "Checking your Private Vault…"} ${this.privateVaultMessage === VAULT_SETUP_MESSAGE ? html`<button class="link" @click=${() => this.openTab(`${VAULT_HOME}/settings`)}>Set up Private Vault</button>` : ""}</p>` : ""}
      ${this.errorMsg ? html`<p class="error-text">${this.errorMsg}</p>` : ""}
      <button
        class="primary big"
        ?disabled=${!this.canRecord}
        @click=${this.onArchiveClick}
      >
        ${this.privateSelected ? "Save privately" : "Save this page"}
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
      <div class="status-block">
        <div class="spinner"></div>
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
        Finish now
      </button>
    `;
  }

  renderUploading() {
    return html`
      <div class="status-block">
        ${this.uploadPercent === null
          ? html`<div class="spinner"></div>`
          : ""}
        <div class="status-text">
          ${this.uploadStage === "processing"
            ? "Finishing on Permavault…"
            : "Sending to Permavault…"}
        </div>
        ${this.uploadPercent !== null
          ? html`
              <div class="progress">
                <div
                  class="progress-fill"
                  style="width: ${this.uploadPercent}%"
                ></div>
              </div>
              <div class="sub-status">${this.uploadPercent}%</div>
            `
          : ""}
        ${this.largeState?.orderId || this.largeState?.paidEarlier ? html`<div class="sub-status">Paid. Keep this popup open until it finishes.</div>` : ""}
      </div>
    `;
  }

  renderDone() {
    if (this.doneKind === "staged") {
      const expiry = serverExpiryDate(this.stagedExpiresAt);
      return html`
        <div class="panel">
          <div class="panel-title">${this.privateSelected ? "Saved privately for 7 days" : "Saved free for 7 days"}</div>
          <p class="panel-sub">
            ${expiry ? temporaryLine(expiry) : "Check History for when this save expires."}
            ${this.info(this.privateSelected
              ? "Make it permanent before then, or it is deleted. It stays sealed; only your vault can open it."
              : "Make it permanent before then, or it is deleted. Once permanent, anyone with its link can view it.")}
          </p>
          ${this.uploadId ? html`<button class="primary" title="${this.privateSelected ? "Opens Permavault to confirm and pay." : ""}" ?disabled=${this.checkoutBusy} @click=${this.onMakePermanent}>${this.privateSelected ? html`Make permanent for $1.99 <span aria-hidden="true">↗</span>` : "Make permanent for $0.99"}</button>` : ""}
          ${this.errorMsg ? html`<p class="error-text">${this.errorMsg}</p>` : ""}
          <button class="secondary" @click=${this.onOpenHistory}>View in History</button>
          <button class="secondary" @click=${this.onArchiveAnother}>Save another page</button>
        </div>
      `;
    }
    if (this.doneKind === "vault" || this.doneKind === "existing") {
      return html`
        <div class="panel">
          <div class="done-mark">&#10003;</div>
          <div class="panel-title">${this.doneKind === "existing" ? "Already saved permanently" : "Sent to permanent storage"}
            ${this.info(this.privateSelected
              ? "It stays sealed. Open it from History with your Private Vault."
              : "Its link can take a few minutes to work. History shows storage and proof status.")}</div>
          <button class="primary" @click=${this.onViewInVault}>
            Open in Permavault
          </button>
          <button class="secondary" @click=${this.onArchiveAnother}>
            Save another page
          </button>
        </div>
      `;
    }

    return html`
      <div class="panel">
        <div class="panel-title">Check History for the result</div>
        <p class="panel-sub">
          We could not confirm it here. ${this.info("History shows whether it finished, any 7-day deadline, and its proof.")}
        </p>
        <button class="primary" @click=${this.onOpenHistory}>View in History</button>
        <button class="secondary" @click=${this.onArchiveAnother}>
          Save another page
        </button>
      </div>
    `;
  }
}

customElements.define("wr-popup-viewer", PermavaultPopup);

export { PermavaultPopup };
