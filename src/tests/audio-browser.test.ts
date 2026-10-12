import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PortalBrowser, browserPath} from '../browser.js';
import {attemptCaptcha, captchaPending} from '../captcha.js';
import {defaults, createRun} from '../model.js';
import {Runner} from '../runner.js';
import {Store} from '../store.js';

const audioUrl = 'https://www.google.com/recaptcha/api2/payload?p=fixture-audio-A&k=fixture-key';

test('real Chromium audio fallback verifies fresh responses and detects provider blocks', {timeout: 160000}, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-audio-browser-'));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    const path = new URL(request.url || '/', 'http://fixture.test').pathname;
    const mode = path.split('/').at(-1);
    if (path.startsWith('/widget/')) {
      if (mode === 'empty') return void response.end('<h1>Widget loading</h1>');
      if (mode === 'blocked') return void response.end('<div class="rc-doscaptcha-body"><h2>Try again later</h2><div class="rc-doscaptcha-body-text">Your computer or network may be sending automated queries. To protect our users, we cannot process your request right now.</div></div>');
      const existing = mode === 'existing';
      response.end(`<html><body>
        <div id="recaptcha-anchor" role="checkbox" aria-checked="true">I'm not a robot</div>
        ${existing ? '' : `<div class="rc-imageselect"><h2>Select all red squares</h2><div style="display:grid;grid-template-columns:repeat(3,80px)">
          ${Array.from({length: 9}, (_, index) => `<button class="rc-imageselect-tile" style="width:80px;height:80px;background:red">${index + 1}</button>`).join('')}
        </div></div>`}
        <button id="recaptcha-audio-button" ${existing ? 'hidden' : ''} onclick="document.querySelector('.rc-imageselect').hidden=true; document.querySelector('.rc-audiochallenge').hidden=false; this.hidden=true">Get an audio challenge</button>
        <div class="rc-audiochallenge" ${existing ? '' : 'hidden'}><h2>Enter what you hear</h2><audio id="audio-source" hidden src="${audioUrl}"></audio><a class="rc-audiochallenge-tdownload-link" href="${audioUrl}">Download audio</a>
          <input id="audio-response"><div class="rc-audiochallenge-error-message" hidden>Multiple correct solutions required - please solve more.</div>
        </div>
        <button id="recaptcha-verify-button" onclick="window.verifyClicks++; if(document.querySelector('#audio-response').value==='seven eleven' && '${mode}'!=='wrong'){parent.postMessage('accepted','*');document.querySelector('.rc-audiochallenge').hidden=true}else{document.querySelector('.rc-audiochallenge-error-message').hidden=false;const source=document.querySelector('#audio-source');source.src=source.src.replace(/fixture-audio-[A-Z]/,'fixture-audio-'+String.fromCharCode(65+window.verifyClicks));document.querySelector('.rc-audiochallenge-tdownload-link').href=source.src;document.querySelector('#audio-response').value=''}">Verify</button>
        <script>window.verifyClicks=0;</script>
      </body></html>`);
    } else if (path === '/done') response.end('<h1>Property results</h1>');
    else {
      const address = server.address(); assert.ok(address && typeof address === 'object');
      response.end(`<html><body><h1>Complete the CAPTCHA</h1>
        <iframe title="reCAPTCHA" src="http://localhost:${address.port}/widget/${mode}" style="width:420px;height:500px"></iframe>
        <textarea name="g-recaptcha-response" hidden></textarea><button disabled onclick="location.href='/done'">Proceed</button>
        <script>addEventListener('message',event=>{if(event.data==='accepted'){document.querySelector('textarea').value='fixture-provider-token';${mode === 'disabled' ? '' : "document.querySelector('button').disabled=false"}}})</script>
      </body></html>`);
    }
  });
  server.listen(0); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const config = {...defaults, browserPath: await browserPath()};
  const driver = new PortalBrowser(directory, true, async () => undefined);
  try {
    const page = await driver.start(config);
    // No Google audio, speech service, model or live portal is used by these fixtures.
    await page.route('https://www.google.com/**', route => route.fulfill({status: 200, contentType: 'audio/mpeg', body: Buffer.from([0])}));
    const widget = () => page.frames().find(frame => frame.url().includes('/widget/'))!;
    await context.test('an offered audio challenge is transcribed and checked by both provider and portal', async () => {
      await page.goto(base + '/captcha/switch'); let gridCalls = 0; let audioCalls = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => {
        gridCalls++; return {action: 'manual', tiles: []};
      }, async (url, signal) => {
        audioCalls++; assert.equal(url, audioUrl); assert.equal(signal.aborted, false); return 'seven eleven';
      });
      assert.equal(result.pending, false, result.reason); assert.equal(gridCalls, 1); assert.equal(audioCalls, 1);
      assert.equal(new URL(page.url()).pathname, '/done'); assert.equal(await captchaPending(page), false);
    });
    await context.test('an already visible audio panel is detected without an image panel', async () => {
      await page.goto(base + '/captcha/existing'); let audioCalls = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { throw new Error('No visible image challenge'); }, async url => {
        audioCalls++; assert.equal(url, audioUrl); return 'seven eleven';
      });
      assert.equal(result.pending, false, result.reason); assert.equal(audioCalls, 1); assert.equal(new URL(page.url()).pathname, '/done');
    });
    await context.test('Try again later is detected without an image panel or solver calls', async () => {
      await page.goto(base + '/captcha/blocked'); let solverCalls = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { solverCalls++; return {action: 'manual', tiles: []}; }, async () => { solverCalls++; return 'seven eleven'; });
      assert.equal(result.pending, true); assert.match(result.reason, /blocked|try again later/i); assert.equal(solverCalls, 0);
      assert.equal(new URL(page.url()).pathname, '/captcha/blocked');
    });
    await context.test('incorrect audio answers stop after two submissions', async () => {
      await page.goto(base + '/captcha/wrong'); let audioCalls = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => ({action: 'manual', tiles: []}), async () => { audioCalls++; return 'not the answer'; });
      assert.equal(result.pending, true); assert.match(result.reason, /limit|not accepted|failed/i); assert.equal(audioCalls, 2);
      assert.equal(await widget().evaluate(() => (window as unknown as {verifyClicks: number}).verifyClicks), 2);
      assert.equal(new URL(page.url()).pathname, '/captcha/wrong');
    });
    await context.test('a changed audio source is rejected before filling or submitting', async () => {
      await page.goto(base + '/captcha/existing');
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { throw new Error('No image inference'); }, async () => {
        await widget().locator('#audio-source').evaluate(element => { (element as HTMLAudioElement).src = (element as HTMLAudioElement).src.replace('fixture-audio-A', 'fixture-audio-Z'); });
        return 'seven eleven';
      });
      assert.equal(result.pending, true); assert.match(result.reason, /changed|stale/i);
      assert.equal(await widget().locator('#audio-response').inputValue(), '');
      assert.equal(await widget().evaluate(() => (window as unknown as {verifyClicks: number}).verifyClicks), 0);
    });
    await context.test('audio refreshed while typing is not verified with stale words', async () => {
      await page.goto(base + '/captcha/existing');
      await widget().locator('#audio-response').evaluate(element => element.addEventListener('input', () => { document.querySelector('#audio-source')!.setAttribute('src', 'https://www.google.com/recaptcha/api2/payload?p=refreshed'); }));
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { throw new Error('No image inference'); }, async () => 'seven eleven');
      assert.equal(result.pending, true); assert.match(result.reason, /changed while entering/);
      assert.equal(await widget().evaluate(() => (window as unknown as {verifyClicks: number}).verifyClicks), 0);
    });
    await context.test('invalid audio transcripts are never submitted', async () => {
      await page.goto(base + '/captcha/existing');
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { throw new Error('No image inference'); }, async () => '');
      assert.equal(result.pending, true); assert.match(result.reason, /invalid|empty|uncertain/i);
      assert.equal(await widget().locator('#audio-response').inputValue(), '');
      assert.equal(await widget().evaluate(() => (window as unknown as {verifyClicks: number}).verifyClicks), 0);
    });
    await context.test('stopping audio transcription prevents any answer submission', async () => {
      await page.goto(base + '/captcha/existing'); const controller = new AbortController();
      await assert.rejects(attemptCaptcha(page, controller.signal, async () => { throw new Error('No image inference'); }, async () => { controller.abort(); return 'seven eleven'; }));
      assert.equal(await widget().locator('#audio-response').inputValue(), '');
      assert.equal(await widget().evaluate(() => (window as unknown as {verifyClicks: number}).verifyClicks), 0);
    });
    await context.test('an audio provider token cannot override disabled portal Proceed', async () => {
      await page.goto(base + '/captcha/disabled');
      const result = await attemptCaptcha(page, new AbortController().signal, async () => ({action: 'manual', tiles: []}), async () => 'seven eleven');
      assert.equal(result.pending, true); assert.match(result.reason, /portal has not cleared/i);
      assert.equal(await page.getByRole('button', {name: 'Proceed'}).isDisabled(), true);
      assert.equal(await page.locator('textarea[name="g-recaptcha-response"]').inputValue(), 'fixture-provider-token');
    });
    await context.test('a late audio iframe is retried on the same URL after an unsuccessful first attempt', async () => {
      let audioCalls = 0;
      const integration = new PortalBrowser(join(directory, 'late'), true, async () => undefined, async () => ({action: 'manual', tiles: []}), undefined, async () => { audioCalls++; return 'seven eleven'; });
      try {
        const integrationPage = await integration.start(config);
        await integrationPage.route('https://www.google.com/**', route => route.fulfill({status: 200, contentType: 'audio/mpeg', body: Buffer.from([0])}));
        await integration.navigate(base + '/captcha/empty');
        assert.equal((await integration.verifyCaptcha()).pending, true); assert.equal(audioCalls, 0);
        await integrationPage.locator('iframe').evaluate((element, url) => { (element as HTMLIFrameElement).src = url; }, `http://localhost:${address.port}/widget/existing`);
        await integrationPage.frameLocator('iframe').locator('#audio-response').waitFor({state: 'visible'});
        const result = await integration.verifyCaptcha();
        assert.equal(result.pending, false, result.reason); assert.equal(audioCalls, 1); assert.equal(new URL(integrationPage.url()).pathname, '/done');
      } finally { await integration.close(); }
    });
    await context.test('blocked discovery keeps the partial queue without waiting for the operator', async () => {
      let solverCalls = 0; let handoffs = 0;
      const dataDirectory = join(directory, 'blocked-discovery');
      const integration = new PortalBrowser(dataDirectory, true, async () => { throw new Error('Discovery must not open contact controls'); }, async () => { solverCalls++; return {action: 'manual', tiles: []}; }, undefined, async () => { solverCalls++; return 'seven eleven'; });
      const discoveryConfig = {...config, stateCode: 'MH', city: 'Mumbai', limit: 2, sites: ['99acres' as const], seedUrls: ['https://www.99acres.com/fixture-project-npxid-42', 'https://www.99acres.com/search/property/buy/mumbai']};
      try {
        const integrationPage = await integration.start(discoveryConfig);
        await integrationPage.route('https://www.99acres.com/**', route => route.fulfill({status: 200, contentType: 'text/html', body: route.request().url().endsWith('/widget/blocked')
          ? '<h2>Try again later</h2><div class="rc-doscaptcha-body-text">Your computer or network may be sending automated queries.</div>'
          : '<h1>Security checkup</h1><iframe title="reCAPTCHA" src="https://www.99acres.com/widget/blocked" style="width:420px;height:500px"></iframe><textarea name="g-recaptcha-response" hidden></textarea>'}));
        const run = createRun(discoveryConfig); const store = new Store(dataDirectory);
        const runner = new Runner(run, store, integration);
        runner.on('handoff', () => { handoffs++; runner.continue('skip'); });
        await runner.discover();
        assert.equal(run.state, 'ready'); assert.equal(run.projects.length, 1); assert.equal(run.projects[0].status, 'queued');
        assert.equal(handoffs, 0); assert.equal(solverCalls, 0);
        assert.ok(run.events.some(event => /provider blocked discovery; kept 1 properties/i.test(event.message)));
        const saved = await store.load(run.id);
        assert.equal(saved.projects.length, 1); assert.equal(saved.state, 'ready');
        assert.ok(saved.events.some(event => /provider blocked discovery/i.test(event.message)));
      } finally { await integration.close(); }
    });
  } finally {
    await driver.close(); server.close(); await once(server, 'close'); await rm(directory, {recursive: true, force: true});
  }
});
