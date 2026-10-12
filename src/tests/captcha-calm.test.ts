import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import type {Frame, Locator} from 'playwright-core';
import {PortalBrowser, browserPath} from '../browser.js';
import {defaults} from '../model.js';
import {attemptCaptcha} from '../captcha.js';
import type {GridSolver} from '../captcha.js';

interface FixtureState {clicks: {tile: number; at: number}[]; verifies: number; scrolls: number; scrollY: number}

const state = (frame: Frame): Promise<FixtureState> => frame.evaluate(() => {
  const fixture = window as unknown as {clicks: {tile: number; at: number}[]; verifies: number; scrolls: number};
  return {clicks: fixture.clicks, verifies: fixture.verifies, scrolls: fixture.scrolls, scrollY};
});
const chooseRed: GridSolver = async (_image, _count, _signal, selected) => selected?.length
  ? {action: 'verify', tiles: []}
  : {action: 'select', tiles: [1, 3]};
const fast = {imageLoadMs: 500, totalMs: 20000, maxDecisions: 3, clickDelayMs: 20, settleMs: 20};

test('headless image CAPTCHA interaction is calm, bounded and interruptible', {timeout: 120000}, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-captcha-calm-'));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/widget') {
      const tiles = Array.from({length: 9}, (_, index) => {
        const tile = index + 1;
        const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" fill="${[1, 3].includes(tile) ? 'red' : 'blue'}"/></svg>`);
        return `<button type="button" class="rc-imageselect-tile" aria-pressed="false" onclick="window.clicks.push({tile:${tile},at:performance.now()});this.classList.toggle('rc-imageselect-tileselected');this.setAttribute('aria-pressed',String(this.classList.contains('rc-imageselect-tileselected')))"><img src="data:image/svg+xml,${svg}" alt="Tile ${tile}"></button>`;
      }).join('');
      response.end(`<!doctype html><style>
        body{margin:0}#rc-imageselect{width:300px}
        .rc-imageselect-desc-wrapper{height:60px;background:lightblue}
        .grid{display:grid;grid-template-columns:repeat(3,90px);gap:2px}
        .rc-imageselect-tile{padding:0;border:0;width:90px;height:90px;background:transparent}
        .rc-imageselect-tile img{display:block;width:90px;height:90px}
        .rc-imageselect-tile:hover{outline:3px solid orange}
        .rc-imageselect-tileselected{outline:3px solid green}
        #recaptcha-verify-button{height:36px}
      </style><div id="rc-imageselect" role="dialog" aria-modal="true">
        <div class="rc-imageselect-desc-wrapper">Select all red squares</div><div class="grid">${tiles}</div>
        <button id="recaptcha-verify-button" onclick="window.verifies++;if(JSON.stringify([...document.querySelectorAll('.rc-imageselect-tile')].flatMap((tile,index)=>tile.classList.contains('rc-imageselect-tileselected')?[index+1]:[]))==='[1,3]')parent.postMessage('accepted','*')">Verify</button>
      </div><script>window.clicks=[];window.verifies=0;window.scrolls=0;addEventListener('scroll',()=>window.scrolls++)</script>`);
    } else if (request.url === '/nested') {
      response.end('<!doctype html><iframe src="/widget" style="width:400px;height:430px"></iframe>');
    } else {
      const clipped = request.url === '/captcha-clipped';
      const offscreen = request.url === '/captcha-offscreen';
      const nested = request.url === '/captcha-nested';
      const overflow = request.url === '/captcha-overflow';
      response.end(`<!doctype html><h1>Complete the CAPTCHA</h1>
        ${overflow ? '<div style="height:120px;overflow:hidden">' : ''}
        <iframe title="reCAPTCHA" src="${nested ? '/nested' : '/widget'}" style="width:450px;height:${clipped ? 120 : 480}px;${offscreen ? 'margin-top:760px' : ''}"></iframe>
        ${overflow ? '</div>' : ''}
        <textarea name="g-recaptcha-response" hidden></textarea>
        <script>window.pageScrolls=0;addEventListener('scroll',()=>window.pageScrolls++);addEventListener('message',event=>{if(event.data==='accepted'){document.querySelector('textarea').value='local-fixture-token';document.querySelector('h1').textContent='Property details';document.querySelector('iframe').hidden=true;history.replaceState(null,'','/property')}})</script>`);
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const driver = new PortalBrowser(directory, true, async () => undefined);
  try {
    const page = await driver.start({...defaults, browserPath: await browserPath()});
    const open = async (path = '/captcha'): Promise<Frame> => {
      await page.goto(base + path);
      await page.mouse.move(0, 0);
      const frame = page.frames().find(candidate => candidate.url() === base + '/widget');
      assert.ok(frame, 'The local image widget must have loaded');
      await frame.locator('#rc-imageselect img').first().waitFor();
      return frame;
    };
    await context.test('captures the visible panel without any scrolling element screenshot calls', async () => {
      const frame = await open();
      const locatorPrototype = Object.getPrototypeOf(page.locator('body')) as {screenshot: Locator['screenshot']};
      const original = locatorPrototype.screenshot;
      let elementScreenshots = 0;
      locatorPrototype.screenshot = async function () { elementScreenshots++; throw new Error('Element screenshots can scroll the widget'); };
      try {
        const result = await attemptCaptcha(page, new AbortController().signal, chooseRed, undefined, undefined, fast);
        assert.equal(result.pending, false, result.reason);
        assert.equal(elementScreenshots, 0);
        assert.equal((await state(frame)).scrolls, 0);
        assert.equal(await page.evaluate(() => (window as unknown as {pageScrolls: number}).pageScrolls), 0);
      } finally { locatorPrototype.screenshot = original; }
    });
    for (const path of ['/captcha-clipped', '/captcha-offscreen', '/captcha-nested', '/captcha-overflow']) await context.test(`incomplete or nested visible capture ${path} produces no inference, click or scroll`, async () => {
      const frame = await open(path); let decisions = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { decisions++; return {action: 'select', tiles: [1, 3]}; }, undefined, undefined, fast);
      assert.equal(result.pending, true);
      assert.equal(decisions, 0, 'An incomplete image must never be sent to the solver');
      const observed = await state(frame);
      assert.deepEqual(observed.clicks, []); assert.equal(observed.verifies, 0); assert.equal(observed.scrolls, 0); assert.equal(observed.scrollY, 0);
      assert.equal(await page.evaluate(() => scrollY), 0);
    });
    await context.test('a harmless hover outline does not discard a valid image decision', async () => {
      const frame = await open(); let decisions = 0;
      const activity: string[] = [];
      const result = await attemptCaptcha(page, new AbortController().signal, async (_image, _count, _signal, selected) => {
        decisions++;
        if (decisions === 1) await frame.locator('.rc-imageselect-tile').first().hover();
        return selected?.length ? {action: 'verify', tiles: []} : {action: 'select', tiles: [1, 3]};
      }, undefined, async message => { activity.push(message); }, fast);
      assert.equal(result.pending, false, result.reason); assert.equal(decisions, 2);
      assert.ok(!activity.some(message => /stale answer|challenge changed/.test(message)), activity.join('\n'));
      assert.deepEqual((await state(frame)).clicks.map(click => click.tile), [1, 3]);
    });
    await context.test('a same-source sprite crop change invalidates the pending image answer', async () => {
      const frame = await open(); let decisions = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async (_image, _count, _signal, selected) => {
        decisions++;
        if (decisions === 1) await frame.locator('.rc-imageselect-tile img').first().evaluate(image => {
          (image as HTMLElement).style.position = 'relative';
          (image as HTMLElement).style.left = '-10px';
        });
        if (decisions === 2) {
          assert.deepEqual(selected, [], 'A stale crop must not receive the previous answer');
          assert.deepEqual((await state(frame)).clicks, []);
        }
        return selected?.length ? {action: 'verify', tiles: []} : {action: 'select', tiles: [1, 3]};
      }, undefined, undefined, fast);
      assert.equal(result.pending, false, result.reason); assert.equal(decisions, 3);
      assert.deepEqual((await state(frame)).clicks.map(click => click.tile), [1, 3]);
    });
    await context.test('a panel moved offscreen during inference stops without scrolling or clicking', async () => {
      const frame = await open(); let decisions = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => {
        decisions++;
        await page.locator('iframe').evaluate(element => { (element as HTMLElement).style.marginTop = '760px'; });
        return {action: 'select', tiles: [1, 3]};
      }, undefined, undefined, fast);
      assert.equal(result.pending, true); assert.equal(decisions, 1);
      const observed = await state(frame); assert.deepEqual(observed.clicks, []); assert.equal(observed.verifies, 0); assert.equal(observed.scrolls, 0); assert.equal(observed.scrollY, 0);
      assert.equal(await page.evaluate(() => scrollY), 0);
    });
    await context.test('a model selecting every tile stops before any tile or Verify click', async () => {
      const frame = await open(); let decisions = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { decisions++; return {action: 'select', tiles: [1, 2, 3, 4, 5, 6, 7, 8, 9]}; }, undefined, undefined, fast);
      assert.equal(result.pending, true); assert.match(result.reason, /all.*tiles|every.*tile/i); assert.equal(decisions, 1);
      const observed = await state(frame); assert.deepEqual(observed.clicks, []); assert.equal(observed.verifies, 0);
    });
    await context.test('already selected tile answers stop after one no-progress answer', async () => {
      const frame = await open(); let decisions = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { decisions++; return {action: 'select', tiles: [1]}; }, undefined, undefined, fast);
      assert.equal(result.pending, true); assert.match(result.reason, /progress|already selected/i); assert.equal(decisions, 2);
      assert.deepEqual((await state(frame)).clicks.map(click => click.tile), [1]);
    });
    await context.test('default timing spaces real tile clicks by at least one second', async () => {
      const frame = await open();
      const result = await attemptCaptcha(page, new AbortController().signal, chooseRed, undefined, undefined, {imageLoadMs: 500, totalMs: 25000, maxDecisions: 2});
      assert.equal(result.pending, false, result.reason);
      const observed = await state(frame); assert.deepEqual(observed.clicks.map(click => click.tile), [1, 3]);
      const interval = observed.clicks[1].at - observed.clicks[0].at;
      assert.ok(interval >= 1000, `Actual default tile spacing was ${interval.toFixed(1)} ms`);
      context.diagnostic(`Measured default interval between tile clicks: ${interval.toFixed(1)} ms`);
    });
    await context.test('Stop during the gap cancels every remaining tile click', async () => {
      const frame = await open(); const controller = new AbortController();
      const task = attemptCaptcha(page, controller.signal, chooseRed, undefined, undefined, {...fast, clickDelayMs: 500});
      const rejection = assert.rejects(task);
      await frame.waitForFunction(() => (window as unknown as {clicks: unknown[]}).clicks.length === 1, undefined, {polling: 10});
      controller.abort(); await rejection; await sleep(100);
      const observed = await state(frame); assert.deepEqual(observed.clicks.map(click => click.tile), [1]); assert.equal(observed.verifies, 0);
    });
    await context.test('a pause checkpoint holds subsequent tile clicks until resumed', async () => {
      const frame = await open();
      let paused = false; let release: () => void = () => undefined; let enteredCheckpoint = false;
      const resume = new Promise<void>(resolve => { release = resolve; });
      const checkpoint = async (): Promise<void> => { if (paused) { enteredCheckpoint = true; await resume; } };
      const task = attemptCaptcha(page, new AbortController().signal, chooseRed, undefined, undefined, {...fast, clickDelayMs: 250}, checkpoint);
      await frame.waitForFunction(() => (window as unknown as {clicks: unknown[]}).clicks.length === 1, undefined, {polling: 10});
      paused = true;
      try {
        await sleep(500);
        assert.equal(enteredCheckpoint, true, 'CAPTCHA actions must await a checkpoint inside the tile loop');
        const observed = await state(frame); assert.deepEqual(observed.clicks.map(click => click.tile), [1]); assert.equal(observed.verifies, 0);
      } finally { paused = false; release(); }
      const result = await task; assert.equal(result.pending, false, result.reason);
      assert.deepEqual((await state(frame)).clicks.map(click => click.tile), [1, 3]);
    });
    await context.test('a changed instruction while the pending answer is paused requires fresh inference', async () => {
      const frame = await open(); let decisions = 0; let pausePending = false; let pauseUsed = false;
      let resume: () => void = () => undefined; let paused: () => void = () => undefined;
      const resumeSignal = new Promise<void>(resolve => { resume = resolve; });
      const pausedSignal = new Promise<void>(resolve => { paused = resolve; });
      const checkpoint = async (): Promise<void> => {
        if (pausePending && !pauseUsed) {
          pauseUsed = true; paused(); await resumeSignal;
          await frame.locator('.rc-imageselect-desc-wrapper').evaluate(element => { element.textContent = 'Updated challenge: select all red squares'; });
        }
      };
      const task = attemptCaptcha(page, new AbortController().signal, async (_image, _count, _signal, selected) => {
        decisions++;
        if (decisions === 2) { assert.deepEqual(selected, []); assert.deepEqual((await state(frame)).clicks, []); }
        return selected?.length ? {action: 'verify', tiles: []} : {action: 'select', tiles: [1, 3]};
      }, undefined, async message => { if (message.includes('selecting image tiles')) pausePending = true; }, fast, checkpoint);
      await pausedSignal;
      try { await sleep(100); assert.deepEqual((await state(frame)).clicks, []); }
      finally { resume(); }
      const result = await task; assert.equal(result.pending, false, result.reason); assert.equal(decisions, 3);
      assert.deepEqual((await state(frame)).clicks.map(click => click.tile), [1, 3]);
    });
    await context.test('an unchanged rejected challenge receives at most one Verify click', async () => {
      const frame = await open(); let decisions = 0;
      const result = await attemptCaptcha(page, new AbortController().signal, async () => { decisions++; return {action: 'verify', tiles: []}; }, undefined, undefined, fast);
      assert.equal(result.pending, true); assert.match(result.reason, /verify|verif|unchanged|progress/i);
      const observed = await state(frame); assert.equal(observed.verifies, 1); assert.deepEqual(observed.clicks, []);
      assert.ok(decisions <= 2, `An unchanged challenge used ${decisions} solver decisions`);
    });
  } finally { await driver.close(); server.close(); await once(server, 'close'); await rm(directory, {recursive: true, force: true}); }
});
