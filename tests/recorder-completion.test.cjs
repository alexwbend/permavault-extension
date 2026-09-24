const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');
const exportsForRecorder = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/recorder.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsForRecorder, require: () => ({}), TextEncoder, clearInterval, console });
const { Recorder } = exportsForRecorder;
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function recorder(commitPage, drain) {
  const r = Object.create(Recorder.prototype);
  Object.assign(r, { running: true, stopping: false, pageInfo: { url: 'https://example.test' },
    flushPending() {}, commitPage, doUpdateLoop: drain, _doStop() { this.finalStatus = this.getStatusMsg(); } });
  return r;
}
for (const existingDrain of [false, true]) {
  test(`completion stays pending through commit and ${existingDrain ? 'existing' : 'new'} drain`, async () => {
    const commit = deferred(), drain = deferred(), reachedDrain = deferred();
    const r = recorder(() => commit.promise, () => { reachedDrain.resolve(); return drain.promise; });
    if (existingDrain) { r._cleaningUp = true; r._cleanupStaleWait = drain.promise; }
    const stopping = r._stop();
    assert.equal(r.getStatusMsg().stopping, true);
    assert.equal(r.getStatusMsg().recording, false);
    assert.equal(r.finalStatus, undefined);
    commit.resolve();
    if (!existingDrain) await reachedDrain.promise;
    else await Promise.resolve();
    assert.equal(r.getStatusMsg().stopping, true);
    assert.equal(r.finalStatus, undefined);
    drain.resolve(); await stopping;
    assert.equal(r.finalStatus.stopping, false);
    assert.equal(r.finalStatus.recording, false);
  });
}
for (const stage of ['commit', 'drain']) {
  test(`${stage} failure never emits successful final status`, async () => {
    const fail = () => { throw new Error('storage failed'); };
    const r = recorder(stage === 'commit' ? fail : async () => {}, stage === 'drain' ? fail : async () => {});
    await assert.rejects(r._stop(), /storage failed/);
    assert.equal(r.stopping, true);
    assert.equal(r.finalStatus, undefined);
  });
}
