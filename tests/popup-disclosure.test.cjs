const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

// Exercise the actual popup methods without a browser or network. Lit's
// template tag is flattened only so result copy can be inspected.
function popup(confirm = () => true, result = { status: 202, json: { jobId: "job" } }) {
  class ServerRefusal extends Error { constructor(message, status, code) { super(message); this.status = status; this.code = code; } }
  const large = {
    ServerRefusal,
    PAYMENT_GONE: new Set(['LARGE_MEDIA_ORDER_REQUIRED', 'ORDER_IN_USE', 'ORDER_SIZE_MISMATCH']),
    coveringLargePayment: async () => null,
    quoteLargeCapture: async () => ({ amountCents: 999, included: false }),
    checkoutLargeCapture: async () => ({ orderId: 'order', checkoutSessionId: 'session', checkoutUrl: 'https://checkout.stripe.com/test', amountCents: 999 }),
    largeCheckoutState: async () => 'waiting',
    uploadLargeCapture: async () => ({ status: 202, json: { jobId: 'job' } }),
  };
  let pending;
  let handlers;
  let uploads = 0;
  let privateUploads = 0;
  let wsReject = false;
  let wsHang = false;
  let jobStatus = { status: 'pending', result: null };
  const ports = [];
  const timers = new Map();
  const local = new Map();
  let session = { walletAddress: 'account' };
  const template = (strings, ...values) => strings.reduce((out, part, i) => out + part + (values[i] ?? ''), '');
  const exports = {};
  const context = {
    exports, console, Blob, URL, crypto: require("node:crypto").webcrypto,
    chrome: { runtime: { connect: () => {
      const port = { messages: [], onMessage: { addListener(fn) { port.onMessageHandler = fn; } },
        onDisconnect: { addListener(fn) { port.onDisconnectHandler = fn; } },
        postMessage(message) { port.messages.push(message); } };
      ports.push(port);
      return port;
    } } },
    window: { confirm, location: { href: 'chrome-extension://test/popup.html' } },
    fetch: async () => ({ ok: true, blob: async () => new Blob(['package']) }),
    customElements: { define() {} },
    setTimeout: (callback, delay) => { timers.set(delay, callback); return delay; },
    clearTimeout: delay => { timers.delete(delay); },
    require(name) {
      if (name === 'lit') return { LitElement: class {}, html: template, css: template };
      if (name === './pv/extensionAuth') return { loadEmailGrant: async () => null };
      if (name === './pv/largeCapture') return large;
      if (name === './pv/api') return {
        uploadWacz: async () => { uploads++; return result; },
        makePermanent: async () => 'https://checkout.stripe.com/test',
        openWsForJob: async (_job, callbacks) => { handlers = callbacks; if (wsHang) return new Promise(() => {}); if (wsReject) throw new Error('offline'); return { close() {} }; },
        getCaptureJob: async () => jobStatus,
      };
      if (name === './pv/privateArticle') return {
        ARTICLE_BYTES: 10 * 1024 * 1024,
        getPrivateVault: async () => ({ id: 'vault', recipient: 'age1recipient', formatVersion: 'age-v1' }),
        lockArticle: async blob => ({ blob: new Blob(['locked']), filename: 'private.age', vaultId: 'vault', recipient: 'age1recipient', plaintextSize: blob.size, sealedManifest: 'sealed', anchorSha256: 'a'.repeat(64), operationId: 'same-operation' }),
        stagePrivateArticle: async () => { privateUploads++; return result; },
      };
      if (name === './localstorage') return {
        getLocalOption: async key => local.get(key),
        setLocalOption: async (key, value) => { local.set(key, value); },
        removeLocalOption: async key => { local.delete(key); },
      };
      if (name === './pv/pending') return { savePending: async value => { pending = value; }, loadPending: async () => pending, clearPending: async () => { pending = undefined; } };
      if (name === './pv/auth') return { VAULT_HOME: 'https://app.permavault.xyz', getStoredSession: async () => session, signInWithJwk: async () => session, signOut: async () => { session = null; } };
      return {};
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/popup.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(compiled.outputText, context);
  const instance = new exports.PermavaultPopup();
  instance.walletAddress = 'account';
  instance.refreshBalance = async () => {};
  return { serverExpiryDate: exports.serverExpiryDate, temporaryLine: exports.temporaryLine, instance, large, handlers: () => handlers, uploads: () => uploads, privateUploads: () => privateUploads, pending: () => pending, local,
    ports: () => ports,
    setJobStatus: value => { jobStatus = value; }, setWsReject: value => { wsReject = value; }, setWsHang: value => { wsHang = value; },
    runTimer: async delay => { const callback = timers.get(delay); assert.ok(callback, `timer ${delay} exists`); await callback(); },
    setSession: value => { session = value; }, setPending: value => { pending = value; }, setPackage: blob => { context.fetch = async () => ({ ok: true, blob: async () => blob }); } };
}

test('signing out keeps an unfinished package visible', async () => {
  const h = popup();
  h.instance.phase = 'review-capture';
  h.instance.waczBlob = new Blob(['package']);
  await h.instance.onSignOut();
  assert.equal(h.instance.phase, 'review-capture');
  assert.equal(h.instance.walletAddress, '');
});

test('late account loading keeps an already reported live recording visible', async () => {
  const h = popup();
  h.setSession(null);
  h.instance.phase = 'capturing';
  h.instance.recording = true;
  h.instance.wasRecording = true;
  h.instance.pageUrl = 'https://example.com/privacy';
  await h.instance.initSession();
  assert.equal(h.instance.phase, 'capturing');
  assert.equal(h.instance.capturedPageUrl, 'https://example.com/privacy');
});

test('a pending package blocks a new recording until explicitly set aside', async () => {
  const h = popup();
  const old = { blob: new Blob(['old package']), filename: 'old.wacz', sourceUrl: 'https://example.com/old', account: 'account' };
  h.setPending(old);
  h.instance.phase = 'signed-out';
  h.instance.walletAddress = '';
  h.instance.sendMessage = () => assert.fail('recording started over a pending package');
  await h.instance.onArchiveClick();
  assert.equal(h.instance.phase, 'review-capture');
  assert.equal(h.instance.waczBlob, old.blob);
  assert.equal(h.pending(), old);
  h.instance.refreshTabInfo = () => {};
  await h.instance.onSetAsidePending();
  assert.equal(h.pending(), undefined);
  assert.equal(h.instance.phase, 'signed-out');
  assert.equal(h.instance.waczBlob, null);
});

test('declining recording disclosure starts no recording or screenshot', () => {
  const { instance } = popup(() => false);
  instance.phase = 'idle';
  instance.sendMessage = () => assert.fail('recording started');
  instance.captureViewportScreenshot = () => assert.fail('screenshot captured');
  instance.onArchiveClick();
  assert.equal(instance.phase, 'idle');
  assert.equal(instance.destinationAccepted, false);
});

test('resumed capture cannot upload without destination acceptance', async () => {
  const harness = popup(() => false);
  harness.instance.waczBlob = new Blob(['archive']);
  await harness.instance.uploadCapture();
  assert.equal(harness.uploads(), 0);
  assert.match(harness.instance.errorMsg, /^Cancelled\./);
});

test('accepted recording starts and carries acceptance to upload', async () => {
  let notice = '';
  const { instance } = popup(text => { notice = text; return true; });
  let message;
  instance.pageUrl = 'https://example.com/private';
  instance.captureViewportScreenshot = () => {};
  instance.sendMessage = value => { message = value; };
  await instance.onArchiveClick();
  assert.equal(message.type, 'startRecording');
  assert.equal(instance.destinationAccepted, true);
  assert.match(notice, /signed in to see/);
  assert.match(notice, /anyone with its link can view it/);
  assert.match(notice, /free for 7 days/);
});

test('a disconnected popup port reconnects and registers the tab before recording', () => {
  const h = popup();
  h.instance.tabId = 42;
  h.instance.port = { postMessage() { throw new Error('disconnected port'); } };
  h.instance.sendMessage({ type: 'startRecording', url: 'https://example.com', autorun: true });
  assert.equal(h.ports()[0].messages[0].type, 'startUpdates');
  assert.equal(h.ports()[0].messages[0].tabId, 42);
  assert.equal(h.ports()[0].messages[1].type, 'startRecording');
  assert.equal(h.ports()[0].messages[1].url, 'https://example.com');
});

test('a lost connection before start is reported without claiming nothing was sent', () => {
  const h = popup();
  h.instance.tabId = 42;
  h.instance.connectPort();
  h.instance.phase = 'capturing';
  h.instance.waitingForStart = true;
  h.ports()[0].onDisconnectHandler();
  assert.equal(h.instance.port, null);
  assert.equal(h.instance.phase, 'error');
  assert.match(h.instance.errorMsg, /Check your local library/);
  assert.doesNotMatch(h.instance.errorMsg, /Nothing was sent/);
});

test('background start failure is surfaced to the popup', () => {
  const h = popup();
  h.instance.phase = 'capturing';
  h.instance.waitingForStart = true;
  h.instance.onMessage({ type: 'startRecordingFailed' });
  assert.equal(h.instance.phase, 'error');
  assert.match(h.instance.errorMsg, /didn't start/);
});

test('staged completion does not claim permanent storage and links to History', async () => {
  const harness = popup();
  await harness.instance.trackUploadJob('job');
  harness.handlers().onComplete({ uploadId: 'save', staged: true });
  assert.equal(harness.instance.doneKind, 'staged');
  assert.match(harness.instance.renderDone(), /Saved free for 7 days/);
  assert.doesNotMatch(harness.instance.renderDone(), /Sent to permanent storage/);
  let url;
  harness.instance.openTab = value => { url = value; };
  harness.instance.onOpenHistory();
  assert.equal(url, 'https://app.permavault.xyz/history');
});

test('disconnected progress reads the durable temporary-save receipt', async () => {
  const harness = popup();
  harness.setJobStatus({ status: 'staged', result: {
    uploadId: 'save', staged: true, stagedExpiresAt: '2026-10-12T12:31:05Z', txId: null, alreadyArchived: false,
  } });
  await harness.instance.trackUploadJob('job');
  harness.handlers().onWsError();
  await new Promise(setImmediate);
  assert.equal(harness.instance.doneKind, 'staged');
  assert.match(harness.instance.renderDone(), /Saved free for 7 days/);
});

test('pending durable job remains uncertain after the status deadline', async () => {
  const harness = popup();
  await harness.instance.trackUploadJob('job');
  await harness.runTimer(120000);
  assert.equal(harness.instance.doneKind, 'finishing');
  assert.match(harness.instance.renderDone(), /Check History for the result/);
});

test('status request that never replies cannot block the History fallback', async () => {
  const harness = popup();
  harness.setJobStatus(new Promise(() => {}));
  await harness.instance.trackUploadJob('job');
  harness.handlers().onWsError();
  await harness.runTimer(120000);
  assert.equal(harness.instance.doneKind, 'finishing');
  assert.match(harness.instance.renderDone(), /Check History for the result/);
});

test('missing progress channel and stalled status still reach History fallback', async () => {
  const harness = popup();
  harness.setWsReject(true);
  harness.setJobStatus(new Promise(() => {}));
  await harness.instance.trackUploadJob('job');
  await harness.runTimer(120000);
  assert.equal(harness.instance.doneKind, 'finishing');
});

test('stalled progress-channel setup cannot block the deadline', async () => {
  const harness = popup();
  harness.setWsHang(true);
  harness.setJobStatus(new Promise(() => {}));
  void harness.instance.trackUploadJob('job');
  await harness.runTimer(120000);
  assert.equal(harness.instance.doneKind, 'finishing');
});

test('large-capture controls unlock while job tracking continues', async () => {
  const harness = popup();
  harness.instance.waczBlob = new Blob(['paid package']);
  harness.instance.largeState = { account: 'account', sessionId: 'paid' };
  harness.instance.destinationAccepted = true;
  harness.instance.trackUploadJob = () => new Promise(() => {});
  await Promise.race([
    harness.instance.onLargeCapture(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('large capture stayed busy')), 100)),
  ]);
  assert.equal(harness.instance.largeBusy, false);
  assert.equal(harness.instance.phase, 'uploading');
});

test('old status reply cannot overwrite a later capture state', async () => {
  const harness = popup();
  let reply;
  harness.setJobStatus(new Promise(resolve => { reply = resolve; }));
  await harness.instance.trackUploadJob('job');
  harness.handlers().onWsError();
  harness.instance.refreshTabInfo = () => {};
  harness.instance.resetForNext();
  harness.handlers().onStage('old-stage');
  harness.handlers().onProgress(99);
  reply({ status: 'staged', result: {
    uploadId: 'old-save', staged: true, stagedExpiresAt: '2026-10-12T12:31:05Z', txId: null, alreadyArchived: false,
  } });
  await new Promise(setImmediate);
  assert.equal(harness.instance.phase, 'idle');
  assert.equal(harness.instance.uploadId, '');
  assert.notEqual(harness.instance.uploadStage, 'old-stage');
  assert.equal(harness.instance.uploadPercent, null);
});


test('zero balance still allows recording and staging upload', async () => {
  const h = popup();
  h.instance.canRecord = true;
  h.instance.balanceLoaded = true;
  h.instance.balance = 0;
  assert.match(h.instance.renderIdle(), /disabled=false/);
  h.instance.waczBlob = new Blob(['small']);
  await h.instance.uploadCapture();
  assert.equal(h.uploads(), 1);
  assert.equal(h.pending().blob, h.instance.waczBlob);
  assert.equal(h.pending().submitted, true);
});

test('staged result uses exact server expiry and offers checkout', async () => {
  const h = popup();
  h.instance.completeCapture({ uploadId: 'save', staged: true, stagedExpiresAt: '2026-10-01T12:00:00Z', txId: null });
  assert.match(h.instance.renderDone(), /Temporary · /);
  assert.match(h.instance.renderDone(), /Make permanent for \$0.99/);
  let url;
  h.instance.openTab = value => { url = value; };
  await h.instance.onMakePermanent();
  assert.equal(url, 'https://checkout.stripe.com/test');
});

test('a private save is made permanent on its page in Permavault (PV-470)', async () => {
  const h = popup();
  h.instance.privateSelected = true;
  h.instance.completeCapture({ uploadId: 'private-save', staged: true, stagedExpiresAt: '2026-10-01T12:00:00Z', txId: null });
  assert.match(h.instance.renderDone(), /Make permanent for \$1.99 <span aria-hidden="true">↗/);
  assert.match(h.instance.renderDone(), /Opens Permavault to confirm and pay/);
  let url;
  h.instance.openTab = value => { url = value; };
  await h.instance.onMakePermanent();
  assert.equal(url, 'https://app.permavault.xyz/view/private-save');
});

test('only transaction evidence supports permanent or already-existing outcomes', () => {
  const { instance } = popup();
  instance.completeCapture({ uploadId: 'save' });
  assert.equal(instance.doneKind, 'finishing');
  instance.completeCapture({ uploadId: 'save', alreadyArchived: true });
  assert.equal(instance.doneKind, 'finishing');
  instance.completeCapture({ uploadId: 'save', txId: 'transaction', alreadyArchived: true });
  assert.equal(instance.doneKind, 'existing');
  assert.match(instance.renderDone(), /Already saved permanently/);
  instance.completeCapture({ uploadId: 'save', txId: 'transaction' });
  assert.equal(instance.doneKind, 'vault');
});

test('over-100-MB package retains checkout identity before opening payment', async () => {
  const h = popup();
  let opened;
  h.instance.openTab = url => { opened = url; };
  h.instance.waczBlob = { size: 100 * 1024 * 1024 + 1 };
  await h.instance.uploadCapture();
  assert.equal(h.uploads(), 0);
  assert.equal(h.instance.phase, 'review-capture');
  assert.equal(opened, 'https://checkout.stripe.com/test');
  assert.equal(h.pending().large.orderId, 'order');
  assert.equal(h.pending().large.checkoutSessionId, 'session');
});

test('payment rejection retains exact package and permits retry after payment', async () => {
  const h = popup(undefined, { status: 402, json: { balance: 0 } });
  const blob = new Blob(['unchanged']);
  h.instance.waczBlob = blob;
  await h.instance.uploadCapture();
  assert.equal(h.instance.phase, 'out-of-captures');
  assert.equal(h.pending().blob, blob);
  assert.equal(h.pending().submitted, false);
});

test('server failure is uncertain, not a promise of future success', async () => {
  const h = popup(undefined, { status: 503, json: null });
  h.instance.waczBlob = new Blob(['archive']);
  await h.instance.uploadCapture();
  assert.equal(h.instance.doneKind, 'finishing');
  assert.equal(h.pending().submitted, true);
  assert.match(h.instance.renderDone(), /Check History for the result/);
});


test('each unnamed capture gets its own collection instead of prior pages', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/ext/bg.ts'), 'utf8');
  const tree = ts.createSourceFile('bg.ts', source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'startRecorder');
  const compiled = ts.transpileModule(fn.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  let next = 0;
  const selections = [];
  const recorder = { running: true, setAutoRunBehavior() {}, setCollId() {} };
  const context = { self: { recorders: {} }, openWinMap: new Map(),
    collLoader: { initNewColl: async () => ({ name: `capture-${++next}` }) },
    BrowserRecorder: class { constructor(_tab, opts) { selections.push(opts.collId); return recorder; } },
    console };
  vm.createContext(context);
  vm.runInContext(compiled.outputText, context);
  await context.startRecorder(1, {});
  await context.startRecorder(2, {});
  await context.startRecorder(3, { collId: 'explicit-library' });
  assert.deepEqual(selections, ['capture-1', 'capture-2', 'explicit-library']);
});

test('background reports an asynchronous recording-start failure', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/ext/bg.ts'), 'utf8');
  const tree = ts.createSourceFile('bg.ts', source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'popupHandler');
  const compiled = ts.transpileModule(fn.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  let receive;
  let disconnect;
  const sent = [];
  const port = { sender: { url: 'chrome-extension://test/popup.html' },
    onMessage: { addListener(fn) { receive = fn; } }, onDisconnect: { addListener(fn) { disconnect = fn; } },
    postMessage(message) { sent.push(message); } };
  let throwFailure = true;
  const context = { chrome: { runtime: { getURL: () => 'chrome-extension://test/popup.html' } },
    self: { recorders: {} }, collLoader: {}, listAllMsg: async () => ({ type: 'collections' }),
    startRecorder: async () => {
      if (throwFailure) throw new Error('cold start failed');
      return 'debugger unavailable';
    }, console: { warn() {} } };
  vm.createContext(context);
  vm.runInContext(compiled.outputText, context);
  context.popupHandler(port);
  await receive({ type: 'startUpdates', tabId: 42 });
  await receive({ type: 'startRecording', url: 'https://example.com', autorun: true });
  assert.equal(sent.at(-1).type, 'startRecordingFailed');
  throwFailure = false;
  await receive({ type: 'startRecording', url: 'https://example.com', autorun: true });
  assert.equal(sent.at(-1).type, 'startRecordingFailed');
  const newerPort = {};
  context.self.recorders[42] = { port: newerPort };
  disconnect();
  assert.equal(context.self.recorders[42].port, newerPort);
});

test('a failed debugger attach remains retryable', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/ext/browser-recorder.ts'), 'utf8');
  const tree = ts.createSourceFile('browser-recorder.ts', source, ts.ScriptTarget.Latest, true);
  const cls = tree.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'BrowserRecorder');
  const method = cls.members.find(node => node.name?.getText(tree) === '_doAttach');
  const compiled = ts.transpileModule(`class Probe { ${method.getText(tree)} }; globalThis.Probe = Probe;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  let fail = true;
  let started = 0;
  const context = { console, chrome: { runtime: { lastError: null }, debugger: {
    onDetach: { addListener() {} }, onEvent: { addListener() {} },
    attach(_tab, _version, callback) {
      context.chrome.runtime.lastError = fail ? { message: 'debugger unavailable' } : null;
      callback();
    },
  } } };
  vm.createContext(context);
  vm.runInContext(compiled.outputText, context);
  const recorder = new context.Probe();
  Object.assign(recorder, { _initDB: Promise.resolve({ store: {} }), debuggee: { tabId: 42 },
    isAttached: false, _onDetached() {}, _onEvent() {}, doUpdateStatus() {},
    start: async () => { started++; }, send: async () => {}, getInjectScript: () => '' });
  await assert.rejects(recorder._doAttach(), error => error === 'debugger unavailable');
  assert.equal(recorder.isAttached, false);
  assert.equal(started, 0);
  fail = false;
  await recorder._doAttach();
  assert.equal(recorder.isAttached, true);
  assert.equal(started, 1);
});


test('measured package above free threshold requires review before spending', async () => {
  const h = popup();
  const blob = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]);
  h.setPackage(blob);
  h.instance.phase = 'capturing';
  h.instance.collId = 'isolated';
  h.instance.capturedPageUrl = 'https://example.com';
  await h.instance.packageAndUpload();
  assert.equal(h.instance.phase, 'review-capture');
  assert.equal(h.uploads(), 0);
  assert.equal(h.pending().blob, blob);
  assert.match(h.instance.renderMain(), /1 prepaid capture \(\$4.99 each\)/);
});

test('reopening restores unpaid exact bytes without automatic resubmission', async () => {
  const h = popup();
  const blob = new Blob(['exact package']);
  h.instance.waczBlob = blob;
  h.instance.waczFilename = 'page.wacz';
  await h.instance.persistPending();
  h.instance.waczBlob = null;
  await h.instance.initSession();
  assert.equal(h.instance.waczBlob, blob);
  assert.equal(h.instance.phase, 'review-capture');
  assert.equal(h.instance.destinationAccepted, false);
  assert.equal(h.uploads(), 0);
});

test('reopening after submission asks for status check instead of duplicate upload', async () => {
  const h = popup();
  h.instance.waczBlob = new Blob(['exact package']);
  await h.instance.persistPending(true);
  await h.instance.initSession();
  assert.equal(h.instance.phase, 'done');
  assert.equal(h.instance.doneKind, 'finishing');
  assert.equal(h.uploads(), 0);
});

test('signed-out recording resumes after popup reopening and packages locally', async () => {
  const h = popup();
  h.setSession(null);
  await h.instance.initSession();
  assert.equal(h.instance.phase, 'signed-out');
  assert.equal(h.instance.walletAddress, '');
  h.instance.onStatus({ recording: true, behaviorState: 'running', collId: 'local', pageUrl: 'https://example.com', firstPageStarted: true });
  assert.equal(h.instance.phase, 'capturing');
  assert.equal(h.instance.destinationAccepted, false);
  await h.instance.packageAndUpload();
  assert.equal(h.instance.phase, 'review-capture');
  assert.equal(h.uploads(), 0);
});

test('cross-account restored package is download-only and preserves its original account', async () => {
  const h = popup();
  h.instance.waczBlob = new Blob(['account A bytes']);
  h.instance.sourceUrl = 'https://example.com/account-a';
  await h.instance.persistPending();
  h.setSession({ walletAddress: 'account-b' });
  await h.instance.initSession();
  assert.equal(h.instance.pendingAccountMismatch, true);
  assert.match(h.instance.renderMain(), /Saved under another account/);
  assert.match(h.instance.renderMain(), /Page: https:\/\/example.com\/account-a/);
  assert.doesNotMatch(h.instance.renderMain(), />Save this page</);
  await h.instance.uploadCapture();
  assert.equal(h.uploads(), 0);
  assert.equal(h.pending().account, 'account');
  h.setSession({ walletAddress: 'account' });
  await h.instance.signInWithKeyText('{}');
  assert.equal(h.instance.pendingAccountMismatch, false);
  assert.equal(h.instance.destinationAccepted, false);
  assert.match(h.instance.renderMain(), />Save this page</);
});

test('signing back into original account does not resubmit an already sent package', async () => {
  const h = popup();
  h.instance.waczBlob = new Blob(['submitted']);
  await h.instance.persistPending(true);
  h.setSession({ walletAddress: 'account-b' });
  await h.instance.initSession();
  assert.equal(h.instance.phase, 'review-capture');
  h.setSession({ walletAddress: 'account' });
  await h.instance.signInWithKeyText('{}');
  assert.equal(h.instance.phase, 'done');
  assert.equal(h.instance.doneKind, 'finishing');
  assert.equal(h.uploads(), 0);
});

test('signed-out capture promises local storage and never authorizes automatic upload', async () => {
  let notice;
  const h = popup(value => { notice = value; return true; });
  h.instance.walletAddress = '';
  h.instance.phase = 'signed-out';
  h.instance.collId = 'local';
  h.instance.pageUrl = 'https://example.test';
  h.instance.sendMessage = () => {};
  h.instance.captureViewportScreenshot = () => {};
  await h.instance.onArchiveClick();
  assert.match(notice, /^Save to this browser only\?/);
  assert.match(notice, /Nothing is uploaded/);
  assert.doesNotMatch(notice, /anyone with its link/);
  assert.equal(h.instance.destinationAccepted, false);
  assert.equal(h.instance.pendingAccount, '');
  assert.doesNotMatch(h.instance.renderHeader(), /Sign out/);
  await h.instance.packageAndUpload();
  assert.equal(h.instance.phase, 'review-capture');
  assert.equal(h.pending().account, '');
  assert.equal(h.uploads(), 0);
  // A later sign-in alone must not adopt or submit the local bytes.
  h.instance.walletAddress = 'new-account';
  await h.instance.uploadCapture();
  assert.equal(h.uploads(), 0);
  assert.equal(h.instance.pendingAccount, '');
});

test('signed-in recording keeps the regular-capture disclosure', async () => {
  let notice;
  const { instance } = popup(value => { notice = value; return true; });
  instance.sendMessage = () => {};
  instance.captureViewportScreenshot = () => {};
  await instance.onArchiveClick();
  assert.match(notice, /^Save this page\?/);
  assert.match(notice, /anyone with its link can view it/);
  assert.match(notice, /right to share/);
  assert.equal(instance.destinationAccepted, true);
  assert.match(instance.renderHeader(), /Sign out/);
});

test('Private choice suppresses screenshot and stages only the locked package', async () => {
  const h = popup();
  const instance = h.instance;
  instance.phase = 'idle';
  instance.privateSelected = true;
  instance.pageUrl = 'https://example.com/secret';
  instance.captureViewportScreenshot = () => assert.fail('private screenshot captured');
  instance.sendMessage = () => {};
  await instance.onArchiveClick();
  assert.equal(h.local.get('pvPendingPrivacy'), 'private');
  instance.collId = 'capture';
  h.setPackage(new Blob(['plain WACZ']));
  await instance.packageAndUpload();
  assert.equal(h.privateUploads(), 1);
  assert.equal(h.uploads(), 0);
  assert.equal(h.pending().filename, 'private.age');
  assert.equal(h.pending().sourceUrl, '');
  assert.equal(h.pending().screenshotDataUrl, null);
  assert.equal(await h.pending().blob.text(), 'locked');
  instance.completeCapture({ uploadId: 'private-save', staged: true });
  assert.match(instance.renderDone(), /private/i);
});

test('Private intent survives reopening and cannot fall into public upload', async () => {
  const h = popup();
  h.local.set('pvPendingPrivacy', 'private');
  await h.instance.initSession();
  h.instance.waczBlob = new Blob(['plain WACZ']);
  h.instance.destinationAccepted = true;
  await h.instance.uploadCapture();
  assert.equal(h.uploads(), 0);
  assert.equal(h.privateUploads(), 0);
  assert.match(h.instance.errorMsg, /couldn't be sealed, so nothing was sent/);
  h.instance.refreshTabInfo = () => {};
  h.instance.onTryAgain();
  assert.equal(h.instance.phase, 'idle');
  assert.equal(h.instance.privateSelected, true);
});


test('server expiry preserves UTC across a local date boundary and explicit ISO offsets', () => {
  const { serverExpiryDate, temporaryLine, instance } = popup();
  const prior = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const sqlite = serverExpiryDate('2026-10-01 00:30:00');
    assert.equal(sqlite.toISOString(), '2026-10-01T00:30:00.000Z');
    // UTC October 1 is still September 30 in this browser timezone.
    assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(sqlite), '2026-09-30');
    assert.equal(serverExpiryDate('2026-10-01T02:30:00+02:00').getTime(), sqlite.getTime());
    assert.equal(serverExpiryDate('2026-10-01T00:30:00Z').getTime(), sqlite.getTime());
    assert.equal(serverExpiryDate('2026-10-01T00:30:00').getTime(), sqlite.getTime());
    assert.equal(serverExpiryDate('2026-10-01 10:39:00').toISOString(), '2026-10-01T10:39:00.000Z');
    instance.doneKind = 'staged'; instance.stagedExpiresAt = '2026-10-01 00:30:00';
    assert.match(instance.renderDone(), /Temporary · /);
    // The moment is named in the reader's own time, with the zone.
    const moment = sqlite.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    assert.ok(temporaryLine(sqlite, sqlite.getTime() - 3 * 86400000).includes(`3 days left, until ${moment}`));
    assert.equal(temporaryLine(sqlite, sqlite.getTime() + 1), 'Temporary · ending now');
    instance.stagedExpiresAt = 'not-a-date';
    assert.equal(serverExpiryDate('not-a-date'), null);
    assert.match(instance.renderDone(), /Check History for when this save expires/);
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});

test('PV-536: a payment the account already has for this package is used: no price question, no checkout', async () => {
  const asked = [];
  const harness = popup((text) => { asked.push(text); return true; });
  let uploadedWith;
  harness.large.coveringLargePayment = async () => 'earlier-order';
  harness.large.quoteLargeCapture = async () => assert.fail('priced a package that is already paid');
  harness.large.checkoutLargeCapture = async () => assert.fail('opened a checkout for a package that is already paid');
  harness.large.uploadLargeCapture = async (_capture, state) => { uploadedWith = { ...state }; return { status: 202, json: { jobId: 'job' } }; };
  harness.instance.waczBlob = new Blob(['large package']);
  harness.instance.destinationAccepted = true;
  harness.instance.openTab = () => assert.fail('opened a tab');
  harness.instance.trackUploadJob = () => new Promise(() => {});
  await harness.instance.onLargeCapture();
  assert.equal(uploadedWith.orderId, 'earlier-order');
  assert.equal(uploadedWith.paidEarlier, true);
  // Asked once, about using the payment, never about a price.
  assert.equal(asked.filter((text) => /costs/.test(text)).length, 0);
  assert.equal(asked.filter((text) => /An earlier payment covers this capture/.test(text)).length, 1);
  assert.equal(harness.instance.phase, 'uploading');
});

test('PV-536: declining to use the earlier payment changes nothing', async () => {
  const harness = popup((text) => !/An earlier payment covers this capture/.test(text));
  harness.large.coveringLargePayment = async () => 'earlier-order';
  harness.large.uploadLargeCapture = async () => assert.fail('uploaded after the customer declined');
  harness.instance.waczBlob = new Blob(['large package']);
  harness.instance.destinationAccepted = true;
  await harness.instance.onLargeCapture();
  assert.equal(harness.instance.largeState.orderId, undefined);
});

test('PV-536: a checkout the server answers with an earlier payment uploads against it, without a tab', async () => {
  const harness = popup(() => true);
  let uploadedWith;
  harness.large.checkoutLargeCapture = async () => ({ orderId: 'named-order', paidEarlier: true });
  harness.large.uploadLargeCapture = async (_capture, state) => { uploadedWith = { ...state }; return { status: 202, json: { jobId: 'job' } }; };
  harness.instance.waczBlob = new Blob(['large package']);
  harness.instance.destinationAccepted = true;
  harness.instance.openTab = () => assert.fail('opened a tab');
  harness.instance.trackUploadJob = () => new Promise(() => {});
  await harness.instance.onLargeCapture();
  assert.equal(uploadedWith.orderId, 'named-order');
  assert.equal(harness.instance.phase, 'uploading');
});

test('PV-536: a checkout that closed unpaid is let go, so the next press opens a new one', async () => {
  const harness = popup(() => true);
  harness.large.largeCheckoutState = async () => 'closed';
  harness.large.uploadLargeCapture = async () => assert.fail('uploaded against a checkout that closed unpaid');
  harness.instance.waczBlob = new Blob(['large package']);
  harness.instance.destinationAccepted = true;
  harness.instance.largeState = { account: 'account', operationId: 'capture-op', checkoutOperationId: 'old-checkout-op', orderId: 'closed-order', checkoutSessionId: 'cs_closed', checkoutUrl: 'https://checkout.stripe.com/c', amountCents: 999 };
  await harness.instance.onLargeCapture();
  const state = harness.instance.largeState;
  assert.equal(state.orderId, undefined);
  assert.equal(state.checkoutSessionId, undefined);
  assert.notEqual(state.checkoutOperationId, 'old-checkout-op');
  assert.match(harness.instance.errorMsg, /closed without payment, so nothing was charged\. Press See price to try again\./);
});

test('PV-536: a payment taken by another upload meanwhile is let go, so the next press looks again', async () => {
  const harness = popup(() => true);
  harness.large.coveringLargePayment = async () => 'earlier-order';
  harness.large.uploadLargeCapture = async () => { throw new harness.large.ServerRefusal('This payment is already being used by an upload in progress.', 409, 'ORDER_IN_USE'); };
  harness.instance.waczBlob = new Blob(['large package']);
  harness.instance.destinationAccepted = true;
  await harness.instance.onLargeCapture();
  const state = harness.instance.largeState;
  assert.equal(state.orderId, undefined);
  assert.equal(state.paidEarlier, undefined);
  assert.match(harness.instance.errorMsg, /already in use\. Nothing more was charged/);
  // The next press looks for a payment again and, finding none, prices the package.
  let priced = false;
  harness.large.coveringLargePayment = async () => null;
  harness.large.quoteLargeCapture = async () => { priced = true; return { amountCents: 999, included: false }; };
  harness.instance.openTab = () => {};
  await harness.instance.onLargeCapture();
  assert.equal(priced, true);
});


test('large-capture labels follow the payment state and never claim a payment that did not happen', () => {
  const h = popup();
  const i = h.instance;
  i.phase = 'review-capture';
  i.waczBlob = { size: 200 * 1024 * 1024 };
  i.destinationAccepted = true;
  assert.match(i.renderMain(), />See price</);
  assert.match(i.renderMain(), /Kept in this browser until you pay/);
  i.largeBusy = true;
  assert.match(i.renderMain(), /Getting your price/);
  // Checking an open checkout is not fetching a price.
  i.largeState = { account: 'account', operationId: 'op', checkoutOperationId: 'c', orderId: 'order', checkoutSessionId: 's', checkoutUrl: 'https://checkout.stripe.com/c' };
  assert.match(i.renderMain(), />Upload now</);
  assert.doesNotMatch(i.renderMain(), /until you pay/);
  i.largeBusy = false;
  i.largeState = { account: 'account', operationId: 'op', checkoutOperationId: 'c' };
  i.phase = 'uploading';
  assert.doesNotMatch(i.renderMain(), /Paid\./);
  i.largeState.paidEarlier = true; i.largeState.orderId = 'earlier';
  assert.match(i.renderMain(), /Paid\. Keep this popup open/);
});

test('an account with captures included is never asked for a price or told it paid', () => {
  const h = popup();
  const i = h.instance;
  i.phase = 'review-capture';
  i.balanceUnlimited = true;
  i.waczBlob = { size: 200 * 1024 * 1024 };
  assert.match(i.renderMain(), />Upload now</);
  assert.doesNotMatch(i.renderMain(), /See price|until you pay/);
  i.waczBlob = { size: 20 * 1024 * 1024 };
  assert.doesNotMatch(i.renderMain(), /\$4\.99|Use 1 capture/);
});

test('a capture waiting after sign-out reads as signed out, not as another account', () => {
  const h = popup();
  const i = h.instance;
  i.phase = 'review-capture';
  i.waczBlob = { size: 1024 };
  i.pendingAccount = 'account';
  i.walletAddress = '';
  assert.match(i.renderMain(), /Sign in to make it permanent/);
  assert.doesNotMatch(i.renderMain(), /another account/);
});
