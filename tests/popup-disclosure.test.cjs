const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

// Exercise the actual popup methods without a browser or network. Lit's
// template tag is flattened only so result copy can be inspected.
function popup(confirm = () => true, result = { status: 202, json: { jobId: "job" } }) {
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
      if (name === './pv/largeCapture') return { quoteLargeCapture: async () => ({ amountCents: 999, included: false }), checkoutLargeCapture: async () => ({ orderId: 'order', checkoutSessionId: 'session', checkoutUrl: 'https://checkout.stripe.com/test', amountCents: 999 }), uploadLargeCapture: async () => ({ status: 202, json: { jobId: 'job' } }) };
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
      if (name === './pv/auth') return { VAULT_HOME: 'https://app.permavault.xyz', getStoredSession: async () => session, signInWithJwk: async () => session };
      return {};
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/popup.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(compiled.outputText, context);
  const instance = new exports.PermavaultPopup();
  instance.walletAddress = 'account';
  instance.refreshBalance = async () => {};
  return { serverExpiryDate: exports.serverExpiryDate, instance, handlers: () => handlers, uploads: () => uploads, privateUploads: () => privateUploads, pending: () => pending, local,
    ports: () => ports,
    setJobStatus: value => { jobStatus = value; }, setWsReject: value => { wsReject = value; }, setWsHang: value => { wsHang = value; },
    runTimer: async delay => { const callback = timers.get(delay); assert.ok(callback, `timer ${delay} exists`); await callback(); },
    setSession: value => { session = value; }, setPackage: blob => { context.fetch = async () => ({ ok: true, blob: async () => blob }); } };
}

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
  assert.match(harness.instance.errorMsg, /Upload cancelled/);
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
  assert.match(notice, /logged-in or personal content/);
  assert.match(notice, /sent to Permavault with readable contents/);
  assert.match(notice, /7 days/);
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
  assert.match(h.instance.errorMsg, /Check the local library/);
  assert.doesNotMatch(h.instance.errorMsg, /Nothing was sent/);
});

test('background start failure is surfaced to the popup', () => {
  const h = popup();
  h.instance.phase = 'capturing';
  h.instance.waitingForStart = true;
  h.instance.onMessage({ type: 'startRecordingFailed' });
  assert.equal(h.instance.phase, 'error');
  assert.match(h.instance.errorMsg, /could not start/);
});

test('staged completion does not claim permanent storage and links to History', async () => {
  const harness = popup();
  await harness.instance.trackUploadJob('job');
  harness.handlers().onComplete({ uploadId: 'save', staged: true });
  assert.equal(harness.instance.doneKind, 'staged');
  assert.match(harness.instance.renderDone(), /Saved temporarily, not permanent/);
  assert.doesNotMatch(harness.instance.renderDone(), /Archived permanently/);
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
  assert.match(harness.instance.renderDone(), /Saved temporarily, not permanent/);
});

test('pending durable job remains uncertain after the status deadline', async () => {
  const harness = popup();
  await harness.instance.trackUploadJob('job');
  await harness.runTimer(120000);
  assert.equal(harness.instance.doneKind, 'finishing');
  assert.match(harness.instance.renderDone(), /final status is not confirmed/);
});

test('status request that never replies cannot block the History fallback', async () => {
  const harness = popup();
  harness.setJobStatus(new Promise(() => {}));
  await harness.instance.trackUploadJob('job');
  harness.handlers().onWsError();
  await harness.runTimer(120000);
  assert.equal(harness.instance.doneKind, 'finishing');
  assert.match(harness.instance.renderDone(), /final status is not confirmed/);
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
  assert.match(h.instance.renderDone(), /Expires /);
  assert.match(h.instance.renderDone(), /Make permanent for \$0.99/);
  let url;
  h.instance.openTab = value => { url = value; };
  await h.instance.onMakePermanent();
  assert.equal(url, 'https://checkout.stripe.com/test');
});

test('only transaction evidence supports permanent or already-existing outcomes', () => {
  const { instance } = popup();
  instance.completeCapture({ uploadId: 'save' });
  assert.equal(instance.doneKind, 'finishing');
  instance.completeCapture({ uploadId: 'save', alreadyArchived: true });
  assert.equal(instance.doneKind, 'finishing');
  instance.completeCapture({ uploadId: 'save', txId: 'transaction', alreadyArchived: true });
  assert.equal(instance.doneKind, 'existing');
  assert.match(instance.renderDone(), /Already in permanent storage/);
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
  assert.match(h.instance.renderDone(), /final status is not confirmed/);
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
  assert.match(h.instance.renderMain(), /costs \$4.99/);
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
  assert.match(h.instance.renderMain(), /different sign-in/);
  assert.match(h.instance.renderMain(), /Captured page: https:\/\/example.com\/account-a/);
  assert.doesNotMatch(h.instance.renderMain(), /Continue with this package/);
  await h.instance.uploadCapture();
  assert.equal(h.uploads(), 0);
  assert.equal(h.pending().account, 'account');
  h.setSession({ walletAddress: 'account' });
  await h.instance.signInWithKeyText('{}');
  assert.equal(h.instance.pendingAccountMismatch, false);
  assert.equal(h.instance.destinationAccepted, false);
  assert.match(h.instance.renderMain(), /Continue with this package/);
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
  assert.match(notice, /^Record a local package\?/);
  assert.match(notice, /not uploaded to Permavault or published/);
  assert.doesNotMatch(notice, /records and uploads automatically/);
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

test('signed-in recording keeps explicit public upload disclosure', async () => {
  let notice;
  const { instance } = popup(value => { notice = value; return true; });
  instance.sendMessage = () => {};
  instance.captureViewportScreenshot = () => {};
  await instance.onArchiveClick();
  assert.match(notice, /^Record and upload this page\?/);
  assert.match(notice, /public permanent storage/);
  assert.match(notice, /records and uploads automatically/);
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
  assert.match(h.instance.errorMsg, /could not be locked/);
  h.instance.refreshTabInfo = () => {};
  h.instance.onTryAgain();
  assert.equal(h.instance.phase, 'idle');
  assert.equal(h.instance.privateSelected, true);
});


test('server expiry preserves UTC across a local date boundary and explicit ISO offsets', () => {
  const { serverExpiryDate, instance } = popup();
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
    assert.match(instance.renderDone(), /Expires/);
    assert.ok(instance.renderDone().includes(sqlite.toLocaleString(undefined, { timeZoneName: 'short' })));
    instance.stagedExpiresAt = 'not-a-date';
    assert.equal(serverExpiryDate('not-a-date'), null);
    assert.match(instance.renderDone(), /server did not provide an expiry/);
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});
