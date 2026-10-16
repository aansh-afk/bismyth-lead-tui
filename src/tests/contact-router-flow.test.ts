import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalApp} from '../tui.js';
import {Store} from '../store.js';
import {createRun, defaults, project} from '../model.js';
import type {Run} from '../model.js';
import {contactsForRun} from '../outreach.js';
import type {OutreachBook} from '../outreach.js';
import type {PublicContact} from '../contacts.js';
import type {Runner} from '../runner.js';
import {renderManagerIntroduction} from '../whatsapp.js';

interface Controller {
  current?: Run; runner?: Runner; task?: Promise<void>; render: () => void; notice: string;
  launchOutreach(action: 'preview' | 'send' | 'refresh', contacts: PublicContact[]): Promise<void>;
}
interface SendPayload {userId: string; to: string; message: string; clientRequestId: string; dryRun: boolean}
const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const operationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recipient = '+919876543210';
const uncheckedRecipient = '+919876543212';
const referral = '+919876543211';
const chatId = '919876543210@s.whatsapp.net';

async function requestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const part = Buffer.from(chunk); bytes += part.byteLength;
    assert.ok(bytes <= 16_384, 'fixture request body stays bounded'); chunks.push(part);
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}
function respond(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, {'Content-Type': 'application/json'}); response.end(JSON.stringify(body));
}

test('real loopback router flow previews without sends, persists before sending, refreshes replies and deduplicates', {timeout: 20_000}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-router-flow-'));
  const store = new Store(directory); await store.init();
  const apiKey = 'fixture-local-router-key-never-a-live-key';
  const config = {...structuredClone(defaults), stateCode: 'MH', city: 'Mumbai', name: 'Fixture Sender', senderBusiness: 'Fixture Business', email: 'fixture@example.test', phone: '9000000000', sites: ['nobroker' as const], delayMs: 0};
  const run = createRun(config);
  const listing = project('nobroker', 'Synthetic property', 'https://www.nobroker.in/property/buy/fixture/detail');
  listing.status = 'prepared'; listing.detail = 'Fixture form preparation remains independent.';
  const observedAt = new Date().toISOString();
  listing.contactCapture = {status: 'captured', attemptedAt: observedAt, detail: 'Synthetic public evidence', contacts: [{
    id: 'fixture-public-contact', kind: 'phone', value: recipient, raw: recipient,
    name: 'Fixture Seller', role: 'owner', sourceUrl: listing.url, evidence: `Owner Fixture Seller: ${recipient}`,
    observedAt, review: 'approved', reviewedBy: 'operator', whatsapp: 'unchecked',
  }, {
    id: 'fixture-unchecked-contact', kind: 'phone', value: uncheckedRecipient, raw: uncheckedRecipient,
    name: 'Unchecked Fixture Seller', role: 'owner', sourceUrl: listing.url, evidence: `Owner Unchecked Fixture Seller: ${uncheckedRecipient}`,
    observedAt, review: 'approved', reviewedBy: 'operator', whatsapp: 'unchecked',
  }]};
  run.projects = [listing];
  const projectsBefore = structuredClone(run.projects);
  const contacts = contactsForRun(run);
  assert.equal(contacts.length, 2);
  run.outreachSelection = {contactIds: contacts.filter(contact => contact.value === recipient).map(contact => contact.id)};
  const expectedMessage = renderManagerIntroduction({senderName: config.name, senderBusiness: config.senderBusiness});
  const previewBodies: SendPayload[] = []; const sentBodies: SendPayload[] = [];
  const operationLookups: string[] = []; const eventCursors: (string | null)[] = [];
  const checkedRecipients: string[] = [];
  const fixtureErrors: unknown[] = [];
  let receiptWasPersisted = false;
  let connected = true;
  let origin = '';
  let app: Controller | undefined;
  let inboundTimestamp = '';
  const server = createServer((request, response) => {
    void (async () => {
      assert.equal(request.headers['x-api-key'], apiKey);
      assert.equal(request.headers.cookie, undefined); assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers.accept, 'application/json');
      const url = new URL(request.url ?? '', origin);
      if (request.method === 'GET' && url.pathname === '/api/health') {
        assert.equal(url.search, ''); respond(response, {ok: true, apiVersion: '1', ready: true}); return;
      }
      if (request.method === 'GET' && url.pathname === `/api/auth/status/${sessionId}`) {
        assert.equal(url.search, ''); respond(response, {userId: sessionId, name: 'Fixture sender session', status: connected ? 'connected' : 'disconnected', phone: '+919000000001', updatedAt: new Date().toISOString()}); return;
      }
      if (request.method === 'GET' && url.pathname === `/api/contacts/${sessionId}/check/%2B919876543210`) {
        checkedRecipients.push(recipient);
        assert.equal(url.search, ''); respond(response, {userId: sessionId, phone: recipient, onWhatsApp: true, jid: chatId, checkedAt: new Date().toISOString()}); return;
      }
      if (request.method === 'POST' && url.pathname === '/api/messages/send') {
        assert.equal(url.search, ''); assert.equal(request.headers['content-type'], 'application/json');
        const body = await requestJson(request) as SendPayload;
        assert.deepEqual(Object.keys(body).sort(), ['clientRequestId', 'dryRun', 'message', 'to', 'userId']);
        assert.equal(body.userId, sessionId); assert.equal(body.to, recipient); assert.equal(body.message, expectedMessage);
        assert.match(body.clientRequestId, uuidPattern); assert.equal(typeof body.dryRun, 'boolean');
        if (body.dryRun) {
          assert.equal((await store.outreach()).entries.length, 0); previewBodies.push(body);
          respond(response, {userId: sessionId, clientRequestId: body.clientRequestId, operationId: null, messageId: null, status: 'preview'}); return;
        }
        // Inspect the actual file at the HTTP transport boundary, rather than
        // trusting a mock save or only the final in-memory operation.
        const durable = JSON.parse(await readFile(join(directory, 'outreach.json'), 'utf8')) as OutreachBook;
        assert.equal(durable.entries.length, 1);
        assert.equal(durable.entries[0].status, 'pending'); assert.equal(durable.entries[0].clientRequestId, body.clientRequestId);
        assert.equal(durable.entries[0].senderSessionId, body.userId); assert.equal(durable.entries[0].to, body.to);
        assert.equal(durable.entries[0].message, body.message); assert.deepEqual(durable.entries[0].sourceUrls, [listing.url]);
        sentBodies.push(body); inboundTimestamp = new Date(Date.now() + 1000).toISOString();
        respond(response, {userId: sessionId, clientRequestId: body.clientRequestId, operationId, messageId: null, status: 'queued'}, 202); return;
      }
      if (request.method === 'GET' && url.pathname.startsWith(`/api/operations/by-client-request/${sessionId}/`)) {
        assert.equal(url.search, ''); assert.equal(sentBodies.length, 1);
        const original = sentBodies[0]; const requestId = url.pathname.split('/').at(-1)!;
        assert.equal(requestId, original.clientRequestId); operationLookups.push(requestId);
        respond(response, {operationId, userId: sessionId, clientRequestId: original.clientRequestId, messageId: 'fixture-outgoing', status: 'sent', updatedAt: inboundTimestamp, errorCode: null}); return;
      }
      if (request.method === 'GET' && url.pathname === `/api/events/${sessionId}`) {
        assert.equal(url.searchParams.get('limit'), '100');
        assert.ok([...url.searchParams.keys()].every(key => ['after', 'limit'].includes(key)));
        const after = url.searchParams.get('after'); eventCursors.push(after);
        assert.equal(sentBodies.length, 1);
        if (after === null) {
          assert.equal((await store.outreach()).entries[0].status, 'sent', 'reconciliation was persisted before receipt refresh');
          respond(response, {events: [{
            eventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', cursor: 'fixture-delivered', userId: sessionId, type: 'message:status', occurredAt: inboundTimestamp,
            data: {clientRequestId: sentBodies[0].clientRequestId, operationId, messageId: 'fixture-outgoing', chatId, status: 'delivered', timestamp: inboundTimestamp},
          }], nextCursor: 'fixture-delivered'}); return;
        }
        if (after === 'fixture-delivered') {
          assert.equal((await store.outreach()).entries[0].status, 'delivered', 'the receipt was saved independently of the following reply');
          receiptWasPersisted = true;
          respond(response, {events: [{
            eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', cursor: 'fixture-reply', userId: sessionId, type: 'message', occurredAt: inboundTimestamp,
            data: {messageId: 'fixture-incoming', chatId, remoteJid: chatId, fromMe: false, isHistorical: false, senderPhone: recipient,
              displayName: 'Fixture Seller', type: 'text', text: `Our sales manager can be reached at ${referral}.`, contacts: [], timestamp: inboundTimestamp, status: 'delivered'},
          }], nextCursor: 'fixture-reply'}); return;
        }
        assert.equal(after, 'fixture-reply'); respond(response, {events: [], nextCursor: null}); return;
      }
      assert.fail(`Unexpected fixture route: ${request.method} ${url.pathname}`);
    })().catch(error => {
      fixtureErrors.push(error);
      if (!response.headersSent) respond(response, {requestId: 'fixture-error', error: {code: 'INVALID_REQUEST', message: 'Fixture assertion failed', retryable: false}}, 500);
      else response.end();
    });
  });
  const environment = {
    BISMYTH_WHATSAPP_ROUTER_URL: '', BISMYTH_WHATSAPP_ROUTER_API_KEY: apiKey, BISMYTH_WHATSAPP_SESSION_ID: sessionId,
  };
  const previous = new Map(Object.keys(environment).map(name => [name, process.env[name]]));
  t.after(async () => {
    if (app?.runner?.active) await app.runner.stop();
    await app?.task;
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, {recursive: true, force: true});
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
  environment.BISMYTH_WHATSAPP_ROUTER_URL = origin;
  Object.assign(process.env, environment);
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (...args: Parameters<typeof fetch>) => {
    const input = args[0]; const target = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(target.origin, origin, 'this integration test permits only its real loopback HTTP fixture');
    return nativeFetch(...args);
  });
  app = new TerminalApp(config, store) as unknown as Controller;
  app.current = run; app.render = () => {};
  async function perform(action: 'preview' | 'send' | 'refresh'): Promise<void> {
    await app!.launchOutreach(action, contacts); assert.ok(app!.task); await app!.task;
    assert.deepEqual(fixtureErrors, []);
    assert.equal(app!.runner?.active, false); assert.equal(run.state, 'ready');
    assert.deepEqual(run.projects, projectsBefore, 'WhatsApp does not mutate portal enquiry outcomes or contact evidence');
  }

  await perform('preview');
  assert.equal(previewBodies.length, 1); assert.equal(sentBodies.length, 0);
  assert.equal((await store.outreach()).entries.length, 0);
  assert.match(app.notice, /No message was sent/);

  await perform('send');
  assert.equal(sentBodies.length, 1);
  const accepted = (await store.outreach()).entries;
  assert.equal(accepted.length, 1); assert.equal(accepted[0].status, 'accepted');
  assert.equal(accepted[0].clientRequestId, sentBodies[0].clientRequestId);
  assert.notEqual(accepted[0].clientRequestId, previewBodies[0].clientRequestId, 'a preview never reserves the send identity');
  assert.equal(accepted[0].operationId, operationId); assert.equal(accepted[0].messageId, null);

  await perform('refresh');
  const refreshed = await store.outreach(); const entry = refreshed.entries[0];
  assert.equal(receiptWasPersisted, true); assert.equal(entry.status, 'replied'); assert.equal(entry.messageId, 'fixture-outgoing');
  assert.equal(entry.replies.length, 1); assert.equal(entry.replies[0].id, 'fixture-incoming');
  assert.deepEqual(entry.referrals, [{phone: referral, raw: referral, sourceMessageId: 'fixture-incoming'}]);
  assert.deepEqual(operationLookups, [sentBodies[0].clientRequestId]);
  assert.deepEqual(eventCursors, [null, 'fixture-delivered', 'fixture-reply']);
  assert.ok(Object.values(refreshed.cursors).includes('fixture-reply'));
  assert.equal(sentBodies.length, 1, 'receipt/reply processing never sends an automatic follow-up');

  await perform('refresh');
  assert.equal((await store.outreach()).entries[0].replies.length, 1);
  assert.equal(eventCursors.at(-1), 'fixture-reply'); assert.equal(operationLookups.length, 1);
  await perform('send');
  assert.equal(sentBodies.length, 1, 'a repeated explicit send remains deduplicated');
  assert.equal((await store.outreach()).entries.length, 1); assert.equal(previewBodies.length, 1);
  assert.ok(!JSON.stringify(await store.outreach()).includes(apiKey));

  connected = false;
  await app.launchOutreach('preview', contacts); await app.task;
  assert.deepEqual(fixtureErrors, []); assert.equal(run.state, 'stopped');
  assert.match(app.notice, /Connect the selected WhatsApp sender session/);
  assert.equal(sentBodies.length, 1); assert.equal(previewBodies.length, 1);
  assert.equal((await store.outreach()).entries.length, 1);
  assert.ok(checkedRecipients.length > 0);
  assert.ok(checkedRecipients.every(phone => phone === recipient));
  assert.equal(JSON.stringify(await store.outreach()).includes(uncheckedRecipient), false);
});
