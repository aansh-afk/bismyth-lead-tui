import test from 'node:test';
import assert from 'node:assert/strict';
import {WhatsAppRouter, WhatsAppRouterError, renderManagerIntroduction} from '../whatsapp.js';
import type {RouterRequest, RouterSendStatus} from '../whatsapp.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const clientRequestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const operationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const eventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherUser = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const timestamp = '2026-10-15T10:00:00Z';
const number = '+919876543210';
const anotherNumber = '+919876543211';
const apiKey = 'private-fixture-api-key';
const draft = {to: number, message: 'Exact approved message.\nSecond line.', clientRequestId};
const make = (request: RouterRequest, timeoutMs?: number) => new WhatsAppRouter({url: 'https://router.example', apiKey, sessionId: userId, request, timeoutMs});
const result = (status: RouterSendStatus = 'queued') => ({userId, clientRequestId, operationId: status === 'preview' ? null : operationId, messageId: status === 'preview' ? null : 'fixture-message', status});
const message = (overrides: Record<string, unknown> = {}) => ({
  messageId: 'fixture-incoming', chatId: number.slice(1) + '@s.whatsapp.net', remoteJid: 'opaque@lid',
  fromMe: false, isHistorical: false, senderPhone: number, displayName: 'Fixture seller', type: 'text',
  text: 'Please contact our manager.', contacts: [], timestamp, status: 'delivered', ...overrides,
});
const event = (data: unknown = message(), overrides: Record<string, unknown> = {}) => ({eventId, cursor: 'event-1', userId, type: 'message', occurredAt: timestamp, data, ...overrides});

test('router settings require all local values and never serialize their secrets', () => {
  assert.equal(WhatsAppRouter.fromEnvironment({}), undefined);
  assert.throws(() => WhatsAppRouter.fromEnvironment({BISMYTH_WHATSAPP_ROUTER_URL: 'https://router.example'}), /Set BISMYTH/);
  const client = WhatsAppRouter.fromEnvironment({BISMYTH_WHATSAPP_ROUTER_URL: 'https://router.example', BISMYTH_WHATSAPP_ROUTER_API_KEY: apiKey, BISMYTH_WHATSAPP_SESSION_ID: userId});
  assert.ok(client);
  assert.equal(JSON.stringify(client), '{}');
});

test('router accepts only HTTPS or loopback HTTP origins and rejects URL credentials and query secrets', () => {
  for (const url of ['http://remote.example', 'https://name:secret@router.example', 'https://router.example?key=secret', 'https://router.example/#secret', 'https://router.example/path', 'http://localhost.evil.test']) {
    assert.throws(() => new WhatsAppRouter({url, apiKey, sessionId: userId}), error => {
      assert.ok(error instanceof WhatsAppRouterError); assert.equal(error.code, 'INVALID_SETTINGS');
      assert.ok(!error.message.includes('secret')); return true;
    });
  }
  for (const url of ['https://router.example', 'http://localhost:3001', 'http://127.0.0.1:3001', 'http://[::1]:3001']) {
    assert.doesNotThrow(() => new WhatsAppRouter({url, apiKey, sessionId: userId}));
  }
});

test('status checks version and selected sender, with auth headers and no redirects/cookies', async () => {
  const paths: string[] = [];
  const client = make(async (url, init) => {
    paths.push(new URL(url).pathname);
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('X-API-Key'), apiKey);
    assert.ok(init.signal instanceof AbortSignal);
    assert.ok(!url.includes(apiKey));
    return Response.json(paths.length === 1 ? {ok: true, apiVersion: '1', ready: true} : {userId, name: 'Fixture sender', status: 'connected', phone: number, updatedAt: timestamp});
  });
  const status = await client.status();
  assert.equal(status.session.status, 'connected');
  assert.deepEqual(paths, ['/api/health', '/api/auth/status/' + userId]);
  await assert.rejects(make(async () => Response.json({ok: true, apiVersion: '2', ready: true})).status(), /invalid contract/);
});

test('number check uses URL-encoded exact supplied number and validates response identity', async () => {
  const client = make(async url => {
    assert.equal(new URL(url).pathname, `/api/contacts/${userId}/check/%2B919876543210`);
    return Response.json({userId, phone: number, onWhatsApp: true, jid: 'opaque@lid', checkedAt: timestamp});
  });
  assert.equal((await client.checkContact(number)).onWhatsApp, true);
  await assert.rejects(client.checkContact('9876543210'), /international phone/);
  await assert.rejects(make(async () => Response.json({userId: otherUser, phone: number, onWhatsApp: true, jid: null, checkedAt: timestamp})).checkContact(number), /invalid contract/);
});

test('preview explicitly sets dryRun and sends exactly the approved draft without creating sessions', async () => {
  let calls = 0;
  const client = make(async (url, init) => {
    calls++; assert.equal(new URL(url).pathname, '/api/messages/send'); assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(String(init.body)), {userId, ...draft, dryRun: true});
    return Response.json(result('preview'));
  });
  assert.equal((await client.preview(draft)).status, 'preview'); assert.equal(calls, 1);
  await assert.rejects(make(async () => Response.json(result('sent'))).preview(draft), error => error instanceof WhatsAppRouterError && error.code === 'INVALID_RESPONSE' && !error.uncertain);
});

test('live send keeps queued/sent/delivered distinct even on HTTP 200 and uses persisted request identity', async () => {
  for (const status of ['queued', 'sending', 'sent', 'delivered', 'read', 'uncertain'] as const) {
    const client = make(async (_url, init) => {
      assert.deepEqual(JSON.parse(String(init.body)), {userId, ...draft, dryRun: false});
      return Response.json(result(status));
    });
    assert.equal((await client.send(draft)).status, status);
  }
});

test('send failures are never retried and cannot leak upstream errors or credentials', async () => {
  let calls = 0;
  const client = make(async () => { calls++; throw new Error(`network error with ${apiKey}`); });
  await assert.rejects(client.send(draft), error => {
    assert.ok(error instanceof WhatsAppRouterError); assert.equal(error.uncertain, true); assert.equal(error.code, 'REQUEST_FAILED');
    assert.ok(!error.message.includes(apiKey)); return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(make(async () => Response.json({error: {code: 'RATE_LIMITED', message: apiKey}}, {status: 429})).send(draft), error => {
    assert.ok(error instanceof WhatsAppRouterError); assert.equal(error.uncertain, false); assert.equal(error.code, 'RATE_LIMITED');
    assert.ok(!error.message.includes(apiKey)); return true;
  });
  await assert.rejects(make(async () => Response.json({error: {code: apiKey, message: apiKey}}, {status: 503})).send(draft), error => {
    assert.ok(error instanceof WhatsAppRouterError); assert.equal(error.uncertain, true); assert.equal(error.code, 'ROUTER_ERROR');
    assert.ok(!error.message.includes(apiKey)); return true;
  });
});

test('wrong session/request, absent operation and malformed live responses remain uncertain', async () => {
  for (const body of [{...result(), userId: otherUser}, {...result(), clientRequestId: otherUser}, {...result(), operationId: null}, result('preview'), {status: 'delivered'}]) {
    await assert.rejects(make(async () => Response.json(body)).send(draft), error => error instanceof WhatsAppRouterError && error.uncertain && error.code === 'INVALID_RESPONSE');
  }
});

test('an oversized response is bounded and an already cancelled request never dispatches', async () => {
  await assert.rejects(make(async () => new Response('x'.repeat(1_048_577))).send(draft), error => error instanceof WhatsAppRouterError && error.uncertain);
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(make(async () => { calls++; return Response.json(result()); }).send(draft, controller.signal), error => error instanceof WhatsAppRouterError && !error.uncertain && error.code === 'REQUEST_CANCELLED');
  assert.equal(calls, 0);
});

test('operation reconciliation uses the original UUID and never dispatches another send', async () => {
  const client = make(async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(new URL(url).pathname, `/api/operations/by-client-request/${userId}/${clientRequestId}`);
    return Response.json({...result('sent'), updatedAt: timestamp, errorCode: null});
  });
  assert.equal((await client.operation(clientRequestId)).status, 'sent');
});

test('pairing retrieves only the selected session QR and never creates/replaces a session', async () => {
  const client = make(async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(new URL(url).pathname, `/api/auth/qr/${userId}`);
    return Response.json({userId, qrRaw: 'fixture-sensitive-pairing', expiresAt: timestamp});
  });
  assert.equal((await client.pairing()).userId, userId);
});

test('event polling uses after/limit and discards unrelated personal chats without losing nextCursor', async () => {
  const client = make(async url => {
    const parsed = new URL(url); assert.equal(parsed.searchParams.get('after'), 'cursor + /'); assert.equal(parsed.searchParams.get('limit'), '6');
    return Response.json({events: [
      event(),
      event(message({chatId: 'unrelated@lid', remoteJid: 'unrelated@lid', senderPhone: anotherNumber}), {eventId: otherUser}),
      event({userId, qrRaw: 'sensitive-do-not-export', expiresAt: timestamp}, {type: 'qr', cursor: 'event-3'}),
      event(message({senderPhone: null, chatId: 'known-selected@lid'}), {cursor: 'event-4'}),
      event({clientRequestId, operationId, messageId: 'fixture-message', chatId: 'known-selected@lid', status: 'delivered', timestamp}, {type: 'message:status', cursor: 'event-5'}),
      event(message({chatId: 'personal-group@g.us', remoteJid: 'personal-group@g.us'}), {cursor: 'event-6'}),
    ], nextCursor: 'event-6'});
  });
  const page = await client.events({after: 'cursor + /', phones: [number], chatIds: ['known-selected@lid'], limit: 6});
  assert.equal(page.nextCursor, 'event-6'); assert.equal(page.events.length, 3);
  assert.ok(!JSON.stringify(page).includes('sensitive-do-not-export'));
  assert.equal(page.events[2].type, 'message:status');
});

test('event polling rejects wrong session and expired cursors explicitly instead of resetting history', async () => {
  await assert.rejects(make(async () => Response.json({events: [event(message(), {userId: otherUser})], nextCursor: null})).events({phones: [number]}), /invalid contract/);
  await assert.rejects(make(async () => Response.json({error: {code: 'CURSOR_EXPIRED', message: 'cursor expired'}}, {status: 410})).events({phones: [number], after: 'old'}), error => error instanceof WhatsAppRouterError && error.code === 'CURSOR_EXPIRED');
  await assert.rejects(make(async () => Response.json({events: [], nextCursor: null})).events({phones: [number], limit: 101}), /1 to 100/);
});

test('history is a single bounded selected-chat page and preserves historical flags/contact cards', async () => {
  const chatId = 'selected/chat@lid';
  const client = make(async url => {
    const parsed = new URL(url); assert.equal(parsed.pathname, `/api/chats/${userId}/selected%2Fchat%40lid/messages`);
    assert.equal(parsed.searchParams.get('before'), 'saved-cursor');
    return Response.json({messages: [message({chatId, isHistorical: true, senderPhone: null, type: 'contact', text: null, contacts: [{displayName: 'Manager', phones: [anotherNumber]}]})], nextCursor: null});
  });
  const history = await client.history(chatId, {before: 'saved-cursor', limit: 10});
  assert.equal(history.messages[0].isHistorical, true); assert.equal(history.messages[0].senderPhone, null);
  assert.deepEqual(history.messages[0].contacts[0].phones, [anotherNumber]);
});

test('manager introduction uses only the provided identity and the approved request for referral', () => {
  const rendered = renderManagerIntroduction({senderName: 'Aansh', senderBusiness: 'Bismyth', contactName: 'Fixture seller'});
  assert.match(rendered, /^Hi Fixture seller, Aansh here from Bismyth\./);
  assert.match(rendered, /sales manager, agency owner or business head/);
  assert.match(rendered, /If they're happy to be contacted, their official work number would help/);
  assert.ok(!rendered.includes('{{'));
  assert.ok(renderManagerIntroduction({senderName: 'Aansh', senderBusiness: 'Bismyth'}).startsWith('Hi, Aansh'));
  assert.throws(() => renderManagerIntroduction({senderName: '', senderBusiness: 'Bismyth'}), /Set your name/);
  assert.throws(() => renderManagerIntroduction({senderName: 'Aansh\nInjected', senderBusiness: 'Bismyth'}), /Set your name/);
});
