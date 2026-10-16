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

const accountControl = (text = 'MyQuikr', attributes = 'data-togg="dropdown" data-area="dashboardMenu"'): string =>
  `<header><a id="loggedInMyAc" ${attributes} href="/dashboard" onclick="window.accountCounters.profile++;fetch('/profile-click')">${text}</a><div id="dashboardMenu" style="display:none"><a id="signOutLink" href="/logout" onclick="window.accountCounters.signOut++;fetch('/logout')">Log Out</a></div></header>`;
const hamburgerLogout = (text = 'Logout'): string =>
  `<header><nav><a id="hamLogoutLink" href="/logout" onclick="window.accountCounters.signOut++;fetch('/logout')">${text}</a></nav></header>`;
const guest = '<header><a id="loginLink" href="/login" onclick="window.accountCounters.login++;fetch(\'/login-click\')">Login/Register</a><div id="dashboardMenu" style="display:none"><a id="signOutLink" href="/logout" onclick="window.accountCounters.signOut++;fetch(\'/logout\')">Log Out</a></div></header>';

test('Quikr login checks recognize the authenticated account branch without opening menus or reading credentials', {timeout: 60000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-quikr-login-'));
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    requests++;
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Quikr local login fixture</title><script>window.accountCounters={login:0,signOut:0,profile:0,valueReads:0};window.isLoggedIn=true;window.loggedInUser={name:"Fixture user"};</script><main>Fixture ready</main>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const options = {portalUrls: {quikr: base + '/quikr', housing: base + '/housing'}};
  let accounts = new AccountBrowser(directory, true, options);
  const config = {browserPath: await browserPath()};
  try {
    assert.equal((await accounts.open('quikr', config)).status, 'unknown');
    const page = accounts.page!;
    await accounts.browser!.addCookies([{name: 'isLoggedIn', value: 'true', url: base, expires: Math.floor(Date.now() / 1000) + 600}]);
    await page.evaluate(() => { localStorage.setItem('loggedIn', 'true'); });
    const cases: Array<{name: string; html: string; status: AccountStatus; title?: string}> = [
      {name: 'visible authenticated MyQuikr dropdown with closed menu', html: accountControl(), status: 'signed-in'},
      {name: 'visible authenticated My Quikr dropdown with closed menu', html: accountControl('My Quikr'), status: 'signed-in'},
      {name: 'visible authenticated name-only dropdown with closed menu', html: accountControl('Fixture user'), status: 'signed-in'},
      {name: 'visible authenticated plain-div dropdown', html: accountControl().replace('<a id="loggedInMyAc"', '<div id="loggedInMyAc"').replace('>MyQuikr</a>', '>MyQuikr</div>'), status: 'signed-in'},
      {name: 'visible desktop hamburger logout', html: hamburgerLogout(), status: 'signed-in'},
      {name: 'visible mobile hamburger logout with icon-only content', html: hamburgerLogout('<svg width="24" height="24" aria-label="Sign out"><path d="M0 0h10v10H0z" /></svg>'), status: 'signed-in'},
      {name: 'guest login ignores the always-mounted hidden logout', html: guest, status: 'signed-out'},
      {name: 'guest plain-div login ignores the hidden logout', html: guest.replace('<a id="loginLink"', '<div id="loginLink"').replace('>Login/Register</a>', '>Login/Register</div>'), status: 'signed-out'},
      {name: 'hidden logout alone is not proof', html: '<header><div id="dashboardMenu" style="display:none"><a id="signOutLink" href="/logout">Log Out</a></div></header>', status: 'unknown'},
      {name: 'authenticated branch hidden directly', html: accountControl().replace('id="loggedInMyAc"', 'id="loggedInMyAc" style="display:none"'), status: 'unknown'},
      {name: 'authenticated branch ancestor hidden through display', html: `<section style="display:none">${accountControl()}</section>`, status: 'unknown'},
      {name: 'authenticated branch ancestor hidden through visibility', html: `<section style="visibility:hidden">${accountControl()}</section>`, status: 'unknown'},
      {name: 'authenticated branch ancestor transparent', html: `<section style="opacity:0">${accountControl()}</section>`, status: 'unknown'},
      {name: 'hamburger logout ancestor hidden', html: `<section style="display:none">${hamburgerLogout()}</section>`, status: 'unknown'},
      {name: 'hamburger logout ancestor transparent', html: `<section style="opacity:0">${hamburgerLogout()}</section>`, status: 'unknown'},
      {name: 'account ID without dropdown attributes is not proof', html: accountControl('MyQuikr', ''), status: 'unknown'},
      {name: 'missing dashboard relationship is not proof', html: accountControl('MyQuikr', 'data-togg="dropdown"'), status: 'unknown'},
      {name: 'missing dropdown marker is not proof', html: accountControl('MyQuikr', 'data-area="dashboardMenu"'), status: 'unknown'},
      {name: 'unrelated dropdown destination is not proof', html: accountControl('MyQuikr', 'data-togg="dropdown" data-area="unrelatedMenu"'), status: 'unknown'},
      {name: 'unrelated MyQuikr marketing link is not proof', html: '<main><a href="/help/myquikr">MyQuikr</a></main>', status: 'unknown'},
      {name: 'unrelated MyQuikr text is not proof', html: '<main>Learn how to use MyQuikr to manage your ads.</main>', status: 'unknown'},
      {name: 'guest login overrides stale authenticated account control', html: accountControl() + guest, status: 'signed-out'},
      {name: 'guest login overrides stale hamburger logout', html: hamburgerLogout() + guest, status: 'signed-out'},
      {name: 'visible OTP overrides stale authenticated account control', html: accountControl() + '<input autocomplete="one-time-code" value="123456">', status: 'signed-out'},
      {name: 'visible password overrides stale authenticated account control', html: accountControl() + '<input type="password" value="synthetic-fixture-password">', status: 'signed-out'},
      {name: 'hidden OTP does not override authenticated account control', html: accountControl() + '<section style="display:none"><input autocomplete="one-time-code" value="123456"></section>', status: 'signed-in'},
      {name: 'security heading overrides authenticated account control', html: accountControl() + '<h1>Verify you are human</h1>', status: 'blocked'},
      {name: 'security title overrides authenticated account control', html: accountControl(), title: 'Security checkup', status: 'blocked'},
      {name: 'visible challenge overrides authenticated account control', html: accountControl() + '<div class="g-recaptcha" style="width:300px;height:80px">Challenge fixture</div>', status: 'blocked'},
      {name: 'security gate takes priority over guest login too', html: guest + '<h1>Access denied</h1>', status: 'blocked'},
      {name: 'cookies, storage and runtime login flags are not proof', html: '<main>Property search</main>', status: 'unknown'},
    ];
    for (const fixture of cases) {
      await page.evaluate(({html, title}) => {
        document.title = title || 'Quikr local login fixture';
        document.body.innerHTML = html;
        const counters = (window as unknown as {accountCounters: {valueReads: number}}).accountCounters;
        for (const input of document.querySelectorAll('input')) {
          Object.defineProperty(input, 'value', {get: () => { counters.valueReads++; throw new Error('Credential values must not be read'); }});
        }
      }, fixture);
      const before = requests;
      const url = page.url();
      const observation = await accounts.check('quikr');
      assert.equal(observation.status, fixture.status, fixture.name);
      assert.equal(page.url(), url, fixture.name + ': check must not navigate');
      assert.equal(requests, before, fixture.name + ': check must not issue requests');
      assert.deepEqual(await page.evaluate(() => (window as unknown as {accountCounters: object}).accountCounters), {login: 0, signOut: 0, profile: 0, valueReads: 0}, fixture.name + ': check must only inspect DOM');
    }
    assert.equal((await accounts.browser!.cookies(base)).some(cookie => cookie.name === 'isLoggedIn'), true);

    // A Quikr-specific account branch cannot establish another portal's login.
    assert.equal((await accounts.open('housing', config)).status, 'unknown');
    const housingPage = accounts.page!;
    await housingPage.evaluate(html => { document.body.innerHTML = html; }, accountControl());
    const beforeHousing = requests;
    assert.equal((await accounts.check('housing')).status, 'unknown');
    assert.equal(requests, beforeHousing);
    assert.deepEqual(await housingPage.evaluate(() => (window as unknown as {accountCounters: object}).accountCounters), {login: 0, signOut: 0, profile: 0, valueReads: 0});

    // The same DOM at a foreign origin must not establish first-party login.
    await page.goto(`http://localhost:${address.port}/foreign`);
    await page.evaluate(html => { document.body.innerHTML = html; }, accountControl());
    const foreignUrl = page.url(); const beforeForeign = requests;
    assert.equal((await accounts.check('quikr')).status, 'unknown');
    assert.equal(page.url(), foreignUrl); assert.equal(requests, beforeForeign);

    await accounts.close();
    accounts = new AccountBrowser(directory, true, options);
    assert.equal((await accounts.open('quikr', config)).status, 'unknown');
    assert.equal((await accounts.browser!.cookies(base)).some(cookie => cookie.name === 'isLoggedIn'), true);
  } finally {
    await accounts.close();
    server.close(); await once(server, 'close');
    await rm(directory, {recursive: true, force: true});
  }
});
