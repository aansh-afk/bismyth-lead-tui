import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Page} from 'playwright-core';
import {AccountBrowser} from '../account-browser.js';
import {PortalBrowser, browserPath} from '../browser.js';
import {defaults} from '../model.js';

test('account login uses the shared profile, preserves tabs, and only inspects current-page transitions', {timeout: 60000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-accounts-'));
  let navigations = 0; let submissions = 0; let challengeClicks = 0;
  const server = createServer((request, response) => {
    if (request.url === '/submit') { submissions++; response.end('ok'); return; }
    if (request.url === '/challenge-click') { challengeClicks++; response.end('ok'); return; }
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    navigations++;
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/blocked') {
      response.end('<title>Security checkup</title><h1>Verify you are human</h1><button onclick="fetch(\'/challenge-click\')">Login</button><button onclick="fetch(\'/challenge-click\')">Try again</button>'); return;
    }
    if (request.url === '/unknown') { response.end('<title>Unknown account state</title><a>My profile</a>'); return; }
    const plainType = new Map([
      ['/plain-phone', {type: 'tel', name: 'phone', value: '+919000000000'}],
      ['/plain-email', {type: 'email', name: 'email', value: 'fixture@example.test'}],
      ['/plain-username', {type: 'text', name: 'username', value: 'fixture-user'}],
      ['/plain-number', {type: 'number', name: 'credential', value: '9000000000'}],
      ['/plain-text', {type: 'text', name: 'generic', value: 'typed-fixture'}],
    ]).get(request.url || '');
    if (plainType) {
      response.end(`<!doctype html><title>Plain div login fixture</title><div><input type="${plainType.type}" name="${plainType.name}" value="${plainType.value}"><button type="button" onclick="window.plainClicks=(window.plainClicks||0)+1;fetch('/submit')">Login</button></div>`); return;
    }
    response.end(`<!doctype html><title>Local account fixture</title>
      <button id="login" onclick="window.loginEntries=(window.loginEntries||0)+1;document.querySelector('form').hidden=false">Login</button>
      <form hidden onsubmit="event.preventDefault(); fetch('/submit')"><label>Password<input type="password" value="fixture-secret"></label><input autocomplete="one-time-code" value="123456"><button>Login</button></form>
      <button id="logout" hidden>Logout</button>
      <script>window.signedIn=()=>{document.querySelector('#login').hidden=true;document.querySelector('form').hidden=true;document.querySelector('#logout').hidden=false;document.cookie='accountFixture=retained;max-age=600;path=/'};</script>`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const config = {...defaults, browserPath: await browserPath()};
  const options = {portalUrls: {'99acres': base + '/login', housing: base + '/blocked', olx: base + '/unknown', quikr: base + '/retry', nobroker: base + '/plain-phone', squareyards: base + '/plain-email', magicbricks: base + '/plain-username'}};
  let accounts = new AccountBrowser(directory, true, options);
  let driver: PortalBrowser | undefined;
  try {
    assert.equal((await accounts.open('99acres', config)).status, 'signed-out');
    assert.equal(await accounts.page!.locator('form').isVisible(), true);
    const page = accounts.page!;
    const before = navigations;
    await page.locator('input[type=password]').fill('manual-fixture-password');
    await page.locator('input[autocomplete="one-time-code"]').fill('654321');
    assert.equal((await accounts.open('99acres', config)).status, 'signed-out');
    assert.equal(await page.evaluate(() => (window as unknown as {loginEntries: number}).loginEntries), 1);
    assert.equal(await page.locator('input[type=password]').inputValue(), 'manual-fixture-password');
    assert.equal(await page.locator('input[autocomplete="one-time-code"]').inputValue(), '654321');
    assert.equal(navigations, before);
    await page.evaluate(() => (window as unknown as {signedIn: () => void}).signedIn());
    assert.equal((await accounts.check('99acres')).status, 'signed-in');
    assert.equal((await accounts.open('99acres', config)).status, 'signed-in');
    assert.equal(accounts.page, page);
    assert.equal(navigations, before);
    assert.equal(accounts.browser!.pages().length, 1);
    assert.equal(submissions, 0);
    assert.equal(await page.locator('input[type=password]').inputValue(), 'manual-fixture-password');
    assert.equal(await page.locator('input[autocomplete="one-time-code"]').inputValue(), '654321');
    assert.equal((await accounts.open('housing', config)).status, 'blocked');
    assert.equal((await accounts.check('housing')).status, 'blocked');
    assert.equal(challengeClicks, 0);
    assert.equal((await accounts.open('olx', config)).status, 'unknown');
    assert.equal(accounts.browser!.pages().length, 3);
    await accounts.page!.goto('http://localhost:' + address.port + '/login');
    assert.equal((await accounts.check('olx')).status, 'unknown');
    // Check leaves a foreign page alone; an explicit Open restores the catalog
    // entry in the same tab, without creating another portal tab.
    await page.goto('http://localhost:' + address.port + '/login');
    const foreignChecks = navigations;
    assert.equal((await accounts.check('99acres')).status, 'unknown');
    assert.equal(navigations, foreignChecks);
    assert.equal((await accounts.open('99acres', config)).status, 'signed-out');
    assert.equal(accounts.page, page);
    assert.equal(page.url(), base + '/login');
    assert.equal(accounts.browser!.pages().length, 3);
    let retryRequests = 0;
    let recoveryAvailable = false;
    await accounts.browser!.route(base + '/retry', async route => {
      retryRequests++;
      // Chromium can retry a failed document itself. Keep the outage active
      // until the explicit application retry, rather than racing that retry.
      if (!recoveryAvailable) await route.abort('failed');
      else await route.continue();
    });
    assert.equal((await accounts.open('quikr', config)).status, 'unknown');
    const retryPage = accounts.page!;
    const outageRequests = retryRequests;
    assert.ok(outageRequests >= 1);
    assert.equal((await accounts.check('quikr')).status, 'unknown');
    assert.equal(retryRequests, outageRequests);
    recoveryAvailable = true;
    const recovered = await accounts.open('quikr', config);
    assert.equal(recovered.status, 'signed-out', JSON.stringify({recovered, retryRequests, url: retryPage.url(), title: await retryPage.title()}));
    assert.equal(accounts.page, retryPage);
    assert.equal(retryPage.url(), base + '/retry');
    assert.equal(accounts.browser!.pages().length, 4);
    assert.ok(retryRequests > outageRequests);
    assert.equal(submissions, 0);
    // A plain-div Login button beside a credential field may send an OTP.
    // Account setup must never activate it, including on repeated explicit Open.
    for (const [portal, value] of [['nobroker', '+919000000000'], ['squareyards', 'fixture@example.test'], ['magicbricks', 'fixture-user']] as const) {
      assert.equal((await accounts.open(portal, config)).status, 'signed-out');
      const credentialPage: Page = accounts.page!;
      assert.equal((await accounts.open(portal, config)).status, 'signed-out');
      assert.equal(accounts.page, credentialPage);
      assert.equal(await credentialPage.locator('input').inputValue(), value);
      assert.equal(await credentialPage.evaluate(() => (window as unknown as {plainClicks?: number}).plainClicks || 0), 0);
      assert.equal(submissions, 0);
      if (portal === 'nobroker') {
        await credentialPage.locator('input').fill('+919123456789');
        const originalLocator = credentialPage.locator.bind(credentialPage);
        let inspectionFailures = 0;
        credentialPage.locator = (selector, options) => {
          const locator = originalLocator(selector, options);
          if (selector === 'input, textarea, [contenteditable="true"]') locator.evaluateAll = async () => {
            inspectionFailures++;
            throw new Error('Execution context was destroyed');
          };
          return locator;
        };
        try {
          assert.equal((await accounts.open(portal, config)).status, 'signed-out');
          assert.equal((await accounts.open(portal, config)).status, 'signed-out');
          assert.equal(inspectionFailures, 2);
          assert.equal(await credentialPage.locator('input').inputValue(), '+919123456789');
          assert.equal(await credentialPage.evaluate(() => (window as unknown as {plainClicks?: number}).plainClicks || 0), 0);
          assert.equal(submissions, 0);
        } finally { credentialPage.locator = originalLocator; }
      }
    }
    for (const [path, value] of [['/plain-number', '9000000000'], ['/plain-text', 'typed-fixture']] as const) {
      const credentialPage: Page = accounts.page!;
      await credentialPage.goto(base + path);
      assert.equal((await accounts.open('magicbricks', config)).status, 'signed-out');
      assert.equal((await accounts.open('magicbricks', config)).status, 'signed-out');
      assert.equal(accounts.page, credentialPage);
      assert.equal(await credentialPage.locator('input').inputValue(), value);
      assert.equal(await credentialPage.evaluate(() => (window as unknown as {plainClicks?: number}).plainClicks || 0), 0);
      assert.equal(submissions, 0);
    }
    assert.equal(accounts.browser!.pages().length, 7);
    await accounts.close();
    assert.equal((await accounts.check('99acres')).status, 'unknown');
    // PortalBrowser sees the same browser-profile cookie after the account window closes.
    driver = new PortalBrowser(directory, true, async () => undefined);
    await driver.start(config);
    assert.equal((await driver.browser!.cookies(base)).some(cookie => cookie.name === 'accountFixture'), true);
    await driver.close(); driver = undefined;
    // A retained cookie or an earlier signed-in observation does not establish login.
    accounts = new AccountBrowser(directory, true, options);
    assert.equal((await accounts.open('99acres', config)).status, 'signed-out');
    assert.equal((await accounts.browser!.cookies(base)).some(cookie => cookie.name === 'accountFixture'), true);
    const closed = accounts.browser!;
    await closed.close();
    assert.equal(accounts.browser, undefined);
    assert.equal((await accounts.open('99acres', config)).status, 'signed-out');
    assert.equal(submissions, 0); assert.equal(challengeClicks, 0);
    assert.equal((await readFile(join(directory, 'browser-profile', 'Default', 'Preferences'), 'utf8')).length > 0, true);
  } finally {
    await accounts.close(); await driver?.close();
    server.close(); await once(server, 'close');
    await rm(directory, {recursive: true, force: true});
  }
});

test('fixture injection refuses credential URLs and remote origins', () => {
  assert.throws(() => new AccountBrowser('/tmp/unused', true, {portalUrls: {olx: 'https://example.com/'}}), /loopback/);
  assert.throws(() => new AccountBrowser('/tmp/unused', true, {portalUrls: {olx: 'http://secret:password@localhost/'}}), /loopback/);
});
