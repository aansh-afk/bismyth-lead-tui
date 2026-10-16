import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import type {Driver} from '../browser.js';
import {extractBrowserContacts, extractPublicContacts} from '../contacts.js';
import type {ContactCapture} from '../contacts.js';
import {createRun, defaults, project} from '../model.js';
import {Runner} from '../runner.js';
import {Store} from '../store.js';

const listingUrl = 'https://www.nobroker.in/property/buy/flat/fixture/detail';
const config = {...structuredClone(defaults), stateCode: 'MH', city: 'Mumbai', name: 'Fixture Operator', email: 'operator@example.test', phone: '+919000000000', sites: ['nobroker' as const], delayMs: 0};
const observedAt = '2026-10-16T12:00:00.000Z';
const seller = '+919876543210';
function run(mode: 'preview' | 'submit' = 'submit') {
  const result = createRun({...config, mode}); result.projects = [project('nobroker', 'Fixture property', listingUrl)]; return result;
}
function capture(): ContactCapture {
  return {status: 'captured', attemptedAt: observedAt, detail: 'Matched portal contact.', collectionMethod: 'playwright',
    contacts: extractBrowserContacts({url: 'https://www.nobroker.in/profile/myContacts', listingUrl, visibility: 'authenticated', markdown: `Listing phone: ${seller}`, observedAt})};
}
function driver(overrides: Partial<Driver> = {}): Driver {
  return {discover: async () => { throw new Error('Discovery must not run.'); },
    prepare: async () => ({ready: true, reason: '', baseline: []}), submit: async () => true, confirmed: async () => true,
    close: async () => {}, ...overrides};
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-portal-capture-'));
  return {store: new Store(directory), close: () => rm(directory, {recursive: true, force: true})};
}

test('a confirmed enquiry captures listing contact evidence afterward and persists both independent results', async () => {
  const {store, close} = await fixture();
  try {
    const current = run(); const order: string[] = [];
    const runner = new Runner(current, store, driver({
      submit: async () => { order.push('submit'); return true; }, confirmed: async () => { order.push('confirmed'); return true; },
      captureContacts: async item => { order.push('capture'); assert.equal(item.status, 'submitted'); return capture(); },
    }));
    await runner.process(); assert.deepEqual(order, ['submit', 'confirmed', 'capture']);
    assert.equal(current.projects[0]!.status, 'submitted'); assert.equal(current.projects[0]!.contactCapture?.status, 'captured');
    assert.equal(current.projects[0]!.contactCapture?.collectionMethod, 'playwright');
    const loaded = await store.load(current.id); assert.equal(loaded.projects[0]!.status, 'submitted');
    assert.equal(loaded.projects[0]!.contactCapture!.contacts[0]!.visibility, 'authenticated');
    assert.equal(loaded.projects[0]!.contactCapture!.contacts[0]!.value, seller);
  } finally { await close(); }
});

test('preview prepares the callback or visit without submitting or reading private contacts', async () => {
  const {store, close} = await fixture();
  try {
    const current = run('preview'); let submitted = 0; let captures = 0;
    await new Runner(current, store, driver({prepare: async () => ({ready: true, reason: '', baseline: [], actionKind: 'visit-booking', summary: 'Latest available slot'}),
      submit: async () => { submitted++; return true; }, captureContacts: async () => { captures++; return capture(); }})).process();
    assert.equal(submitted, 0); assert.equal(captures, 0); assert.equal(current.projects[0]!.status, 'prepared');
    assert.equal(current.projects[0]!.contactCapture, undefined); assert.match(current.projects[0]!.detail, /not clicked/);
  } finally { await close(); }
});

test('unconfirmed outcomes and stale success baselines never trigger account contact capture', {timeout: 10000}, async () => {
  const {store, close} = await fixture();
  try {
    const current = run(); let captures = 0;
    const runner = new Runner(current, store, driver({prepare: async () => ({ready: true, reason: '', baseline: ['Thank you for your enquiry.']}),
      confirmed: async (_item, baseline) => { assert.deepEqual(baseline, ['Thank you for your enquiry.']); return false; },
      captureContacts: async () => { captures++; return capture(); }}));
    runner.on('handoff', () => runner.continue('skip'));
    await runner.process(); assert.equal(current.projects[0]!.status, 'uncertain'); assert.equal(captures, 0);
    assert.equal(current.projects[0]!.contactCapture, undefined);
  } finally { await close(); }
});

test('capture failure retains confirmed submission and existing approved evidence instead of downgrading to uncertain', async () => {
  const {store, close} = await fixture();
  try {
    const current = run(); const retained = capture(); retained.contacts[0]!.review = 'approved'; retained.contacts[0]!.reviewedBy = 'operator';
    current.projects[0]!.contactCapture = retained;
    await new Runner(current, store, driver({captureContacts: async () => { throw new Error('Fixture account page unavailable.'); }})).process();
    assert.equal(current.projects[0]!.status, 'submitted'); assert.equal(current.projects[0]!.contactCapture?.status, 'captured');
    assert.equal(current.projects[0]!.contactCapture!.contacts[0]!.reviewedBy, 'operator');
    assert.equal((await store.load(current.id)).projects[0]!.status, 'submitted');
    assert.ok(current.events.some(event => /confirmed submission retained/.test(event.message)));
  } finally { await close(); }
});

test('stopping during account contact capture preserves the already confirmed enquiry and stops before the next property', {timeout: 10000}, async () => {
  const {store, close} = await fixture(); let task: Promise<void> | undefined; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    const current = run(); current.projects.push(project('nobroker', 'Second fixture', listingUrl.replace('/fixture/', '/second/')));
    let prepared = 0; let started!: () => void; const capturing = new Promise<void>(resolve => { started = resolve; });
    const runner = new Runner(current, store, driver({prepare: async () => { prepared++; return {ready: true, reason: '', baseline: []}; },
      captureContacts: async () => { started(); await gate; throw new Error('Fixture browser closed.'); }, close: async () => { release(); }}));
    task = runner.process(); await capturing; await runner.stop(); await task;
    assert.equal(current.state, 'stopped'); assert.equal(current.projects[0]!.status, 'submitted');
    assert.equal(current.projects[1]!.status, 'queued'); assert.equal(prepared, 1);
    assert.equal((await store.load(current.id)).projects[0]!.status, 'submitted');
  } finally { release(); await task; await close(); }
});

test('confirmation after a browser handoff captures contacts without reloading or submitting again', async () => {
  const {store, close} = await fixture();
  try {
    const current = run(); let prepared = 0; let submitted = 0; let captures = 0;
    const runner = new Runner(current, store, driver({prepare: async () => { prepared++; return {ready: false, reason: 'Finish the contact step in Chrome.', baseline: []}; },
      submit: async () => { submitted++; return true; }, captureContacts: async () => { captures++; return capture(); }}));
    const handoff = once(runner, 'handoff'); const task = runner.process(); await handoff; runner.continue('continue'); await task;
    assert.equal(current.projects[0]!.status, 'submitted'); assert.equal(prepared, 1); assert.equal(submitted, 0); assert.equal(captures, 1);
  } finally { await close(); }
});

test('new browser evidence merges with approved public contact evidence without losing approval or duplicating the phone', async () => {
  const {store, close} = await fixture();
  try {
    const current = run(); const [contact] = extractPublicContacts({url: listingUrl, markdown: `Owner: ${seller}`, observedAt});
    contact!.review = 'approved'; contact!.reviewedBy = 'operator'; contact!.role = 'owner';
    current.projects[0]!.contactCapture = {status: 'captured', attemptedAt: observedAt, detail: 'Prior public contact.', collectionMethod: 'firecrawl', contacts: [contact!]};
    await new Runner(current, store, driver({captureContacts: async () => capture()})).process();
    const contacts = current.projects[0]!.contactCapture!.contacts;
    assert.equal(contacts.length, 1); assert.equal(contacts[0]!.review, 'approved'); assert.equal(contacts[0]!.reviewedBy, 'operator');
    assert.equal(contacts[0]!.attributions!.length, 2);
    assert.ok(contacts[0]!.attributions!.some(source => source.visibility === 'authenticated' && source.collectionMethod === 'playwright'));
    assert.equal(current.projects[0]!.status, 'submitted');
  } finally { await close(); }
});

test('Firecrawl collection does not request private account URLs or erase retained authenticated contacts on a public failure', async () => {
  const {store, close} = await fixture();
  try {
    for (const throws of [false, true]) {
      const current = run(); current.projects[0]!.status = 'submitted';
      current.projects[0]!.contactCapture = {...capture(), status: 'failed'};
      const requested: string[] = [];
      await new Runner(current, store, driver()).collectContacts({assertConfigured() {}, async capture(page) {
        requested.push(page.url);
        if (throws) throw new Error('Fixture provider unavailable.');
        return {status: 'blocked', attemptedAt: observedAt, detail: 'Public source blocked.', contacts: []};
      }}, 1);
      assert.deepEqual(requested, [listingUrl]); assert.equal(current.projects[0]!.status, 'submitted');
      assert.equal(current.projects[0]!.contactCapture!.contacts[0]!.visibility, 'authenticated');
      assert.equal(current.projects[0]!.contactCapture!.contacts[0]!.value, seller);
      assert.equal((await store.load(current.id)).projects[0]!.contactCapture!.contacts[0]!.sourceUrl, 'https://www.nobroker.in/profile/myContacts');
    }
  } finally { await close(); }
});

test('an empty browser capture permits a later public listing pass while collected browser contacts avoid extra provider requests', async () => {
  const {store, close} = await fixture();
  try {
    const current = run(); current.projects.push(project('nobroker', 'Second fixture', listingUrl.replace('/fixture/', '/second/')));
    current.projects[0]!.contactCapture = {...capture(), status: 'not-found', contacts: []};
    current.projects[1]!.contactCapture = capture(); const requested: string[] = [];
    await new Runner(current, store, driver()).collectContacts({assertConfigured() {}, async capture(page) {
      requested.push(page.url); return {status: 'not-found', attemptedAt: observedAt, detail: 'No public phone.', contacts: []};
    }}, 2);
    assert.deepEqual(requested, [listingUrl]); assert.equal(current.projects[0]!.contactCapture!.collectionMethod, 'firecrawl');
    assert.equal(current.projects[1]!.contactCapture!.contacts[0]!.visibility, 'authenticated');
  } finally { await close(); }
});
