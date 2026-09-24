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

import { getBalance, uploadWacz, openWsForJob, makePermanent } from "./pv/api";

import { loadPending, savePending, clearPending, type LargeCaptureState } from "./pv/pending";

import { startEmailGrant, loadEmailGrant, exchangeEmailGrant, type EmailGrant } from "./pv/extensionAuth";
import { quoteLargeCapture, checkoutLargeCapture, largeCapturePaid, uploadLargeCapture } from "./pv/largeCapture";

const ARTICLE_BYTES = 10 * 1024 * 1024;
const STANDARD_BYTES = 100 * 1024 * 1024;

// Download API served by the extension background service worker (bg.js
// importScripts sw.js, see src/sw/main.ts and src/sw/api.ts). This mirrors
// apiPrefix ("./w/api") from the replaywebpage package; duplicated here so
// the popup bundle does not pull in the whole replay UI.
const WACZ_API_PREFIX = "./w/api";

// Give up on the progress WebSocket after this long and show the fallback
const WS_FALLBACK_TIMEOUT = 120000;

const CAPTURE_DESTINATION_NOTICE = `Record and upload this page?

This records your current browser session and may include logged-in or personal content. The archive is sent to Permavault with readable contents. It is not locked as a Private Capture.

Eligible article saves up to 10 MB are held for 7 days, then deleted unless you pay to make them permanent. Larger paid uploads go to public permanent storage. Once made permanent, anyone with the archive link can read the captured content and it cannot be deleted from Arweave.

Only continue with content you are willing and entitled to publish. You can inspect captures in the extension's local library; this action records and uploads automatically.`;

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
  declare pendingAccount: string | null;
  declare walletAddress: string;
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
    this.pendingAccount = null;

    this.walletAddress = "";
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
  }

  static get properties() {
    return {
      emailGrant: { type: Object }, largeState: { type: Object },
      largeBusy: { type: Boolean }, largeQuote: { type: Number },
      stagedExpiresAt: { type: String },
      checkoutBusy: { type: Boolean },
      pendingAccount: { type: String },
      phase: { type: String },

      walletAddress: { type: String },
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
    this.connectPort();
    void this.initSession();
  }

  // -----------------------------------------------------------------------
  // session

  async initSession() {
    this.emailGrant = await loadEmailGrant();
    const session = await getStoredSession();
    if (session) {
      this.walletAddress = session.walletAddress;
      this.phase = "idle";
      void this.refreshBalance();
    } else {
      this.walletAddress = "";
      this.phase = "signed-out";
    }
    try {
      const pending = await loadPending();
      if (pending) {
        this.largeState = pending.large || null;
        this.largeQuote = this.largeState?.amountCents ?? null;
        this.pendingAccount = pending.account;
        this.waczBlob = pending.blob;
        this.waczFilename = pending.filename;
        this.sourceUrl = pending.sourceUrl;
        this.screenshotDataUrl = pending.screenshotDataUrl;
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
      this.errorMsg = "The saved package could not be reopened. Use the local library to download your capture.";
    }
  }

  async onEmailSignIn() {
    this.keyError = "";
    this.signingIn = true;
    try {
      this.emailGrant = await startEmailGrant();
      this.openTab(this.emailGrant.approvalUrl);
    } catch (error) { this.keyError = error instanceof Error ? error.message : "Sign-in could not start."; }
    finally { this.signingIn = false; }
  }

  async onCheckEmailSignIn() {
    if (this.signingIn) return;
    this.signingIn = true;
    this.keyError = "";
    try {
      this.emailGrant = await loadEmailGrant();
      if (!this.emailGrant) throw new Error("Start a new sign-in request.");
      if (await exchangeEmailGrant()) {
        this.emailGrant = null;
        this.destinationAccepted = false;
        await this.initSession();
      } else this.keyError = "Waiting for approval. Enter the code above on the website, then check again.";
    } catch (error) { this.keyError = error instanceof Error ? error.message : "Sign-in could not be checked."; }
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
      this.keyError =
        "That does not look like a key file. It should be the JSON key file you use for Arweave.";
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
      this.keyError =
        "Sign in did not work. Check your connection, and make sure this is the same key you use at app.permavault.xyz.";
    } finally {
      this.signingIn = false;
    }
  }

  async onSignOut() {
    await signOut();
    this.walletAddress = "";
    this.balanceLoaded = false;
    this.phase = "signed-out";
  }

  // -----------------------------------------------------------------------
  // background port

  connectPort() {
    this.port = chrome.runtime.connect({ name: "popup-port" });

    // @ts-expect-error - TS7006 - Parameter 'tabs' implicitly has an 'any' type.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length) {
        this.tabId = tabs[0].id;
        this.pageUrl = tabs[0].url || "";
        this.pageTitle = tabs[0].title || "";
        this.updateCanRecord();
        this.sendMessage({ tabId: this.tabId, type: "startUpdates" });
      }
    });

    this.port.onMessage.addListener((message: any) => {
      this.onMessage(message);
    });
  }

  // @ts-expect-error - TS7006 - Parameter 'message' implicitly has an 'any' type.
  sendMessage(message) {
    this.port.postMessage(message);
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
      this.errorMsg =
        "This page could not be archived. Try again, or try a different page.";
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

  onArchiveClick() {
    if (!window.confirm(CAPTURE_DESTINATION_NOTICE)) return;
    this.destinationAccepted = true;
    this.pendingAccount = this.walletAddress;
    this.capturedPageUrl = this.pageUrl;
    this.autoStopSent = false;
    this.stopRequested = false;
    this.wasRecording = false;
    this.waitingForStart = true;
    this.phase = "capturing";

    // Grab the viewport now, before autorun scrolling moves it: this shot
    // becomes the exhibit PDF on the server. Optional, failure is fine.
    this.captureViewportScreenshot();

    this.sendMessage({
      type: "startRecording",
      url: this.pageUrl,
      autorun: true,
    });
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
    } catch (e) {
      console.warn(e);
      this.phase = "error";
      this.errorMsg =
        "The capture finished, but the package could not be built. Your capture is safe in the local library.";
      return;
    }

    try {
      await this.persistPending();
    } catch (_e) {
      this.phase = "error";
      this.errorMsg = "The package could not be retained for payment. Download your capture from the local library before continuing.";
      return;
    }
    if (!this.walletAddress || this.waczBlob!.size > ARTICLE_BYTES) {
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
      account: this.pendingAccount, submitted, ...(this.largeState ? { large: this.largeState } : {}) });
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
      if (!state.sessionId) {
        const quote = state.orderId ? { amountCents: state.amountCents || 0, included: false } : await quoteLargeCapture(this.waczBlob.size, this.walletAddress);
        this.largeQuote = quote.amountCents;
        if (!quote.included) {
          if (!state.orderId) {
            if (!window.confirm(`This measured package costs $${(quote.amountCents / 100).toFixed(2)}. Continue to checkout? The final total is shown before you pay.`)) return;
            Object.assign(state, await checkoutLargeCapture(this.waczBlob.size, state));
            this.largeQuote = state.amountCents ?? null;
            await this.persistPending();
            this.openTab(state.checkoutUrl!);
            return;
          }
          if (!(await largeCapturePaid(state))) {
            this.errorMsg = "Payment is not confirmed yet. Finish the existing checkout, then continue this package. No new payment was created.";
            return;
          }
        }
      }
      this.phase = "uploading";
      const result = await uploadLargeCapture({ blob: this.waczBlob, filename: this.waczFilename,
        sourceUrl: this.sourceUrl, screenshotDataUrl: this.screenshotDataUrl, account: this.walletAddress },
        state, () => this.persistPending(true), percent => { this.uploadPercent = percent; });
      if (result.status === 202 && result.json.jobId) await this.trackUploadJob(result.json.jobId);
      else this.completeCapture(result.json);
    } catch (error) {
      this.phase = "review-capture";
      this.errorMsg = error instanceof Error ? error.message : "Upload paused. Your exact package is retained.";
    } finally { this.largeBusy = false; }
  }

  async onClaimLocalCapture() {
    if (this.pendingAccount !== "" || !this.walletAddress) return;
    if (!window.confirm("Use this local package with the account signed in to this extension? It will be uploaded with readable contents. Review the price and destination before continuing.")) return;
    this.pendingAccount = this.walletAddress;
    this.destinationAccepted = false;
    await this.persistPending();
  }

  get pendingAccountMismatch() {
    return this.pendingAccount !== null && this.pendingAccount !== this.walletAddress;
  }

  async uploadCapture() {
    if (this.pendingAccountMismatch) {
      this.phase = "review-capture";
      return;
    }
    // A reopened popup can resume a recording it did not start. Never let
    // that path bypass the destination disclosure before sending any bytes.
    if (!this.destinationAccepted) {
      if (!window.confirm(CAPTURE_DESTINATION_NOTICE)) {
        this.phase = "error";
        this.errorMsg = "Upload cancelled. The capture remains in the local library.";
        return;
      }
      this.destinationAccepted = true;
    }
    if (this.waczBlob && this.waczBlob.size > STANDARD_BYTES && this.walletAddress) {
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
      this.errorMsg =
        "The packaged capture is no longer in memory. Archive the page again.";
      return;
    }

    let result;
    try {
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
    } catch (_e) {
      // The request may have reached the server. Never invite a blind retry.
      this.doneKind = "finishing";
      this.phase = "done";
      return;
    }

    const { status, json } = result;

    if (status === 202 && json && json.jobId) {
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
        this.errorMsg = "The server did not accept this package. Your capture remains in the local library.";
        break;

      case 402:
        this.balance = typeof json?.balance === "number" ? json.balance : 0;
        this.phase = "out-of-captures";
        break;

      case 409:
        this.phase = "error";
        this.errorMsg =
          "Another capture is already being archived. Give it a moment, then try again.";
        break;

      default:
        this.phase = "error";
        this.errorMsg =
          "The upload did not go through. Your capture is safe in the local library.";
    }
  }

  // @ts-expect-error - TS7006 - Parameter 'jobId' implicitly has an 'any' type.
  async trackUploadJob(jobId) {
    let settled = false;

    // @ts-expect-error - TS7006 - Parameter 'fn' implicitly has an 'any' type.
    const finish = (fn) => {
      if (!settled) {
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

    try {
      this.jobWs = await openWsForJob(jobId, {
        onStage: (stage) => {
          this.uploadStage = stage || "";
        },
        onProgress: (percent) => {
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
            console.warn("upload job failed", data);
            this.phase = "error";
            this.errorMsg =
              "The vault could not finish this capture. Your capture is safe in the local library.";
            this.closeJobChannel();
          }),
        onWsError: () => fallbackToFinishing(),
      });
    } catch (_e) {
      // could not open the progress channel at all
      fallbackToFinishing();
      return;
    }

    if (settled) this.closeJobChannel();
    else this.jobTimer = setTimeout(fallbackToFinishing, WS_FALLBACK_TIMEOUT);
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
    this.checkoutBusy = true;
    this.errorMsg = "";
    try { this.openTab(await makePermanent(this.uploadId)); }
    catch (error) { this.errorMsg = error instanceof Error ? error.message : "Check History to continue payment."; }
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

  resetForNext() {
    this.largeState = null;
    this.largeQuote = null;
    void clearPending();
    this.stagedExpiresAt = "";
    this.closeJobChannel();
    this.destinationAccepted = false;
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
      return "Unlimited captures";
    }
    return `${this.balance} ${this.balance === 1 ? "capture" : "captures"} left`;
  }

  get outOfCaptures() {
    return this.balanceLoaded && !this.balanceUnlimited && this.balance <= 0;
  }

  get captureStatusLine() {
    if (this.waitingForStart) {
      return "Starting the capture. The page will reload.";
    }
    if (this.stopping || this.stopRequested) {
      return "Finishing the capture.";
    }
    switch (this.behaviorState) {
      case BEHAVIOR_WAIT_LOAD:
        return "Waiting for the page to load.";
      case BEHAVIOR_DONE:
        return "Finishing the capture.";
      case BEHAVIOR_RUNNING:
        return this.behaviorMsg || "Archiving page content.";
      case BEHAVIOR_READY_START:
        return "Getting the page ready.";
      case BEHAVIOR_PAUSED:
        return this.behaviorMsg || "Archiving paused.";
      default:
        return this.behaviorMsg || "Archiving page content.";
    }
  }

  // -----------------------------------------------------------------------
  // styles

  static get styles() {
    return css`
      :host {
        --pv-primary: hsl(255, 60%, 72%);
        --pv-primary-soft: hsl(255, 60%, 96%);
        --pv-button: hsl(255, 58%, 63%);
        --pv-button-hover: hsl(255, 58%, 55%);
        --pv-text: hsl(228, 18%, 22%);
        --pv-muted: hsl(230, 8%, 50%);
        --pv-border: hsl(240, 14%, 91%);

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
        background: #fff;
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

      .brand-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--pv-primary);
      }

      .account {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .wallet {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        color: var(--pv-muted);
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

      .secondary {
        display: block;
        width: 100%;
        padding: 9px 14px;
        margin-top: 8px;
        background: #fff;
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
    const signedIn = this.phase !== "signed-out";

    return html`
      <header>
        <div class="brand">
          <span class="brand-dot"></span>
          <span>Permavault</span>
        </div>
        ${signedIn
          ? html`
              <div class="account">
                <span
                  class="wallet"
                  title="${this.walletAddress}"
                  >${this.shortWallet}</span
                >
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
        <button class="link" @click=${this.onOpenVault}>Open vault</button>
        <span>&middot;</span>
        <button class="link" @click=${this.onOpenLibrary}>Local library</button>
      </footer>
    `;
  }

  renderMain() {
    switch (this.phase) {
      case "signed-out":
        return this.renderSignedOut();

      case "idle":
        return this.renderIdle();

      case "review-capture":
        return html`<div class="panel">
          <div class="panel-title">Your capture is ready</div>
          ${this.sourceUrl ? html`<p class="panel-sub">Captured page: ${this.sourceUrl}</p>` : ""}
          <p class="panel-sub">Package size: ${((this.waczBlob?.size || 0) / 1024 / 1024).toFixed(2)} MB.
            ${this.pendingAccountMismatch ? "This package was recorded under a different sign-in. It can only be downloaded here until you sign in to the original account in the extension. No capture will be spent on this account."
              : !this.walletAddress ? "Download this package, sign in by email on the website, and upload the file there. The website shows the price before payment."
              : (this.waczBlob?.size || 0) > STANDARD_BYTES ? "Get a price for this measured package, then pay and upload here. Closing the popup pauses the upload; reopen it to continue the same bytes."
              : (this.waczBlob?.size || 0) > ARTICLE_BYTES ? "This uses one prepaid capture, or costs $4.99 if you need to buy one. The readable archive goes to public permanent storage."
              : "Eligible article saves are held free for 7 days. Making a save permanent costs $0.99."}
            Your package is retained in this browser while you arrange payment.</p>
          ${this.pendingAccount === "" && this.walletAddress ? html`<button class="secondary" @click=${this.onClaimLocalCapture}>Use local package with this account</button>` : ""}
          ${this.largeQuote !== null ? html`<p>Total: $${(this.largeQuote / 100).toFixed(2)}</p>` : ""}
          ${this.errorMsg ? html`<p class="error-text">${this.errorMsg}</p>` : ""}
          ${this.walletAddress && !this.pendingAccountMismatch
            ? html`<button class="primary" ?disabled=${this.largeBusy} @click=${this.uploadCapture}>${this.largeBusy ? "Preparing package..." : "Continue with this package"}</button>` : ""}
          ${this.largeState?.checkoutUrl && !this.pendingAccountMismatch ? html`<button class="secondary" @click=${() => this.openTab(this.largeState!.checkoutUrl!)}>Reopen existing checkout</button>` : ""}
          ${!this.walletAddress ? html`<button class="secondary" @click=${this.onEmailSignIn}>Sign in with email</button>${this.renderEmailGrant()}` : ""}
          <button class="secondary" @click=${this.onDownloadCapture}>Download package</button>
          <button class="secondary" @click=${this.onOpenVault}>Open website</button>
        </div>`;

      case "capturing":
        return this.renderCapturing();

      case "packaging":
        return html`
          <div class="status-block">
            <div class="spinner"></div>
            <div class="status-text">Packaging your capture.</div>
          </div>
        `;

      case "uploading":
        return this.renderUploading();

      case "done":
        return this.renderDone();

      case "server-not-ready":
        return html`
          <div class="panel">
            <div class="panel-title">Saved to your local library</div>
            <p class="panel-sub">
              The vault upload is not available yet. It ships on the server
              side soon, and your capture is safe in the local library in the
              meantime.
            </p>
            <button class="primary" @click=${this.onTryAgain}>
              Try again
            </button>
            <button class="secondary" @click=${this.onArchiveAnother}>
              Archive another page
            </button>
          </div>
        `;

      case "out-of-captures":
        return html`
          <div class="panel">
            <div class="panel-title">You are out of captures</div>
            <p class="panel-sub">
              Buy more captures to keep archiving to your vault. This capture
              is saved in your local library.
            </p>
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
            <div class="panel-title">Something went wrong</div>
            <p class="panel-sub">
              ${this.errorMsg ||
              "Something went wrong. Your capture is safe in the local library."}
            </p>
            <button class="primary" @click=${this.onTryAgain}>
              Try again
            </button>
          </div>
        `;
    }
  }

  renderEmailGrant() {
    return this.emailGrant ? html`<p class="helper">Enter this code on the approval page: <strong>${this.emailGrant.userCode}</strong>. Only approve a request you started in this extension.</p>
      <button class="secondary" ?disabled=${this.signingIn} @click=${this.onCheckEmailSignIn}>Check sign-in approval</button>` : "";
  }

  renderSignedOut() {
    return html`
      <p class="tagline">
        Record this page from your browser and send it to Permavault.
      </p>
      <button class="primary" ?disabled=${this.signingIn} @click=${this.onEmailSignIn}>Sign in with email</button>
      <p class="helper">Sign in on the website, then approve this extension using the code shown here.</p>
      ${this.renderEmailGrant()}
      <button class="secondary" ?disabled=${!this.canRecord} @click=${this.onArchiveClick}>Record a local package</button>
      <details><summary>Existing key-file account</summary>
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
      <div class="or">or paste your key JSON</div>
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
      ${this.keyError
        ? html`<p class="error-text">${this.keyError}</p>`
        : ""}
      <p class="helper">
        Key-file sign-in sends the file to Permavault over HTTPS. An encrypted
        copy is held for the server session, and this browser saves it for
        sign-in renewal. Email sign-in does not need a key file.
      </p></details>
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
      <button
        class="primary big"
        ?disabled=${!this.canRecord}
        @click=${this.onArchiveClick}
      >
        Record and upload this page
      </button>
      ${!this.canRecord
        ? html`<p class="note">This kind of page can't be archived.</p>`
        : ""}
      ${this.outOfCaptures
        ? html`<p class="note">
            You can still record. Eligible saves up to 10 MB are held free for 7 days; permanent storage costs $0.99. Larger captures need payment after we measure the package.
          </p>`
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
              ${this.numPending} resources still saving.
            </div>`
          : ""}
      </div>
      <button
        class="secondary"
        ?disabled=${this.stopping || this.stopRequested}
        @click=${this.onStopClick}
      >
        Stop
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
            ? "Processing your capture."
            : "Sending to your vault."}
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
      </div>
    `;
  }

  renderDone() {
    if (this.doneKind === "staged") {
      return html`
        <div class="panel">
          <div class="panel-title">Saved temporarily, not permanent</div>
          <p class="panel-sub">
            ${this.stagedExpiresAt && !Number.isNaN(Date.parse(this.stagedExpiresAt))
              ? `Expires ${new Date(this.stagedExpiresAt).toLocaleString(undefined, { timeZoneName: "short" })}.`
              : "The server did not provide an expiry. Check History before relying on this save."}
            Unpaid saves are deleted at expiry. Making it permanent costs $0.99 and publishes the readable archive on Arweave.
          </p>
          ${this.uploadId ? html`<button class="primary" ?disabled=${this.checkoutBusy} @click=${this.onMakePermanent}>Make permanent for $0.99</button>` : ""}
          ${this.errorMsg ? html`<p class="error-text">${this.errorMsg}</p>` : ""}
          <button class="secondary" @click=${this.onOpenHistory}>View in History</button>
          <button class="secondary" @click=${this.onArchiveAnother}>Archive another page</button>
        </div>
      `;
    }
    if (this.doneKind === "vault" || this.doneKind === "existing") {
      return html`
        <div class="panel">
          <div class="done-mark">&#10003;</div>
          <div class="panel-title">${this.doneKind === "existing" ? "Already in permanent storage" : "Submitted to permanent storage"}</div>
          <p class="panel-sub">
            This archive was submitted to public permanent storage. Its link may take time to become available. Check History for storage and proof status.
          </p>
          <button class="primary" @click=${this.onViewInVault}>
            View in vault
          </button>
          <button class="secondary" @click=${this.onArchiveAnother}>
            Archive another page
          </button>
        </div>
      `;
    }

    return html`
      <div class="panel">
        <div class="panel-title">Check capture status</div>
        <p class="panel-sub">
          The upload's final status is not confirmed here.
          Check History for completion, any temporary-save expiry, and storage
          and proof status. A disconnected progress display does not confirm permanence.
        </p>
        <button class="primary" @click=${this.onOpenHistory}>Check History</button>
        <button class="secondary" @click=${this.onArchiveAnother}>
          Archive another page
        </button>
      </div>
    `;
  }
}

customElements.define("wr-popup-viewer", PermavaultPopup);

export { PermavaultPopup };
