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
  let session = { walletAddress: 'account' };
  const template = (strings, ...values) => strings.reduce((out, part, i) => out + part + (values[i] ?? ''), '');
  const exports = {};
  const context = {
    exports, console, Blob, URL, crypto: require("node:crypto").webcrypto,
    window: { confirm, location: { href: 'chrome-extension://test/popup.html' } },
    fetch: async () => ({ ok: true, blob: async () => new Blob(['package']) }),
    customElements: { define() {} },
    setTimeout: () => 1, clearTimeout() {},
    require(name) {
      if (name === 'lit') return { LitElement: class {}, html: template, css: template };
      if (name === './pv/extensionAuth') return { loadEmailGrant: async () => null };
      if (name === './pv/largeCapture') return { quoteLargeCapture: async () => ({ amountCents: 999, included: false }), checkoutLargeCapture: async () => ({ orderId: 'order', checkoutSessionId: 'session', checkoutUrl: 'https://checkout.stripe.com/test', amountCents: 999 }) };
      if (name === './pv/api') return {
        uploadWacz: async () => { uploads++; return result; },
        makePermanent: async () => 'https://checkout.stripe.com/test',
        openWsForJob: async (_job, callbacks) => { handlers = callbacks; return { close() {} }; },
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
  return { instance, handlers: () => handlers, uploads: () => uploads, pending: () => pending, setSession: value => { session = value; }, setPackage: blob => { context.fetch = async () => ({ ok: true, blob: async () => blob }); } };
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

test('accepted recording starts and carries acceptance to upload', () => {
  let notice = '';
  const { instance } = popup(text => { notice = text; return true; });
  let message;
  instance.pageUrl = 'https://example.com/private';
  instance.captureViewportScreenshot = () => {};
  instance.sendMessage = value => { message = value; };
  instance.onArchiveClick();
  assert.equal(message.type, 'startRecording');
  assert.equal(instance.destinationAccepted, true);
  assert.match(notice, /logged-in or personal content/);
  assert.match(notice, /sent to Permavault with readable contents/);
  assert.match(notice, /7 days/);
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

test('disconnected progress does not claim a completed archive', async () => {
  const harness = popup();
  await harness.instance.trackUploadJob('job');
  harness.handlers().onWsError();
  assert.equal(harness.instance.doneKind, 'finishing');
  assert.match(harness.instance.renderDone(), /final status is not confirmed/);
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
  h.instance.onArchiveClick();
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

test('signed-in recording keeps explicit public upload disclosure', () => {
  let notice;
  const { instance } = popup(value => { notice = value; return true; });
  instance.sendMessage = () => {};
  instance.captureViewportScreenshot = () => {};
  instance.onArchiveClick();
  assert.match(notice, /^Record and upload this page\?/);
  assert.match(notice, /public permanent storage/);
  assert.match(notice, /records and uploads automatically/);
  assert.equal(instance.destinationAccepted, true);
  assert.match(instance.renderHeader(), /Sign out/);
});
