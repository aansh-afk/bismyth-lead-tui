import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {PortalBrowser, browserPath} from '../browser.js';

// Exercise the added portal guard without contacting or interacting with a
// verification provider. Every request is fulfilled by this local fixture.
test('new portal verification remains a read-only Chrome handoff', {timeout: 30000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-portal-verification-'));
  const browser = await chromium.launch({executablePath: await browserPath(), headless: true, chromiumSandbox: true});
  let decisions = 0;
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: '<h1>Security Checkup</h1><button onclick="window.fixtureClicks=(window.fixtureClicks||0)+1">Continue</button>'}));
    const driver = new PortalBrowser(directory, true, async () => undefined, async () => { decisions++; throw new Error('No model decision is allowed for website verification in this fixture.'); });
    driver.page = page;
    for (const host of ['www.squareyards.com', 'www.magicbricks.com', 'www.olx.in', 'www.quikr.com']) {
      await page.goto('https://' + host + '/fixture-verification');
      const result = await driver.verifyCaptcha();
      assert.equal(result.pending, true);
      assert.match(result.reason, /Chrome.*C rechecks/);
      assert.equal(await page.evaluate(() => (window as unknown as {fixtureClicks?: number}).fixtureClicks || 0), 0);
    }
    assert.equal(decisions, 0);
  } finally { await browser.close(); await rm(directory, {recursive: true, force: true}); }
});
