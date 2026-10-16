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

// Housing's desktop profile and account popover both render logout as plain
// clickable divs. These are deliberately not buttons or role=button controls.
const profileLink = '<a href="/user-profile/edit-profile">Edit Profile</a>';
const plainLogout = '<div onclick="window.accountCounters.signOut++;fetch(\'/sign-out\')">Log Out</div>';
const profile = profileLink + plainLogout;
const popover = '<div class="T_bottomLinksContainerStyle"><div class="T_itemStyle" data-icon="logOut2" onclick="window.accountCounters.signOut++;fetch(\'/sign-out\')">Log Out</div></div>';
const guestLogin = '<button class="T_loginBtnStyle" data-testid="buttonId" onclick="window.accountCounters.login++;fetch(\'/login-click\')">Login</button>';
const guestPhone = '<input id="phone" type="tel" data-testid="login_input_text" value="9876543210">';

test('Housing login checks recognize its account divs without account actions or credential reads', {timeout: 60000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-housing-login-'));
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    requests++;
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Housing local login fixture</title><script>window.accountCounters={login:0,signOut:0,valueReads:0};window.isLoggedIn=true;</script><main>Fixture ready</main>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const options = {portalUrls: {housing: base + '/user-profile/edit-profile', nobroker: base + '/nobroker'}};
  const accounts = new AccountBrowser(directory, true, options);
  const config = {browserPath: await browserPath()};
  try {
    assert.equal((await accounts.open('housing', config)).status, 'unknown');
    const page = accounts.page!;
    await accounts.browser!.addCookies([{name: 'isLoggedIn', value: 'true', url: base, expires: Math.floor(Date.now() / 1000) + 600}]);
    const cases: Array<{name: string; html: string; status: AccountStatus; path?: string; title?: string}> = [
      {name: 'profile navigation and visible plain-div logout', html: profile, status: 'signed-in'},
      {name: 'profile navigation and logout with normalized spacing', html: profileLink + plainLogout.replace('Log Out', '  Log  Out  '), status: 'signed-in'},
      {name: 'profile editing phone field is not a login phone field', html: profile + '<input type="text" placeholder="NAME" value="Fixture person"><input type="text" placeholder="EMAIL" value="fixture@example.invalid"><button class="T_formButtonStyles">Save Changes</button><div>CHANGE PHONE NUMBER</div><input type="tel" placeholder="PHONE" value="9876543210">', status: 'signed-in'},
      {name: 'authenticated account popover on the homepage', html: popover, path: '/', status: 'signed-in'},
      {name: 'authenticated account popover within header', html: `<header data-q="header">${popover}</header>`, path: '/', status: 'signed-in'},
      {name: 'authenticated profile header with sibling Edit button', html: '<div class="T_subContainerStyle"><div class="T_detailsContainerStyle"><div class="T_HelloWrapper">Hello Fixture!</div></div></div><button class="T_editBtnStyle">Edit</button>', path: '/', status: 'signed-in'},
      {name: 'Edit without authenticated greeting does not prove login', html: '<div class="T_subContainerStyle"></div><button class="T_editBtnStyle">Edit</button>', path: '/', status: 'unknown'},
      {name: 'greeting without the authenticated Edit control does not prove login', html: '<div class="T_subContainerStyle"><div class="T_HelloWrapper">Hello</div></div>', path: '/', status: 'unknown'},
      {name: 'hidden authenticated profile header does not prove login', html: '<div style="display:none"><div class="T_subContainerStyle"><div class="T_HelloWrapper">Hello</div></div><button class="T_editBtnStyle">Edit</button></div>', path: '/', status: 'unknown'},
      {name: 'profile URL alone is not proof', html: '<main>Property search</main>', status: 'unknown'},
      {name: 'profile navigation alone is not proof', html: profileLink, status: 'unknown'},
      {name: 'plain logout outside the profile is not proof', html: plainLogout, path: '/', status: 'unknown'},
      {name: 'profile link and plain logout outside the profile are not proof', html: profile, path: '/', status: 'unknown'},
      {name: 'plain logout without profile navigation is not proof', html: plainLogout, status: 'unknown'},
      {name: 'profile navigation hidden through an ancestor is not proof', html: `<section style="display:none">${profileLink}</section>${plainLogout}`, status: 'unknown'},
      {name: 'logout hidden directly is not proof', html: profileLink + plainLogout.replace('<div ', '<div style="display:none" '), status: 'unknown'},
      {name: 'profile hidden through display is not proof', html: `<section style="display:none">${profile}</section>`, status: 'unknown'},
      {name: 'profile hidden through visibility is not proof', html: `<section style="visibility:hidden">${profile}</section>`, status: 'unknown'},
      {name: 'profile transparent through an ancestor is not proof', html: `<section style="opacity:0">${profile}</section>`, status: 'unknown'},
      {name: 'hidden popover is not proof', html: `<section style="display:none">${popover}</section>`, path: '/', status: 'unknown'},
      {name: 'transparent popover is not proof', html: `<section style="opacity:0">${popover}</section>`, path: '/', status: 'unknown'},
      {name: 'popover container without logout is not proof', html: '<div class="T_bottomLinksContainerStyle"><div class="T_itemStyle">Visit Help Center</div></div>', path: '/', status: 'unknown'},
      {name: 'logout icon outside its account container is not proof', html: '<div class="T_itemStyle" data-icon="logOut2">Log Out</div>', path: '/', status: 'unknown'},
      {name: 'unrelated text containing Log Out is not proof', html: profileLink + '<div>You can Log Out later</div>', status: 'unknown'},
      {name: 'visible Housing login button is signed out', html: guestLogin, status: 'signed-out'},
      {name: 'visible Housing login phone field is signed out', html: guestPhone, status: 'signed-out'},
      {name: 'login button overrides stale authenticated profile', html: profile + guestLogin, status: 'signed-out'},
      {name: 'login phone field overrides stale authenticated profile', html: profile + guestPhone, status: 'signed-out'},
      {name: 'visible OTP overrides stale authenticated profile', html: profile + '<input autocomplete="one-time-code" value="123456">', status: 'signed-out'},
      {name: 'visible password overrides stale authenticated profile', html: profile + '<input type="password" value="synthetic-fixture-password">', status: 'signed-out'},
      {name: 'hidden login fields do not override authenticated profile', html: profile + `<section style="display:none">${guestPhone}<input type="password" value="synthetic-fixture-password"></section>`, status: 'signed-in'},
      {name: 'security heading overrides stale authenticated profile', html: profile + '<h1>Verify you are human</h1>', status: 'blocked'},
      {name: 'security title overrides stale authenticated profile', html: profile, title: 'Security checkup', status: 'blocked'},
      {name: 'visible challenge overrides stale authenticated profile', html: profile + '<div class="g-recaptcha" style="width:300px;height:80px">Challenge fixture</div>', status: 'blocked'},
      {name: 'retained cookie and runtime flag without account DOM are not proof', html: '<main>Property search</main>', status: 'unknown'},
    ];
    for (const fixture of cases) {
      await page.evaluate(({html, title, path}) => {
        history.replaceState(null, '', path || '/user-profile/edit-profile');
        document.title = title || 'Housing local login fixture';
        document.body.innerHTML = html;
        const counters = (window as unknown as {accountCounters: {valueReads: number}}).accountCounters;
        for (const input of document.querySelectorAll('input')) {
          Object.defineProperty(input, 'value', {get: () => { counters.valueReads++; throw new Error('Credential values must not be read'); }});
        }
      }, fixture);
      const before = requests;
      const url = page.url();
      assert.equal((await accounts.check('housing')).status, fixture.status, fixture.name);
      assert.equal(page.url(), url, fixture.name + ': check must not navigate');
      assert.equal(requests, before, fixture.name + ': check must not issue requests');
      assert.deepEqual(await page.evaluate(() => (window as unknown as {accountCounters: object}).accountCounters), {login: 0, signOut: 0, valueReads: 0}, fixture.name + ': check must only inspect DOM');
    }
    assert.equal((await accounts.browser!.cookies(base)).some(cookie => cookie.name === 'isLoggedIn'), true);

    // Housing-specific account markers must not authenticate another portal.
    assert.equal((await accounts.open('nobroker', config)).status, 'unknown');
    const otherPage = accounts.page!;
    for (const html of [profile, popover]) {
      await otherPage.evaluate(body => {
        history.replaceState(null, '', '/user-profile/edit-profile');
        document.body.innerHTML = body;
      }, html);
      const before = requests;
      assert.equal((await accounts.check('nobroker')).status, 'unknown');
      assert.equal(requests, before);
      assert.deepEqual(await otherPage.evaluate(() => (window as unknown as {accountCounters: object}).accountCounters), {login: 0, signOut: 0, valueReads: 0});
    }
  } finally {
    await accounts.close();
    server.close(); await once(server, 'close');
    await rm(directory, {recursive: true, force: true});
  }
});
