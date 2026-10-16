import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PortalBrowser, browserPath} from '../browser.js';
import {createRun, defaults, project, sites, counts} from '../model.js';
import {Runner} from '../runner.js';
import {portalCatalog} from '../portal-catalog.js';
import {Store} from '../store.js';

const enquirySites = sites.filter(site => portalCatalog[site].contactMode === 'enquiry');

for (const size of [100, 200, 300]) test(`full browser batch: ${size} confirmed fixture submissions`, {timeout: 300000}, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-batches-'));
  const received = new Map<string, Record<string, string>>();
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/submit/')) {
      let body = ''; request.on('data', chunk => { body += String(chunk); });
      request.on('end', () => { received.set(request.url!, JSON.parse(body)); response.end('ok'); }); return;
    }
    const id = request.url!.split('/').pop();
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><title>Fixture ${id}</title><button onclick="document.querySelector('form').hidden=false">Contact</button>
      <form hidden onsubmit="event.preventDefault(); fetch('/submit/${id}', {method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(this)))}).then(()=>{document.querySelector('p').textContent='Thank you for your enquiry.'; document.querySelector('[data-contact-details]').hidden=false})">
      <input name="name" required><input name="phone" type="tel" required><input name="email" type="email" required><button>Send Enquiry</button></form><p></p><section data-contact-details hidden>Seller contact: +919876543210</section>`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const config = {...defaults, city: 'Fixture', name: 'Batch Tester', phone: '+919000000000', email: 'batch@example.test', delayMs: 0, browserPath: await browserPath()};
  const store = new Store(directory);
  const driver = new PortalBrowser(directory, true, async (_goal, candidates) => candidates.find(item => item.label === 'Contact')?.id);
  let activeRunner: Runner | undefined;
  t.signal.addEventListener('abort', () => { void activeRunner?.stop(); }, {once: true});
  try {
      const run = createRun({...config, limit: size, mode: 'submit'});
      run.projects = Array.from({length: size}, (_, index) => project(enquirySites[index % enquirySites.length], `Batch ${size} / ${index}`, `${base}/form/${size}-${index}`));
      if (size === 100) {
        const preview = createRun({...config, limit: 100, mode: 'preview'}); preview.projects = structuredClone(run.projects);
        activeRunner = new Runner(preview, store, driver); await activeRunner.process();
        assert.equal(counts(preview).prepared, 100); assert.equal(received.size, 0);
        console.log('BATCH CHECK: 100 preview forms prepared; 0 fixture submissions.');
      }
      const start = Date.now();
      activeRunner = new Runner(run, store, driver); await activeRunner.process();
      assert.equal(run.state, 'complete'); assert.equal(counts(run).submitted, size);
      assert.equal(counts(run).failed + counts(run).uncertain, 0);
      assert.equal(run.projects.filter(item => item.contactCapture?.status === 'captured').length, size, 'each confirmed form retains seller contact evidence');
      for (let index = 0; index < size; index++) assert.deepEqual(received.get(`/submit/${size}-${index}`), {name: 'Batch Tester', phone: '9000000000', email: 'batch@example.test'});
      const saved = await store.load(run.id); assert.equal(counts(saved).submitted, size);
      const before = received.size; await new Runner(saved, store, driver).process(); assert.equal(received.size, before);
      t.diagnostic(`${size} confirmed fixture submissions in ${Date.now() - start} ms; resume produced zero duplicates.`);
      console.log(`BATCH CHECK: ${size}/${size} confirmed fixture submissions, values verified, resume checked.`);
    assert.equal(received.size, size);
  } finally { await driver.close(); server.close(); await once(server, 'close'); await rm(directory, {recursive: true, force: true}); }
});
