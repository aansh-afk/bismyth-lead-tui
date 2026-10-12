import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PortalBrowser, browserPath} from '../browser.js';
import {defaults, project} from '../model.js';
import {attemptCaptcha, captchaPending, gridDecision, solveGridWithSubscription} from '../captcha.js';

test('CAPTCHA decisions reject invalid actions, tile IDs, duplicate tiles and incompatible empty lists', () => {
  assert.deepEqual(gridDecision({action: 'select', tiles: [1, 9]}, 9), {action: 'select', tiles: [1, 9]});
  for (const decision of [null, {action: 'select', tiles: [0]}, {action: 'select', tiles: [10]}, {action: 'select', tiles: [1, 1]}, {action: 'select', tiles: []}, {action: 'verify', tiles: [1]}, {action: 'click', tiles: [1]}]) assert.equal(gridDecision(decision, 9), undefined);
});

test('real Chromium CAPTCHA flow validates provider acceptance, stale images, failure fallback and cancellation', {timeout: 160000}, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-captcha-'));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/widget-checkbox' || request.url === '/widget-stalled') {
      response.end(`<div id="recaptcha-anchor" role="checkbox" aria-checked="false" onclick="this.setAttribute('aria-checked','true');${request.url === '/widget-checkbox' ? "parent.postMessage('accepted','*')" : ''}">I'm not a robot</div>`);
    } else if (request.url?.startsWith('/widget')) {
      const count = request.url === '/widget16' ? 16 : 9;
      response.end(`<html><body><div id="recaptcha-anchor" role="checkbox" aria-checked="false" onclick="this.setAttribute('aria-checked','true'); document.querySelector('.rc-imageselect').hidden=false">I'm not a robot</div>
        <div class="rc-imageselect" hidden><h2 id="instruction">Select all red squares</h2><div style="display:grid;grid-template-columns:repeat(${count === 16 ? 4 : 3},90px);gap:2px">
        ${Array.from({length: count}, (_, index) => `<button class="rc-imageselect-tile" style="width:90px;height:90px;background:${[0, 2].includes(index) ? 'red' : 'blue'}" onclick="this.classList.toggle('rc-imageselect-tileselected');this.setAttribute('aria-pressed',String(this.classList.contains('rc-imageselect-tileselected')))">${index + 1}</button>`).join('')}
        </div><button id="recaptcha-verify-button" onclick="if(JSON.stringify([...document.querySelectorAll('.rc-imageselect-tile')].flatMap((element,index)=>element.classList.contains('rc-imageselect-tileselected')?[index+1]:[]))==='[1,3]'){parent.postMessage('accepted','*');document.querySelector('.rc-imageselect').hidden=true}">Verify</button></div></body></html>`);
    } else if (request.url === '/done') response.end('<h1>Property results</h1>');
    else {
      const address = server.address(); assert.ok(address && typeof address === 'object');
      const stuck = request.url === '/captcha-stuck';
      const property = request.url === '/property';
      const widget = request.url === '/captcha16' ? '/widget16' : request.url === '/captcha-checkbox' ? '/widget-checkbox' : request.url === '/captcha-stalled' ? '/widget-stalled' : '/widget';
      const late = request.url === '/captcha-late';
      response.end(`<html><body><h1>${property ? 'Property details' : 'Complete the CAPTCHA'}</h1>${property ? '<input name="name" required><input name="phone" type="tel" required><input name="email" type="email" required>' : ''}<iframe title="reCAPTCHA" src="${late ? 'about:blank' : `http://localhost:${address.port}${widget}`}" style="width:400px;height:570px"></iframe><textarea name="g-recaptcha-response" hidden></textarea><button disabled onclick="location.href='/done'">Proceed</button><script>${late ? `setTimeout(()=>document.querySelector('iframe').src='http://localhost:${address.port}/widget-checkbox',600);` : ''}addEventListener('message',event=>{if(event.data==='accepted'){document.querySelector('textarea').value='fixture-provider-token';${property ? "document.querySelector('iframe').hidden=true;" : ''}${stuck ? '' : "document.querySelector('button').disabled=false"}}})</script></body></html>`);
    }
  });
  server.listen(0); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const config = {...defaults, browserPath: await browserPath()};
  const driver = new PortalBrowser(directory, true, async () => undefined);
  try {
    const page = await driver.start(config);
    await context.test('checkbox-only verification resumes without image inference', async () => {
      await page.goto(base + '/captcha-checkbox');
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { throw new Error('Must not invoke image inference'); });
      assert.equal(result.pending, false); assert.equal(new URL(page.url()).pathname, '/done');
    });
    await context.test('checked checkbox without a provider token does not resume', async () => {
      await page.goto(base + '/captcha-stalled');
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { throw new Error('No image challenge exists'); });
      assert.equal(result.pending, true); assert.match(result.reason, /not accepted the checkbox/);
      assert.equal(new URL(page.url()).pathname, '/captcha-stalled');
    });
    await context.test('late-loading checkbox is clicked after its iframe arrives', async () => {
      await page.goto(base + '/captcha-late');
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { throw new Error('No image inference needed'); });
      assert.equal(result.pending, false, result.reason); assert.equal(new URL(page.url()).pathname, '/done');
    });
    await context.test('valid image choices resume only after the portal leaves its verification page', async () => {
      await page.goto(base + '/captcha'); let decisions = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async (image, count) => {
        assert.ok(image.length > 100); assert.equal(count, 9);
        return ++decisions === 1 ? {action: 'select', tiles: [1, 3]} : {action: 'verify', tiles: []};
      });
      assert.equal(result.pending, false); assert.equal(decisions, 2);
      assert.equal(new URL(page.url()).pathname, '/done'); assert.equal(await captchaPending(page), false);
    });
    await context.test('a provider token cannot override a disabled portal Proceed control', async () => {
      await page.goto(base + '/captcha-stuck'); let decisions = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => ++decisions === 1 ? {action: 'select', tiles: [1, 3]} : {action: 'verify', tiles: []});
      assert.equal(result.pending, true); assert.match(result.reason, /portal has not cleared/);
      assert.equal(await page.getByRole('button', {name: 'Proceed'}).isDisabled(), true);
    });
    await context.test('4 by 4 grids pass selected tile IDs into the next decision', async () => {
      await page.goto(base + '/captcha16');
      const result = await attemptCaptcha(page, new AbortController().signal, async (_image, count, _signal, selected) => {
        assert.equal(count, 16);
        if (!selected?.length) return {action: 'select', tiles: [1, 3]};
        assert.deepEqual(selected, [1, 3]); return {action: 'verify', tiles: []};
      });
      assert.equal(result.pending, false, result.reason); assert.equal(new URL(page.url()).pathname, '/done');
    });
    await context.test('invalid choices produce no tile clicks', async () => {
      await page.goto(base + '/captcha');
      const result = await attemptCaptcha(page, new AbortController().signal, async () => ({action: 'select', tiles: [100]}));
      assert.equal(result.pending, true); assert.match(result.reason, /invalid/);
      assert.equal(await page.frames()[1].locator('.rc-imageselect-tileselected').count(), 0);
    });
    await context.test('changed images are rejected before any tile clicks', async () => {
      await page.goto(base + '/captcha');
      const result = await attemptCaptcha(page, new AbortController().signal, async () => {
        await page.frames()[1].locator('#instruction').evaluate(element => { element.textContent = 'Select blue squares instead'; });
        return {action: 'select', tiles: [1, 3]};
      });
      assert.equal(result.pending, true); assert.match(result.reason, /changed/);
      assert.equal(await page.frames()[1].locator('.rc-imageselect-tileselected').count(), 0);
    });
    await context.test('a tile refreshed by an earlier click is not clicked from a stale decision', async () => {
      await page.goto(base + '/captcha');
      const result = await attemptCaptcha(page, new AbortController().signal, async () => {
        await page.frames()[1].locator('.rc-imageselect-tile').first().evaluate(element => {
          element.addEventListener('click', () => { (document.querySelectorAll('.rc-imageselect-tile')[2] as HTMLElement).style.background = 'yellow'; });
        });
        return {action: 'select', tiles: [1, 3]};
      });
      assert.equal(result.pending, true); assert.match(result.reason, /tile changed/);
      assert.equal(await page.frames()[1].locator('.rc-imageselect-tileselected').count(), 1);
    });
    await context.test('unsuccessful attempts are bounded', async () => {
      await page.goto(base + '/captcha'); let decisions = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { decisions++; return {action: 'select', tiles: [2]}; });
      assert.equal(decisions, 4); assert.equal(result.pending, true); assert.match(result.reason, /limit/);
    });
    await context.test('stopping cancels pending image inference', async () => {
      await page.goto(base + '/captcha'); const controller = new AbortController();
      await assert.rejects(attemptCaptcha(page, controller.signal, async () => { controller.abort(); return {action: 'select', tiles: [1, 3]}; }));
      assert.equal(await page.frames()[1].locator('.rc-imageselect-tileselected').count(), 0);
    });
    await context.test('model errors retain a manual handoff reason', async () => {
      await page.goto(base + '/captcha');
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { throw new Error('Subscription unavailable'); });
      assert.equal(result.pending, true); assert.match(result.reason, /Subscription unavailable/);
    });
    await context.test('contact preparation automatically solves the widget and fills supplied fields', async () => {
      const integration = new PortalBrowser(join(directory, 'integration'), true, async () => undefined, async (_image, _count, _signal, selected) => selected?.length ? {action: 'verify', tiles: []} : {action: 'select', tiles: [1, 3]});
      try {
        const prepared = await integration.prepare(project('99acres', 'Fixture property', base + '/property'), {...config, name: 'Fixture User', phone: '9000000000', email: 'fixture@example.test'});
        assert.equal(prepared.ready, true, prepared.reason);
        assert.equal(await integration.page!.locator('input[name="phone"]').inputValue(), '9000000000');
        assert.equal(new URL(integration.page!.url()).pathname, '/property');
      } finally { await integration.close(); }
    });
    await context.test('the operator can retry once before failed automatic attempts are bounded', async () => {
      let calls = 0;
      const integration = new PortalBrowser(join(directory, 'failure'), true, async () => undefined, async () => { calls++; return {action: 'manual', tiles: []}; });
      try {
        await integration.start(config); await integration.navigate(base + '/captcha');
        assert.equal((await integration.verifyCaptcha()).pending, true);
        assert.equal((await integration.verifyCaptcha()).pending, true);
        assert.equal(calls, 2);
        const bounded = await integration.verifyCaptcha();
        assert.equal(bounded.pending, true); assert.match(bounded.reason, /limit/i);
        assert.equal(calls, 2);
        await integration.page!.frames()[1].evaluate(() => { parent.postMessage('accepted', '*'); });
        await integration.page!.waitForFunction(() => Boolean((document.querySelector('textarea[name="g-recaptcha-response"]') as HTMLTextAreaElement).value));
        assert.equal((await integration.verifyCaptcha()).pending, false);
        assert.equal(calls, 2); assert.equal(new URL(integration.page!.url()).pathname, '/done');
      } finally { await integration.close(); }
    });
    if (process.env.BISMYTH_TEST_SUBSCRIPTION_VISION === '1') await context.test('real ChatGPT subscription interprets a cropped synthetic challenge', {timeout: 95000}, async () => {
      await page.goto(base + '/captcha');
      const result = await attemptCaptcha(page, new AbortController().signal, solveGridWithSubscription);
      assert.equal(result.pending, false, result.reason); assert.equal(new URL(page.url()).pathname, '/done');
    });
  } finally {
    await driver.close(); server.close(); await once(server, 'close'); await rm(directory, {recursive: true, force: true});
  }
});
