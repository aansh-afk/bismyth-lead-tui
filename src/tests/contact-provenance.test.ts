import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deduplicateContacts, extractBrowserContacts, extractPublicContacts} from '../contacts.js';
import type {ContactAttribution, PublicContact} from '../contacts.js';
import {copyProject, createRun, defaults, project} from '../model.js';
import {contactsForRun, OutreachService} from '../outreach.js';
import {Store} from '../store.js';
import type {RouterSendResult, WhatsAppDraft, WhatsAppRouter} from '../whatsapp.js';

const accountUrl = 'https://www.nobroker.in/profile/myContacts';
const listingUrl = 'https://www.nobroker.in/property/buy/fixture/one/detail';
const observedAt = '2026-10-16T12:00:00.000Z';
// The operator supplied this example; all tests are local and never call this number.
const number = '+918012345678';
const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function browserContact(options: {url?: string; listingUrl?: string; visibility?: 'public' | 'authenticated'; markdown?: string} = {}): PublicContact {
  return extractBrowserContacts({url: options.url ?? accountUrl, listingUrl: options.listingUrl ?? listingUrl,
    visibility: options.visibility ?? 'authenticated', markdown: options.markdown ?? `# Contacted property\nListing phone: ${number}`, observedAt})[0]!;
}
function batch(contacts: PublicContact[]) {
  const run = createRun({...structuredClone(defaults), name: 'Fixture Operator', email: 'private-operator@example.test', phone: '+919876543219'});
  const item = project('nobroker', 'Fixture property', listingUrl);
  item.status = 'submitted';
  item.contactCapture = {status: 'captured', attemptedAt: observedAt, detail: 'Visible account contact for this listing.', collectionMethod: 'playwright', contacts};
  run.projects = [item];
  return run;
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-provenance-'));
  return {store: new Store(directory), close: () => rm(directory, {recursive: true, force: true})};
}
function csvRow(line: string): string[] {
  const values: string[] = []; let value = ''; let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { values.push(value); value = ''; }
    else value += character;
  }
  values.push(value); return values;
}

test('browser contact evidence remains authenticated, listing-associated and unapproved without assuming WhatsApp identity', () => {
  const contact = browserContact();
  assert.equal(contact.value, number); assert.equal(contact.kind, 'phone');
  assert.equal(contact.visibility, 'authenticated'); assert.equal(contact.collectionMethod, 'playwright');
  assert.equal(contact.sourceUrl, accountUrl); assert.equal(contact.listingUrl, listingUrl);
  assert.equal(contact.review, 'needs-review'); assert.equal(contact.reviewedBy, undefined);
  assert.equal(contact.role, 'unknown'); assert.equal(contact.whatsapp, 'unchecked');
  assert.equal(contact.name, undefined); assert.equal(contact.observedAt, observedAt);
  assert.ok(contact.evidence.includes(number)); assert.ok(contact.evidence.length <= 700);
  assert.equal(contact.attributions?.length, 1);
  assert.equal(contact.attributions![0]!.visibility, 'authenticated');
  assert.equal(contact.attributions![0]!.listingUrl, listingUrl);
});

test('browser extraction supports every portal and public browser evidence retains Playwright provenance', () => {
  for (const host of ['www.99acres.com', 'www.nobroker.in', 'housing.com', 'www.squareyards.com', 'www.magicbricks.com', 'www.olx.in', 'www.quikr.com']) {
    const listing = `https://${host}/fixture-property`;
    const contact = browserContact({url: listing, listingUrl: listing, visibility: 'public'});
    assert.equal(contact.visibility, 'public', host); assert.equal(contact.collectionMethod, 'playwright', host);
    assert.equal(contact.listingUrl, listing, host); assert.equal(contact.review, 'needs-review', host);
  }
});

test('browser extraction keeps deterministic masked, support and hidden-link rejection', () => {
  for (const markdown of ['Owner phone: 98xxxx3210', 'Customer support: +918012345678', '# Property\nPhone available after contacting']) {
    assert.deepEqual(extractBrowserContacts({url: accountUrl, listingUrl, visibility: 'authenticated', markdown,
      links: [`tel:${number}`], observedAt}), [], markdown);
  }
});

test('browser provenance rejects credentials and unsafe listing schemes instead of recording them', () => {
  for (const url of ['https://user:secret@example.test/listing', 'javascript:alert(1)', 'file:///tmp/listing']) {
    assert.throws(() => extractBrowserContacts({url: accountUrl, listingUrl: url, visibility: 'authenticated', markdown: number}), /http\(s\) listing URL without credentials/);
  }
  assert.throws(() => extractBrowserContacts({url: 'https://user:secret@example.test/account', listingUrl, visibility: 'authenticated', markdown: number}), /public http/);
  assert.equal(browserContact({listingUrl: listingUrl + '#contact'}).listingUrl, listingUrl);
});

test('one normalized phone keeps approval and all public/authenticated listing attributions across repeated merges', () => {
  const first = browserContact(); const second = browserContact({listingUrl: listingUrl.replace('/one/', '/two/')});
  const publicContact = extractPublicContacts({url: listingUrl, markdown: `Owner Fixture Seller: ${number}`, observedAt})[0]!;
  publicContact.review = 'approved'; publicContact.role = 'owner'; publicContact.reviewedBy = 'operator';
  const merged = deduplicateContacts([first, second, publicContact, first]);
  assert.equal(merged.length, 1); assert.equal(merged[0]!.id, first.id); assert.equal(first.id, publicContact.id);
  assert.equal(merged[0]!.review, 'approved'); assert.equal(merged[0]!.reviewedBy, 'operator');
  assert.equal(merged[0]!.attributions?.length, 3);
  assert.equal(merged[0]!.attributions!.filter(source => source.visibility === 'authenticated').length, 2);
  assert.equal(new Set(merged[0]!.attributions!.map(source => source.listingUrl).filter(Boolean)).size, 2);
  assert.deepEqual(deduplicateContacts([merged[0]!, first, second, publicContact]), merged);
});

test('legacy public contacts deduplicate with explicit public Firecrawl provenance without changing stable IDs', () => {
  const legacy = extractPublicContacts({url: listingUrl, markdown: `Owner: ${number}`, observedAt})[0]!;
  const explicit: PublicContact = {...legacy, visibility: 'public', collectionMethod: 'firecrawl',
    attributions: legacy.attributions!.map(source => ({...source, visibility: 'public', collectionMethod: 'firecrawl'}))};
  const merged = deduplicateContacts([legacy, explicit]);
  assert.equal(merged.length, 1); assert.equal(merged[0]!.id, legacy.id); assert.equal(merged[0]!.attributions?.length, 1);
  assert.equal(legacy.visibility, undefined, 'older saved contacts stay compatible without a schema migration');
});

test('identical source URLs and text retain distinct authenticated and public collection evidence', () => {
  const markdown = `Listing phone: ${number}`;
  const publicContact = extractPublicContacts({url: listingUrl, markdown, observedAt})[0]!;
  const browserPublic = browserContact({url: listingUrl, visibility: 'public', markdown});
  const browserAuthenticated = browserContact({url: listingUrl, visibility: 'authenticated', markdown});
  const [contact] = deduplicateContacts([publicContact, browserPublic, browserAuthenticated, browserPublic]);
  assert.equal(contact!.id, publicContact.id); assert.equal(contact!.attributions?.length, 3);
  assert.deepEqual(contact!.attributions!.map(source => [source.visibility ?? 'public', source.collectionMethod ?? 'firecrawl']),
    [['public', 'firecrawl'], ['public', 'playwright'], ['authenticated', 'playwright']]);
});

test('authenticated evidence survives run persistence and copying independently of submission outcomes', async () => {
  const {store, close} = await fixture();
  try {
    const run = batch([browserContact()]); await store.save(run); const loaded = await store.load(run.id);
    assert.deepEqual(loaded.projects[0]!.contactCapture, run.projects[0]!.contactCapture);
    assert.equal(loaded.projects[0]!.status, 'submitted');
    const copy = copyProject(loaded.projects[0]!);
    assert.equal(copy.status, 'queued'); assert.equal(copy.contactCapture?.collectionMethod, 'playwright');
    assert.deepEqual(copy.contactCapture, loaded.projects[0]!.contactCapture);
    copy.contactCapture!.contacts[0]!.listingUrl = 'https://example.test/copied';
    assert.equal(loaded.projects[0]!.contactCapture!.contacts[0]!.listingUrl, listingUrl);
  } finally { await close(); }
});

test('CSV and JSON contact exports preserve per-source provenance, listing URLs and private file permissions', async () => {
  const {store, close} = await fixture();
  try {
    const authenticated = browserContact();
    const publicContact = extractPublicContacts({url: listingUrl, markdown: `Owner phone: ${number}`, observedAt})[0]!;
    const run = batch([authenticated, publicContact]);
    const jsonPath = await store.exportContacts(run, 'json'); const text = await readFile(jsonPath, 'utf8');
    const exported = JSON.parse(text) as {contacts: PublicContact[]; captureResults: {collectionMethod: string}[]};
    assert.equal(exported.contacts.length, 1); assert.equal(exported.contacts[0]!.attributions?.length, 2);
    assert.equal(exported.contacts[0]!.attributions![0]!.visibility, 'authenticated');
    assert.equal(exported.contacts[0]!.attributions![0]!.listingUrl, listingUrl);
    assert.equal(exported.captureResults[0]!.collectionMethod, 'playwright');
    assert.equal((await stat(jsonPath)).mode & 0o777, 0o600);
    for (const privateValue of [run.config.name, run.config.email, run.config.phone]) assert.equal(text.includes(privateValue), false);
    const csvPath = await store.exportContacts(run, 'csv'); const lines = (await readFile(csvPath, 'utf8')).trimEnd().split('\r\n');
    const row = Object.fromEntries(csvRow(lines[0]!).map((key, index) => [key, csvRow(lines[1]!)[index]]));
    assert.equal(row.sourceVisibilities, 'authenticated | public'); assert.equal(row.collectionMethods, 'playwright | firecrawl');
    assert.equal(row.listingUrls, listingUrl); assert.ok(row.sourceUrls!.includes(accountUrl)); assert.ok(row.sourceUrls!.includes(listingUrl));
    const attributions = JSON.parse(row.sourceAttributions!) as ContactAttribution[];
    assert.equal(attributions[0]!.visibility, 'authenticated'); assert.equal(attributions[0]!.collectionMethod, 'playwright');
    assert.equal(attributions[0]!.listingUrl, listingUrl); assert.equal((await stat(csvPath)).mode & 0o777, 0o600);
  } finally { await close(); }
});

test('authenticated contacts require approval and router availability; preview keeps both source and listing URLs without sending', async () => {
  const {store, close} = await fixture();
  try {
    const checked: string[] = []; const previews: WhatsAppDraft[] = []; let sends = 0; let available = true;
    const router: Pick<WhatsAppRouter, 'status' | 'checkContact' | 'preview' | 'send' | 'operation' | 'events'> = {
      async status() { return {health: {ok: true, apiVersion: '1', ready: true}, session: {userId: sessionId, name: 'Fixture', status: 'connected', phone: '+919876543219', updatedAt: observedAt}}; },
      async checkContact(phone) { checked.push(phone); return {userId: sessionId, phone, onWhatsApp: available, jid: available ? 'fixture@lid' : null, checkedAt: observedAt}; },
      async preview(draft) { previews.push(draft); return {userId: sessionId, clientRequestId: draft.clientRequestId, operationId: null, messageId: null, status: 'preview'}; },
      async send(draft): Promise<RouterSendResult> { sends++; return {userId: sessionId, clientRequestId: draft.clientRequestId, operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', messageId: 'fixture-message', status: 'queued'}; },
      async operation() { throw new Error('No operation reconciliation expected.'); },
      async events() { throw new Error('No reply fetch expected.'); },
    };
    const contact = browserContact(); const run = batch([contact]); const service = new OutreachService(store, router, sessionId);
    assert.deepEqual(await service.preview(run, contactsForRun(run)), []); assert.equal(checked.length, 0);
    contact.review = 'approved'; contact.reviewedBy = 'operator';
    const preview = await service.preview(run, contactsForRun(run));
    assert.equal(preview.length, 1); assert.deepEqual(preview[0]!.sourceUrls, [accountUrl, listingUrl]);
    assert.equal(preview[0]!.status, 'ready'); assert.equal(previews.length, 1); assert.equal(sends, 0);
    assert.equal((await store.outreach()).entries.length, 0); assert.equal(contact.whatsapp, 'unchecked');
    available = false; assert.equal((await service.preview(run, contactsForRun(run)))[0]!.status, 'unavailable');
    assert.equal(previews.length, 1); assert.equal(sends, 0);
    available = true; const sent = await service.send(run, contactsForRun(run));
    assert.equal(sent.length, 1); assert.deepEqual(sent[0]!.sourceUrls, [accountUrl, listingUrl]); assert.equal(sends, 1);
    await service.send(run, contactsForRun(run)); assert.equal(sends, 1, 'the same imported number is not introduced twice');
  } finally { await close(); }
});
