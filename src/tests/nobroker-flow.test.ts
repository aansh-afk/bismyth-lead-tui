import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {browserPath} from '../browser.js';
import {noBrokerVisitEvidence, prepareNoBrokerVisit, submitNoBrokerVisit} from '../nobroker-flow.js';

const fixture = `<!doctype html><html><head><style>
body {font-family:sans-serif} .pointer-events-none {pointer-events:none} button {min-width:70px;height:35px}
.visit_schedule_container div.slot {width:100px;height:30px;cursor:pointer} [hidden] {display:none!important}
</style></head><body><button id="outside" onclick="window.outsideClicks++">Confirm Booking</button>
<div id="modal"><div class="schedule-visit-header-container">Schedule your FREE visit</div>
<div class="schedule-modal-content-container"><div class="calender-compoent">
<div><h2>Pick a Date</h2><div id="days"><div><div><div>DEC</div></div></div><button id="dec30"><span>30</span><span>Wed</span></button><button id="dec31"><span>31</span><span>Thu</span></button><div><div><div>JAN</div></div></div><button id="jan1"><span>1</span><span>Fri</span></button><button id="jan2" class="pointer-events-none"><span>2</span><span>Sat</span></button><button id="jan3" disabled><span>3</span><span>Sun</span></button></div></div>
<div id="times"></div><button id="confirm" hidden>Confirm Booking</button></div></div></div>
<div id="scheduleVisitModalConfirmation" hidden></div><div id="unrelated">Your visit is scheduled tomorrow</div>
<script>
window.bookingPosts=0;window.dateClicks=[];window.timeClicks=[];window.outsideClicks=0;
window.groups={morning:['9:00 AM','11:00 AM'],afternoon:['12:00 PM','2:00 PM'],evening:['6:30 PM','8:00 PM','10:00 PM']};
const days=document.querySelector('#days');
days.querySelectorAll('button').forEach(button=>button.onclick=()=>{
 window.dateClicks.push(button.id);days.querySelectorAll('button').forEach(day=>day.setAttribute('aria-pressed',String(day===button)));
 document.querySelector('#times').innerHTML='';document.querySelector('#confirm').hidden=true;
 setTimeout(()=>{document.querySelector('#times').innerHTML='<div class="visit_schedule_container"><div id="categories"></div><div id="slots"></div></div>';
 const groups=window.groups;Object.keys(groups).forEach(name=>{const group=document.createElement('button');group.textContent=name+' ('+groups[name].filter(time=>time!=='10:00 PM').length+')';group.onclick=()=>{
 document.querySelectorAll('#categories button').forEach(control=>control.setAttribute('aria-pressed',String(control===group)));
 document.querySelector('#slots').innerHTML='';groups[name].forEach(time=>{const slot=document.createElement('div');slot.textContent=time;slot.className='slot'+(time==='10:00 PM'?' pointer-events-none':'');slot.onclick=()=>{window.timeClicks.push(time);document.querySelectorAll('#slots .slot').forEach(control=>control.setAttribute('aria-selected',String(control===slot)));};document.querySelector('#slots').appendChild(slot);});};document.querySelector('#categories').appendChild(group);});
 document.querySelector('#categories button').click();document.querySelector('#confirm').hidden=false;
 },80);
});
document.querySelector('#confirm').onclick=()=>{window.bookingPosts++;fetch('/book',{method:'POST'}).then(()=>{const box=document.querySelector('#scheduleVisitModalConfirmation');box.hidden=false;box.textContent='Your visit is scheduled Fri, 1st January at 08:00 PM';});};
</script></body></html>`;

test('NoBroker chooses the latest available date and time without confirming, then submits once', {timeout: 30000}, async () => {
  let posts = 0;
  const server = createServer((request, response) => {
    if (request.url === '/book') {posts++; response.end('ok'); return;}
    response.setHeader('Content-Type', 'text/html'); response.end(fixture);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({headless: true, executablePath: await browserPath()});
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${address.port}/fixture`);
    const before = await noBrokerVisitEvidence(page);
    const baseline = new Set(before);
    assert.deepEqual(before, [], 'unrelated success text does not prove a visit');
    let checkpoints = 0;
    const preparation = await prepareNoBrokerVisit(page, async () => {checkpoints++;});
    assert.equal(preparation.detected, true); assert.equal(preparation.ready, true);
    assert.match(preparation.summary!, /Real viewing appointment: 1 jan \d{4} at 8:00 PM; uses your signed-in NoBroker account/);
    assert.ok(checkpoints > 0); assert.equal(posts, 0, 'preparation never books');
    assert.equal(await page.locator('input').count(), 0, 'signed-in scheduling needs no editable phone field');
    assert.deepEqual(await page.evaluate(() => (window as unknown as {dateClicks: string[]}).dateClicks), ['jan1']);
    assert.deepEqual(await page.evaluate(() => (window as unknown as {timeClicks: string[]}).timeClicks), ['8:00 PM']);
    assert.equal((await prepareNoBrokerVisit(page, async () => undefined)).ready, true);
    assert.deepEqual(await page.evaluate(() => (window as unknown as {dateClicks: string[]}).dateClicks), ['jan1'], 'recheck preserves the selected date');
    assert.deepEqual(await page.evaluate(() => (window as unknown as {timeClicks: string[]}).timeClicks), ['8:00 PM'], 'recheck preserves the selected time');
    assert.equal(await submitNoBrokerVisit(page), true);
    assert.equal(await submitNoBrokerVisit(page), false);
    await page.waitForFunction(() => !document.querySelector<HTMLElement>('#scheduleVisitModalConfirmation')!.hidden);
    assert.equal(posts, 1);
    const after = await noBrokerVisitEvidence(page);
    assert.equal(after.length, 1); assert.ok(after.some(value => !baseline.has(value)));
    assert.deepEqual(await noBrokerVisitEvidence(page), after, 'caller can reject the same stale baseline');
    assert.equal(await page.evaluate(() => (window as unknown as {outsideClicks: number}).outsideClicks), 0);
    assert.equal((await prepareNoBrokerVisit(page, async () => undefined)).ready, false, 'existing confirmation never schedules a duplicate');
  } finally {await browser.close();server.close();await once(server, 'close');}
});

test('NoBroker ignores hidden confirmations, reschedules and unrelated pages', {timeout: 30000}, async () => {
  const browser = await chromium.launch({headless: true, executablePath: await browserPath()});
  const page = await browser.newPage();
  try {
    await page.setContent('<p>Your visit is scheduled Fri, 1st January at 08:00 PM</p>');
    assert.deepEqual(await noBrokerVisitEvidence(page), []);
    assert.equal((await prepareNoBrokerVisit(page, async () => undefined)).detected, false);
    assert.equal(await submitNoBrokerVisit(page), false);
    await page.setContent(fixture);
    await page.locator('#scheduleVisitModalConfirmation').evaluate(node => {node.textContent = 'Your visit is scheduled Fri, 1st January at 08:00 PM';});
    assert.deepEqual(await noBrokerVisitEvidence(page), []);
    await page.locator('.schedule-visit-header-container').evaluate(node => {node.textContent = 'Reschedule your FREE visit';});
    const preparation = await prepareNoBrokerVisit(page, async () => undefined);
    assert.equal(preparation.detected, true); assert.equal(preparation.ready, false); assert.match(preparation.reason, /reschedule/);
    assert.deepEqual(await page.evaluate(() => (window as unknown as {dateClicks: string[]}).dateClicks), []);
    assert.equal(await submitNoBrokerVisit(page), false);
  } finally {await browser.close();}
});

test('NoBroker rejects unavailable ancestors and never retries an ambiguous final click', {timeout: 30000}, async () => {
  const browser = await chromium.launch({headless: true, executablePath: await browserPath()});
  const page = await browser.newPage();
  try {
    await page.setContent(fixture);
    await page.locator('#days').evaluate(node => {node.setAttribute('aria-disabled', 'true');});
    assert.equal((await prepareNoBrokerVisit(page, async () => undefined)).ready, false);
    assert.deepEqual(await page.evaluate(() => (window as unknown as {dateClicks: string[]}).dateClicks), []);
    await page.locator('#days').evaluate(node => {node.removeAttribute('aria-disabled');});
    assert.equal((await prepareNoBrokerVisit(page, async () => undefined)).ready, true);
    await page.locator('#confirm').evaluate(node => {(node as HTMLButtonElement).onclick = () => {(window as unknown as {bookingPosts: number}).bookingPosts++;};});
    assert.equal(await submitNoBrokerVisit(page), true); assert.equal(await submitNoBrokerVisit(page), false);
    assert.equal(await page.evaluate(() => (window as unknown as {bookingPosts: number}).bookingPosts), 1);
    assert.deepEqual(await noBrokerVisitEvidence(page), []);
  } finally {await browser.close();}
});

test('NoBroker refuses final submission if the prepared time or page has changed', {timeout: 30000}, async () => {
  const browser = await chromium.launch({headless: true, executablePath: await browserPath()});
  const page = await browser.newPage();
  try {
    await page.setContent(fixture);
    assert.equal((await prepareNoBrokerVisit(page, async () => undefined)).ready, true);
    await page.locator('#slots .slot').filter({hasText: /^6:30 PM$/}).click();
    assert.equal(await submitNoBrokerVisit(page), false, 'manual changes invalidate the stored preparation');
    assert.equal((await prepareNoBrokerVisit(page, async () => undefined)).ready, true);
    await page.locator('.schedule-visit-header-container').evaluate(node => {node.textContent = 'Reschedule your FREE visit';});
    assert.equal(await submitNoBrokerVisit(page), false, 'reschedule never inherits a previous preparation');
    assert.equal(await page.evaluate(() => (window as unknown as {bookingPosts: number}).bookingPosts), 0);
  } finally {await browser.close();}
});

test('NoBroker reads adjacent date spans and ignores the separate Join Visit card', {timeout: 30000}, async () => {
  const browser = await chromium.launch({headless: true, executablePath: await browserPath()});
  const page = await browser.newPage();
  try {
    await page.setContent(fixture);
    await page.evaluate(() => {
      for (const node of document.querySelector('#days')!.children) {
        if (!node.matches('button')) node.innerHTML = '<div><div>OCT</div></div>';
      }
      for (const [id, day, weekday] of [['dec30', '16', 'Today'], ['dec31', '19', 'Mon'], ['jan1', '20', 'Tue'], ['jan2', '21', 'Wed'], ['jan3', '22', 'Thu']]) {
        document.getElementById(id)!.innerHTML = `<span>${day}</span><span>${weekday}</span>`;
      }
      const join = document.createElement('section');
      join.innerHTML = '<p>Already scheduled group visit: 22 October at 9:00 PM</p><button id="join-visit">Join Visit</button>';
      const host = window as unknown as {joinClicks: number};host.joinClicks = 0;
      join.querySelector<HTMLButtonElement>('button')!.onclick = () => {host.joinClicks++;};
      document.querySelector('.schedule-modal-content-container')!.prepend(join);
    });
    assert.equal(await page.locator('#dec30').textContent(), '16Today', 'fixture preserves the production DOM with no separating text node');
    const preparation = await prepareNoBrokerVisit(page, async () => undefined);
    assert.equal(preparation.detected, true);assert.equal(preparation.ready, true);
    assert.match(preparation.summary!, /20 oct \d{4} at 8:00 PM/);
    assert.deepEqual(await page.evaluate(() => (window as unknown as {dateClicks: string[]}).dateClicks), ['jan1']);
    assert.deepEqual(await page.evaluate(() => (window as unknown as {timeClicks: string[]}).timeClicks), ['8:00 PM']);
    assert.equal(await page.evaluate(() => (window as unknown as {joinClicks: number}).joinClicks), 0);
    assert.equal(await page.evaluate(() => (window as unknown as {bookingPosts: number}).bookingPosts), 0);
    assert.equal(await page.evaluate(() => (window as unknown as {outsideClicks: number}).outsideClicks), 0);
  } finally {await browser.close();}
});

function acknowledgement(state: 'pending' | 'scheduled', date = 'Wed, 21st October at 07:00 PM'): string {
  return `<div id="scheduleVisitModalConfirmation"><div class="nb__2c6WW"><div><p class="nb__2hhpY">${state === 'pending' ? 'Visit Confirmation Pending' : 'Your visit is scheduled'}</p><p class="nb__WypMs">${date}</p></div><p class="nb__1fLbO">${state === 'pending' ? 'You will receive call from our executive for further details' : 'You will get all details regarding this visit on your registered number shortly.'}</p><button onclick="window.actionClicks++">Call</button><button onclick="window.actionClicks++">View all scheduled visits</button></div></div><script>window.actionClicks=0</script>`;
}

test('NoBroker distinguishes pending acknowledgement, stable rechecks and scheduled transition', {timeout: 30000}, async () => {
  const browser = await chromium.launch({headless: true, executablePath: await browserPath()});
  const page = await browser.newPage();
  try {
    await page.setContent(acknowledgement('pending'));
    const pending = await noBrokerVisitEvidence(page);
    assert.deepEqual(pending, ['nobroker-visit:pending:Wed, 21st October at 07:00 PM']);
    await page.locator('.nb__2c6WW').evaluate(node => {
      const details = document.createElement('div');details.textContent = 'Synthetic listing phone +919000000011. Additional help is available.';node.append(details);
    });
    assert.deepEqual(await noBrokerVisitEvidence(page), pending, 'revealing a phone or help text does not fabricate a fresh acknowledgement');
    await page.locator('.nb__1fLbO').evaluate(node => {node.textContent = 'Call Now or Request a Callback to Confirm your Visit';});
    assert.deepEqual(await noBrokerVisitEvidence(page), pending, 'known callback-confirmation variant remains pending without requesting another callback');
    await page.locator('.nb__WypMs').evaluate(node => {node.textContent = 'thu, 22nd october at 7:00 pm';});
    assert.deepEqual(await noBrokerVisitEvidence(page), ['nobroker-visit:pending:Thu, 22nd October at 07:00 PM']);
    await page.locator('.nb__2hhpY').evaluate(node => {node.textContent = 'Your visit is scheduled';});
    assert.deepEqual(await noBrokerVisitEvidence(page), ['nobroker-visit:scheduled:Thu, 22nd October at 07:00 PM']);
    assert.equal(await page.evaluate(() => (window as unknown as {actionClicks: number}).actionClicks), 0, 'reading outcomes never calls, joins or requests a callback');
  } finally {await browser.close();}
});

test('NoBroker reads the primary acknowledgement despite a long recommendation column', {timeout: 30000}, async () => {
  const browser = await chromium.launch({headless: true, executablePath: await browserPath()});
  const page = await browser.newPage();
  try {
    await page.setContent(acknowledgement('scheduled', 'Tue, 20th October at 07:00 PM'));
    await page.locator('#scheduleVisitModalConfirmation').evaluate(node => {
      const recommendations = document.createElement('div');recommendations.className = 'nb__1ejA1';
      recommendations.innerHTML = '<h2>Club your visit with nearby properties</h2>' + Array.from({length: 12}, (_, index) => `<section><h3>${index % 2 ? 'Visit Confirmation Pending' : 'Your visit is scheduled'}</h3><p class="nb__WypMs">Fri, 23rd October at 09:00 PM</p><p>${'Synthetic nearby-property description. '.repeat(12)}</p><button onclick="window.actionClicks++">Join Visit</button></section>`).join('');
      node.append(recommendations);
    });
    assert.ok((await page.locator('#scheduleVisitModalConfirmation').innerText()).length > 1500);
    assert.deepEqual(await noBrokerVisitEvidence(page), ['nobroker-visit:scheduled:Tue, 20th October at 07:00 PM']);
    await page.locator('.nb__2hhpY').evaluate(node => {node.textContent = 'Visit Confirmation Pending';});
    await page.locator('.nb__1fLbO').evaluate(node => {node.textContent = 'You will receive call from our executive for further details';});
    assert.deepEqual(await noBrokerVisitEvidence(page), ['nobroker-visit:pending:Tue, 20th October at 07:00 PM']);
    assert.equal(await page.evaluate(() => (window as unknown as {actionClicks: number}).actionClicks), 0);
  } finally {await browser.close();}
});

test('NoBroker rejects incomplete, hidden, duplicate and ambiguous acknowledgements', {timeout: 30000}, async () => {
  const browser = await chromium.launch({headless: true, executablePath: await browserPath()});
  const page = await browser.newPage();
  try {
    const valid = acknowledgement('pending');
    const cases = [
      {label: 'missing concrete date', html: valid.replace('Wed, 21st October at 07:00 PM', '')},
      {label: 'invalid hour', html: valid.replace('07:00 PM', '25:00 PM')},
      {label: 'invalid calendar day', html: valid.replace('21st October', '32nd October')},
      {label: 'impossible month date', html: valid.replace('21st October', '31st September')},
      {label: 'invalid ordinal', html: valid.replace('21st October', '21th October')},
      {label: 'missing supporting acknowledgement', html: valid.replace('You will receive call from our executive for further details', '')},
      {label: 'generic thanks is insufficient', html: valid.replace('Visit Confirmation Pending', 'Thank You !')},
      {label: 'failure is insufficient', html: valid.replace('Visit Confirmation Pending', 'Failed to schedule visit')},
      {label: 'whole modal hidden', html: valid.replace('id="scheduleVisitModalConfirmation"', 'id="scheduleVisitModalConfirmation" hidden')},
      {label: 'heading hidden', html: valid.replace('class="nb__2hhpY"', 'class="nb__2hhpY" hidden')},
      {label: 'date hidden', html: valid.replace('class="nb__WypMs"', 'class="nb__WypMs" hidden')},
      {label: 'supporting copy hidden', html: valid.replace('class="nb__1fLbO"', 'class="nb__1fLbO" hidden')},
      {label: 'duplicate visible modals', html: valid + acknowledgement('scheduled')},
      {label: 'conflicting primary headings', html: valid.replace('<p class="nb__WypMs">', '<h3>Your visit is scheduled</h3><p class="nb__WypMs">')},
      {label: 'ambiguous primary dates', html: valid.replace('</div><p class="nb__1fLbO">', '<p class="nb__WypMs">Thu, 22nd October at 08:00 PM</p></div><p class="nb__1fLbO">')},
      {label: 'unbounded primary panel', html: valid.replace('<button onclick=', '<p>' + 'Unexpected primary content. '.repeat(80) + '</p><button onclick=')},
    ];
    for (const sample of cases) {
      await page.setContent(sample.html);
      assert.deepEqual(await noBrokerVisitEvidence(page), [], sample.label);
    }
    await page.setContent('<div id="scheduleVisitModalConfirmation"><h3>Visit Confirmation Pending</h3><p>Wed, 21st October at 07:00 PM</p><p>You will receive call from our executive for further details</p><section>' + 'Unrelated recommendation text. '.repeat(100) + '</section></div>');
    assert.deepEqual(await noBrokerVisitEvidence(page), ['nobroker-visit:pending:Wed, 21st October at 07:00 PM'], 'bounded adjacent fallback ignores later recommendation content');
    await page.setContent('<div id="scheduleVisitModalConfirmation">Your visit is scheduled Fri, 1st January at 08:00 PM</div>');
    assert.deepEqual(await noBrokerVisitEvidence(page), ['nobroker-visit:scheduled:Fri, 1st January at 08:00 PM'], 'strict narrow flat confirmation remains supported');
  } finally {await browser.close();}
});
