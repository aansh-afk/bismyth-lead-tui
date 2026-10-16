import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
import {browserPath} from '../browser.js';
import {captureNoBrokerCopiedNumber, capturePortalContacts, visibleListingContacts} from '../portal-contacts.js';
import {defaults, project, sites} from '../model.js';
import type {Site} from '../model.js';

const seller = '+919876543210';
const otherSeller = '+919876543211';
const config = {...structuredClone(defaults), name: 'Fixture Operator', phone: '+919000000000', email: 'operator@example.test'};
async function fixture() {
  const pages = new Map<string, string>(); const requests: {method: string; path: string}[] = [];
  const server = createServer((request, response) => {
    requests.push({method: request.method || '', path: request.url || ''});
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><html><head><title>Local portal contacts fixture</title></head><body>${pages.get(new URL(request.url || '/', 'http://fixture.test').pathname) || '<h1>Empty fixture</h1>'}
      <script>window.fixtureClicks=0;window.fixtureChanges=0;document.addEventListener('click',()=>window.fixtureClicks++);document.addEventListener('change',()=>window.fixtureChanges++);</script></body></html>`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const browser = await chromium.launch({executablePath: await browserPath(), headless: true, chromiumSandbox: true});
  const context = await browser.newContext(); const page = await context.newPage();
  const externalRequests: string[] = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === base) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  return {base, pages, requests, externalRequests, page, context, close: async () => {
    await browser.close(); server.close(); await once(server, 'close');
  }};
}

test('all seven portals collect only visible listing-scoped contacts without clicking or changing the page', {timeout: 45000}, async () => {
  const fixturePage = await fixture();
  try {
    for (const site of sites) {
      const path = `/property/${site}/one/detail`; const url = fixturePage.base + path;
      fixturePage.pages.set(path, `<header>My account ${config.phone} ${config.email}<a href="tel:${otherSeller}">Header assistance</a></header>
        <article><h1>${site} fixture property</h1><section data-contact-details><h2>Listing owner contact</h2><p>${seller}</p></section></article>
        <section data-contact-details hidden>Hidden contact: +919876543212</section>
        <section data-contact-details>Customer support: +919876543213</section><footer>Phone: +919876543214</footer>`);
      await fixturePage.page.goto(url);
      const before = await fixturePage.page.locator('body').innerHTML();
      const capture = await visibleListingContacts(fixturePage.page, project(site, 'Fixture property', url), config);
      assert.equal(capture.status, 'captured', site); assert.equal(capture.contacts.length, 1, site);
      const contact = capture.contacts[0]!;
      assert.equal(contact.value, seller, site); assert.equal(contact.visibility, 'authenticated', site);
      assert.equal(contact.collectionMethod, 'playwright', site); assert.equal(contact.listingUrl, url, site);
      assert.equal(contact.review, 'needs-review', site); assert.equal(contact.role, 'unknown', site);
      assert.equal(contact.whatsapp, 'unchecked', site); assert.equal(contact.name, undefined, site);
      assert.equal(await fixturePage.page.locator('body').innerHTML(), before, site);
      assert.deepEqual(await fixturePage.page.evaluate(() => {
        const state = window as unknown as {fixtureClicks: number; fixtureChanges: number};
        return [state.fixtureClicks, state.fixtureChanges];
      }), [0, 0], site);
    }
    assert.ok(fixturePage.requests.every(request => request.method === 'GET'));
    assert.deepEqual(fixturePage.externalRequests, []);
  } finally { await fixturePage.close(); }
});

test('NoBroker contact history attributes only the exact listing card among other contacted properties', {timeout: 30000}, async () => {
  const fixturePage = await fixture();
  try {
    const target = fixturePage.base + '/property/buy/flat/one/detail';
    const unrelated = fixturePage.base + '/property/buy/flat/two/detail';
    fixturePage.pages.set('/profile/myContacts', `<header>My account ${config.phone}</header><main>
      <article data-contact-details><a href="${unrelated}">Other contacted property</a><a href="tel:${otherSeller}">Call ${otherSeller}</a></article>
      <article data-contact-details><a href="${target}?utm_source=fixture#listing">Exact contacted property</a><a href="tel:${seller}">Call ${seller}</a></article>
      <article data-contact-details><a href="${unrelated}/extra">Different listing path</a><p>Owner phone: +919876543212</p></article>
      </main>`);
    await fixturePage.page.goto(fixturePage.base + '/profile/myContacts');
    const capture = await visibleListingContacts(fixturePage.page, project('nobroker', 'Exact property', target), config, true);
    assert.equal(capture.status, 'captured'); assert.deepEqual(capture.contacts.map(contact => contact.value), [seller]);
    assert.equal(capture.contacts[0]!.sourceUrl, fixturePage.base + '/profile/myContacts');
    assert.equal(capture.contacts[0]!.listingUrl, target); assert.equal(capture.contacts[0]!.visibility, 'authenticated');
    assert.equal(capture.contacts[0]!.evidence.includes(otherSeller), false);
    assert.deepEqual(fixturePage.externalRequests, []);
  } finally { await fixturePage.close(); }
});

test('history extraction never borrows a neighbouring card number when the matching card has no contact', {timeout: 30000}, async () => {
  const fixturePage = await fixture();
  try {
    const target = fixturePage.base + '/property/buy/flat/one/detail';
    fixturePage.pages.set('/profile/myContacts', `<main>
      <article><a href="${target}">Matching property, no phone revealed</a></article>
      <article data-contact-details><a href="${fixturePage.base}/property/buy/flat/two/detail">Other property</a><a href="tel:${otherSeller}">Call ${otherSeller}</a></article>
      </main>`);
    await fixturePage.page.goto(fixturePage.base + '/profile/myContacts');
    const capture = await visibleListingContacts(fixturePage.page, project('nobroker', 'Target', target), config, true);
    assert.equal(capture.status, 'not-found'); assert.deepEqual(capture.contacts, []);
  } finally { await fixturePage.close(); }
});

test('masked, hidden, support and supplied-profile details do not become seller contacts', {timeout: 30000}, async () => {
  const fixturePage = await fixture();
  try {
    const path = '/property/housing/masked'; const url = fixturePage.base + path;
    fixturePage.pages.set(path, `<header>${seller}</header><section data-contact-details>
      <h2>Contact details</h2><p>My number: ${config.phone}</p><p>My email: ${config.email}</p><p>Seller: 98xxxx3210</p>
      <p hidden>Hidden seller: ${seller}</p><a hidden href="tel:${otherSeller}">Hidden call</a></section>
      <section data-contact-details>Customer support: +919876543212</section>`);
    await fixturePage.page.goto(url);
    const capture = await visibleListingContacts(fixturePage.page, project('housing', 'Masked property', url), config);
    assert.equal(capture.status, 'not-found'); assert.deepEqual(capture.contacts, []);
  } finally { await fixturePage.close(); }
});

test('contact reads reject another listing, login and security pages even when numbers appear', {timeout: 30000}, async () => {
  const fixturePage = await fixture();
  try {
    const target = fixturePage.base + '/property/target/detail';
    const cases: {path: string; body: string; site: Site}[] = [
      {path: '/property/different/detail', body: `<section data-contact-details>${seller}</section>`, site: 'housing'},
      {path: '/login', body: `<section data-contact-details>${seller}</section>`, site: 'housing'},
      {path: '/property/target/detail', body: `<h1>Security check: verify you are human</h1><section data-contact-details>${seller}</section>`, site: 'housing'},
    ];
    for (const item of cases) {
      fixturePage.pages.set(item.path, item.body); await fixturePage.page.goto(fixturePage.base + item.path);
      const capture = await visibleListingContacts(fixturePage.page, project(item.site, 'Target', target), config);
      assert.equal(capture.status, 'blocked', item.path); assert.deepEqual(capture.contacts, [], item.path);
    }
  } finally { await fixturePage.close(); }
});

test('NoBroker post-confirmation capture opens contact history separately and preserves the original listing tab', {timeout: 30000}, async () => {
  const fixturePage = await fixture();
  try {
    const path = '/property/buy/flat/one/detail'; const target = fixturePage.base + path;
    fixturePage.pages.set(path, '<h1>Visit confirmed</h1>');
    fixturePage.pages.set('/profile/myContacts', `<article data-contact-details><a href="${target}">Matched property</a><a href="tel:${seller}">Call ${seller}</a></article>`);
    await fixturePage.page.goto(target); let checkpoints = 0;
    const capture = await capturePortalContacts(fixturePage.page, project('nobroker', 'Target', target), config, async () => { checkpoints++; });
    assert.equal(capture.status, 'captured'); assert.deepEqual(capture.contacts.map(contact => contact.value), [seller]);
    assert.equal(fixturePage.page.url(), target); assert.equal(fixturePage.context.pages().length, 1);
    assert.ok(checkpoints >= 2); assert.ok(fixturePage.requests.some(request => request.path === '/profile/myContacts'));
    assert.ok(fixturePage.requests.every(request => request.method === 'GET')); assert.deepEqual(fixturePage.externalRequests, []);
  } finally { await fixturePage.close(); }
});

function copyCard(url: string, phone: string, name: string): string {
  return `<article class="nb__ZsnRA"><a href="${url}">${name} property</a>
    <div onclick="window.fixtureChatClicks++;"><img src="/List-Page/chatIconActive.svg" alt="chat" width="20" height="20"></div>
    <div onclick="window.fixturePhoneClicks.push('${name}');const input=document.createElement('input');input.value='${phone}';document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();"><img src="/List-Page/callIconActive.svg" alt="chat" width="20" height="20"></div></article>`;
}
async function installCopyObservers(page: Awaited<ReturnType<typeof fixture>>['page']): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as {fixturePhoneClicks: string[]; fixtureChatClicks: number; fixtureClipboardWrites: number; fixtureOriginalExec: typeof document.execCommand};
    state.fixturePhoneClicks = []; state.fixtureChatClicks = 0; state.fixtureClipboardWrites = 0;
    document.execCommand = () => { state.fixtureClipboardWrites++; return true; };
    state.fixtureOriginalExec = document.execCommand;
  });
}
async function copyObservations(page: Awaited<ReturnType<typeof fixture>>['page']) {
  return page.evaluate(() => {
    const state = window as unknown as {fixturePhoneClicks: string[]; fixtureChatClicks: number; fixtureClipboardWrites: number; fixtureOriginalExec: typeof document.execCommand};
    return {phones: state.fixturePhoneClicks, chats: state.fixtureChatClicks, clipboardWrites: state.fixtureClipboardWrites,
      restored: document.execCommand === state.fixtureOriginalExec, leakedInterceptors: Object.keys(window).filter(key => key.startsWith('__bismythPhoneCopy_'))};
  });
}

test('NoBroker official desktop phone-copy control reads only the matched card and leaves the clipboard and chat controls untouched', {timeout: 30000}, async () => {
  const fixturePage = await fixture();
  try {
    const target = fixturePage.base + '/property/buy/flat/one/detail';
    const unrelated = fixturePage.base + '/property/buy/flat/two/detail';
    fixturePage.pages.set('/profile/myContacts', copyCard(unrelated, otherSeller, 'other') + copyCard(target, seller, 'matched'));
    await fixturePage.page.goto(fixturePage.base + '/profile/myContacts'); await installCopyObservers(fixturePage.page);
    const capture = await captureNoBrokerCopiedNumber(fixturePage.page, project('nobroker', 'Target', target), config);
    assert.equal(capture?.status, 'captured'); assert.deepEqual(capture!.contacts.map(contact => contact.value), [seller]);
    assert.equal(capture!.contacts[0]!.visibility, 'authenticated'); assert.equal(capture!.contacts[0]!.listingUrl, target);
    assert.equal(capture!.contacts[0]!.review, 'needs-review'); assert.equal(capture!.contacts[0]!.whatsapp, 'unchecked');
    assert.deepEqual(await copyObservations(fixturePage.page), {phones: ['matched'], chats: 0, clipboardWrites: 0, restored: true, leakedInterceptors: []});
    assert.equal(await fixturePage.page.locator('input,textarea').count(), 0);
    assert.ok(fixturePage.requests.every(request => request.method === 'GET')); assert.deepEqual(fixturePage.externalRequests, []);
  } finally { await fixturePage.close(); }
});

test('NoBroker copy never clicks another listing, ambiguous duplicate cards or a mobile phone action', {timeout: 30000}, async () => {
  const fixturePage = await fixture();
  try {
    const target = fixturePage.base + '/property/buy/flat/one/detail';
    const unrelated = fixturePage.base + '/property/buy/flat/two/detail';
    const item = project('nobroker', 'Target', target);
    const cases = [
      {html: copyCard(unrelated, otherSeller, 'other'), mobile: false},
      {html: copyCard(target, seller, 'first') + copyCard(target, otherSeller, 'duplicate'), mobile: false},
      {html: copyCard(target, seller, 'mobile'), mobile: true},
    ];
    for (const current of cases) {
      fixturePage.pages.set('/profile/myContacts', current.html); await fixturePage.page.goto(fixturePage.base + '/profile/myContacts');
      await fixturePage.page.setViewportSize({width: current.mobile ? 390 : 1280, height: 800}); await installCopyObservers(fixturePage.page);
      assert.equal(await captureNoBrokerCopiedNumber(fixturePage.page, item, config), undefined);
      assert.deepEqual(await copyObservations(fixturePage.page), {phones: [], chats: 0, clipboardWrites: 0, restored: true, leakedInterceptors: []});
    }
  } finally { await fixturePage.close(); }
});

test('NoBroker copy rejects masked and supplied-profile numbers after the official action and always restores its interceptor', {timeout: 30000}, async () => {
  const fixturePage = await fixture();
  try {
    const target = fixturePage.base + '/property/buy/flat/one/detail';
    for (const number of ['98xxxx3210', config.phone]) {
      fixturePage.pages.set('/profile/myContacts', copyCard(target, number, 'matched'));
      await fixturePage.page.goto(fixturePage.base + '/profile/myContacts'); await installCopyObservers(fixturePage.page);
      assert.equal(await captureNoBrokerCopiedNumber(fixturePage.page, project('nobroker', 'Target', target), config), undefined);
      assert.deepEqual(await copyObservations(fixturePage.page), {phones: ['matched'], chats: 0, clipboardWrites: 0, restored: true, leakedInterceptors: []});
    }
  } finally { await fixturePage.close(); }
});
