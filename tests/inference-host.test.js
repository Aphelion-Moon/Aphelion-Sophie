import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registeredAiWorker, registeredAiWorkerIdentity } from '../apps/inference-host/worker-registration.js';
import { prepareAiWorkerBoot } from '../apps/inference-host/bootstrap.js';
import { createAiServiceControl } from '../apps/inference-host/service-control.js';
import { createAiWorkerSlot } from '../apps/inference-host/slot.js';
import { createAiSupervisorWorkerSlot } from '../apps/inference-host/worker-slot.js';
import { createAiSupervisorControlService } from '../apps/inference-host/control.js';
import { createAiControlClient } from '../apps/ai-control/client.js';
import { aiControlScope } from '../apps/ai-control/contract.js';
import { createDeepSeekClient } from '../apps/knowledge-worker/deepseek-client.js';
import { createServer as createNetServer } from 'node:net';
// The installed supervisor may already hold the default control port on this host.
const port=await new Promise((resolve,reject)=>{const probe=createNetServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});});


const native={skip:process.platform!=='win32',timeout:15000};
const hash=()=>createHash('sha256').update(randomBytes(32)).digest('hex');
const acceptedFingerprints=['synthetic-inference-host'],apiKey='synthetic-inference-host-provider-key';
const profileHash=createDeepSeekClient({apiKey,acceptedFingerprints}).profileHash;
const release=()=>({name:'synthetic-release',workerId:hash(),releaseHash:hash(),profileHash,provider:'deepseek',domain:'public',evidenceHash:hash()});
const identity=rel=>({workerId:rel.workerId,bootId:hash(),releaseHash:rel.releaseHash,profileHash:rel.profileHash,provider:rel.provider,domain:rel.domain});
async function until(check,ms=3000){const deadline=Date.now()+ms;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('CONDITION_TIMEOUT');}
async function job(client,command,body) {
  const accepted=await client.request(command,body);let state;
  await until(async()=>{state=await client.request('inspect');return state.job?.id===accepted.job.id && state.job.state!=='running';});
  assert.equal(state.job.state,'complete');return state;
}

test('worker-registration rejects overlapping boot/provider/trust directories and cross-release identities', () => {
  const base = { installationId: hash(), serviceName: 'aphelion-bot-ai-worker', bootRoot: 'C:\\Aphelion\\Sophie\\state\\boots',
    providerDirectory: 'C:\\Aphelion\\Sophie\\provider', release: release() };
  assert.doesNotThrow(() => registeredAiWorker(base));
  assert.throws(() => registeredAiWorker({ ...base, providerDirectory: base.bootRoot }), /AI_WORKER_REGISTRATION_INVALID/);
  assert.throws(() => registeredAiWorker({ ...base, providerDirectory: `${base.bootRoot}\\nested` }), /AI_WORKER_REGISTRATION_INVALID/);
  assert.throws(() => registeredAiWorker({ ...base, trustDirectory: base.providerDirectory }), /AI_WORKER_REGISTRATION_INVALID/);
  assert.throws(() => registeredAiWorker({ ...base, serviceName: 'a' }), /AI_WORKER_REGISTRATION_INVALID/);
  const registered = registeredAiWorker(base), fixed = identity(base.release);
  assert.deepEqual(registeredAiWorkerIdentity(registered, fixed), fixed);
  assert.throws(() => registeredAiWorkerIdentity(registered, { ...fixed, releaseHash: hash() }), /AI_WORKER_SCOPE_INVALID/);
});

async function bootFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sophie-inference-host-'));
  const bootRoot = join(root, 'boots'), providerDirectory = join(root, 'provider');
  await Promise.all([bootRoot, providerDirectory].map(path => mkdir(path)));
  const rel = release(), registration = { installationId: hash(), serviceName: 'aphelion-bot-ai-worker', bootRoot, providerDirectory, release: rel };
  return { root, registration, rel, async close() { await rm(root, { recursive: true, force: true }); } };
}

test('bootstrap publishes distinct ipc/lease keys and revokes both files without reuse', async () => {
  const f = await bootFixture();
  try {
    const fixed = identity(f.rel);
    const boot = await prepareAiWorkerBoot({ registration: f.registration, identity: fixed, acceptedFingerprints, qualified: async () => true });
    const bootPath = join(f.registration.bootRoot, fixed.bootId, 'boot.json');
    const stored = JSON.parse(await readFile(bootPath, 'utf8'));
    assert.notEqual(stored.ipcKey, stored.leaseKey);
    assert.equal(Object.hasOwn(stored, 'egressKey'), false);
    const grant = boot.channel('inference');
    assert.equal(grant.key.toString('hex'), stored.ipcKey);
    assert.throws(() => boot.channel('egress'), /AI_BOOT_PUBLICATION_REVOKED/);
    await boot.revoke();
    await assert.rejects(access(bootPath), { code: 'ENOENT' });
  } finally { await f.close(); }
});

function mockService({ registered = true, stuck = false } = {}) {
  let state = registered ? 'STOPPED' : null;
  const calls = [];
  async function run(_command, args) {
    calls.push(args.join(' '));
    const verb = args[0];
    if (verb === 'query') return state === null ? { code: 1060, stdout: '' } : { code: 0, stdout: `STATE              : 4  ${state}` };
    if (verb === 'start') { if (state === null) return { code: 1060, stdout: '' }; if (state !== 'STOPPED') return { code: 1056, stdout: '' }; state = 'RUNNING'; return { code: 0, stdout: '' }; }
    if (verb === 'stop') { if (state === 'STOPPED') return { code: 1062, stdout: '' }; if (!stuck) state = 'STOPPED'; return { code: 0, stdout: '' }; }
    throw Error(`unexpected sc.exe invocation: ${args.join(' ')}`);
  }
  return { run, calls, setState: value => { state = value; }, getState: () => state };
}

test('DS04-I01 service control starts, waits for RUNNING and stops back to STOPPED', native, async () => {
  const f = await bootFixture(), service = mockService({ registered: false });
  try {
    const control = createAiServiceControl({ registration: f.registration, run: service.run });
    assert.equal(await control.inspect(), null);
    assert.equal(await control.qualified(), false);
    await assert.rejects(control.create(), /AI_SERVICE_NOT_REGISTERED/);
    service.setState('STOPPED'); // the operator's one-time setup script has now registered the service
    assert.deepEqual(await control.create(), { id: 'aphelion-bot-ai-worker' });
    await control.start();
    assert.deepEqual(await control.inspect(), { running: true });
    const receipt = await control.remove();
    assert.equal(receipt.removed, true);
    assert.equal(await control.inspect(), null);
    assert.equal(await control.qualified(), true);
  } finally { await f.close(); }
});

test('DS04-I01b service control never reports an unconfirmed stop or adopts an already running worker', native, async () => {
  const f = await bootFixture(), service = mockService({ stuck: true });
  try {
    const control = createAiServiceControl({ registration: f.registration, run: service.run, timeoutMs: 300 });
    service.setState('RUNNING');
    await assert.rejects(control.create(), /AI_SERVICE_NOT_STOPPED/);
    await assert.rejects(control.start(), /AI_SERVICE_START_FAILED/);
    await assert.rejects(control.remove(), /AI_SERVICE_OPERATION_TIMEOUT/);
    const slot = createAiWorkerSlot({ registration: f.registration, service: control });
    await assert.rejects(slot.quiesce(), /AI_SUPERVISOR_STOP_UNCONFIRMED|AI_SERVICE_OPERATION_TIMEOUT/);
    assert.equal(slot.status().recovered, false);
    assert.throws(() => slot.prepare({ revision: 0, identity: identity(f.rel), operationId: randomUUID() }), /AI_SUPERVISOR_NOT_READY/);
  } finally { await f.close(); }
});

test('DS04-I01c recovery removes every leftover boot entry so the worker sees exactly one published boot', native, async () => {
  const f = await bootFixture(), service = mockService();
  try {
    await mkdir(join(f.registration.bootRoot, hash()));
    await writeFile(join(f.registration.bootRoot, 'stray.tmp'), 'x');
    const slot = createAiWorkerSlot({ registration: f.registration, service: createAiServiceControl({ registration: f.registration, run: service.run }) });
    await slot.quiesce();
    assert.deepEqual(await readdir(f.registration.bootRoot), []);
  } finally { await f.close(); }
});

test('DS04-I02 slot rejects stale revisions and recovery stops a service left running by a prior crash', native, async () => {
  const f = await bootFixture(), service = mockService();
  service.setState('RUNNING'); // simulates a worker left running by a supervisor that crashed mid-operation
  try {
    const control = createAiServiceControl({ registration: f.registration, run: service.run });
    const slot = createAiWorkerSlot({ registration: f.registration, service: control });
    assert.equal(slot.status().recovered, false);
    await slot.quiesce(); // recovery: no identity is known, so any running service is presumed stale and stopped
    assert.equal(slot.status().recovered, true);
    assert.equal(service.getState(), 'STOPPED');
    const fixed = identity(f.rel), operationId = randomUUID();
    await slot.prepare({ revision: 0, identity: fixed, operationId });
    await assert.rejects(slot.prepare({ revision: 0, identity: fixed, operationId: randomUUID() }), /AI_SUPERVISOR_REVISION_STALE/);
    const created = await slot.create({ revision: 1 });
    assert.equal(created.phase, 'created');
    const running = await slot.start({ revision: created.revision, beforeStart: async () => true });
    assert.equal(running.phase, 'running');
    assert.equal(service.getState(), 'RUNNING');
    const stopped = await slot.quiesce();
    assert.equal(stopped.phase, 'empty');
    assert.equal(service.getState(), 'STOPPED');
  } finally { await f.close(); }
});

test('DS04-I03 core control composes prepare/create/start/quiesce through the authenticated channel', native, async t => {
  const f = await bootFixture(), service = mockService();
  const installationId = f.registration.installationId, keySet = { core: randomBytes(32) };
  const control = createAiServiceControl({ registration: f.registration, run: service.run });
  const durable = createAiWorkerSlot({ registration: f.registration, service: control });
  const revocation = new AbortController();
  const slot = createAiSupervisorWorkerSlot({ registration: f.registration, slot: durable, acceptedFingerprints,
    qualified: async () => true, revocationSignal: revocation.signal, onFault: () => {} });
  const server = createAiSupervisorControlService({ port, installationId, keys: keySet, qualified: async () => true, slot,
    beforeStart: async () => true, revocationSignal: revocation.signal, onFault: () => {} });
  const client = createAiControlClient({port, installationId, role: 'core', key: keySet.core, revocationSignal: new AbortController().signal });
  t.after(async () => { revocation.abort(); await client.stop(); await server.stop(); await f.close(); });
  await server.start();
  await until(async () => (await client.request('inspect')).recovered);
  const fixed = identity(f.rel), operationId = randomUUID();
  let state = await client.request('inspect');
  await job(client, 'prepare', { revision: state.revision, operationId, identity: fixed });
  await client.request('channel', { operationId, identity: fixed });
  await client.request('ready', { operationId, identity: fixed });
  state = await client.request('inspect');
  assert.deepEqual(state.readiness, { core: true });
  state = (await job(client, 'create', { revision: state.revision, operationId }));
  assert.equal(state.phase, 'created');
  state = await job(client, 'start', { revision: state.revision, operationId });
  assert.equal(state.phase, 'running');
  assert.equal(service.getState(), 'RUNNING');
  state = await job(client, 'quiesce', { revision: state.revision, operationId: randomUUID() });
  assert.equal(state.phase, 'empty');
  assert.equal(service.getState(), 'STOPPED');
});

test('DS04-I04 a non-core role is rejected before it can even address the control channel', () => {
  assert.throws(() => aiControlScope(hash(), 'egress'), /AI_CONTROL_CONFIGURATION_INVALID/);
  assert.doesNotThrow(() => aiControlScope(hash(), 'core'));
});

test('DS04-I05 an unapproved job command and a stale-revision retry are denied before touching the service', native, async t => {
  const f = await bootFixture(), service = mockService();
  const installationId = f.registration.installationId, keySet = { core: randomBytes(32) };
  const control = createAiServiceControl({ registration: f.registration, run: service.run });
  const durable = createAiWorkerSlot({ registration: f.registration, service: control });
  const revocation = new AbortController();
  const slot = createAiSupervisorWorkerSlot({ registration: f.registration, slot: durable, acceptedFingerprints,
    qualified: async () => true, revocationSignal: revocation.signal, onFault: () => {} });
  const server = createAiSupervisorControlService({ port, installationId, keys: keySet, qualified: async () => true, slot,
    beforeStart: async () => true, revocationSignal: revocation.signal, onFault: () => {} });
  const client = createAiControlClient({port, installationId, role: 'core', key: keySet.core, revocationSignal: new AbortController().signal });
  t.after(async () => { revocation.abort(); await client.stop(); await server.stop(); await f.close(); });
  await server.start();
  await until(async () => (await client.request('inspect')).recovered);
  service.calls.length = 0; // drop the startup recovery's own query, so only this test's calls are counted below
  await assert.rejects(client.request('start', { revision: 0, operationId: randomUUID() }), /AI_CONTROL_STALE/);
  const fixed = identity(f.rel), operationId = randomUUID();
  await job(client, 'prepare', { revision: 0, operationId, identity: fixed });
  await assert.rejects(client.request('prepare', { revision: 0, operationId: randomUUID(), identity: fixed }), /AI_CONTROL_STALE/);
  assert.equal(service.calls.length, 0); // prepare never touches the service; only create/start/quiesce do
});
