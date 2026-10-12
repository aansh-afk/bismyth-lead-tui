import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PortalBrowser, browserPath} from '../browser.js';
import {defaults, project} from '../model.js';
import {Runner} from '../runner.js';
import {Store} from '../store.js';

test('real Chromium fills forms, preserves required consent, and distinguishes fresh confirmation', {timeout: 45000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-browser-'));
  let submissions = 0;
  const server = createServer((request, response) => {
    if (request.url === '/submit') { submissions++; response.end('ok'); return; }
    response.setHeader('Content-Type', 'text/html');
    const stale = request.url === '/stale';
    response.end(`<!doctype html><title>Local property fixture</title>
      ${stale ? '<p>Thank you for your enquiry.</p>' : ''}
      <button onclick="setTimeout(()=>{document.querySelector('form').hidden=false}, 150)">Contact</button>
      <form hidden onsubmit="event.preventDefault(); fetch('/submit', {method:'POST'}).then(()=>{document.querySelector('#success').textContent=${stale ? "'No confirmation'" : "'Thank you for your enquiry.'"}; this.hidden=true;})">
        <label>Name<input name="name" required></label>
        <label>Phone<input name="phone" type="tel" required></label>
        <label>Email<input name="email" type="email" required></label>
        <label><input id="terms" type="checkbox" required>Agree to terms</label>
        <button type="submit">Send Enquiry</button>
      </form><p id="success"></p>`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const config = {...defaults, city: 'Fixture', name: 'Fixture Person', phone: '+919000000000', email: 'fixture@example.test', sites: ['99acres' as const], browserPath: await browserPath(), delayMs: 0};
  const driver = new PortalBrowser(directory, true, async (_goal, candidates) => candidates.find(candidate => candidate.label === 'Contact')?.id);
  try {
    const item = project('99acres', 'Local fixture', base + '/form');
    const preparation = await driver.prepare(item, config);
    assert.equal(preparation.ready, false); assert.match(preparation.reason, /Required/);
    assert.equal(submissions, 0);
    assert.deepEqual(await driver.page!.evaluate(() => [...document.querySelectorAll('form input')].map(node => (node as HTMLInputElement).value)), ['Fixture Person', '9000000000', 'fixture@example.test', 'on']);
    assert.equal(await driver.page!.$eval('#terms', node => (node as HTMLInputElement).checked), false);
    await driver.page!.click('#terms');
    assert.equal((await driver.prepare(item, config, false)).ready, true);
    assert.equal(await driver.submit(item), true);
    await driver.page!.waitForFunction(() => document.querySelector('#success')?.textContent === 'Thank you for your enquiry.');
    assert.equal(await driver.confirmed(item, preparation.baseline), true);
    assert.equal(submissions, 1);
    const stale = project('99acres', 'Stale fixture', base + '/stale');
    const before = await driver.prepare(stale, config); await driver.page!.click('#terms');
    await driver.submit(stale);
    await driver.page!.waitForFunction(() => document.querySelector('#success')?.textContent === 'No confirmation');
    assert.equal(await driver.confirmed(stale, before.baseline), false);
    assert.equal(submissions, 2);
    // End-to-end runner/browser handoff: fixture user checks terms, then continues.
    await driver.close();
    const store = new Store(directory); const run = (await import('../model.js')).createRun({...config, mode: 'submit'});
    run.projects = [item]; const runner = new Runner(run, store, driver);
    runner.on('handoff', async () => { await driver.page!.click('#terms'); runner.continue('continue'); });
    await runner.process(); assert.equal(run.projects[0].status, 'submitted'); assert.equal(submissions, 3);
  } finally { await driver.close(); server.close(); await once(server, 'close'); await rm(directory, {recursive: true, force: true}); }
});
