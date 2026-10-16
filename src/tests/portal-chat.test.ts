import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
import type {Page} from 'playwright-core';
import {browserPath} from '../browser.js';
import {defaults} from '../model.js';
import {portalChatEvidence, portalIntroduction, preparePortalChat, submitPortalChat} from '../portal-chat.js';
import {renderManagerIntroduction} from '../whatsapp.js';

const config = {...defaults, name: 'Fixture Sender', senderBusiness: 'Fixture Business', phone: '+919000000000', email: 'callback@example.test'};
const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shell = (content: string): string => `<!doctype html><html><head><style>[hidden]{display:none!important}textarea{width:500px;height:160px}button{height:35px}.bubble{white-space:pre-wrap}</style></head><body>${content}</body></html>`;

async function fixture(run: (page: Page, requests: {posts: number; bodies: string[]}) => Promise<void>): Promise<void> {
  const requests = {posts: 0, bodies: [] as string[]};
  const server = createServer(async (request, response) => {
    if (request.method === 'POST') {
      requests.posts++;
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.bodies.push(Buffer.concat(chunks).toString()); response.end('ok'); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(shell(`<h1>Conversation with listing seller</h1>
      <div id="messages" role="log"></div><form id="composer" onsubmit="event.preventDefault()">
      <label>Message<textarea placeholder="Write a message"></textarea></label><button type="button" id="send">Send</button></form>
      <form id="newsletter"><input placeholder="Email"><button type="button" id="other">Send Newsletter</button></form>
      <script>document.querySelector('#send').onclick=()=>{const field=document.querySelector('textarea');const text=field.value;fetch('/send',{method:'POST',body:text}).then(()=>{const message=document.createElement('div');message.className='message bubble outgoing';message.dataset.messageId='message-1';message.textContent=text;document.querySelector('#messages').appendChild(message);field.value='';});};document.querySelector('#other').onclick=()=>fetch('/newsletter',{method:'POST'});</script>`));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({headless: true, executablePath: await browserPath()});
  const page = await browser.newPage();
  try {await page.goto(`http://127.0.0.1:${address.port}/conversation`); await run(page, requests);}
  finally {await browser.close(); server.close(); await once(server, 'close');}
}

test('portal introduction uses the shared Atlas pitch and chosen callback details', () => {
  const text = portalIntroduction(config);
  assert.equal(text, renderManagerIntroduction({senderName: config.name, senderBusiness: config.senderBusiness}) + '\nReach me at +919000000000 / callback@example.test');
  assert.match(text, /Atlas/);
  assert.match(text, /Fixture Sender/);
  assert.match(text, /Fixture Business/);
  assert.throws(() => portalIntroduction({...config, phone: '+919000000000\nextra'}), /callback phone/);
  assert.throws(() => portalIntroduction({...config, email: 'missing-at-sign'}), /callback phone/);
});

test('real Chromium previews without POST, clicks scoped Send once and confirms a fresh outgoing bubble', {timeout: 30000}, async () => {
  await fixture(async (page, requests) => {
    const draft = portalIntroduction(config);
    assert.deepEqual(await portalChatEvidence(page, draft), []);
    const preparation = await preparePortalChat(page, config);
    assert.equal(preparation.detected, true); assert.equal(preparation.ready, true); assert.equal(preparation.draft, draft);
    assert.equal(await page.locator('textarea').inputValue(), draft);
    assert.equal(requests.posts, 0, 'preview never clicks or submits');
    assert.deepEqual(await portalChatEvidence(page, draft), [], 'text in an editor is not sent evidence');
    assert.equal(await submitPortalChat(page, draft), true);
    assert.equal(await submitPortalChat(page, draft), false);
    await page.locator('[data-message-id="message-1"]').waitFor({state: 'visible'});
    assert.equal(requests.posts, 1);
    assert.deepEqual(requests.bodies, [draft]);
    const evidence = await portalChatEvidence(page, draft);
    assert.equal(evidence.length, 1); assert.match(evidence[0], /^portal-message:message-1:/);
    assert.deepEqual(await portalChatEvidence(page, draft), evidence);
    const again = await preparePortalChat(page, config);
    assert.equal(again.alreadyShared, true); assert.equal(again.ready, false);
    assert.equal(requests.posts, 1);
  });
});

test('visible stale outgoing messages deduplicate, while hidden, incoming, editor and support text are not evidence', {timeout: 30000}, async () => {
  await fixture(async (page, requests) => {
    const draft = portalIntroduction(config);
    await page.setContent(shell(`<div hidden class="bubble outgoing" data-message-id="hidden">${escape(draft)}</div>
      <div class="message incoming" data-message-id="incoming">${escape(draft)}</div>
      <div class="customer-support"><div class="bubble outgoing" data-message-id="support">${escape(draft)}</div></div>
      <div style="opacity:0"><div class="bubble outgoing" data-message-id="transparent">${escape(draft)}</div></div>
      <div contenteditable="true" hidden><div class="bubble outgoing" data-message-id="editor">${escape(draft)}</div></div>
      <form><textarea placeholder="Write a message">${escape(draft)}</textarea><button type="button">Send</button></form>`));
    assert.deepEqual(await portalChatEvidence(page, draft), []);
    assert.equal((await preparePortalChat(page, config)).ready, true);
    await page.locator('body').evaluate((body, text) => {const bubble = document.createElement('div'); bubble.setAttribute('data-message', 'outgoing'); bubble.setAttribute('data-message-id', 'already-sent'); bubble.textContent = text; body.prepend(bubble);}, draft);
    const preparation = await preparePortalChat(page, config);
    assert.equal(preparation.alreadyShared, true); assert.equal(preparation.ready, false);
    assert.equal(await submitPortalChat(page, draft), false);
    assert.equal(requests.posts, 0);
  });
});

test('support-only, hidden, ambiguous and newsletter composers cannot send a portal introduction', {timeout: 30000}, async () => {
  await fixture(async (page, requests) => {
    const cases = [
      '<div class="customer-support"><textarea placeholder="Chat message"></textarea><button>Send</button></div>',
      '<div id="support-widget"><textarea placeholder="Write a message"></textarea><button>Send</button></div>',
      '<div hidden><textarea placeholder="Write a message"></textarea><button>Send</button></div>',
      '<div style="opacity:0"><textarea placeholder="Write a message"></textarea><button>Send</button></div>',
      '<textarea placeholder="Search properties"></textarea><button>Send</button>',
      '<form><textarea placeholder="Write a message"></textarea><button>Send Newsletter</button></form>',
      '<form><textarea placeholder="Write a message"></textarea><button>Send</button></form><form><textarea placeholder="Chat message"></textarea><button>Send</button></form>',
    ];
    for (const content of cases) {
      await page.setContent(shell(content));
      assert.equal((await preparePortalChat(page, config)).ready, false, content);
      assert.equal(await submitPortalChat(page, portalIntroduction(config)), false);
    }
    assert.equal(requests.posts, 0);
  });
});

test('OTP, password, security and payment screens stop preparation without changing their controls', {timeout: 30000}, async () => {
  await fixture(async (page, requests) => {
    for (const blocker of ['<input autocomplete="one-time-code">', '<input type="password">', '<h2>Choose a plan</h2>', '<h2>Security check</h2>']) {
      await page.setContent(shell(`${blocker}<form><textarea placeholder="Write a message"></textarea><button>Send</button></form>`));
      const preparation = await preparePortalChat(page, config);
      assert.equal(preparation.detected, true); assert.equal(preparation.ready, false);
      assert.equal(await page.locator('textarea').inputValue(), '');
      assert.equal(await submitPortalChat(page, portalIntroduction(config)), false);
    }
    assert.equal(requests.posts, 0);
  });
});

test('contenteditable messages work and modified drafts, replaced Send controls and changed pages are refused', {timeout: 30000}, async () => {
  await fixture(async (page, requests) => {
    const draft = portalIntroduction(config);
    await page.setContent(shell('<form><div contenteditable="true" role="textbox" aria-label="Write a message"></div><button type="button">Send Message</button></form>'));
    assert.equal((await preparePortalChat(page, config)).ready, true);
    assert.equal((await page.locator('[contenteditable]').innerText()).replace(/\s+/g, ' ').trim(), draft.replace(/\s+/g, ' ').trim());
    await page.locator('[contenteditable]').fill('Changed by operator');
    assert.equal(await submitPortalChat(page, draft), false);
    await page.locator('[contenteditable]').fill('');
    assert.equal((await preparePortalChat(page, config)).ready, true);
    await page.locator('button').evaluate(button => {button.replaceWith(button.cloneNode(true));});
    assert.equal(await submitPortalChat(page, draft), false);
    assert.equal((await preparePortalChat(page, config)).ready, true);
    await page.evaluate(() => {history.pushState({}, '', '/different-listing');});
    assert.equal(await submitPortalChat(page, draft), false);
    assert.equal(requests.posts, 0);
  });
});

test('an existing human draft is preserved and an ambiguous send attempt is not retried', {timeout: 30000}, async () => {
  await fixture(async (page, requests) => {
    const draft = portalIntroduction(config);
    await page.locator('textarea').fill('My unfinished message');
    const unfinished = await preparePortalChat(page, config);
    assert.equal(unfinished.ready, false); assert.match(unfinished.reason, /unfinished draft/);
    assert.equal(await page.locator('textarea').inputValue(), 'My unfinished message');
    await page.locator('textarea').fill('');
    assert.equal((await preparePortalChat(page, config)).ready, true);
    await page.locator('#send').evaluate(button => {(button as HTMLButtonElement).onclick = () => {fetch('/ambiguous-send', {method: 'POST'});};});
    const sent = page.waitForResponse(response => response.url().endsWith('/ambiguous-send'));
    assert.equal(await submitPortalChat(page, draft), true);
    await sent;
    assert.deepEqual(await portalChatEvidence(page, draft), []);
    assert.equal(await submitPortalChat(page, draft), false);
    const retry = await preparePortalChat(page, config);
    assert.equal(retry.ready, false); assert.match(retry.reason, /already had a send attempt/);
    assert.equal(requests.posts, 1);
  });
});

test('a reused browser page can introduce us in a different listing conversation without retrying the first', {timeout: 30000}, async () => {
  await fixture(async (page, requests) => {
    const draft = portalIntroduction(config);
    const first = page.url();
    assert.equal((await preparePortalChat(page, config)).ready, true);
    assert.equal(await submitPortalChat(page, draft), true);
    await page.locator('[data-message-id="message-1"]').waitFor({state: 'visible'});
    assert.equal(requests.posts, 1);
    await page.goto(new URL('/second-listing-conversation', first).href);
    assert.equal((await preparePortalChat(page, config)).ready, true);
    assert.equal(await submitPortalChat(page, draft), true);
    await page.locator('[data-message-id="message-1"]').waitFor({state: 'visible'});
    assert.equal(requests.posts, 2);
    await page.goto(first);
    const repeat = await preparePortalChat(page, config);
    assert.equal(repeat.ready, false); assert.match(repeat.reason, /already had a send attempt/);
    assert.equal(await submitPortalChat(page, draft), false);
    assert.equal(requests.posts, 2);
  });
});

test('optimistic pending, queued, failed and error bubbles never confirm that a portal accepted the message', {timeout: 30000}, async () => {
  await fixture(async (page, requests) => {
    const draft = portalIntroduction(config);
    const variants = [
      `<div class="bubble outgoing" data-status="pending">${escape(draft)}</div>`,
      `<div class="bubble outgoing" data-message-status="queued">${escape(draft)}</div>`,
      `<div class="bubble outgoing sending">${escape(draft)}</div>`,
      `<div class="bubble outgoing" data-delivery-status="failed">${escape(draft)}</div>`,
      `<div class="bubble outgoing error">${escape(draft)}</div>`,
      `<div class="bubble outgoing" aria-label="Message not sent">${escape(draft)}</div>`,
      `<div class="bubble outgoing"><span class="message-text">${escape(draft)}</span><i aria-label="Message failed to send">!</i></div>`,
    ];
    for (const bubble of variants) {
      await page.setContent(shell(bubble + '<form><textarea placeholder="Write a message"></textarea><button type="button">Send</button></form>'));
      assert.deepEqual(await portalChatEvidence(page, draft), [], bubble);
      assert.equal((await preparePortalChat(page, config)).alreadyShared, undefined);
    }
    assert.equal(requests.posts, 0);
  });
});
