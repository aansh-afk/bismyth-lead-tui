import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PortalBrowser, browserPath} from '../browser.js';
import {portalCatalog} from '../portal-catalog.js';
import {createRun, defaults, project} from '../model.js';
import type {Config, Project, Site} from '../model.js';
import {Runner} from '../runner.js';
import {Store} from '../store.js';
import {extractBrowserContacts} from '../contacts.js';
import type {ContactCapture} from '../contacts.js';

const enquirySites: Site[] = ['99acres', 'nobroker', 'housing', 'squareyards', 'magicbricks', 'quikr'];
const sellerPhone = '+919876543210';
function enquiryFixture(site: Site, stale = false): string {
  const entry = portalCatalog[site];
  return `<!doctype html><title>Synthetic ${site} property</title>
    <button id="getOwnerDetails" onclick="window.visitClicks++">Schedule Visit</button>
    <button id="getOwnerDetails" data-open onclick="window.contactClicks++;document.querySelector('[role=dialog]').hidden=false">${entry.openLabels[0]}</button>
    ${stale ? '<p id="stale">Thank you for your enquiry.</p>' : ''}
    <div role="dialog" hidden><form onsubmit="event.preventDefault();fetch('/submit/${site}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(this)))}).then(()=>{document.querySelector('#seller').hidden=false;document.querySelector('#success').textContent=${stale ? "'No fresh confirmation'" : "'Thank you for your enquiry.'"};})">
      <label>Name<input name="name" required></label><label>Phone<input name="phone" type="tel" required></label><label>Email<input name="email" type="email" required></label>
      <button type="submit">${entry.submitLabels[0]}</button></form></div>
    <section id="seller" data-contact-details hidden>Listing owner contact: <a href="tel:${sellerPhone}">${sellerPhone}</a></section><p id="success"></p>
    <script>window.contactClicks=0;window.visitClicks=0</script>`;
}

class ObservedBrowser extends PortalBrowser {
  captures = 0;
  aiCalls = 0;
  outsideRequests: string[] = [];
  constructor(directory: string) {
    let chosen: ObservedBrowser;
    super(directory, true, async (_goal, candidates) => {chosen.aiCalls++;return candidates.find(candidate => /schedule visit/i.test(candidate.label))?.id;});
    chosen = this;
  }
  override async start(config: Config) {
    const existing = this.page;
    const page = await super.start(config);
    if (page !== existing) await page.context().route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      this.outsideRequests.push(url.origin);return route.abort();
    });
    return page;
  }
  override async captureContacts(item: Project, config: Config): Promise<ContactCapture> {
    this.captures++;
    assert.equal(item.status, 'submitted', 'capture follows independent portal confirmation');
    return super.captureContacts(item, config);
  }
}
async function setup(site: Site, html = enquiryFixture(site)) {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-portal-enquiry-'));
  const requests: {path: string; body: string}[] = [];
  const server = createServer((request, response) => {
    if (request.method === 'POST') {
      let body = '';request.on('data', part => {body += String(part);});request.on('end', () => {requests.push({path: request.url!, body});response.end('ok');});return;
    }
    response.setHeader('Content-Type', 'text/html');response.end(html);
  });
  server.listen(0, '127.0.0.1');await once(server, 'listening');
  const address = server.address();assert.ok(address && typeof address === 'object');
  const config: Config = {...structuredClone(defaults), stateCode: 'MH', city: 'Mumbai', name: 'Fixture Callback Sender', email: 'callback-fixture@example.test', phone: '+919000000000', sites: [site], browserPath: await browserPath(), delayMs: 0};
  const item = project(site, 'Synthetic owner listing', `http://127.0.0.1:${address.port}/listing/${site}`);
  const browser = new ObservedBrowser(directory);
  const store = new Store(directory);
  return {directory, config, item, browser, store, requests, async close() {await browser.close();server.close();await once(server, 'close');await rm(directory, {recursive: true, force: true});}};
}

for (const site of enquirySites) {
  test(`${site}: Preview opens deterministic contact and fills callback details without sending or capturing`, {timeout: 30000}, async () => {
    const fixture = await setup(site);
    try {
      const run = createRun({...fixture.config, mode: 'preview'});run.projects = [fixture.item];
      const runner = new Runner(run, fixture.store, fixture.browser);
      runner.on('handoff', () => runner.continue('skip'));
      await runner.process();
      assert.equal(run.projects[0].status, 'prepared');
      assert.equal(run.projects[0].contactAction?.kind, 'interest');
      assert.equal(fixture.requests.length, 0);assert.equal(fixture.browser.captures, 0);assert.equal(fixture.browser.aiCalls, 0);
      assert.equal(run.projects[0].contactCapture, undefined);
      assert.deepEqual(fixture.browser.outsideRequests, []);
      // Inspect the same fixture through preparation before Runner closes Chrome.
      const prepared = await fixture.browser.prepare(fixture.item, fixture.config);
      assert.equal(prepared.ready, true);
      assert.equal(await fixture.browser.page!.locator('input[name=phone]').inputValue(), '9000000000');
      assert.equal(await fixture.browser.page!.locator('input[name=name]').inputValue(), fixture.config.name);
      assert.equal(await fixture.browser.page!.locator('input[name=email]').inputValue(), fixture.config.email);
      assert.equal(await fixture.browser.page!.evaluate(() => (window as unknown as {visitClicks: number}).visitClicks), 0);
      assert.equal(await fixture.browser.page!.evaluate(() => (window as unknown as {contactClicks: number}).contactClicks), 1);
      assert.equal(fixture.requests.length, 0);assert.equal(fixture.browser.aiCalls, 0);
    } finally {await fixture.close();}
  });

  test(`${site}: Submit sends the configured callback once then captures the revealed seller contact`, {timeout: 30000}, async () => {
    const fixture = await setup(site);
    try {
      const run = createRun({...fixture.config, mode: 'submit'});run.projects = [fixture.item];
      const runner = new Runner(run, fixture.store, fixture.browser);
      runner.on('handoff', () => runner.continue('skip'));
      await runner.process();
      assert.equal(run.projects[0].status, 'submitted');
      assert.equal(fixture.requests.length, 1);
      assert.deepEqual(JSON.parse(fixture.requests[0].body), {name: fixture.config.name, phone: '9000000000', email: fixture.config.email});
      assert.equal(fixture.browser.aiCalls, 0);assert.equal(fixture.browser.captures, 1);
      assert.equal(run.projects[0].contactCapture?.collectionMethod, 'playwright');
      assert.deepEqual(run.projects[0].contactCapture?.contacts.map(contact => contact.value), [sellerPhone]);
      assert.deepEqual(fixture.browser.outsideRequests, []);
      assert.match(run.events.at(-1)!.message, /1 confirmed interests; 0 portal messages; 0 viewing bookings; 1 contacts collected/);
    } finally {await fixture.close();}
  });
}

test('all six enquiry portals reject number reveal and unchanged stale success as delivery evidence', {timeout: 60000}, async () => {
  for (const site of enquirySites) {
    const fixture = await setup(site, enquiryFixture(site, true));
    try {
      await fixture.browser.start(fixture.config);await fixture.browser.navigate(fixture.item.url);
      await fixture.browser.page!.evaluate(() => {
        const stale = document.querySelector('#stale')!;const seller = document.querySelector('#seller')!;
        const wrapper = document.createElement('div');stale.before(wrapper);wrapper.append(stale, seller);seller.replaceChildren();
      });
      const preparation = await fixture.browser.prepare(fixture.item, fixture.config, false);
      assert.equal(preparation.ready, true, site);
      assert.ok(preparation.baseline.length > 0, site + ' records pre-existing success');
      await fixture.browser.page!.locator('#seller').evaluate((node, phone) => {node.textContent = 'Listing owner contact: ' + phone;(node as HTMLElement).hidden = false;}, sellerPhone);
      assert.equal(await fixture.browser.confirmed(fixture.item, preparation.baseline), false, site + ' number reveal is not delivery');
      assert.equal(await fixture.browser.submit(fixture.item), true);
      await fixture.browser.page!.waitForFunction(() => document.querySelector('#success')!.textContent === 'No fresh confirmation');
      assert.equal(await fixture.browser.confirmed(fixture.item, preparation.baseline), false, site + ' stale success is not new delivery');
      assert.equal(fixture.requests.length, 1);assert.equal(fixture.browser.captures, 0);
      assert.deepEqual(fixture.browser.outsideRequests, []);
    } finally {await fixture.close();}
  }
});

const scheduler = `<!doctype html><title>NoBroker fixture scheduler</title><style>button{min-width:70px;height:30px}.slot{height:30px;width:100px}.pointer-events-none{pointer-events:none}[hidden]{display:none!important}</style>
<p>Signed in as a synthetic NoBroker account</p><button id="getOwnerDetails" onclick="window.wrongClicks++">Schedule Visit</button><button id="getOwnerDetails" data-open onclick="setTimeout(()=>document.querySelector('#visit').hidden=false,80)">Contact</button>
<div id="visit" hidden><div class="schedule-visit-header-container">Schedule your FREE visit</div><div class="schedule-modal-content-container"><div class="calender-compoent"><div><h2>Pick a Date</h2><div><div><div><div>DEC</div></div></div><button id="day30"><span>30</span><span>Wed</span></button><button id="day31"><span>31</span><span>Thu</span></button></div></div><div id="times"></div><button id="confirm" hidden>Confirm Booking</button></div></div></div><div id="scheduleVisitModalConfirmation" hidden></div>
<script>window.wrongClicks=0;window.dates=[];window.times=[];
document.querySelectorAll('#day30,#day31').forEach(button=>button.onclick=()=>{window.dates.push(button.id);document.querySelectorAll('#day30,#day31').forEach(day=>day.setAttribute('aria-pressed',String(day===button)));document.querySelector('#times').innerHTML='';setTimeout(()=>{document.querySelector('#times').innerHTML='<div class="visit_schedule_container"><button aria-pressed="true">Evening (2)</button><div class="slot">7:00 PM</div><div class="slot">8:00 PM</div></div>';document.querySelectorAll('.slot').forEach(slot=>slot.onclick=()=>{window.times.push(slot.textContent);document.querySelectorAll('.slot').forEach(item=>item.setAttribute('aria-selected',String(item===slot)));});document.querySelector('#confirm').hidden=false;},50);});
document.querySelector('#confirm').onclick=()=>fetch('/book',{method:'POST'}).then(()=>{const confirmation=document.querySelector('#scheduleVisitModalConfirmation');confirmation.hidden=false;confirmation.textContent='Your visit is scheduled Thu, 31st December at 08:00 PM';});</script>`;

test('NoBroker scheduler integrates with Preview and Submit as a distinct viewing booking', {timeout: 45000}, async () => {
  for (const mode of ['preview', 'submit'] as const) {
    const fixture = await setup('nobroker', scheduler);
    class SchedulerBrowser extends ObservedBrowser {
      override async captureContacts(item: Project): Promise<ContactCapture> {
        this.captures++;assert.equal(item.status, 'submitted');
        const attemptedAt = new Date().toISOString();
        return {status: 'captured', attemptedAt, detail: 'Synthetic matched-contact capture; no account-history navigation.', contacts: extractBrowserContacts({url: item.url, listingUrl: item.url, visibility: 'authenticated', markdown: 'Listing owner: ' + sellerPhone, observedAt: attemptedAt})};
      }
    }
    const browser = new SchedulerBrowser(fixture.directory);
    try {
      const run = createRun({...fixture.config, mode});run.projects = [fixture.item];
      const runner = new Runner(run, fixture.store, browser);runner.on('handoff', () => runner.continue('skip'));
      await runner.process();
      assert.equal(run.projects[0].status, mode === 'preview' ? 'prepared' : 'submitted');
      assert.equal(run.projects[0].contactAction?.kind, 'visit-booking');
      assert.match(run.projects[0].contactAction!.summary, /Real viewing appointment: 31 dec \d{4} at 8:00 PM; uses your signed-in NoBroker account/);
      assert.equal(fixture.requests.length, mode === 'preview' ? 0 : 1);
      assert.equal(browser.captures, mode === 'preview' ? 0 : 1);
      if (mode === 'submit') {
        assert.equal(fixture.requests[0].path, '/book');
        assert.deepEqual(run.projects[0].contactCapture?.contacts.map(contact => contact.value), [sellerPhone]);
        assert.match(run.events.at(-1)!.message, /0 confirmed interests; 0 portal messages; 1 viewing bookings; 1 contacts collected/);
      } else assert.equal(run.projects[0].contactCapture, undefined);
      assert.equal(browser.aiCalls, 0);assert.deepEqual(browser.outsideRequests, []);
    } finally {await browser.close();await fixture.close();}
  }
});
