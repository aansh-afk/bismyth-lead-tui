import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Frame, Page} from 'playwright-core';
import {PortalBrowser, browserPath} from '../browser.js';
import {defaults, project} from '../model.js';
import {attemptCaptcha, captchaCanContinue, captchaPending} from '../captcha.js';

const fast = {imageLoadMs: 300, totalMs: 20000, maxDecisions: 2, clickDelayMs: 20, settleMs: 20};

// Remove a real iframe precisely after its Frame has been enumerated, before the
// browser obtains its element. This recreates provider callbacks disposing of a
// widget without fabricating the error that Playwright produces afterward.
function detachDuringEnumeration(frame: Frame, page: Page, id: string, accept: boolean) {
  const original = frame.frameElement;
  let detached = false;
  let error = '';
  frame.frameElement = async () => {
    if (!detached) {
      detached = true;
      await page.evaluate(({id, accept}) => {
        document.getElementById(id)?.remove();
        if (accept) (document.querySelector('#proceed') as HTMLButtonElement).disabled = false;
      }, {id, accept});
    }
    try { return await original.call(frame); }
    catch (failure) { error = (failure as Error).message; throw failure; }
  };
  return {
    restore: () => { frame.frameElement = original; },
    detached: () => detached,
    error: () => error,
  };
}

test('headless CAPTCHA continuation survives accepted-widget disposal and portal callbacks', {timeout: 120000}, async context => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-captcha-continuation-'));
  const requests = new Map<string, number>();
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://fixture');
    requests.set(url.pathname + url.search, (requests.get(url.pathname + url.search) || 0) + 1);
    response.setHeader('Content-Type', 'text/html');
    if (url.pathname === '/widget/checked') {
      response.end('<!doctype html><div id="recaptcha-anchor" role="checkbox" aria-checked="true">I am not a robot</div>');
    } else if (url.pathname === '/widget/stale-anchor') {
      response.end('<!doctype html><div id="recaptcha-anchor" role="checkbox" aria-checked="false">Inactive widget</div>');
    } else if (url.pathname === '/widget/stale-blocker') {
      response.end('<!doctype html><div class="rc-doscaptcha-body-text">Inactive provider warning</div>');
    } else if (url.pathname === '/widget/grid') {
      response.end(`<!doctype html><style>body{margin:0}#rc-imageselect{width:300px}.grid{display:grid;grid-template-columns:repeat(3,90px);gap:2px}.rc-imageselect-tile{width:90px;height:90px}</style>
        <div id="rc-imageselect" role="dialog" aria-modal="true"><h2 id="instruction">Select all red squares</h2>
        <div class="grid">${Array.from({length: 9}, (_, index) => `<button class="rc-imageselect-tile" aria-pressed="false" style="background:${index === 0 ? 'red' : 'blue'}">${index + 1}</button>`).join('')}</div>
        <button id="recaptcha-verify-button">Verify</button></div>`);
    } else if (url.pathname === '/done' || url.pathname === '/property') {
      response.end('<!doctype html><h1>Property details</h1><input name="name" required><input name="phone" type="tel" required><input name="email" type="email" required><button id="proceed">Proceed</button>');
    } else if (url.pathname === '/property-widget') {
      response.end('<!doctype html><h1>Property details</h1><iframe id="stale" src="/widget/stale-anchor" style="width:400px;height:80px"></iframe><iframe id="current" src="/widget/checked" style="width:400px;height:80px"></iframe>');
    } else {
      const scenario = url.searchParams.get('case') || 'fixture';
      const widget = url.searchParams.get('widget') || 'checked';
      const stale = url.searchParams.has('stale') ? '<iframe id="stale" src="/widget/stale-blocker" style="width:400px;height:80px"></iframe>' : '';
      response.end(`<!doctype html><h1>Complete the CAPTCHA</h1>${stale}
        <iframe id="current" title="reCAPTCHA" src="/widget/${widget}" style="width:450px;height:430px"></iframe>
        <textarea name="g-recaptcha-response" hidden></textarea>
        <button id="proceed" disabled onclick="window.proceedClicks++;location.href='/done?case=${scenario}'">Proceed</button>
        <script>window.proceedClicks=0;</script>`);
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  let decisions = 0;
  const driver = new PortalBrowser(directory, true, async () => undefined, async () => { decisions++; return {action: 'manual', tiles: []}; });
  try {
    const config = {...defaults, browserPath: await browserPath(), name: 'Fixture Person', phone: '9000000000', email: 'fixture@example.invalid'};
    const page = await driver.start(config);
    const count = (path: string) => requests.get(path) || 0;
    const open = async (path: string): Promise<Frame> => {
      await page.goto(base + path);
      const frame = page.frames().find(candidate => candidate.url().startsWith(base + '/widget/') && !candidate.url().includes('stale'));
      assert.ok(frame, 'The current local widget must have loaded');
      return frame;
    };
    const noInference = async () => { throw new Error('A cleared or checkbox-only gate must not call image inference'); };

    await context.test('an enabled gate Proceed is accepted without a top-level token or checkbox inference', async () => {
      await open('/captcha?case=tokenless');
      await page.evaluate(() => { document.querySelector('iframe')!.remove(); (document.querySelector('#proceed') as HTMLButtonElement).disabled = false; });
      assert.equal(await captchaCanContinue(page), true);
      assert.equal(new URL(page.url()).pathname, '/captcha', 'The continuation probe is read-only');
      const result = await attemptCaptcha(page, new AbortController().signal, noInference, undefined, undefined, fast);
      assert.equal(result.pending, false, result.reason);
      assert.equal(new URL(page.url()).pathname, '/done');
      assert.equal(count('/done?case=tokenless'), 1, 'Proceed navigates exactly once');
      assert.equal(count('/captcha?case=tokenless'), 1, 'The gate is never reloaded');
    });

    await context.test('provider disposal during frameElement acquisition resumes the enabled tokenless gate', async () => {
      const path = '/captcha?case=detached';
      const frame = await open(path);
      const removal = detachDuringEnumeration(frame, page, 'current', true);
      try {
        const result = await attemptCaptcha(page, new AbortController().signal, noInference, undefined, undefined, fast);
        assert.equal(removal.detached(), true, 'The fixture must dispose of the actual enumerated iframe');
        assert.match(removal.error(), /Frame has been detached/i, 'Playwright itself must reproduce the user error');
        assert.equal(result.pending, false, result.reason);
        assert.equal(new URL(page.url()).pathname, '/done');
        assert.equal(count('/done?case=detached'), 1);
        assert.equal(count(path), 1);
      } finally { removal.restore(); }
    });

    await context.test('a provider token waits for delayed portal enablement before clicking Proceed once', async () => {
      await open('/captcha?case=delayed');
      await page.evaluate(() => {
        (document.querySelector('[name="g-recaptcha-response"]') as HTMLTextAreaElement).value = 'local-fixture-token';
        document.querySelector('iframe')!.remove();
      });
      assert.equal(await captchaCanContinue(page), false, 'An accepted widget alone is not a ready portal while Proceed is disabled');
      await page.evaluate(() => { setTimeout(() => { (document.querySelector('#proceed') as HTMLButtonElement).disabled = false; }, 700); });
      const started = Date.now();
      const result = await attemptCaptcha(page, new AbortController().signal, noInference, undefined, undefined, fast);
      assert.equal(result.pending, false, result.reason);
      assert.ok(Date.now() - started >= 500, 'An accepted widget cannot race ahead of the portal callback');
      assert.equal(count('/done?case=delayed'), 1);
      assert.equal(count('/captcha?case=delayed'), 1);
    });

    await context.test('an automatic portal redirect while waiting clears the gate without token, clicks or reloads', async () => {
      await open('/captcha?case=redirect');
      await page.evaluate(() => { setTimeout(() => { location.href = '/done?case=redirect'; }, 500); });
      const result = await attemptCaptcha(page, new AbortController().signal, noInference, undefined, undefined, {...fast, imageLoadMs: 2000});
      assert.equal(result.pending, false, result.reason);
      assert.equal(new URL(page.url()).pathname, '/done');
      assert.equal(count('/done?case=redirect'), 1);
      assert.equal(count('/captcha?case=redirect'), 1);
    });

    await context.test('manually enabling Proceed after two failed automatic attempts bypasses the retry cap', async () => {
      decisions = 0;
      await open('/captcha?case=manual-after-cap&widget=grid');
      assert.equal((await driver.verifyCaptcha()).pending, true);
      assert.equal((await driver.verifyCaptcha()).pending, true);
      assert.equal(decisions, 2);
      const limited = await driver.verifyCaptcha();
      assert.equal(limited.pending, true);
      assert.match(limited.reason, /attempt limit/);
      assert.equal(decisions, 2, 'The retry limit stops additional image inference');
      await page.evaluate(() => { document.querySelector('iframe')!.remove(); (document.querySelector('#proceed') as HTMLButtonElement).disabled = false; });
      const result = await driver.verifyCaptcha();
      assert.equal(result.pending, false, result.reason);
      assert.equal(decisions, 2, 'A human-cleared gate needs no extra model call');
      assert.equal(count('/done?case=manual-after-cap'), 1);
      assert.equal(count('/captcha?case=manual-after-cap&widget=grid'), 1);
    });

    await context.test('discarding a detached unrelated frame does not falsely clear a disabled live gate', async () => {
      await open('/captcha?case=stale-unrelated&stale=1');
      const frame = page.frames().find(candidate => candidate.url() === base + '/widget/stale-blocker');
      assert.ok(frame);
      const removal = detachDuringEnumeration(frame, page, 'stale', false);
      try {
        const result = await attemptCaptcha(page, new AbortController().signal, noInference, undefined, undefined, fast);
        assert.equal(removal.detached(), true);
        assert.match(removal.error(), /Frame has been detached/i);
        assert.equal(result.pending, true);
        assert.equal(result.blocked, undefined, 'A removed provider warning cannot block the current widget');
        assert.doesNotMatch(result.reason, /Frame has been detached|frame\.frameElement/);
        assert.equal(await captchaPending(page), true);
        assert.equal(await captchaCanContinue(page), false);
        assert.equal(count('/done?case=stale-unrelated'), 0);
      } finally { removal.restore(); }
    });

    await context.test('captchaPending tolerates a stale frame while retaining another visible widget', async () => {
      await page.goto(base + '/property-widget');
      const frame = page.frames().find(candidate => candidate.url() === base + '/widget/stale-anchor');
      assert.ok(frame);
      const removal = detachDuringEnumeration(frame, page, 'stale', false);
      try {
        assert.equal(await captchaPending(page), true);
        assert.equal(removal.detached(), true);
        assert.match(removal.error(), /Frame has been detached/i);
      } finally { removal.restore(); }
    });

    await context.test('a checked checkbox with disabled Proceed and no provider token stays pending', async () => {
      await open('/captcha?case=unchecked-portal');
      assert.equal(await captchaCanContinue(page), false);
      const result = await attemptCaptcha(page, new AbortController().signal, noInference, undefined, undefined, fast);
      assert.equal(result.pending, true);
      assert.equal(await captchaPending(page), true);
      assert.equal(await page.locator('#proceed').isDisabled(), true);
      assert.equal(count('/done?case=unchecked-portal'), 0);
    });

    await context.test('a stalled enabled Proceed waits once and does not keep triggering automatic readiness', async () => {
      await open('/captcha?case=stalled-proceed');
      await page.locator('#proceed').evaluate(element => {
        const button = element as HTMLButtonElement;
        button.disabled = false;
        button.onclick = () => { (window as unknown as {proceedClicks: number}).proceedClicks++; };
      });
      assert.equal(await driver.verificationReady(), true, 'A newly enabled portal continuation can be attempted');
      const before = decisions;
      const started = Date.now();
      const result = await driver.verifyCaptcha();
      assert.equal(result.pending, true, 'An enabled control is not proof that the portal actually advanced');
      assert.equal(result.continuationFailed, true);
      assert.ok(Date.now() - started >= 7500, 'The browser waits for the portal callback before declaring continuation stalled');
      assert.equal(decisions, before, 'A ready continuation needs no image inference');
      assert.equal(await driver.verificationReady(), false, 'A timed-out Proceed cannot trigger another automatic attempt');
      assert.equal(await driver.verificationReady(), false);
      assert.equal(await page.evaluate(() => (window as unknown as {proceedClicks: number}).proceedClicks), 1, 'Readiness probes never click or restart a stalled continuation');
      assert.equal(count('/done?case=stalled-proceed'), 0);
      await page.evaluate(() => {
        document.querySelector('iframe')!.remove();
        document.querySelector('h1')!.textContent = 'Property details';
        history.replaceState(null, '', '/property?case=stalled-proceed');
      });
      assert.equal(await driver.verificationReady(), true, 'Chrome leaving the gate restores readiness after the stall');
      assert.equal(count('/captcha?case=stalled-proceed'), 1, 'A stalled continuation never reloads the gate');
    });

    await context.test('a normal property Proceed does not identify a gate or navigate during preparation', async () => {
      await page.goto(base + '/property');
      const before = count('/property');
      assert.equal(await captchaPending(page), false);
      assert.equal(await captchaCanContinue(page), true, 'An already cleared page can continue without using its ordinary Proceed button');
      const prepared = await driver.prepare(project('99acres', 'Local property fixture', base + '/property'), config, false);
      assert.equal(prepared.ready, true, prepared.reason);
      assert.equal(count('/property'), before, 'Resuming a cleared form cannot reload its URL');
      assert.equal(new URL(page.url()).pathname, '/property');
    });

    await context.test('discovery collects the current search page after handoff without navigating to it again', async () => {
      const search = 'https://www.99acres.com/search/property/buy/mumbai?fixture=continuation';
      const propertyUrl = 'https://www.99acres.com/3-bhk-bedroom-apartment-flat-for-sale-in-mumbai-1234-sq-ft-spid-123456';
      const navigations: string[] = [];
      let handoffs = 0;
      const route = 'https://www.99acres.com/**';
      await page.route(route, async intercepted => {
        const url = intercepted.request().url();
        navigations.push(url);
        await intercepted.fulfill({status: 200, contentType: 'text/html', body: url === search
          ? `<!doctype html><h1>Mumbai property results</h1><a href="${propertyUrl}">Local routed property</a>`
          : '<!doctype html><h1>Local routed portal home</h1>'});
      });
      try {
        const found = await driver.discover({...config, seedUrls: []}, '99acres', 1, async () => undefined, async () => {
          handoffs++;
          await page.goto(search);
          return 'continue';
        });
        assert.equal(handoffs, 1, 'A portal home without search controls requests one search handoff');
        assert.equal(found.length, 1);
        assert.equal(found[0].url, propertyUrl);
        assert.equal(navigations.filter(url => url === search).length, 1, 'The current search seed is collected without a second request');
        assert.equal(new URL(page.url()).href, search);
      } finally { await page.unroute(route); }
    });
  } finally {
    await driver.close();
    server.close(); await once(server, 'close');
    await rm(directory, {recursive: true, force: true});
  }
});
