import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AccountBrowser} from '../account-browser.js';
import {browserPath} from '../browser.js';
import type {AccountStatus} from '../accounts.js';

const profile = (menu = '<div id="sign-out" onclick="window.accountCounters.signOut++;fetch(\'/sign-out\')">Sign Out</div>', hidden = true): string =>
  `<div id="profile-icon" style="display:inline-block;width:48px;height:48px" onclick="window.accountCounters.profile++"><span>A</span><div id="profile-menu-dropdown"${hidden ? ' style="display:none"' : ''}>${menu}</div></div>`;
const login = '<div id="navheaderContainer"><div onclick="window.accountCounters.login++;fetch(\'/login-click\')">Log in</div></div>';

test('NoBroker login checks recognize the closed profile menu and inspect it without account actions', {timeout: 60000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-nobroker-login-'));
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    requests++;
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>NoBroker local login fixture</title><script>window.accountCounters={login:0,signOut:0,profile:0,valueReads:0};window.isLoggedIn=true;</script><main>Fixture ready</main>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const options = {portalUrls: {nobroker: base + '/nobroker', housing: base + '/housing'}};
  let accounts = new AccountBrowser(directory, true, options);
  const config = {browserPath: await browserPath()};
  try {
    assert.equal((await accounts.open('nobroker', config)).status, 'unknown');
    const page = accounts.page!;
    await accounts.browser!.addCookies([{name: 'isLoggedIn', value: 'true', url: base, expires: Math.floor(Date.now() / 1000) + 600}]);
    const cases: Array<{name: string; html: string; status: AccountStatus; title?: string}> = [
      {name: 'visible profile with closed plain-div menu, outside a header', html: profile(), status: 'signed-in'},
      {name: 'visible profile with open plain-div menu', html: profile(undefined, false), status: 'signed-in'},
      {name: 'signed-out plain-div header entry', html: login, status: 'signed-out'},
      {name: 'signed-out plain-div semantic header entry', html: '<header><div>Log in</div></header>', status: 'signed-out'},
      {name: 'profile hidden directly', html: profile().replace('display:inline-block', 'display:none'), status: 'unknown'},
      {name: 'profile ancestor hidden through display', html: `<section style="display:none">${profile()}</section>`, status: 'unknown'},
      {name: 'profile ancestor hidden through visibility', html: `<section style="visibility:hidden">${profile()}</section>`, status: 'unknown'},
      {name: 'profile ancestor transparent', html: `<section style="opacity:0">${profile()}</section>`, status: 'unknown'},
      {name: 'profile alone does not prove login', html: '<div id="profile-icon" style="width:48px;height:48px">A</div>', status: 'unknown'},
      {name: 'unowned menu does not prove login', html: '<div id="profile-menu-dropdown" style="display:none"><div>Sign Out</div></div>', status: 'unknown'},
      {name: 'profile menu without Sign Out does not prove login', html: profile('<div>My profile</div>'), status: 'unknown'},
      {name: 'Sign Out outside its menu does not prove login', html: '<div id="profile-icon" style="width:48px;height:48px">A<div>Sign Out</div></div>', status: 'unknown'},
      {name: 'unrelated text containing Sign Out does not prove login', html: profile('<div>You can Sign Out later</div>'), status: 'unknown'},
      {name: 'stale profile cannot override header Log in', html: profile() + login, status: 'signed-out'},
      {name: 'visible OTP overrides a stale profile', html: profile() + '<input autocomplete="one-time-code" value="123456">', status: 'signed-out'},
      {name: 'visible password overrides a stale profile', html: profile() + '<input type="password" value="synthetic-fixture-password">', status: 'signed-out'},
      {name: 'hidden OTP does not override the visible profile', html: profile() + '<section style="display:none"><input autocomplete="one-time-code" value="123456"></section>', status: 'signed-in'},
      {name: 'security heading overrides a stale profile', html: profile() + '<h1>Verify you are human</h1>', status: 'blocked'},
      {name: 'security title overrides a stale profile', html: profile(), title: 'Security checkup', status: 'blocked'},
      {name: 'visible challenge overrides a stale profile', html: profile() + '<div class="g-recaptcha" style="width:300px;height:80px">Challenge fixture</div>', status: 'blocked'},
      {name: 'retained cookie and runtime flag without account DOM are not proof', html: '<main>Property search</main>', status: 'unknown'},
    ];
    for (const fixture of cases) {
      await page.evaluate(({html, title}) => {
        document.title = title || 'NoBroker local login fixture';
        document.body.innerHTML = html;
        const counters = (window as unknown as {accountCounters: {valueReads: number}}).accountCounters;
        for (const input of document.querySelectorAll('input')) {
          // A check must inspect credential-field metadata, never passwords/OTPs.
          Object.defineProperty(input, 'value', {get: () => { counters.valueReads++; throw new Error('Credential values must not be read'); }});
        }
      }, fixture);
      const before = requests;
      const url = page.url();
      const observation = await accounts.check('nobroker');
      assert.equal(observation.status, fixture.status, fixture.name);
      assert.equal(page.url(), url, fixture.name + ': check must not navigate');
      assert.equal(requests, before, fixture.name + ': check must not issue requests');
      assert.deepEqual(await page.evaluate(() => (window as unknown as {accountCounters: object}).accountCounters), {login: 0, signOut: 0, profile: 0, valueReads: 0}, fixture.name + ': check must only inspect DOM');
    }
    assert.equal((await accounts.browser!.cookies(base)).some(cookie => cookie.name === 'isLoggedIn'), true);

    // The NoBroker-specific marker is not accepted for another portal.
    assert.equal((await accounts.open('housing', config)).status, 'unknown');
    const housingPage = accounts.page!;
    await housingPage.evaluate(html => { document.body.innerHTML = html; }, profile());
    const beforeHousing = requests;
    assert.equal((await accounts.check('housing')).status, 'unknown');
    assert.equal(requests, beforeHousing);
    assert.deepEqual(await housingPage.evaluate(() => (window as unknown as {accountCounters: object}).accountCounters), {login: 0, signOut: 0, profile: 0, valueReads: 0});

    // An explicit foreign navigation is our fixture action, not the check's.
    await page.goto(`http://localhost:${address.port}/foreign`);
    await page.evaluate(html => { document.body.innerHTML = html; }, profile());
    const foreignUrl = page.url(); const beforeForeign = requests;
    assert.equal((await accounts.check('nobroker')).status, 'unknown');
    assert.equal(page.url(), foreignUrl); assert.equal(requests, beforeForeign);

    await accounts.close();
    accounts = new AccountBrowser(directory, true, options);
    assert.equal((await accounts.open('nobroker', config)).status, 'unknown');
    assert.equal((await accounts.browser!.cookies(base)).some(cookie => cookie.name === 'isLoggedIn'), true);
  } finally {
    await accounts.close();
    server.close(); await once(server, 'close');
    await rm(directory, {recursive: true, force: true});
  }
});
