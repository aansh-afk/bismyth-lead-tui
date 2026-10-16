import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emitKeypressEvents} from 'node:readline';
import type {Key} from 'node:readline';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {accountStatusDetails, blankAccounts} from '../accounts.js';
import type {AccountPortal, AccountSnapshot, AccountStatus, PortalAccount} from '../accounts.js';
import {createRun, defaults, project} from '../model.js';
import type {Config, Run} from '../model.js';
import {Runner} from '../runner.js';
import {Store} from '../store.js';
import {TerminalApp} from '../tui.js';

interface Controller {
  screen: number;
  accountSetup: boolean;
  accounts: AccountSnapshot;
  accountTask?: Promise<void>;
  current?: Run;
  review?: number;
  runner?: Runner;
  task?: Promise<void>;
  notice: string;
  busy: boolean;
  editing?: {field: {key: 'name'; label: string; hint: string}; buffer: string};
  picker?: {kind: 'state' | 'city'; query: string; selected: number};
  render: () => void;
  keypress: (text: string | undefined, key: Key) => void;
}

class NoNetworkAccountBrowser {
  readonly calls: string[] = [];
  async open(): Promise<PortalAccount> { this.calls.push('open'); throw new Error('Unexpected login browser work'); }
  async check(): Promise<PortalAccount> { this.calls.push('check'); throw new Error('Unexpected login inspection'); }
  async close(): Promise<void> { this.calls.push('close'); }
}

const checkedAt = '2026-10-16T10:00:00.000Z';
function observations(statuses: Partial<Record<AccountPortal, AccountStatus>>): AccountSnapshot {
  const snapshot = blankAccounts();
  for (const account of snapshot.accounts) {
    const status = statuses[account.portal];
    if (status) Object.assign(account, {status, checkedAt, detail: accountStatusDetails[status]});
  }
  return snapshot;
}

async function fixture(t: TestContext, statuses: Partial<Record<AccountPortal, AccountStatus>> = {nobroker: 'signed-in'}): Promise<{
  app: Controller; store: Store; config: Config; browser: NoNetworkAccountBrowser;
  input: PassThrough; decoded: Key[]; originalConfig: string; originalAccounts: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-run-shortcut-'));
  const store = new Store(directory);
  const config: Config = {...structuredClone(defaults), stateCode: 'MH', city: 'Mumbai', name: 'Fixture User', email: 'fixture@example.test', phone: '9000000000', sites: ['nobroker', 'housing'], browserPath: '/fixture/chrome'};
  await store.saveConfig(config);
  await store.saveAccounts(observations(statuses));
  const originalConfig = await readFile(join(directory, 'config.json'), 'utf8');
  const originalAccounts = await readFile(join(directory, 'accounts.json'), 'utf8');
  const browser = new NoNetworkAccountBrowser();
  // Recreate the controller and load the persisted observations just as start()
  // does after a restart. No N/finish-account-setup action has occurred.
  const app = new TerminalApp(await store.config(), store, browser) as unknown as Controller;
  app.accounts = await store.accounts();
  app.render = () => undefined;
  const input = new PassThrough();
  const decoded: Key[] = [];
  emitKeypressEvents(input);
  input.on('keypress', (text: string | undefined, key: Key) => { decoded.push(key); app.keypress(text, key); });
  t.after(async () => { input.destroy(); await app.task; await rm(directory, {recursive: true, force: true}); });
  return {app, store, config, browser, input, decoded, originalConfig, originalAccounts};
}

function press(app: Controller, name: string): void {
  app.keypress(name.length === 1 ? name : undefined, {name});
}

async function idle(app: Controller): Promise<void> {
  const deadline = Date.now() + 5000;
  while (app.busy && Date.now() < deadline) await delay(1);
  assert.equal(app.busy, false, 'the keyboard action finishes within the fixture timeout');
  await app.task;
}

async function savedQueue(app: Controller, store: Store, config: Config): Promise<Run> {
  const saved = createRun({...config, mode: 'submit'});
  saved.projects = [project('nobroker', 'Fixture saved apartment', 'https://www.nobroker.in/property/fixture-saved')];
  await store.save(saved);
  app.current = await store.load(saved.id);
  app.screen = 1;
  return structuredClone(app.current);
}

async function assertNoRunWork(app: Controller, store: Store, browser: NoNetworkAccountBrowser, before: Run): Promise<void> {
  assert.equal(app.runner, undefined);
  assert.equal(app.task, undefined);
  assert.deepEqual(browser.calls, []);
  assert.deepEqual(app.current, before);
  assert.deepEqual(await store.history(), [before], 'review and rejected starts do not create a copied run');
}

test('the actual Ctrl+R byte opens a restarted saved queue on page two without returning to Set up', async t => {
  const {app, store, config, browser, input, decoded, originalConfig, originalAccounts} = await fixture(t);
  const before = await savedQueue(app, store, config);
  assert.equal(app.accountSetup, true, 'the account navigation step has not been finished with N');
  input.write('\x12');
  assert.equal(decoded.at(-1)?.name, 'r');
  assert.equal(decoded.at(-1)?.ctrl, true, 'readline parsed the genuine control-key byte');
  assert.equal(app.screen, 1);
  assert.equal(app.review, 0, 'Test forms is selected by default');
  input.write('\x12');
  assert.equal(app.review, 0, 'repeating Ctrl+R does not start or recreate the queue');
  await assertNoRunWork(app, store, browser, before);
  press(app, 'escape');
  assert.equal(app.review, undefined);
  assert.equal(app.screen, 1);
  await assertNoRunWork(app, store, browser, before);
  assert.equal(await readFile(join(store.directory, 'config.json'), 'utf8'), originalConfig);
  assert.equal(await readFile(join(store.directory, 'accounts.json'), 'utf8'), originalAccounts);
});

test('Enter and Ctrl+R open the same read-only chooser from queue and results screens', async t => {
  const {app, store, config, browser, input} = await fixture(t);
  const before = await savedQueue(app, store, config);
  for (const screen of [1, 2]) {
    for (const shortcut of ['enter', 'ctrl-r']) {
      app.screen = screen;
      if (shortcut === 'enter') input.write('\r'); else input.write('\x12');
      assert.equal(app.screen, screen, shortcut + ' preserves the current screen');
      assert.equal(app.review, 0);
      await assertNoRunWork(app, store, browser, before);
      press(app, 'escape');
    }
  }
});

test('a restarted saved login starts the default preview only after explicit Enter confirmation', async t => {
  const {app, store, config, browser, input, originalConfig, originalAccounts} = await fixture(t);
  const before = await savedQueue(app, store, config);
  const processed: Run[] = [];
  t.mock.method(Runner.prototype, 'process', async function(this: Runner) { processed.push(structuredClone(this.run)); });
  input.write('\x12');
  assert.equal(processed.length, 0);
  await assertNoRunWork(app, store, browser, before);
  input.write('\r');
  await idle(app);
  assert.equal(processed.length, 1);
  assert.equal(processed[0].config.mode, 'preview', 'the stored submit mode does not override the safe chooser default');
  assert.notEqual(processed[0].id, before.id);
  assert.deepEqual(processed[0].projects.map(item => item.id), before.projects.map(item => item.id));
  assert.equal(app.screen, 2);
  assert.deepEqual(browser.calls, ['close']);
  const history = await store.history();
  assert.equal(history.length, 2);
  assert.deepEqual(history.find(run => run.id === before.id), before, 'the original saved run remains unchanged');
  assert.equal(await readFile(join(store.directory, 'config.json'), 'utf8'), originalConfig);
  assert.equal(await readFile(join(store.directory, 'accounts.json'), 'utf8'), originalAccounts);
});

test('Send enquiries requires selecting it and explicitly confirming the queue chooser', async t => {
  const {app, store, config, input} = await fixture(t);
  await savedQueue(app, store, config);
  const modes: Config['mode'][] = [];
  t.mock.method(Runner.prototype, 'process', async function(this: Runner) { modes.push(this.run.config.mode); });
  input.write('\x12');
  press(app, 'down');
  assert.equal(app.review, 1);
  input.write('\x12');
  assert.deepEqual(modes, [], 'Ctrl+R while choosing does not send or start processing');
  assert.equal((await store.history()).length, 1);
  input.write('\r');
  await idle(app);
  assert.deepEqual(modes, ['submit']);
});

test('a queue with a missing website login stays on its page and is not copied or started', async t => {
  const {app, store, config, browser, input} = await fixture(t);
  await savedQueue(app, store, config);
  app.current!.projects.push(project('housing', 'Fixture Housing apartment', 'https://housing.com/in/buy/fixture-saved'));
  await store.save(app.current!);
  const before = structuredClone(app.current!);
  input.write('\x12');
  assert.equal(app.review, 0, 'missing login does not prevent reviewing the chooser');
  input.write('\r');
  await idle(app);
  assert.equal(app.screen, 1);
  assert.match(app.notice, /Housing/);
  assert.match(app.notice, /\bL\b.*login|login.*\bL\b/i, 'the error gives the explicit website-login shortcut');
  await assertNoRunWork(app, store, browser, before);
  press(app, 'l');
  assert.equal(app.screen, 0);
  assert.equal(app.accountSetup, true);
  assert.deepEqual(app.current, before);
});

test('finishing the navigation step cannot authorize a queue whose login is unconfirmed', async t => {
  const {app, store, config, browser, input} = await fixture(t, {nobroker: 'skipped'});
  press(app, 'n');
  await app.accountTask;
  assert.equal(app.accountSetup, false);
  browser.calls.length = 0;
  const before = await savedQueue(app, store, config);
  input.write('\x12');
  input.write('\r');
  await idle(app);
  assert.equal(app.screen, 1);
  assert.match(app.notice, /NoBroker/);
  await assertNoRunWork(app, store, browser, before);
});

test('an unobserved signed-in flag cannot start a saved queue', async t => {
  const {app, store, config, browser, input} = await fixture(t);
  const before = await savedQueue(app, store, config);
  app.accounts.accounts.find(account => account.portal === 'nobroker')!.checkedAt = null;
  input.write('\x12');
  input.write('\r');
  await idle(app);
  assert.equal(app.screen, 1);
  assert.match(app.notice, /NoBroker/);
  await assertNoRunWork(app, store, browser, before);
});

test('an invalid saved contact profile is rejected before copying or launching a queue', async t => {
  const {app, store, config, browser, input} = await fixture(t);
  const before = await savedQueue(app, store, {...config, email: 'invalid-fixture-email'});
  input.write('\x12');
  input.write('\r');
  await idle(app);
  assert.match(app.notice, /valid email/i);
  await assertNoRunWork(app, store, browser, before);
});

test('empty-queue Ctrl+R discovers only selected verified websites without requiring N', async t => {
  const {app, store, config, browser, input, originalConfig, originalAccounts} = await fixture(t);
  app.screen = 1;
  const discovered: Config[] = [];
  t.mock.method(Runner.prototype, 'discover', async function(this: Runner) { discovered.push(structuredClone(this.run.config)); });
  input.write('\x12');
  await idle(app);
  assert.equal(discovered.length, 1);
  assert.deepEqual(discovered[0].sites, ['nobroker']);
  assert.deepEqual(config.sites, ['nobroker', 'housing']);
  assert.equal(app.screen, 1);
  assert.deepEqual(browser.calls, ['close']);
  assert.equal((await store.history()).length, 1);
  assert.equal(await readFile(join(store.directory, 'config.json'), 'utf8'), originalConfig);
  assert.equal(await readFile(join(store.directory, 'accounts.json'), 'utf8'), originalAccounts);
});

test('empty-queue Ctrl+R with no eligible login creates no discovery job or run', async t => {
  const {app, store, input} = await fixture(t, {nobroker: 'signed-out', housing: 'unknown'});
  app.screen = 1;
  let discoveries = 0;
  t.mock.method(Runner.prototype, 'discover', async () => { discoveries++; });
  input.write('\x12');
  await idle(app);
  assert.equal(discoveries, 0);
  assert.equal(app.current, undefined);
  assert.equal(app.runner, undefined);
  assert.equal(app.task, undefined);
  assert.deepEqual(await store.history(), []);
  assert.match(app.notice, /confirmed login|log.?in|sign.?in/i);
});

test('Ctrl+R is ignored inside text editors, location pickers and busy actions', async t => {
  const {app, store, config, browser, input} = await fixture(t);
  const before = await savedQueue(app, store, config);
  app.editing = {field: {key: 'name', label: 'Contact name', hint: 'Fixture'}, buffer: 'Fixture User'};
  input.write('\x12');
  assert.equal(app.editing.buffer, 'Fixture User');
  assert.equal(app.review, undefined);
  app.editing = undefined;
  app.picker = {kind: 'state', query: 'maha', selected: 0};
  input.write('\x12');
  assert.deepEqual(app.picker, {kind: 'state', query: 'maha', selected: 0});
  assert.equal(app.review, undefined);
  app.picker = undefined;
  app.busy = true;
  input.write('\x12');
  assert.equal(app.review, undefined);
  app.busy = false;
  await assertNoRunWork(app, store, browser, before);
});

test('active-run Ctrl+R cannot reopen review while Enter retains pause and browser-handoff behavior', async t => {
  const {app, store, config, browser, input} = await fixture(t);
  const before = await savedQueue(app, store, config);
  let pauses = 0;
  const continues: string[] = [];
  const running = {
    active: true, paused: false, stopped: false, handoffMessage: '',
    pause(): void { this.paused = !this.paused; pauses++; },
    continue(answer: string): void { continues.push(answer); },
  };
  app.runner = running as unknown as Runner;
  input.write('\x12');
  assert.equal(app.review, undefined);
  assert.equal(app.screen, 1);
  assert.match(app.notice, /current run first/i);
  running.paused = true;
  input.write('\r');
  assert.equal(pauses, 1);
  assert.equal(running.paused, false);
  running.handoffMessage = 'Fixture browser step';
  input.write('\r');
  assert.deepEqual(continues, ['continue']);
  assert.equal(app.review, undefined);
  assert.equal(app.runner, running);
  assert.deepEqual(browser.calls, []);
  assert.deepEqual(app.current, before);
  assert.deepEqual(await store.history(), [before]);
});
