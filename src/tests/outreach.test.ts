import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.js';
import {createRun, defaults, project} from '../model.js';
import {contactsForRun, OutreachService, selectableContactsForRun, selectedContactsForRun} from '../outreach.js';
import type {OutreachBook, OutreachEntry, OutreachStorage} from '../outreach.js';
import {deduplicateContacts} from '../contacts.js';
import type {PublicContact} from '../contacts.js';
import {WhatsAppRouterError} from '../whatsapp.js';
import type {RouterEvent, RouterMessage, RouterOperation, RouterSendResult, WhatsAppDraft} from '../whatsapp.js';

const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherSession = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const number = '+919876543210';
const secondNumber = '+919876543211';
const timestamp = '2026-10-15T00:00:00.000Z';
function run(contacts: PublicContact[] = [contact()]) {
  const batch = createRun({...structuredClone(defaults), name: 'Aansh', senderBusiness: 'Bismyth'});
  const listing = project('housing', 'Synthetic listing', 'https://housing.com/one');
  listing.contactCapture = {status: 'captured', attemptedAt: timestamp, detail: 'Synthetic source evidence', contacts};
  batch.projects = [listing];
  batch.outreachSelection = {contactIds: contactsForRun(batch).map(item => item.id)};
  return batch;
}
function contact(overrides: Partial<PublicContact> = {}): PublicContact {
  return deduplicateContacts([{id: 'public-phone', kind: 'phone', value: number, raw: number, role: 'owner', name: 'Public owner',
    sourceUrl: 'https://example.test/one', evidence: 'Owner: ' + number, observedAt: timestamp, review: 'approved', whatsapp: 'unchecked', ...overrides}])[0]!;
}
class MemoryStore implements OutreachStorage {
  book: OutreachBook = {version: 1, entries: [], cursors: {}};
  writes = 0;
  async outreach() { return structuredClone(this.book); }
  async saveOutreach(book: OutreachBook) { this.writes++; this.book = structuredClone(book); }
}
function entry(overrides: Partial<OutreachEntry> = {}): OutreachEntry {
  return {senderSessionId: sessionId, to: number, purpose: 'manager-introduction-v1', clientRequestId: randomUUID(),
    runId: randomUUID(), contactId: 'public-phone', message: 'Saved exact introduction', sourceUrls: ['https://example.test/one'],
    status: 'accepted', operationId, messageId: 'sent-message', createdAt: timestamp, updatedAt: timestamp, replies: [], chatIds: ['selected@lid'], ...overrides};
}
function router(overrides: Record<string, unknown> = {}) {
  const calls = {statuses: 0, sends: [] as WhatsAppDraft[], previews: [] as WhatsAppDraft[], checks: [] as string[], operations: [] as string[], eventOptions: [] as {after?: string; phones: string[]; chatIds?: string[]; limit?: number}[]};
  const client = {
    async status() { calls.statuses++; return {health: {ok: true, apiVersion: '1' as const, ready: true}, session: {userId: sessionId, name: 'Selected sender', status: 'connected' as const, phone: number, updatedAt: timestamp}}; },
    async checkContact(phone: string) { calls.checks.push(phone); return {userId: sessionId, phone, onWhatsApp: true, jid: 'selected@lid', checkedAt: timestamp}; },
    async preview(draft: WhatsAppDraft): Promise<RouterSendResult> { calls.previews.push(draft); return {userId: sessionId, clientRequestId: draft.clientRequestId, operationId: null, messageId: null, status: 'preview'}; },
    async send(draft: WhatsAppDraft): Promise<RouterSendResult> { calls.sends.push(draft); return {userId: sessionId, clientRequestId: draft.clientRequestId, operationId, messageId: 'sent-message', status: 'queued'}; },
    async operation(clientRequestId: string): Promise<RouterOperation> { calls.operations.push(clientRequestId); return {userId: sessionId, clientRequestId, operationId, messageId: 'sent-message', status: 'sent', updatedAt: timestamp, errorCode: null}; },
    async events(options: {after?: string; phones: string[]; chatIds?: string[]; limit?: number}): Promise<{events: RouterEvent[]; nextCursor: string | null}> { calls.eventOptions.push(options); return {events: [], nextCursor: null}; },
  };
  Object.assign(client, overrides);
  return {client, calls};
}
function messageEvent(overrides: Partial<RouterMessage> = {}, userId = sessionId): RouterEvent {
  return {eventId: randomUUID(), cursor: randomUUID(), userId, type: 'message', occurredAt: '2026-10-15T01:00:00Z', data: {
    messageId: 'reply-one', chatId: 'selected@lid', remoteJid: 'selected@lid', fromMe: false, isHistorical: false,
    senderPhone: number, displayName: 'Public contact', type: 'text', text: 'Our manager can be reached at +91 98765 43211.', contacts: [], timestamp: '2026-10-15T01:00:00Z', status: 'delivered', ...overrides,
  }};
}
function receiptEvent(saved: OutreachEntry, status: 'sent' | 'delivered' | 'read' | 'failed' | 'uncertain', overrides: Record<string, unknown> = {}): RouterEvent {
  return {eventId: randomUUID(), cursor: randomUUID(), userId: sessionId, type: 'message:status', occurredAt: '2026-10-15T01:00:00Z', data: {
    clientRequestId: saved.clientRequestId, operationId: saved.operationId, messageId: saved.messageId!, chatId: 'selected@lid', status, timestamp: '2026-10-15T01:00:00Z', ...overrides,
  }};
}

test('separate persistent stores exclude concurrent sends and retain the original operation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-outreach-lock-'));
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const sending = new Promise<void>(resolve => { started = resolve; });
  const {client, calls} = router();
  const original = client.send;
  client.send = async draft => { started(); await gate; return original(draft); };
  const first = new OutreachService(new Store(directory), client, sessionId);
  const second = new OutreachService(new Store(directory), client, sessionId);
  let pending: Promise<OutreachEntry[]> | undefined;
  try {
    pending = first.send(run(), [contact()]); await sending;
    await assert.rejects(second.send(run(), [contact()]), /Another outreach task/);
    release(); await pending;
    assert.equal((await second.send(run(), [contact()])).length, 0);
    assert.equal(calls.sends.length, 1);
    assert.equal((await new Store(directory).outreach()).entries.length, 1);
    await assert.rejects(new Store(directory).withOutreachLock(async () => { throw new Error('fixture failure'); }), /fixture failure/);
    await new Store(directory).withOutreachLock(async () => {});
  } finally { release(); await pending; await rm(directory, {recursive: true, force: true}); }
});

test('run contact aggregation deduplicates numbers and preserves listing attribution', () => {
  const batch = run();
  batch.projects = [project('housing', 'One', 'https://housing.com/one'), project('housing', 'Two', 'https://housing.com/two')];
  for (const [index, item] of batch.projects.entries()) item.contactCapture = {status: 'captured', attemptedAt: timestamp, detail: 'Public evidence', contacts: [contact({sourceUrl: `https://example.test/${index}`})]};
  const contacts = contactsForRun(batch);
  assert.equal(contacts.length, 1); assert.equal(contacts[0]!.attributions!.length, 2);
});

test('preview checks only approved Indian mobile contacts and never creates ledger operations or live sends', async () => {
  const store = new MemoryStore(); const {client, calls} = router();
  const controller = new AbortController();
  const service = new OutreachService(store, client, sessionId);
  const result = await service.preview(run(), [contact(), contact({kind: 'whatsapp'}), contact({review: 'needs-review'}), contact({kind: 'email', value: 'owner@example.test'}), contact({value: '+12025550123'})], controller.signal);
  assert.equal(result.length, 1); assert.equal(result[0]!.status, 'ready');
  assert.match(result[0]!.message, /Aansh here from Bismyth/); assert.ok(!result[0]!.message.includes('Public owner'));
  assert.equal(calls.previews.length, 1); assert.equal(calls.sends.length, 0); assert.equal(store.writes, 0); assert.equal(store.book.entries.length, 0);
});

test('persisted recipient choices limit both preview and send when callers pass every run contact', async () => {
  const store = new MemoryStore(); const {client, calls} = router();
  const batch = run([contact(), contact({value: secondNumber, raw: secondNumber})]);
  const contacts = contactsForRun(batch);
  batch.outreachSelection = {contactIds: [contacts[0]!.id]};
  const service = new OutreachService(store, client, sessionId);
  assert.deepEqual(selectedContactsForRun(batch).map(item => item.value), [number]);
  assert.deepEqual((await service.preview(batch, contacts)).map(item => item.to), [number]);
  assert.deepEqual((await service.send(batch, contacts)).map(item => item.to), [number]);
  assert.deepEqual(calls.checks, [number, number]);
  assert.deepEqual(calls.previews.map(item => item.to), [number]);
  assert.deepEqual(calls.sends.map(item => item.to), [number]);
  assert.equal(store.book.entries.length, 1);
});

test('missing, empty and malformed saved recipient choices fail closed before any router request', async () => {
  const validId = contactsForRun(run())[0]!.id;
  for (const selection of [undefined, null, {}, {contactIds: []}, {contactIds: validId}, {contactIds: [123]}, {contactIds: [validId, 123]}]) {
    const store = new MemoryStore(); const {client, calls} = router(); const batch = run();
    batch.outreachSelection = selection as typeof batch.outreachSelection;
    const service = new OutreachService(store, client, sessionId);
    assert.deepEqual(selectedContactsForRun(batch), []);
    assert.deepEqual(await service.preview(batch, contactsForRun(batch)), []);
    assert.deepEqual(await service.send(batch, contactsForRun(batch)), []);
    assert.equal(calls.statuses, 0); assert.deepEqual(calls.checks, []);
    assert.deepEqual(calls.previews, []); assert.deepEqual(calls.sends, []);
    assert.equal(store.writes, 0); assert.deepEqual(store.book.entries, []);
  }
});

test('selected IDs cannot authorize a tampered number or a caller contact outside the saved run', async () => {
  const store = new MemoryStore(); const {client, calls} = router(); const batch = run();
  const canonical = contactsForRun(batch)[0]!;
  const tampered = {...canonical, value: secondNumber, raw: secondNumber};
  const foreign = contact({value: '+919876543212', raw: '+919876543212'});
  batch.outreachSelection!.contactIds.push(foreign.id);
  const requested = [tampered, foreign];
  const service = new OutreachService(store, client, sessionId);
  assert.deepEqual(selectedContactsForRun(batch, requested), []);
  assert.deepEqual(await service.preview(batch, requested), []);
  assert.deepEqual(await service.send(batch, requested), []);
  assert.equal(calls.statuses, 0); assert.deepEqual(calls.checks, []);
  assert.deepEqual(calls.sends, []); assert.equal(store.writes, 0);
});

test('sender uses canonical saved source evidence rather than caller-supplied contact metadata', async () => {
  const store = new MemoryStore(); const {client, calls} = router(); const batch = run();
  const canonical = contactsForRun(batch)[0]!;
  const forged = {...canonical, sourceUrl: 'https://unrelated.example/forged', evidence: 'Caller supplied replacement',
    name: 'Forged identity', attributions: [{sourceUrl: 'https://unrelated.example/hidden', evidence: 'Forged source', observedAt: timestamp}]};
  const selected = selectedContactsForRun(batch, [forged]);
  assert.deepEqual(selected, [canonical]);
  await new OutreachService(store, client, sessionId).send(batch, [forged]);
  assert.deepEqual(calls.sends.map(item => item.to), [number]);
  assert.deepEqual(store.book.entries[0]!.sourceUrls, ['https://example.test/one']);
  assert.equal(JSON.stringify(store.book).includes('unrelated.example'), false);
});

test('selection never overrides approval, and removing a choice after preview prevents dispatch', async () => {
  const store = new MemoryStore(); const {client, calls} = router();
  const batch = run([contact(), contact({value: secondNumber, review: 'needs-review'}),
    contact({kind: 'email', value: 'seller@example.test'}), contact({value: '+12025550123'})]);
  assert.deepEqual(selectableContactsForRun(batch).map(item => item.value), [number]);
  assert.deepEqual(selectedContactsForRun(batch).map(item => item.value), [number]);
  assert.deepEqual(selectedContactsForRun(batch, [{...contactsForRun(batch)[0]!, review: 'needs-review'}]), []);
  const service = new OutreachService(store, client, sessionId);
  await service.preview(batch, contactsForRun(batch));
  batch.outreachSelection = {contactIds: []};
  assert.deepEqual(await service.send(batch, contactsForRun(batch)), []);
  assert.equal(calls.statuses, 1); assert.equal(calls.previews.length, 1); assert.equal(calls.sends.length, 0);
  assert.equal(store.writes, 0);
  batch.outreachSelection = {contactIds: [contactsForRun(batch)[0]!.id]};
  batch.projects[0]!.contactCapture!.contacts[0]!.review = 'needs-review';
  assert.deepEqual(selectedContactsForRun(batch), []);
});

test('phone and WhatsApp aliases share one selected recipient and preserve all canonical sources', async () => {
  const store = new MemoryStore(); const {client, calls} = router();
  const aliases = [contact(), contact({kind: 'whatsapp', sourceUrl: 'https://example.test/two'})];
  const batch = run(aliases);
  assert.equal(contactsForRun(batch).length, 1);
  assert.equal(batch.outreachSelection!.contactIds.length, 1);
  const service = new OutreachService(store, client, sessionId);
  assert.equal((await service.preview(batch, aliases)).length, 1);
  assert.equal((await service.send(batch, aliases)).length, 1);
  assert.equal(calls.previews.length, 1); assert.equal(calls.sends.length, 1);
  assert.deepEqual(store.book.entries[0]!.sourceUrls, ['https://example.test/one', 'https://example.test/two']);
});

test('recipient deselection during availability lookup or the pre-save checkpoint prevents transport', async () => {
  for (const action of ['preview', 'send'] as const) {
    const store = new MemoryStore(); const batch = run(); const {client, calls} = router();
    const check = client.checkContact;
    client.checkContact = async phone => { const availability = await check(phone); batch.outreachSelection = {contactIds: []}; return availability; };
    const service = new OutreachService(store, client, sessionId);
    assert.deepEqual(await service[action](batch, contactsForRun(batch)), []);
    assert.deepEqual(calls.checks, [number]); assert.equal(calls.previews.length, 0); assert.equal(calls.sends.length, 0);
    assert.equal(store.writes, 0); assert.deepEqual(store.book.entries, []);
  }
  const store = new MemoryStore(); const batch = run(); const {client, calls} = router();
  const service = new OutreachService(store, client, sessionId);
  assert.deepEqual(await service.send(batch, contactsForRun(batch), undefined, message => {
    if (message.startsWith('Saving the exact')) batch.outreachSelection = {contactIds: []};
  }), []);
  assert.deepEqual(calls.checks, [number]); assert.equal(calls.sends.length, 0); assert.equal(store.writes, 0);
});

test('recipient deselection during durable save or the final sending checkpoint records definitively unsent operations', async () => {
  for (const boundary of ['save', 'sending'] as const) {
    const store = new MemoryStore(); const batch = run(); const contacts = contactsForRun(batch);
    const {client, calls} = router(); const progress: string[] = [];
    const save = store.saveOutreach.bind(store);
    store.saveOutreach = async book => {
      await save(book);
      if (boundary === 'save' && store.writes === 1) {
        assert.equal(store.book.entries[0]!.status, 'pending');
        batch.outreachSelection = {contactIds: []};
      }
    };
    const service = new OutreachService(store, client, sessionId);
    const created = await service.send(batch, contacts, undefined, message => {
      progress.push(message);
      if (boundary === 'sending' && message.startsWith('Sending the explicitly reviewed')) {
        assert.equal(store.book.entries[0]!.status, 'pending');
        batch.outreachSelection = {contactIds: []};
      }
    });
    assert.equal(created.length, 1); assert.equal(created[0]!.status, 'failed');
    assert.equal(store.book.entries.length, 1); assert.equal(store.book.entries[0]!.status, 'failed');
    assert.equal(store.book.entries[0]!.operationId, null); assert.equal(store.book.entries[0]!.messageId, null);
    assert.equal(store.book.entries[0]!.clientRequestId, created[0]!.clientRequestId);
    assert.equal(store.writes, 2); assert.deepEqual(calls.checks, [number]); assert.equal(calls.sends.length, 0);
    assert.ok(progress.some(message => /not sent/.test(message)));
    batch.outreachSelection = {contactIds: contacts.map(contact => contact.id)};
    assert.deepEqual(await service.send(batch, contacts), []);
    assert.equal(calls.sends.length, 0); assert.equal(store.book.entries.length, 1);
  }
});

test('missing configuration, invalid sender name and disconnected sessions fail before writes', async () => {
  const store = new MemoryStore(); const {client} = router();
  assert.throws(() => new OutreachService(store, undefined, sessionId), /Configure/);
  assert.throws(() => new OutreachService(store, client, 'bad-session'), /Configure/);
  const batch = run(); batch.config.name = '';
  await assert.rejects(new OutreachService(store, client, sessionId).send(batch, [contact()]), /Set your name/);
  const disconnected = router({status: async () => ({health: {ok: true, ready: true, apiVersion: '1'}, session: {userId: sessionId, status: 'disconnected'}})});
  await assert.rejects(new OutreachService(store, disconnected.client, sessionId).send(run(), [contact()]), /Connect the selected/);
  assert.equal(store.writes, 0);
});

test('send saves the exact request before transport and deduplicates across runs and concurrent callers', async () => {
  const store = new MemoryStore(); const {client, calls} = router();
  const original = client.send;
  client.send = async draft => {
    assert.equal(store.book.entries.length, 1); const persisted = store.book.entries[0]!;
    assert.equal(persisted.status, 'pending'); assert.equal(persisted.clientRequestId, draft.clientRequestId);
    assert.equal(persisted.message, draft.message); assert.equal(persisted.to, draft.to);
    return original(draft);
  };
  const messages: string[] = [];
  const one = new OutreachService(store, client, sessionId); const two = new OutreachService(store, client, sessionId);
  await Promise.all([one.send(run(), [contact()], undefined, async text => { messages.push(text); }), two.send(run(), [contact()])]);
  assert.equal(calls.sends.length, 1); assert.equal(store.book.entries[0]!.status, 'accepted');
  assert.ok(messages.some(text => text.includes('accepted')));
  await one.send(run(), [contact()]); assert.equal(calls.sends.length, 1);
});

test('a failed durable write prevents dispatch, and a lost post-send save remains deduplicated by pending UUID', async () => {
  const store = new MemoryStore(); const {client, calls} = router();
  store.saveOutreach = async () => { throw new Error('Disk unavailable'); };
  await assert.rejects(new OutreachService(store, client, sessionId).send(run(), [contact()]), /Disk unavailable/);
  assert.equal(calls.sends.length, 0);
  const secondStore = new MemoryStore(); const save = secondStore.saveOutreach.bind(secondStore);
  let count = 0;
  secondStore.saveOutreach = async book => { if (++count === 2) throw new Error('Disk unavailable after send'); await save(book); };
  const service = new OutreachService(secondStore, client, sessionId);
  await assert.rejects(service.send(run(), [contact()]), /after send/);
  assert.equal(secondStore.book.entries[0]!.status, 'pending');
  secondStore.saveOutreach = save;
  await service.send(run(), [contact()]); assert.equal(calls.sends.length, 1);
  await service.reconcile(); assert.equal(secondStore.book.entries[0]!.status, 'sent');
});

test('an uncertain send is never retried and reconciliation queries its original request', async () => {
  const store = new MemoryStore(); let sends = 0;
  const {client, calls} = router({send: async () => { sends++; throw new WhatsAppRouterError('Connection lost', 'REQUEST_FAILED', true); }});
  const service = new OutreachService(store, client, sessionId);
  const contacts = [contact(), contact({value: secondNumber})];
  await service.send(run(contacts), contacts);
  assert.equal(sends, 1); assert.equal(store.book.entries.length, 1); assert.equal(store.book.entries[0]!.status, 'uncertain');
  const id = store.book.entries[0]!.clientRequestId;
  await service.send(run(), [contact()]); assert.equal(sends, 1);
  await service.reconcile(); assert.deepEqual(calls.operations, [id]); assert.equal(store.book.entries[0]!.status, 'sent'); assert.equal(sends, 1);
});

test('missing operations remain uncertain, explicit rejection remains failed, and unavailable contacts are not sent', async () => {
  const store = new MemoryStore(); store.book.entries = [entry({status: 'pending', operationId: null, messageId: null})];
  const missing = router({operation: async () => { throw new WhatsAppRouterError('Not found', 'OPERATION_NOT_FOUND', false, 404); }});
  await new OutreachService(store, missing.client, sessionId).reconcile(); assert.equal(store.book.entries[0]!.status, 'uncertain');
  const rejected = router({send: async () => { throw new WhatsAppRouterError('Rate limited', 'RATE_LIMITED', false, 429); }});
  const newStore = new MemoryStore(); await new OutreachService(newStore, rejected.client, sessionId).send(run(), [contact()]);
  assert.equal(newStore.book.entries[0]!.status, 'failed');
  const absent = router({checkContact: async () => ({userId: sessionId, phone: number, onWhatsApp: false, jid: null, checkedAt: timestamp})});
  assert.equal((await new OutreachService(new MemoryStore(), absent.client, sessionId).preview(run(), [contact()]))[0]!.status, 'unavailable');
  const empty = new MemoryStore(); await new OutreachService(empty, absent.client, sessionId).send(run(), [contact()]); assert.equal(empty.writes, 0);
});

test('receipts are monotonic, identity scoped and selected-contact scoped', async () => {
  const store = new MemoryStore(); const saved = entry(); store.book.entries = [saved, entry({senderSessionId: otherSession, to: secondNumber})];
  const events = [receiptEvent(saved, 'read'), receiptEvent(saved, 'sent'), receiptEvent(saved, 'failed'), receiptEvent(saved, 'uncertain'), receiptEvent(saved, 'delivered', {clientRequestId: randomUUID()})];
  const {client} = router({events: async () => ({events, nextCursor: null})});
  await new OutreachService(store, client, sessionId).refresh([number]);
  assert.equal(store.book.entries[0]!.status, 'read'); assert.equal(store.book.entries[1]!.status, 'accepted');
  assert.equal(Object.values(store.book.cursors)[0], events.at(-1)!.cursor);
});

test('actual replies and explicit manager numbers are retained once without sending referrals', async () => {
  const store = new MemoryStore(); store.book.entries = [entry()];
  const incoming = messageEvent(); const duplicate = structuredClone(incoming);
  const {client, calls} = router({events: async () => ({events: [incoming, duplicate], nextCursor: null})});
  await new OutreachService(store, client, sessionId).refresh([number]);
  const saved = store.book.entries[0]!;
  assert.equal(saved.status, 'replied'); assert.equal(saved.replies.length, 1);
  assert.deepEqual(saved.referrals, [{phone: secondNumber, raw: '+91 98765 43211', sourceMessageId: 'reply-one'}]);
  assert.equal(calls.sends.length, 0);
});

test('contact-card referral numbers are recorded and STOP opt-outs remain sticky', async () => {
  const store = new MemoryStore(); store.book.entries = [entry()];
  const events = [messageEvent({messageId: 'card', type: 'contact', text: null, contacts: [{displayName: 'Sales manager', phones: [secondNumber]}]}),
    messageEvent({messageId: 'stop', text: 'STOP'}), receiptEvent(store.book.entries[0]!, 'read'), messageEvent({messageId: 'later', text: 'Thanks'})];
  const {client, calls} = router({events: async () => ({events, nextCursor: null})});
  const service = new OutreachService(store, client, sessionId); await service.refresh([number]);
  assert.equal(store.book.entries[0]!.status, 'opted-out'); assert.equal(store.book.entries[0]!.replies.length, 3);
  assert.equal(store.book.entries[0]!.referrals![0]!.phone, secondNumber);
  await service.send(run(), [contact()]); assert.equal(calls.sends.length, 0);
});

test('personal/group/outgoing/old messages never enter the outreach ledger or trigger sends', async () => {
  const store = new MemoryStore(); store.book.entries = [entry()];
  const events = [messageEvent({senderPhone: secondNumber, chatId: 'unrelated@lid', remoteJid: 'unrelated@lid'}),
    messageEvent({fromMe: true}), messageEvent({remoteJid: 'group@g.us'}), messageEvent({timestamp: '2026-10-14T00:00:00Z', isHistorical: true}), messageEvent({}, otherSession)];
  const {client, calls} = router({events: async () => ({events, nextCursor: null})});
  await new OutreachService(store, client, sessionId).refresh([number]);
  assert.equal(store.book.entries[0]!.replies.length, 0); assert.equal(store.book.entries[0]!.status, 'accepted'); assert.equal(calls.sends.length, 0);
});

test('refresh cursors are isolated by sender and selected contact subset and never silently reset expired cursors', async () => {
  const store = new MemoryStore(); store.book.entries = [entry(), entry({to: secondNumber})];
  const {client, calls} = router(); let page = 0;
  client.events = async options => { calls.eventOptions.push(options); return {events: [], nextCursor: page++ % 2 === 0 ? 'saved-cursor' : null}; };
  const service = new OutreachService(store, client, sessionId);
  await service.refresh([number]); await service.refresh([secondNumber]);
  assert.equal(Object.keys(store.book.cursors).length, 2); assert.equal(calls.eventOptions[2]!.after, undefined);
  client.events = async options => { assert.equal(options.after, 'saved-cursor'); throw new WhatsAppRouterError('Expired', 'CURSOR_EXPIRED', false, 410); };
  await assert.rejects(service.refresh([number]), error => error instanceof WhatsAppRouterError && error.code === 'CURSOR_EXPIRED');
  assert.equal(Object.keys(store.book.cursors).length, 2);
});

test('cancellation propagates to network calls and an empty selected ledger performs no events request', async () => {
  const store = new MemoryStore(); const controller = new AbortController(); controller.abort();
  const {client, calls} = router(); const service = new OutreachService(store, client, sessionId);
  await assert.rejects(service.send(run(), [contact()], controller.signal), {name: 'AbortError'});
  await assert.rejects(service.preview(run(), [contact()], controller.signal), {name: 'AbortError'});
  await assert.rejects(service.reconcile(controller.signal), {name: 'AbortError'});
  await assert.rejects(service.refresh([number], controller.signal), {name: 'AbortError'});
  await service.refresh([number]); assert.equal(calls.eventOptions.length, 0); assert.equal(store.writes, 0);
});
