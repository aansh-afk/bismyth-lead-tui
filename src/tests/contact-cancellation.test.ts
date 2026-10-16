import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../tui.js';
import {Runner} from '../runner.js';
import {Store} from '../store.js';
import {createRun, defaults, project} from '../model.js';
import type {Run} from '../model.js';
import type {PublicContact} from '../contacts.js';
import {saveFirecrawlKey} from '../credentials.js';

interface Controller {
  closing: boolean; current?: Run; runner?: Runner; task?: Promise<void>; render: () => void;
  launchContacts(limit: number): Promise<void>;
  launchOutreach(action: 'send', contacts: PublicContact[]): Promise<void>;
}
function deferred(): {promise: Promise<void>; resolve: () => void} {
  let resolve!: () => void;
  return {promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve()};
}
async function fixture(t: TestContext, options: {savedKey?: boolean; blockClose?: boolean} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-contact-cancel-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const settings: Record<string, string> = {
    FIRECRAWL_API_KEY: 'fixture-not-a-real-firecrawl-key', BISMYTH_FIRECRAWL_URL: 'https://api.firecrawl.dev',
    BISMYTH_WHATSAPP_ROUTER_URL: 'https://router.example', BISMYTH_WHATSAPP_ROUTER_API_KEY: 'fixture-not-a-real-router-key',
    BISMYTH_WHATSAPP_SESSION_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };
  for (const [name, value] of Object.entries(settings)) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  if (options.savedKey) { delete process.env.FIRECRAWL_API_KEY; await saveFirecrawlKey(directory, settings.FIRECRAWL_API_KEY); }
  const store = new Store(directory); await store.init();
  const config = {...structuredClone(defaults), stateCode: 'MH', city: 'Mumbai', name: 'Fixture Sender', email: 'fixture@example.test', phone: '9000000000'};
  const run = createRun(config); run.projects = [project('nobroker', 'Fixture listing', 'https://www.nobroker.in/property/buy/fixture/detail')];
  const closeStarted = deferred(); const releaseClose = deferred(); let closes = 0;
  const app = new TerminalApp(config, store, {
    open: async () => { throw new Error('Browser login must not open.'); },
    check: async () => { throw new Error('Browser login must not be checked.'); },
    close: async () => { closes++; closeStarted.resolve(); if (options.blockClose) await releaseClose.promise; },
  }) as unknown as Controller;
  app.current = run; app.render = () => {};
  let collections = 0; let workflows = 0;
  // Instrument the job boundary, so a broken guard fails without calling Firecrawl,
  // a WhatsApp endpoint, Codex or Chrome. These are not transport-success fixtures.
  t.mock.method(Runner.prototype, 'collectContacts', async () => { collections++; });
  t.mock.method(Runner.prototype, 'workflow', async () => { workflows++; });
  return {app, run, store, closeStarted, releaseClose, calls: () => ({closes, collections, workflows})};
}

test('quitting while the saved Firecrawl key is being read prevents browser closing and job creation', async t => {
  const {app, run, store, calls} = await fixture(t, {savedKey: true});
  const before = structuredClone(run);
  const pending = app.launchContacts(1);
  // shutdown() sets this flag synchronously before waiting for existing tasks.
  // Simulate that boundary without entering raw terminal mode in this unit test.
  app.closing = true;
  await pending;
  assert.deepEqual(calls(), {closes: 0, collections: 0, workflows: 0});
  assert.equal(app.runner, undefined); assert.equal(app.task, undefined);
  assert.deepEqual(run, before); assert.equal((await store.history()).length, 0);
});

test('quitting during account-browser closure prevents a later Firecrawl job from starting', async t => {
  const {app, run, store, closeStarted, releaseClose, calls} = await fixture(t, {blockClose: true});
  const before = structuredClone(run);
  const pending = app.launchContacts(1);
  await closeStarted.promise;
  app.closing = true; releaseClose.resolve();
  await pending;
  assert.deepEqual(calls(), {closes: 1, collections: 0, workflows: 0});
  assert.equal(app.runner, undefined); assert.equal(app.task, undefined);
  assert.deepEqual(run, before); assert.equal((await store.history()).length, 0);
});

test('quitting during account-browser closure prevents a confirmed WhatsApp task from starting afterward', async t => {
  const {app, run, store, closeStarted, releaseClose, calls} = await fixture(t, {blockClose: true});
  const before = structuredClone(run);
  const pending = app.launchOutreach('send', []);
  await closeStarted.promise;
  app.closing = true; releaseClose.resolve();
  await pending;
  assert.deepEqual(calls(), {closes: 1, collections: 0, workflows: 0});
  assert.equal(app.runner, undefined); assert.equal(app.task, undefined);
  assert.deepEqual(run, before); assert.equal((await store.history()).length, 0);
  assert.equal((await store.outreach()).entries.length, 0);
});

test('a closed app rejects queued collection and WhatsApp launches before setup begins', async t => {
  const {app, calls} = await fixture(t);
  app.closing = true; app.current = undefined;
  await app.launchContacts(1); await app.launchOutreach('send', []);
  assert.deepEqual(calls(), {closes: 0, collections: 0, workflows: 0});
  assert.equal(app.runner, undefined); assert.equal(app.task, undefined);
});

test('an open app can still start collection and a WhatsApp workflow after setup finishes', async t => {
  const {app, calls} = await fixture(t);
  await app.launchContacts(1); await app.task;
  assert.deepEqual(calls(), {closes: 1, collections: 1, workflows: 0});
  await app.launchOutreach('send', []); await app.task;
  assert.deepEqual(calls(), {closes: 2, collections: 1, workflows: 1});
});
