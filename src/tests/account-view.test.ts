import test from 'node:test';
import assert from 'node:assert/strict';
import {portalAccounts} from '../accounts.js';
import type {PortalAccount} from '../accounts.js';
import {defaults, createRun, project} from '../model.js';
import {messageDetailLayout, renderView} from '../terminal-view.js';
import type {View} from '../terminal-view.js';

const sizes = [[70, 22], [80, 24], [100, 30], [180, 40]] as const;

function fixture(width = 80, height = 24): View {
  const accounts: PortalAccount[] = portalAccounts.map(item => ({portal: item.id, status: 'unchecked', checkedAt: null, detail: 'Login has not been checked yet.'}));
  return {width, height, screen: 0, selected: [0, 0, 0, 0], config: {...defaults}, history: [], fields: [{index: 0, label: 'Name', value: 'PROFILE-MUST-STAY-HIDDEN', hint: 'Your name'}], advanced: false, notice: '', help: false, handoff: '', active: false, auth: 'ChatGPT subscription connected', accountSetup: {accounts, selected: 0, busy: false}};
}

function renderedLines(view: View): string[] {
  return renderView(view).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\r\n');
}

function text(view: View): string {return renderedLines(view).map(line => line.trim()).join(' ').replace(/\s+/g, ' ');}

function assertFits(view: View): void {
  const lines = renderedLines(view);
  assert.ok(lines.length <= view.height - 1, `${view.width}×${view.height} uses ${lines.length} rows`);
  for (const [index, line] of lines.entries()) assert.ok(Array.from(line).length <= view.width, `row ${index + 1} exceeds ${view.width}: ${line}`);
}

function assertControls(view: View): void {
  const screen = text(view);
  for (const control of ['Enter Login', 'C Check', 'K Skip', 'N Profile', 'Q Quit']) assert.ok(screen.includes(control), `${view.width}×${view.height} retains ${control}`);
}

test('website logins stay inside Set up and every portal is reachable at supported terminal sizes', () => {
  assert.equal(portalAccounts.length, 7);
  for (const [width, height] of sizes) {
    const pages: string[] = [];
    for (const [selected, portal] of portalAccounts.entries()) {
      const view = fixture(width, height);
      view.accountSetup!.selected = selected;
      assertFits(view); assertControls(view);
      const screen = text(view); pages.push(screen);
      assert.ok(screen.includes(portal.label), `${portal.label} is visible when selected`);
      assert.match(screen, /Set up · Website logins/);
      assert.doesNotMatch(screen, /PROFILE-MUST-STAY-HIDDEN|5\s+Website logins/);
      assert.match(screen, /passwords and OTPs in Chrome/);
    }
    for (const portal of portalAccounts) assert.ok(pages.some(page => page.includes(portal.label)), `${width}×${height} exposes ${portal.label}`);
  }
});

test('website rows identify catalogued listing adapters', () => {
  for (const [width, height] of sizes) for (const [selected, portal] of portalAccounts.entries()) {
    const view = fixture(width, height); view.accountSetup!.selected = selected;
    const row = renderedLines(view).find(line => line.includes('› ' + portal.label));
    assert.ok(row, `${portal.label} has a selected row`);
    assert.ok(row.includes(portal.integrated ? 'Listing adapter' : 'Login only'), `${portal.label} states whether a listing adapter exists`);
  }
});

test('unchecked sessions do not claim login and persisted verification is labelled as past verification', () => {
  for (const [width, height] of sizes) {
    const view = fixture(width, height);
    assert.match(text(view), /Not checked/);
    assert.doesNotMatch(text(view), /Last verified|Signed in|Logged in/);
    view.accountSetup!.accounts[0] = {...view.accountSetup!.accounts[0], status: 'signed-in', checkedAt: '2026-10-13T08:30:00.000Z', detail: 'Account menu was visible when last checked.'};
    assertFits(view);
    assert.match(text(view), /Last verified: 2026-10-13 08:30 UTC/);
    assert.doesNotMatch(text(view), /Signed in|Logged in/);
    assert.match(text(view), /Account menu was visible when last checked\./);
  }
});

test('website login operations animate even when no property run is active', () => {
  for (const [width, height] of sizes) {
    const view = fixture(width, height); view.accountSetup!.busy = true;
    for (const operation of ['Opening Chrome', 'Checking login']) {
      view.accountSetup!.operation = operation;
      const first = {...view, animationFrame: 0}; const second = {...view, animationFrame: 1};
      assertFits(first); assertFits(second);
      assert.match(text(first), /Please wait for Chrome\s+Q Quit/);
      assert.doesNotMatch(text(first), /Enter Login|C Check|K Skip|N Profile/);
      const details = {...first, details: {offset: 0}};
      assertFits(details);
      assert.match(text(details), /Please wait for Chrome\s+Q Quit/);
      assert.doesNotMatch(text(details), /Enter Login|C Check|K Skip|N Profile/);
      assert.ok(text(first).includes('⠋ ' + operation));
      assert.ok(text(second).includes('⠙ ' + operation));
      assert.notEqual(renderView(first), renderView(second));
    }
    view.accountSetup!.busy = false;
    assert.equal(renderView({...view, animationFrame: 0}), renderView({...view, animationFrame: 1}));
  }
});

test('long portal diagnostics keep login controls and every detail is readable through E', () => {
  const diagnostic = 'BEGIN-ACCOUNT-DETAIL ' + Array.from({length: 180}, (_, index) => `account-context-${index}`).join(' ') + ' END-ACCOUNT-DETAIL';
  for (const [width, height] of sizes) {
    const view = fixture(width, height);
    view.notice = 'OPERATION-NOTICE ' + 'context '.repeat(90);
    view.accountSetup!.accounts[0].detail = diagnostic;
    assertFits(view); assertControls(view);
    assert.match(text(view), /E Full message/);
    assert.ok(renderedLines(view).some(line => line.includes('› ' + portalAccounts[0].label)), 'selected portal remains in the reduced list budget');
    const pages: string[] = []; const layout = messageDetailLayout({...view, details: {offset: 0}});
    for (let offset = 0; offset <= layout.maxOffset + layout.pageSize; offset += layout.pageSize) {
      const page = {...view, details: {offset}};
      assertFits(page); assertControls(page); pages.push(text(page));
    }
    const complete = pages.join(' ');
    assert.match(complete, /OPERATION-NOTICE/);
    assert.match(complete, /BEGIN-ACCOUNT-DETAIL/);
    assert.match(complete, /END-ACCOUNT-DETAIL/);
    for (let index = 0; index < 180; index++) assert.ok(complete.includes(`account-context-${index}`));
  }
});

test('portal diagnostics and operation labels cannot inject terminal controls', () => {
  for (const [width, height] of sizes) {
    const view = fixture(width, height);
    view.accountSetup!.busy = true;
    view.accountSetup!.operation = 'Opening Chrome\x1b[2J\x1b]52;c;clipboard\x07';
    view.accountSetup!.accounts[0].detail = 'BEGIN-SAFE\x1b[2J\nline-two\rline-three\x00\u202eEND-SAFE';
    for (const details of [undefined, {offset: 0}]) {
      const current = {...view, details}; const rendered = renderView(current);
      assertFits(current);
      assert.ok(!rendered.includes('\x1b[2J')); assert.ok(!rendered.includes('\x1b]'));
      assert.doesNotMatch(rendered, /[\x00\x07\u202e]/);
      assert.ok(!rendered.replace(/\r\n/g, '').includes('\n'));
      assert.match(text(current), /BEGIN-SAFE/); assert.match(text(current), /line-two line-three/);
    }
  }
});

test('profile setup advertises the return shortcut and other sections keep their existing controls', () => {
  const view = fixture();
  const profile = {...view, accountSetup: undefined};
  assert.match(text(profile), /L Website logins/);
  assert.match(text({...profile, help: true}), /Website logins inside Set up/);
  const run = createRun(view.config); run.projects = [project('nobroker', 'Fixture apartment', 'https://www.nobroker.in/property/fixture')];
  const review = {...view, screen: 1, run};
  assertFits(review);
  assert.match(text(review), /Review your property queue/);
  assert.match(text(review), /Enter \/ Ctrl\+R Choose test or send/);
  assert.doesNotMatch(text(review), /Set up · Website logins|Enter Login|N Profile/);
});

test('NoBroker login success remains visible in green after advancing to the next website', () => {
  for (const [width, height] of sizes) {
    const view = fixture(width, height);
    const account = view.accountSetup!.accounts.find(item => item.portal === 'nobroker')!;
    account.status = 'signed-in'; account.checkedAt = '2026-10-14T16:50:00.000Z';
    view.accountSetup!.selected = 2;
    view.notice = 'NoBroker login successful. Enter opens Housing; N continues to your profile.';
    assertFits(view);
    assert.match(text(view), /NoBroker login successful\./);
    assert.ok(renderView(view).includes('\x1b[38;5;114mNoBroker login successful.'), 'the current success message is green');
  }
});
