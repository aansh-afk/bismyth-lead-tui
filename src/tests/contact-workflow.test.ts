import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import type {Key} from 'node:readline';
import {copyProject, createRun, defaults, project, recoverRun} from '../model.js';
import type {Run} from '../model.js';
import {Runner} from '../runner.js';
import type {Driver} from '../browser.js';
import {Store} from '../store.js';
import {FirecrawlConfigurationError} from '../firecrawl.js';
import {extractPublicContacts} from '../contacts.js';
import type {ContactCapture, PublicContact} from '../contacts.js';
import {TerminalApp} from '../tui.js';
import {renderView} from '../terminal-view.js';
import {contactsForRun} from '../outreach.js';
import {firecrawlKey, firecrawlKeyPath, saveFirecrawlKey} from '../credentials.js';
import {subscriptionEnvironment} from '../subscription.js';

const config = {...defaults, stateCode: 'MH', city: 'Mumbai', name: 'Private Supplied Name', phone: '9000000000', email: 'private-profile@example.test', sites: ['nobroker' as const], delayMs: 0};
function queued(size = 1): Run {
  const run = createRun(config);
  run.projects = Array.from({length: size}, (_, i) => project('nobroker', `Property ${i}`, `https://www.nobroker.in/property/buy/flat/${i}/detail`));
  return run;
}
function capture(url = queued().projects[0].url): ContactCapture {
  const contacts = extractPublicContacts({url, markdown: '# Listing\nOwner Example Seller: +91 98765 43210', observedAt: '2026-10-15T12:00:00.000Z'});
  assert.equal(contacts.length, 1);
  return {status: 'captured', attemptedAt: '2026-10-15T12:00:00.000Z', detail: 'Public contact found', contacts: contacts.map(contact => ({...contact, review: 'approved', role: 'owner'}))};
}
function driver(): Driver { return {discover: async () => { throw new Error('Discovery not needed'); }, prepare: async () => { throw new Error('No contact form should open'); }, submit: async () => { throw new Error('No enquiry should be sent'); }, confirmed: async () => false, close: async () => {}}; }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-contact-workflow-'));
  const store = new Store(directory); await store.init();
  return {store, close: () => rm(directory, {recursive: true, force: true})};
}

test('contact collection preserves submitted/uncertain/prepared enquiry states and never opens forms', async () => {
  const {store, close} = await fixture();
  try {
    const run = queued(3); run.projects[0].status = 'submitted'; run.projects[1].status = 'uncertain'; run.projects[2].status = 'prepared';
    const before = run.projects.map(item => item.status); let calls = 0;
    await new Runner(run, store, driver()).collectContacts({assertConfigured() {}, async capture(page) { calls++; return capture(page.url); }}, 2);
    assert.equal(calls, 2); assert.deepEqual(run.projects.map(item => item.status), before);
    assert.equal(run.projects[2].contactCapture, undefined);
    assert.equal((await store.load(run.id)).projects[0].contactCapture?.status, 'captured');
  } finally { await close(); }
});
test('missing key and invalid budgets fail before mutating a run or writing snapshots', async () => {
  const {store, close} = await fixture();
  try {
    const run = queued(); const before = structuredClone(run); const runner = new Runner(run, store, driver());
    await assert.rejects(runner.collectContacts({assertConfigured() { throw new FirecrawlConfigurationError('Missing key'); }, async capture() { throw new Error('Must not run'); }}), /Missing key/);
    assert.deepEqual(run, before); assert.equal(runner.active, false); assert.equal((await store.history()).length, 0);
    await assert.rejects(runner.collectContacts({assertConfigured() {}, async capture() { return capture(); }}, 301), /1–300/);
  } finally { await close(); }
});
test('provider credential/credit/rate limits stop the remaining batch without changing enquiry states', async () => {
  const {store, close} = await fixture();
  try {
    const run = queued(4); let requests = 0;
    await new Runner(run, store, driver()).collectContacts({assertConfigured() {}, async capture() { requests++; return {status: 'failed', attemptedAt: new Date().toISOString(), detail: 'Credits exhausted', contacts: [], stopBatch: true}; }}, 4);
    assert.equal(requests, 1); assert.equal(run.projects.filter(item => item.contactCapture).length, 1);
    assert.ok(run.projects.every(item => item.status === 'queued'));
  } finally { await close(); }
});
test('already collected pages are skipped without another credit-consuming request', async () => {
  const {store, close} = await fixture();
  try {
    const run = queued(3); run.projects[0].contactCapture = capture(); run.projects[1].contactCapture = {...capture(), status: 'not-found', contacts: []}; let calls = 0;
    await new Runner(run, store, driver()).collectContacts({assertConfigured() {}, async capture(page) { calls++; return capture(page.url); }}, 3);
    assert.equal(calls, 1);
  } finally { await close(); }
});
test('stop aborts the current public scrape, saves its status and prevents further requests', async () => {
  const {store, close} = await fixture();
  try {
    const run = queued(2); const runner = new Runner(run, store, driver()); let notify!: () => void;
    const begun = new Promise<void>(resolve => { notify = resolve; }); let calls = 0;
    const task = runner.collectContacts({assertConfigured() {}, async capture(_page, signal) {
      calls++; notify(); await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), {once: true})); return capture();
    }}, 2);
    await begun; await runner.stop(); await task;
    assert.equal(calls, 1); assert.equal(run.state, 'stopped'); assert.equal(run.projects[0].contactCapture?.status, 'failed'); assert.equal(run.projects[0].status, 'queued');
    assert.equal((await store.load(run.id)).state, 'stopped');
  } finally { await close(); }
});
test('pause gates the next contact request and resume continues without duplicating completed pages', async () => {
  const {store, close} = await fixture();
  try {
    const run = queued(2); const runner = new Runner(run, store, driver()); let calls = 0;
    const task = runner.collectContacts({assertConfigured() {}, async capture(page) { calls++; if (calls === 1) runner.pause(); return capture(page.url); }}, 2);
    while (!runner.paused) await setImmediate();
    await setImmediate(); assert.equal(calls, 1); runner.pause(); await task; assert.equal(calls, 2);
  } finally { await close(); }
});
test('copy and interruption recovery preserve public evidence separately from enquiry confirmation', () => {
  const run = queued(); run.projects[0].contactCapture = capture(); const copy = copyProject(run.projects[0]);
  assert.deepEqual(copy.contactCapture, run.projects[0].contactCapture); copy.contactCapture!.contacts[0].evidence = 'copy only';
  assert.notEqual(copy.contactCapture!.contacts[0].evidence, run.projects[0].contactCapture!.contacts[0].evidence);
  run.state = 'enriching'; run.projects[0].contactCapture!.status = 'working'; run.projects[0].status = 'submitted'; recoverRun(run);
  assert.equal(run.state, 'stopped'); assert.equal(run.projects[0].status, 'submitted'); assert.equal(run.projects[0].contactCapture!.status, 'failed');
});
test('contact exports deduplicate sources and exclude the supplied profile and secrets', async () => {
  const {store, close} = await fixture();
  try {
    const run = queued(2); run.projects.forEach(item => { item.contactCapture = capture(item.url); });
    const contacts = contactsForRun(run); assert.equal(contacts.length, 1); assert.equal(contacts[0].attributions!.length, 2);
    const path = await store.exportContacts(run, 'json'); const text = await readFile(path, 'utf8'); const body = JSON.parse(text);
    assert.equal(body.contacts.length, 1); assert.equal(body.contacts[0].listings.length, 2);
    for (const privateValue of [config.name, config.phone, config.email, 'FIRECRAWL_API_KEY', 'apiKey']) assert.equal(text.includes(privateValue), false);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    run.projects[0].contactCapture!.contacts[0].name = '=untrusted';
    const csv = await readFile(await store.exportContacts(run, 'csv'), 'utf8'); assert.ok(csv.includes('"\'=untrusted"')); assert.ok(csv.includes('"\'+919876543210"'));
  } finally { await close(); }
});
test('credential storage is private and independent from saved configuration', async () => {
  const {store, close} = await fixture(); const previous = process.env.FIRECRAWL_API_KEY; delete process.env.FIRECRAWL_API_KEY;
  try {
    assert.equal(await firecrawlKey(store.directory), undefined); await store.saveConfig(config);
    const before = await readFile(join(store.directory, 'config.json'), 'utf8');
    await saveFirecrawlKey(store.directory, 'fixture-private-key'); assert.equal(await firecrawlKey(store.directory), 'fixture-private-key');
    assert.equal((await stat(firecrawlKeyPath(store.directory))).mode & 0o777, 0o600);
    assert.equal(await readFile(join(store.directory, 'config.json'), 'utf8'), before);
  } finally { if (previous === undefined) delete process.env.FIRECRAWL_API_KEY; else process.env.FIRECRAWL_API_KEY = previous; await close(); }
});
test('Firecrawl and router secrets are excluded from the Codex child environment', () => {
  const keys = ['FIRECRAWL_API_KEY', 'BISMYTH_WHATSAPP_ROUTER_API_KEY']; const previous = keys.map(key => process.env[key]);
  try { keys.forEach(key => { process.env[key] = 'fixture-not-real'; }); const child = subscriptionEnvironment(); keys.forEach(key => assert.equal(child[key], undefined)); }
  finally { keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; }); }
});

interface Controller {
  screen: number; selected: number[]; current?: Run; captureReview?: number; contactReview?: {contacts: PublicContact[]; choice: number};
  busy: boolean; notice: string; render: () => void; task?: Promise<void>; launchContacts: (limit: number) => Promise<void>;
  launchOutreach: (action: string, contacts: PublicContact[]) => Promise<void>; keypress: (text: string | undefined, key: Key) => void;
}
function press(app: Controller, key: string, text = key.length === 1 ? key : undefined): void { app.keypress(text, {name: key}); }
test('H reviews a bounded collection budget and Enter starts it without a browser-login gate', async () => {
  const {store, close} = await fixture();
  try {
    const app = new TerminalApp(config, store) as unknown as Controller; app.render = () => {}; app.current = queued(20); app.screen = 1;
    const budgets: number[] = []; app.launchContacts = async n => { budgets.push(n); };
    press(app, 'h'); assert.equal(app.captureReview, 10); assert.equal(budgets.length, 0);
    press(app, 'down'); assert.equal(app.captureReview, 11); press(app, 'return'); await setImmediate(); assert.deepEqual(budgets, [11]);
    press(app, '5'); assert.equal(app.screen, 4); press(app, 'tab'); assert.equal(app.screen, 0);
  } finally { await close(); }
});
test('contact review defaults to dry run; explicit second choice is the only live-send route', async () => {
  const {store, close} = await fixture();
  try {
    const app = new TerminalApp(config, store) as unknown as Controller; app.render = () => {}; app.current = queued(); app.current.projects[0].contactCapture = capture(); app.screen = 4;
    const calls: string[] = []; app.launchOutreach = async action => { calls.push(action); };
    press(app, 'return'); assert.equal(app.contactReview?.choice, 0); press(app, 'return'); await setImmediate(); assert.deepEqual(calls, ['preview']);
    press(app, 'return'); press(app, 'down'); press(app, 'return'); await setImmediate(); assert.deepEqual(calls, ['preview', 'send']);
  } finally { await close(); }
});
test('unapproved candidates require explicit operator attribution before WhatsApp review', async () => {
  const {store, close} = await fixture();
  try {
    const app = new TerminalApp(config, store) as unknown as Controller; app.render = () => {}; app.current = queued();
    app.current.projects[0].contactCapture = capture(); app.current.projects[0].contactCapture!.contacts[0].review = 'needs-review'; app.screen = 4;
    press(app, 'return'); assert.equal(app.contactReview, undefined); assert.match(app.notice, /approved phone/);
    press(app, 'a'); for (let i = 0; i < 1000 && app.busy; i++) await setImmediate();
    assert.equal(app.busy, false);
    assert.equal(app.current.projects[0].contactCapture!.contacts[0].reviewedBy, 'operator');
  } finally { await close(); }
});
test('Contacts and active collection render at supported sizes without enquiry-send labels or terminal injection', () => {
  const run = queued(); run.projects[0].contactCapture = capture(); run.projects[0].contactCapture!.contacts[0].name = '\x1b[2JUntrusted';
  for (const [width, height] of [[70, 22], [80, 24], [100, 30], [180, 40]]) {
    const view = {width, height, screen: 4, selected: [0, 0, 0, 0, 0], config, run, history: [], fields: [], advanced: false, notice: '', help: false, handoff: '', active: false, auth: 'ChatGPT subscription connected', contacts: contactsForRun(run), firecrawlStatus: 'Key configured', routerStatus: 'Not configured'};
    const output = renderView(view); assert.ok(output.includes('Public contacts')); assert.ok(output.includes('+919876543210')); assert.equal(output.includes('\x1b[2J'), false);
    assert.ok(output.split('\r\n').length <= height);
    const active = renderView({...view, screen: 2, active: true, run: {...run, state: 'enriching'}});
    assert.ok(active.includes('Collecting contacts')); assert.equal(active.includes('Sending enquiries'), false);
  }
});
