const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto, createHash } = require('node:crypto');
function moduleFor(file, mocks, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/pv', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => mocks[name], crypto: webcrypto, URL, Blob, TextEncoder, Uint8Array, btoa, atob, Date, console, ...globals });
  return exports;
}
test('email grant persists verifier; only its digest goes to start, exchange installs dedicated session', async () => {
  const saved = new Map(); const calls = []; let accepted;
  const auth = moduleFor('extensionAuth.ts', {
    '../localstorage': { getLocalOption: async key => saved.get(key), setLocalOption: async (key, v) => saved.set(key, v), removeLocalOption: async key => saved.delete(key) },
    './auth': { getApiBase: async () => 'https://app.permavault.xyz/api', getAppOrigin: async () => 'https://app.permavault.xyz', beginAuthAttempt: async () => 'generation', assertAuthGeneration: async () => {}, acceptEmailSession: async (...args) => { accepted = args; } },
  }, { fetch: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    return { ok: true, status: 200, json: async () => url.endsWith('/start')
      ? { id: 'grant', userCode: 'ABCD1234', approvalUrl: 'https://app.permavault.xyz/extension/approve?id=grant', expiresAt: new Date(Date.now()+60000).toISOString() }
      : { token: 'dedicated-session', user: { walletAddress: 'account' } } };
  } });
  const grant = await auth.startEmailGrant();
  assert.equal(calls[0].body.verifier, undefined);
  assert.equal(calls[0].body.challenge, createHash('sha256').update(grant.verifier).digest('base64url'));
  assert.equal((await auth.startEmailGrant()).verifier, grant.verifier);
  assert.equal(calls.length, 1);
  assert.equal(await auth.exchangeEmailGrant(), true);
  assert.deepEqual(accepted, ['dedicated-session', 'account', 'generation']);
  assert.equal(await auth.loadEmailGrant(), null);
});
test('email authorization rejects a foreign approval origin', async () => {
  const auth = moduleFor('extensionAuth.ts', {
    '../localstorage': { getLocalOption: async () => null, setLocalOption: async () => assert.fail('saved untrusted grant') },
    './auth': { getApiBase: async () => 'https://app.permavault.xyz/api', getAppOrigin: async () => 'https://app.permavault.xyz', beginAuthAttempt: async () => 'generation', assertAuthGeneration: async () => {} },
  }, { fetch: async () => ({ ok: true, json: async () => ({ id: 'g', userCode: 'ABCD1234', approvalUrl: 'https://evil.test/extension/approve', expiresAt: new Date(Date.now()+60000).toISOString() }) }) });
  await assert.rejects(auth.startEmailGrant(), /could not be verified/);
});
function large(fetch) {
  return moduleFor('largeCapture.ts', {
    './auth': { authFetch: fetch, getAppOrigin: async () => 'https://app.permavault.xyz' },
    'hash-wasm': { createSHA256: async () => { let h; return { init: () => { h = createHash('sha256'); }, update: b => h.update(b), digest: () => h.digest('hex') }; } },
  });
}
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
test('large upload resumes from server offset and retains exact request identity', async () => {
  const blob = new Blob(['12345678']); const calls = []; let persisted = 0;
  const state = { operationId: 'capture-op', checkoutOperationId: 'checkout-op', orderId: 'paid-order' };
  const api = large(async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/session')) return response(201, { sessionId: 'upload', jobId: 'job' });
    if (url.endsWith('/session/upload')) return response(200, { status: 'open', size: 8, offset: 4, chunkSize: 4 });
    if (url.includes('/chunk')) { assert.equal(await opts.body.text(), '5678'); return response(200, { offset: 8 }); }
    return response(202, { jobId: 'job' });
  });
  const result = await api.uploadLargeCapture({ blob, filename: 'page.wacz', sourceUrl: 'https://example.com' }, state, async () => { persisted++; }, () => {});
  const create = JSON.parse(calls[0].opts.body);
  assert.equal(create.operationId, 'capture-op');
  assert.equal(create.largeMediaOrderId, 'paid-order');
  assert.equal(create.captureOrigin, 'browser-extension');
  assert.equal(create.sha256, createHash('sha256').update('12345678').digest('hex'));
  assert.equal(result.json.jobId, 'job');
  assert.equal(state.sessionId, 'upload');
  assert.equal(persisted, 2);
});
test('lost chunk reply preserves same session and reads authoritative offset on retry', async () => {
  let attempt = 0; let puts = 0;
  const state = { operationId: 'op', checkoutOperationId: 'pay-op', sessionId: 'upload', jobId: 'job', sha256: 'a'.repeat(64) };
  const api = large(async url => {
    if (url.endsWith('/session/upload')) return response(200, { status: 'open', size: 4, offset: attempt ? 4 : 0, chunkSize: 4 });
    if (url.includes('/chunk')) { puts++; attempt++; throw new Error('connection lost'); }
    return response(202, { jobId: 'job' });
  });
  const capture = { blob: new Blob(['data']) };
  await assert.rejects(api.uploadLargeCapture(capture, state, async () => {}, () => {}), /connection lost/);
  assert.equal((await api.uploadLargeCapture(capture, state, async () => {}, () => {})).json.jobId, 'job');
  assert.equal(puts, 1);
  assert.equal(state.sessionId, 'upload');
});
test('large checkout reuses operation identity and validates redirect', async () => {
  let body;
  const api = large(async (_url, opts) => { body = JSON.parse(opts.body); return response(200, { url: 'https://evil.test', orderId: 'o', sessionId: 's', quote: { amountCents: 999 } }); });
  await assert.rejects(api.checkoutLargeCapture(200000000, { checkoutOperationId: 'stable-payment-op' }), /could not be verified/);
  assert.equal(body.operationId, 'stable-payment-op');
  assert.equal(body.fileSize, 200000000);
});

test('bound API request refuses another account before sending any bytes', async () => {
  const values = new Map([['pvToken','other-token'], ['pvWallet','other-account']]);
  const api = moduleFor('auth.ts', { '../localstorage': {
    getLocalOption: async key => values.get(key), setLocalOption: async (key, value) => values.set(key, value), removeLocalOption: async key => values.delete(key),
  } }, { Headers, fetch: async () => assert.fail('cross-account request sent') });
  await assert.rejects(api.authFetch('/archive/file', {}, false, 'capture-owner'), /account changed/);
});

test('email sign-in removes previous key-file fallback', async () => {
  const values = new Map([['pvJwk','old-key']]);
  const api = moduleFor('auth.ts', { '../localstorage': {
    getLocalOption: async key => values.get(key), setLocalOption: async (key, value) => values.set(key, value), removeLocalOption: async key => values.delete(key),
  } });
  await api.acceptEmailSession('new-token', 'email-account');
  assert.equal(values.has('pvJwk'), false);
  assert.equal(JSON.parse(values.get('pvSession')).walletAddress, 'email-account');
});

test('a late rotation reply does not revive a signed-out account', async () => {
  const values = new Map([['pvToken','old-token'], ['pvWallet','account']]);
  const api = moduleFor('auth.ts', { '../localstorage': {
    getLocalOption: async key => values.get(key), setLocalOption: async (key, value) => values.set(key, value), removeLocalOption: async key => values.delete(key),
  } }, { Headers, fetch: async () => { await api.signOut(); return { status: 200, headers: { get: () => 'rotated-token' } }; } });
  await assert.rejects(api.authFetch('/payments/balance', {}, false, 'account'), /Sign-in changed/);
  assert.equal(values.has('pvToken'), false);
});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const jwt = id => `x.${Buffer.from(JSON.stringify({ sessionId: id, exp: 9999999999 })).toString('base64url')}.x`;
function authHarness(fetch) {
  const values = new Map();
  const api = moduleFor('auth.ts', { '../localstorage': {
    getLocalOption: async k => values.get(k), setLocalOption: async (k, v) => values.set(k, v), removeLocalOption: async k => values.delete(k),
  } }, { Headers, fetch });
  return { api, values };
}
test('paid checkout replay accepts only the exact trusted session return', async () => {
  const state = { checkoutOperationId: 'same-op' };
  const make = url => large(async () => response(200, { url, orderId: 'order', sessionId: 'session', quote: { amountCents: 999 } }));
  const recovered = await make('https://app.permavault.xyz/purchase/success?session_id=session').checkoutLargeCapture(200000000, state);
  assert.equal(recovered.orderId, 'order');
  assert.equal(recovered.checkoutSessionId, 'session');
  for (const url of ['https://app.permavault.xyz/purchase/success?session_id=other', 'https://evil.test/purchase/success?session_id=session', 'https://app.permavault.xyz/purchase/success?session_id=session&next=evil']) {
    await assert.rejects(make(url).checkoutLargeCapture(200000000, state), /could not be verified/);
  }
});
test('pending JWK login cannot revive account after sign-out', async () => {
  const gate = deferred(), entered = deferred(); const revoked = [];
  const { api } = authHarness(async (url, opts) => {
    if (url.endsWith('/auth/logout')) { revoked.push(url); return response(204, {}); }
    if (url.endsWith('/challenge')) return response(200, { challengeToken: 'challenge' });
    entered.resolve(); await gate.promise;
    return response(200, { token: jwt('late'), walletAddress: 'old' });
  });
  const login = api.signInWithJwk({ kty: 'RSA' });
  await entered.promise; await api.signOut(); gate.resolve();
  await assert.rejects(login, /Sign-in changed/);
  assert.equal(await api.getStoredSession(), null);
  assert.equal(revoked.length, 1);
});
test('pending renewal cannot replace a newer email account', async () => {
  const gate = deferred(), entered = deferred();
  const { api, values } = authHarness(async (url, opts) => {
    if (url.endsWith('/auth/logout')) return response(204, {});
    if (url.endsWith('/challenge')) return response(200, { challengeToken: 'challenge' });
    if (url.endsWith('/jwk-login')) { entered.resolve(); await gate.promise; return response(200, { token: jwt('renewed'), walletAddress: 'old' }); }
    return { ...response(401, {}), headers: new Headers() };
  });
  values.set('pvToken', jwt('old')); values.set('pvWallet', 'old'); values.set('pvJwk', JSON.stringify({ kty: 'RSA' }));
  const request = api.authFetch('/payments/balance');
  await entered.promise; await api.acceptEmailSession(jwt('email'), 'email'); gate.resolve();
  await assert.rejects(request, /Sign-in changed/);
  assert.equal((await api.getStoredSession()).walletAddress, 'email');
  assert.equal((await api.getStoredSession()).jwk, undefined);
});
test('response body arriving after account switch cannot advance old operation', async () => {
  const gate = deferred();
  const { api } = authHarness(async () => ({ status: 200, headers: new Headers(), json: () => gate.promise }));
  await api.acceptEmailSession(jwt('old'), 'old');
  const res = await api.authFetch('/payments/balance'); const body = res.json();
  await api.acceptEmailSession(jwt('new'), 'new'); gate.resolve({ balance: 10 });
  await assert.rejects(body, /Sign-in changed/);
});
test('sign-out clears locally before its best-effort remote revocation completes', async () => {
  const gate = deferred(); let request;
  const { api } = authHarness(async (url, opts) => { request = { url, opts }; await gate.promise; return response(204, {}); });
  await api.acceptEmailSession(jwt('current'), 'account'); await api.signOut();
  assert.equal(await api.getStoredSession(), null);
  assert.match(request.url, /auth\/logout$/);
  assert.equal(request.opts.method, 'POST');
  assert.equal(request.opts.headers.Authorization, `Bearer ${jwt('current')}`);
  gate.resolve();
});
