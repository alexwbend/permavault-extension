const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto, createHash } = require('node:crypto');

async function articleModule(fetch) {
  const age = await import('age-encryption');
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/pv/privateArticle.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(compiled.outputText, {
    exports, require: name => name === 'age-encryption' ? age : { authFetch: fetch },
    crypto: webcrypto, Blob, File, FormData, TextEncoder, Uint8Array, Date, btoa,
  });
  return { api: exports, age };
}

const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

test('private article locks exact WACZ, sealed manifest and blinded anchor before staging', async () => {
  const calls = [];
  const { api, age } = await articleModule(async (url, init, _retried, account) => {
    calls.push({ url, init, account });
    if (url === '/vault/recipient') return response(200, { vault: { id: 'vault-1', recipient, formatVersion: 1 } });
    return response(202, { jobId: 'private-job' });
  });
  const identity = await age.generateIdentity();
  const recipient = await age.identityToRecipient(identity);
  const vault = await api.getPrivateVault('owner');
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
  const locked = await api.lockArticle(new Blob([bytes], { type: 'application/wacz' }), vault);
  const decrypter = new age.Decrypter();
  decrypter.addIdentity(identity);
  const original = await decrypter.decrypt(new Uint8Array(await locked.blob.arrayBuffer()), 'uint8array');
  assert.deepEqual(Array.from(original), Array.from(bytes));
  const manifestBytes = await decrypter.decrypt(Uint8Array.from(atob(locked.sealedManifest), c => c.charCodeAt(0)), 'uint8array');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  assert.equal(manifest.schemaVersion, 'private-1.0');
  assert.equal(manifest.files[0].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(manifest.files[0].sizeBytes, bytes.length);
  assert.equal(manifest.mimeType, 'application/wacz');
  const blinded = createHash('sha256').update(Buffer.from(manifest.privacyNonce, 'hex')).update(manifestBytes).digest('hex');
  assert.equal(locked.anchorSha256, blinded);

  const result = await api.stagePrivateArticle(locked, 'owner');
  assert.equal(result.status, 202);
  const sent = calls.find(call => call.url === '/archive/file');
  assert.equal(sent.account, 'owner');
  const form = sent.init.body;
  assert.equal(form.get('visibility'), 'private');
  assert.equal(form.get('privateArticleSave'), 'true');
  assert.equal(form.get('contentTypeOriginal'), 'application/wacz');
  assert.equal(form.get('plaintextSize'), String(bytes.length));
  assert.equal(form.get('anchorSha256'), blinded);
  assert.equal(form.get('operationId'), locked.operationId);
  assert.equal(form.get('sourceUrl'), null);
  assert.equal(form.get('screenshot'), null);
  assert.equal(form.get('plaintextSha256'), null);
  assert.match(form.get('file').name, /^private-article-[\w-]+\.age$/);
  assert.equal(form.get('file').type, 'application/octet-stream');
});

test('private article refuses invalid, oversized and replaced-vault captures without sending bytes', async () => {
  const age = await import('age-encryption');
  const identity = await age.generateIdentity();
  const recipient = await age.identityToRecipient(identity);
  let sent = 0;
  const { api } = await articleModule(async url => {
    if (url === '/vault/recipient') return response(200, { vault: { id: 'vault-2', recipient, formatVersion: 1 } });
    sent++;
    return response(202, {});
  });
  await assert.rejects(api.lockArticle(new Blob([new Uint8Array([1,2,3,4])]), { id: 'vault-1', recipient, formatVersion: 1 }), /not a valid WACZ/);
  await assert.rejects(api.lockArticle(new Blob([new Uint8Array(api.ARTICLE_BYTES + 1)]), { id: 'vault-1', recipient, formatVersion: 1 }), /up to 10 MB/);
  await assert.rejects(api.stagePrivateArticle({ blob: new Blob(['age']), filename: 'private.age', vaultId: 'vault-1', recipient, plaintextSize: 4, sealedManifest: 'sealed', anchorSha256: 'a'.repeat(64), operationId: 'same-operation' }, 'owner'), /Vault changed/);
  assert.equal(sent, 0);
});
