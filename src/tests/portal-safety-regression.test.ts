import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Locator} from 'playwright-core';
import {PortalBrowser, browserPath} from '../browser.js';
import type {Driver} from '../browser.js';
import {createRun, defaults, project} from '../model.js';
import {visibleListingContacts} from '../portal-contacts.js';
import {Runner} from '../runner.js';
import {Store} from '../store.js';

const url = 'https://housing.com/in/buy/resale/page/fixture-safety';
const config = {...structuredClone(defaults), stateCode: 'MH', city: 'Mumbai', name: 'Fixture Operator', phone: '+919000000000', email: 'operator@example.test', sites: ['housing' as const], delayMs: 0};
async function fixture(html: string) {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-portal-safety-'));
  const driver = new PortalBrowser(directory, true, async () => { throw new Error('No AI or unobserved browser choice is permitted in this fixture.'); });
  const runConfig = {...config, browserPath: await browserPath()}; const page = await driver.start(runConfig);
  const requests: string[] = [];
  await page.context().route('**/*', route => {
    requests.push(route.request().url());
    return route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>Offline portal safety fixture</title>' + html});
  });
  return {driver, page, runConfig, requests, store: new Store(directory), close: async () => { await driver.close(); await rm(directory, {recursive: true, force: true}); }};
}

test('a pre-action verification handoff cannot turn stale listing confirmation into a new submitted enquiry', {timeout: 30000}, async () => {
  const fixturePage = await fixture(`<p>Thank you for your enquiry.</p><form onsubmit="event.preventDefault();window.fixtureSubmissions=(window.fixtureSubmissions||0)+1;document.querySelector('#fresh').textContent='Owner will contact you soon.';">
    <input name="name"><input name="phone" type="tel"><input name="email" type="email"><button type="submit">Submit</button></form><p id="fresh"></p>`);
  try {
    const item = project('housing', 'Fixture property', url); const run = createRun({...fixturePage.runConfig, mode: 'submit'}); run.projects = [item];
    let firstGate = true; let handoffs = 0; let actualSubmit = false; let confirmationReadsBeforeSubmit = 0; let captured = 0;
    fixturePage.driver.verifyCaptcha = async () => {
      if (firstGate) { firstGate = false; return {pending: true, reason: 'Fixture pre-action verification.'}; }
      return {pending: false, reason: ''};
    };
    const originalSubmit = fixturePage.driver.submit.bind(fixturePage.driver);
    fixturePage.driver.submit = async project => { actualSubmit = true; return originalSubmit(project); };
    const originalConfirmed = fixturePage.driver.confirmed.bind(fixturePage.driver);
    fixturePage.driver.confirmed = async (project, baseline) => {
      if (!actualSubmit) confirmationReadsBeforeSubmit++;
      return originalConfirmed(project, baseline);
    };
    fixturePage.driver.captureContacts = async () => { captured++; return {status: 'not-found', attemptedAt: new Date().toISOString(), detail: 'No contact fixture.', contacts: []}; };
    const runner = new Runner(run, fixturePage.store, fixturePage.driver);
    runner.on('handoff', () => { handoffs++; runner.continue(handoffs === 1 ? 'continue' : 'skip'); });
    await runner.process();
    assert.equal(handoffs, 1); assert.equal(confirmationReadsBeforeSubmit, 0);
    assert.equal(actualSubmit, true); assert.equal(item.status, 'submitted'); assert.equal(captured, 1);
    const saved = await fixturePage.store.load(run.id); assert.equal(saved.projects[0]!.status, 'submitted');
    assert.equal(saved.projects[0]!.contactCapture?.status, 'not-found');
  } finally { await fixturePage.close(); }
});

test('new-listing state is cleared before navigation reaches a pre-action verification gate', {timeout: 30000}, async () => {
  const fixturePage = await fixture('<h1>Fixture verification page</h1>');
  try {
    const state = fixturePage.driver as unknown as {visitReady: boolean; submitScope?: Locator; chatDraft?: string};
    state.visitReady = true; state.submitScope = fixturePage.page.locator('body'); state.chatDraft = 'Previous listing introduction.';
    let inspected = false;
    fixturePage.driver.verifyCaptcha = async () => {
      inspected = true; assert.equal(state.visitReady, false); assert.equal(state.submitScope, undefined); assert.equal(state.chatDraft, undefined);
      return {pending: true, reason: 'Fixture verification remains pending.'};
    };
    const prepared = await fixturePage.driver.prepare(project('housing', 'Next property', url), fixturePage.runConfig);
    assert.equal(inspected, true); assert.equal(prepared.ready, false); assert.equal(prepared.verification, true);
    assert.equal((prepared as {allowHandoffConfirmation?: boolean}).allowHandoffConfirmation, false);
  } finally { await fixturePage.close(); }
});

test('re-preparing after verification refreshes the stale-success baseline so an unconfirmed final click stays uncertain', {timeout: 30000}, async () => {
  const fixturePage = await fixture('<p>Thank you for your enquiry.</p><form onsubmit="event.preventDefault();"><input name="phone" type="tel"><button type="submit">Submit</button></form>');
  try {
    const run = createRun({...fixturePage.runConfig, mode: 'submit'}); run.projects = [project('housing', 'Fixture property', url)];
    let gated = false; let handoffs = 0; let captures = 0; let submitted = 0;
    fixturePage.driver.verifyCaptcha = async () => {
      if (!gated) { gated = true; return {pending: true, reason: 'Fixture pre-action verification.'}; }
      return {pending: false, reason: ''};
    };
    const originalSubmit = fixturePage.driver.submit.bind(fixturePage.driver);
    fixturePage.driver.submit = async item => { submitted++; return originalSubmit(item); };
    fixturePage.driver.captureContacts = async () => { captures++; return {status: 'not-found', attemptedAt: new Date().toISOString(), detail: '', contacts: []}; };
    const runner = new Runner(run, fixturePage.store, fixturePage.driver);
    runner.on('handoff', () => { handoffs++; runner.continue(handoffs === 1 ? 'continue' : 'skip'); });
    await runner.process(); assert.equal(submitted, 1); assert.equal(run.projects[0]!.status, 'uncertain');
    assert.equal(captures, 0); assert.equal((await fixturePage.store.load(run.id)).projects[0]!.status, 'uncertain');
  } finally { await fixturePage.close(); }
});

test('an unscoped contact form never picks one of two Submit buttons and ignores a noninteractive Submit heading', {timeout: 30000}, async () => {
  const fixturePage = await fixture(`<h1>Property</h1><input name="phone" type="tel"><button onclick="window.fixtureLeft=(window.fixtureLeft||0)+1">Submit</button>
    <button onclick="window.fixtureRight=(window.fixtureRight||0)+1">Submit</button>`);
  try {
    fixturePage.driver.verifyCaptcha = async () => ({pending: false, reason: ''});
    const item = project('housing', 'Fixture property', url);
    assert.equal((await fixturePage.driver.prepare(item, fixturePage.runConfig)).ready, true);
    assert.equal(await fixturePage.driver.submit(item), false);
    assert.deepEqual(await fixturePage.page.evaluate(() => {
      const state = window as unknown as {fixtureLeft?: number; fixtureRight?: number}; return [state.fixtureLeft || 0, state.fixtureRight || 0];
    }), [0, 0]);
    await fixturePage.page.setContent(`<h2 id="heading">Submit</h2><input name="phone" type="tel"><button onclick="window.fixtureButton=(window.fixtureButton||0)+1">Submit</button>
      <script>document.querySelector('#heading').addEventListener('click',()=>window.fixtureHeading=(window.fixtureHeading||0)+1)</script>`);
    assert.equal((await fixturePage.driver.prepare(item, fixturePage.runConfig, false)).ready, true);
    assert.equal(await fixturePage.driver.submit(item), true);
    assert.deepEqual(await fixturePage.page.evaluate(() => {
      const state = window as unknown as {fixtureButton?: number; fixtureHeading?: number}; return [state.fixtureButton || 0, state.fixtureHeading || 0];
    }), [1, 0]);
  } finally { await fixturePage.close(); }
});

test('login, OTP, account-profile and unrelated dialogs cannot expose an account number as a seller contact', {timeout: 30000}, async () => {
  const fixturePage = await fixture('<h1>Property</h1>');
  const accountPhone = '+919876543211';
  try {
    await fixturePage.page.goto(url); const item = project('housing', 'Fixture property', url);
    const dialogs = [
      `<div role="dialog"><h2>Log in to your account</h2><p>Phone: ${accountPhone}</p><input type="password"></div>`,
      `<div role="dialog"><h2>Verify your mobile</h2><p>Phone: ${accountPhone}</p><input autocomplete="one-time-code" name="otp"></div>`,
      `<div role="dialog" data-testid="account-profile"><h2>My Profile</h2><p>Contact details: ${accountPhone}</p><a href="tel:${accountPhone}">My number</a></div>`,
      `<div role="dialog"><h2>Refer a friend</h2><p>Friend number: ${accountPhone}</p></div>`,
    ];
    for (const dialog of dialogs) {
      await fixturePage.page.setContent('<h1>Property</h1>' + dialog);
      const capture = await visibleListingContacts(fixturePage.page, item, fixturePage.runConfig);
      assert.deepEqual(capture.contacts, [], dialog);
    }
    await fixturePage.page.setContent('<h1>Property</h1><div role="dialog" aria-label="Contact Owner"><h2>Contact Owner</h2><p>Owner number: +919876543210</p></div>');
    const seller = await visibleListingContacts(fixturePage.page, item, fixturePage.runConfig);
    assert.deepEqual(seller.contacts.map(contact => contact.value), ['+919876543210']);
  } finally { await fixturePage.close(); }
});

test('an introduction discovered after a handoff exits as skipped without another prompt, submit or contact read', {timeout: 10000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-handoff-duplicate-'));
  try {
    const run = createRun({...config, mode: 'submit'}); run.projects = [project('olx', 'Fixture conversation', 'https://www.olx.in/item/fixture-property-iid-100')];
    let prepared = 0; let handoffs = 0; let submitted = 0; let captured = 0;
    const driver: Driver = {discover: async () => [],
      prepare: async () => ++prepared === 1 ? {ready: false, reason: 'Open the selected conversation.', baseline: []}
        : {ready: false, alreadyShared: true, actionKind: 'portal-message', reason: 'The exact outgoing introduction is already visible.', baseline: ['portal-message:existing']},
      confirmed: async () => false, submit: async () => { submitted++; return true; },
      captureContacts: async () => { captured++; return {status: 'not-found', attemptedAt: new Date().toISOString(), detail: 'No fixture contact.', contacts: []}; }, close: async () => {},
    };
    const runner = new Runner(run, new Store(directory), driver);
    runner.on('handoff', () => { handoffs++; runner.continue(handoffs === 1 ? 'continue' : 'skip'); });
    await runner.process(); assert.equal(prepared, 2); assert.equal(handoffs, 1); assert.equal(submitted, 0); assert.equal(captured, 0);
    assert.equal(run.projects[0]!.status, 'skipped'); assert.match(run.projects[0]!.detail, /already visible|duplicate/);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('standalone seller links and contact sections never inherit account-profile numbers from neighbouring or nested UI', {timeout: 30000}, async () => {
  const fixturePage = await fixture('<h1>Property</h1>');
  const sellerPhone = '+919876543210'; const accountPhone = '+919876543211';
  const profile = `<div role="dialog" data-testid="account-profile"><h2>My Profile</h2><p>Contact details: ${accountPhone}</p><a href="tel:${accountPhone}">My number ${accountPhone}</a></div>`;
  try {
    await fixturePage.page.goto(url); const item = project('housing', 'Fixture property', url);
    const cases = [
      `<main><a href="tel:${sellerPhone}">Call owner ${sellerPhone}</a>${profile}</main>`,
      `<section data-contact-details><h2>Owner contact</h2><p>Listing phone: ${sellerPhone}</p>${profile}</section>`,
    ];
    for (const html of cases) {
      await fixturePage.page.setContent('<h1>Property</h1>' + html);
      const capture = await visibleListingContacts(fixturePage.page, item, fixturePage.runConfig);
      assert.equal(capture.status, 'captured'); assert.deepEqual(capture.contacts.map(contact => contact.value), [sellerPhone]);
      for (const contact of capture.contacts) {
        assert.equal(contact.evidence.includes(accountPhone), false);
        assert.ok((contact.attributions || [contact]).every(source => !source.evidence.includes(accountPhone)));
        assert.equal(contact.visibility, 'authenticated'); assert.equal(contact.listingUrl, url);
      }
    }
  } finally { await fixturePage.close(); }
});
