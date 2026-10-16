import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AccountBrowser} from '../account-browser.js';
import {browserPath} from '../browser.js';
import {defaults} from '../model.js';
import type {AccountPortal, AccountStatus} from '../accounts.js';

test('account checks distinguish passive reCAPTCHA badges from active security checks without interacting', {timeout: 60000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-account-badge-'));
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>My Portfolio</title><h1>Manage your properties</h1>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const accounts = new AccountBrowser(directory, true, {portalUrls: {squareyards: base + '/user/my-portfolio', housing: base + '/user-profile'}});
  const badge = '<div class="grecaptcha-badge" style="position:fixed;bottom:8px;right:8px;width:256px;height:60px"><iframe title="reCAPTCHA" src="/recaptcha/api2/anchor?size=invisible" width="256" height="60"></iframe></div>';
  const logout = '<nav><a href="/user/my-portfolio">My Portfolio</a><button onclick="window.fixtureClicks++;fetch(\'/logout\')">Logout</button></nav>';
  const plainLogout = '<li class="userLogout"><div class="logOut" onclick="window.fixtureClicks++;fetch(\'/logout\')">Logout</div></li>';
  const dropdownLogout = '<ul class="lgnDsktpDrpdwnUl">' + plainLogout + '</ul>';
  const headerProfile = '<div class="headerProfileBoxParent withUserProfile"><div class="headerProfileBox"><figure>A</figure><strong>Account</strong><div class="profileDropdownBox" hidden><ul>' + plainLogout + '</ul></div></div></div>';
  const portfolioLabels = '<aside><div>Profile</div><div>My Portfolio</div><div onclick="window.fixtureClicks++;fetch(\'/logout\')">Logout</div></aside>';
  const fixtures: {name: string; body: string; status: AccountStatus; title?: string; path?: string; portal?: AccountPortal}[] = [
    {name: 'signed-in portfolio with a passive corner badge', body: logout + badge, status: 'signed-in'},
    {name: 'passive badge mounted under a normal g-recaptcha container', body: logout + '<div class="g-recaptcha">' + badge + '</div>', status: 'signed-in'},
    {name: 'invisible g-recaptcha container without an active challenge', body: logout + '<div class="g-recaptcha" data-size="invisible" style="width:256px;height:60px"></div>', status: 'signed-in'},
    {name: 'guest login with passive badge', body: '<button onclick="window.fixtureClicks++;fetch(\'/login\')">Login</button>' + badge, status: 'signed-out'},
    {name: 'badge alone does not prove login', body: badge, status: 'unknown'},
    {name: 'active image challenge alongside passive badge', body: logout + badge + '<iframe title="reCAPTCHA challenge" src="/recaptcha/api2/bframe?k=fixture" width="300" height="300"></iframe>', status: 'blocked'},
    {name: 'visible checkbox alongside passive badge', body: logout + badge + '<iframe title="reCAPTCHA checkbox" src="/recaptcha/api2/anchor?size=normal" width="304" height="78"></iframe>', status: 'blocked'},
    {name: 'visible non-invisible reCAPTCHA widget', body: logout + badge + '<div class="g-recaptcha" style="width:304px;height:78px">Verify</div>', status: 'blocked'},
    {name: 'active hCaptcha challenge alongside passive badge', body: logout + badge + '<iframe title="hCaptcha challenge" src="/hcaptcha/challenge" width="300" height="300"></iframe>', status: 'blocked'},
    {name: 'hCaptcha inside an unrelated badge wrapper remains blocked', body: logout + '<div class="grecaptcha-badge" style="width:300px;height:300px"><iframe src="/hcaptcha/challenge" width="300" height="300"></iframe></div>', status: 'blocked'},
    {name: 'Cloudflare security iframe alongside passive badge', body: logout + badge + '<iframe title="Cloudflare challenge" src="/challenges.cloudflare.com/challenge" width="300" height="150"></iframe>', status: 'blocked'},
    {name: 'security heading overrides logout and passive badge', body: logout + badge + '<h1>Verify you are human</h1>', status: 'blocked'},
    {name: 'security title overrides logout and passive badge', body: logout + badge, title: 'Security checkup', status: 'blocked'},
    {name: 'hidden badge and hidden challenge are irrelevant', body: logout + '<section hidden>' + badge + '<iframe title="hidden challenge" src="/recaptcha/api2/bframe" width="300" height="300"></iframe></section>', status: 'signed-in'},
    {name: 'Square Yards visible desktop plain-div logout proves login off portfolio route', body: dropdownLogout + badge, path: '/sale/property-for-sale-in-mumbai', status: 'signed-in'},
    {name: 'Square Yards hidden desktop logout does not prove login', body: '<section hidden>' + dropdownLogout + '</section>' + badge, status: 'unknown'},
    {name: 'Square Yards authenticated header owns its hidden logout dropdown', body: headerProfile + badge, status: 'signed-in'},
    {name: 'Square Yards header alone has no authenticated logout evidence', body: '<div class="headerProfileBoxParent withUserProfile"><div class="headerProfileBox">A</div></div>' + badge, status: 'unknown'},
    {name: 'Square Yards hidden header does not prove login', body: '<section hidden>' + headerProfile + '</section>' + badge, status: 'unknown'},
    {name: 'Square Yards header signature does not authenticate Housing', body: headerProfile + badge, portal: 'housing', status: 'unknown'},
    {name: 'Square Yards plain-div logout structure does not authenticate Housing', body: dropdownLogout + badge, portal: 'housing', status: 'unknown'},
    {name: 'guest login overrides a stale Square Yards profile header', body: '<button>Login</button>' + headerProfile + badge, status: 'signed-out'},
    {name: 'Square Yards screenshot portfolio labels and passive badge prove login', body: portfolioLabels + badge, path: '/user/my-portfolio', status: 'signed-in'},
    {name: 'Square Yards portfolio route and navigation alone do not prove login', body: '<aside><div>Profile</div><div>My Portfolio</div></aside>' + badge, path: '/user/my-portfolio', status: 'unknown'},
    {name: 'Square Yards plain logout without profile context does not prove login', body: '<div>Logout</div>' + badge, path: '/user/my-portfolio', status: 'unknown'},
    {name: 'Square Yards portfolio labels on another route do not prove login', body: portfolioLabels + badge, path: '/public/search', status: 'unknown'},
    {name: 'active image challenge remains blocked even inside badge wrapper', body: logout + '<div class="grecaptcha-badge" style="width:300px;height:300px"><iframe title="reCAPTCHA challenge" src="/recaptcha/api2/bframe?k=fixture" width="300" height="300"></iframe></div>', status: 'blocked'},
  ];
  try {
    assert.equal((await accounts.open('squareyards', {...defaults, browserPath: await browserPath()})).status, 'unknown');
    const squareyards = accounts.page!;
    assert.equal((await accounts.open('housing', {...defaults, browserPath: await browserPath()})).status, 'unknown');
    const housing = accounts.page!;
    let iframeRequests = 0;
    // All iframe resources are local fixtures, fulfilled explicitly. No provider
    // scripts, external frames, challenge clicks, or CAPTCHA requests are used.
    await accounts.browser!.route('**/*', async route => {
      assert.equal(new URL(route.request().url()).origin, base);
      iframeRequests++;
      await route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>Local security iframe fixture</title>'});
    });
    for (const fixture of fixtures) {
      const portal = fixture.portal || 'squareyards';
      const page = portal === 'housing' ? housing : squareyards;
      await page.evaluate(path => history.replaceState({}, '', path), fixture.path || '/');
      await page.setContent(`<!doctype html><title>${fixture.title || 'My Portfolio'}</title>${fixture.body}
        <input id="fixture-phone" type="tel" value="9000000000" hidden>
        <input type="password" value="fixture-password" hidden>
        <input autocomplete="one-time-code" value="123456" hidden>
        <script>
        (() => {
          window.fixtureClicks = 0;
          window.fixtureFetches = 0;
          window.fixtureValueReads = 0;
          const originalFetch = window.fetch;
          window.fetch = (...args) => { window.fixtureFetches++; return originalFetch(...args); };
          const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          Object.defineProperty(HTMLInputElement.prototype, 'value', {
            configurable: true,
            get() { window.fixtureValueReads++; return valueDescriptor.get.call(this); },
            set(value) { return valueDescriptor.set.call(this, value); }
          });
          document.addEventListener('click', () => window.fixtureClicks++);
        })();
        </script>`, {waitUntil: 'load'});
      const requestsBeforeCheck = requests;
      const iframesBeforeCheck = iframeRequests;
      const urlBeforeCheck = page.url();
      const observation = await accounts.check(portal);
      assert.equal(observation.status, fixture.status, fixture.name);
      assert.equal(page.url(), urlBeforeCheck, fixture.name + ': no navigation');
      assert.equal(requests, requestsBeforeCheck, fixture.name + ': no page requests');
      assert.equal(iframeRequests, iframesBeforeCheck, fixture.name + ': no iframe or fetch requests');
      assert.deepEqual(await page.evaluate(() => {
        const counters = window as unknown as {fixtureClicks: number; fixtureFetches: number; fixtureValueReads: number};
        return {clicks: counters.fixtureClicks, fetches: counters.fixtureFetches, valueReads: counters.fixtureValueReads};
      }), {clicks: 0, fetches: 0, valueReads: 0}, fixture.name + ': login check only inspects account UI');
    }
  } finally {
    await accounts.close();
    server.close();
    await once(server, 'close');
    await rm(directory, {recursive: true, force: true});
  }
});
