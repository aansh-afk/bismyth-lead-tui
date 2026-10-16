import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import type {Key} from 'node:readline';
import {TerminalApp} from '../tui.js';
import {Store} from '../store.js';
import {createRun, defaults, project} from '../model.js';
import type {Config, Run} from '../model.js';
import {accountStatusDetails, blankAccounts, portalAccounts} from '../accounts.js';
import type {AccountPortal, AccountSnapshot, AccountStatus, PortalAccount} from '../accounts.js';

// Exercise the real keyboard controller without entering raw mode or starting
// Chrome. Rendering has its own size/escape-sequence tests in account-view.
interface AppController {
  screen: number;
  selected: number[];
  accountSetup: boolean;
  accountSelected: number;
  accounts: AccountSnapshot;
  accountTask?: Promise<void>;
  current?: Run;
  review?: number;
  runner?: unknown;
  notice: string;
  busy: boolean;
  help: boolean;
  details?: {offset: number; message: string};
  render: () => void;
  keypress: (text: string | undefined, key: Key) => void;
  accountSetupView: () => {accounts: PortalAccount[]; selected: number; busy: boolean} | undefined;
  launch: (discover: boolean) => Promise<void>;
}

const checkedAt = '2026-10-13T10:20:30.000Z';

class FakeAccountBrowser {
  readonly calls: string[] = [];
  readonly openedProfiles: Pick<Config, 'browserPath'>[] = [];
  checkedStatus: AccountStatus = 'signed-in';
  checkError?: Error;
  onClose?: () => Promise<void>;

  async open(portal: AccountPortal, config: Pick<Config, 'browserPath'>): Promise<PortalAccount> {
    this.calls.push('open:' + portal);
    this.openedProfiles.push({browserPath: config.browserPath});
    return {portal, status: 'signed-out', checkedAt, detail: accountStatusDetails['signed-out']};
  }

  async check(portal: AccountPortal): Promise<PortalAccount> {
    this.calls.push('check:' + portal);
    if (this.checkError) throw this.checkError;
    return {portal, status: this.checkedStatus, checkedAt, detail: accountStatusDetails[this.checkedStatus]};
  }

  async close(): Promise<void> {
    this.calls.push('close');
    await this.onClose?.();
  }
}

async function fixture(t: TestContext): Promise<{
  app: AppController; browser: FakeAccountBrowser; store: Store; config: Config; originalConfig: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-account-setup-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const store = new Store(directory);
  const config: Config = {...structuredClone(defaults), stateCode: 'MH', city: 'Mumbai', name: 'Fixture User', email: 'fixture@example.test', phone: '9000000000', sites: ['nobroker', 'housing'], browserPath: '/fixture/chrome'};
  await store.saveConfig(config);
  const originalConfig = await readFile(join(directory, 'config.json'), 'utf8');
  const browser = new FakeAccountBrowser();
  const app = new TerminalApp(config, store, browser) as unknown as AppController;
  app.render = () => undefined;
  return {app, browser, store, config, originalConfig};
}

function press(app: AppController, name: string, text = name.length === 1 ? name : undefined): void {
  app.keypress(text, {name});
}

async function accountAction(app: AppController, name: string): Promise<void> {
  press(app, name);
  assert.ok(app.accountTask, 'account keyboard action exposes its pending task');
  await app.accountTask;
  assert.equal(app.busy, false);
}

async function assertProfileUnchanged(store: Store, originalConfig: string, config: Config): Promise<void> {
  assert.equal(await readFile(join(store.directory, 'config.json'), 'utf8'), originalConfig);
  assert.deepEqual(config, JSON.parse(originalConfig));
}

test('initial Set up starts with website accounts before the saved contact profile', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  assert.equal(app.screen, 0);
  assert.equal(app.accountSetup, true);
  const accountView = app.accountSetupView();
  assert.ok(accountView);
  assert.deepEqual(accountView.accounts, blankAccounts().accounts);
  assert.equal(accountView.selected, 0);
  assert.equal(accountView.busy, false);
  assert.deepEqual(browser.calls, []);
  assert.equal((await store.history()).length, 0);
  await assertProfileUnchanged(store, originalConfig, config);
});

test('Enter opens the selected website without editing the contact profile or starting a run', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  press(app, 'down'); press(app, 'down');
  assert.equal(app.accountSelected, 2);
  await accountAction(app, 'return');
  assert.deepEqual(browser.calls, ['open:housing']);
  assert.deepEqual(browser.openedProfiles, [{browserPath: config.browserPath}]);
  assert.equal(app.accountSetup, true);
  assert.equal(app.screen, 0);
  assert.equal(app.accountSelected, 2, 'opening a signed-out site keeps the current login selected');
  assert.equal((await store.accounts()).accounts.find(account => account.portal === 'housing')?.status, 'signed-out');
  assert.equal(app.current, undefined);
  assert.equal(app.runner, undefined);
  await assertProfileUnchanged(store, originalConfig, config);
});

test('C checks the same website, persists signed-in observation and advances one portal', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  await accountAction(app, 'return');
  await accountAction(app, 'c');
  assert.deepEqual(browser.calls, ['open:99acres', 'check:99acres']);
  assert.equal(app.accountSelected, 1);
  assert.match(app.notice, /99acres login successful/);
  assert.equal(app.accountSetup, true, 'checking one website keeps the account list open');
  assert.deepEqual((await store.accounts()).accounts[0], {portal: '99acres', status: 'signed-in', checkedAt, detail: accountStatusDetails['signed-in']});
  await assertProfileUnchanged(store, originalConfig, config);
});

test('C keeps signed-out and blocked websites selected and does not open another page', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  for (const status of ['signed-out', 'blocked'] as const) {
    browser.checkedStatus = status;
    await accountAction(app, 'c');
    assert.equal(app.accountSelected, 0);
    assert.equal((await store.accounts()).accounts[0].status, status);
  }
  assert.deepEqual(browser.calls, ['check:99acres', 'check:99acres']);
  await assertProfileUnchanged(store, originalConfig, config);
});

test('K skips a website while preserving its open browser and saved profile data', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  const profile = join(store.directory, 'browser-profile');
  await mkdir(profile, {mode: 0o700});
  const profileMarker = join(profile, 'fixture-session-marker');
  await writeFile(profileMarker, 'existing-fixture-browser-state', {mode: 0o600});
  await accountAction(app, 'return');
  await accountAction(app, 'k');
  assert.deepEqual(browser.calls, ['open:99acres'], 'skip does not close or navigate the browser');
  assert.equal(await readFile(profileMarker, 'utf8'), 'existing-fixture-browser-state');
  assert.equal(app.accountSelected, 1);
  assert.equal((await store.accounts()).accounts[0].status, 'skipped');
  await assertProfileUnchanged(store, originalConfig, config);
});

test('N closes account Chrome and continues in Set up; L reopens the account stage', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  await accountAction(app, 'return');
  await accountAction(app, 'n');
  assert.deepEqual(browser.calls, ['open:99acres', 'close']);
  assert.equal(app.screen, 0);
  assert.equal(app.accountSetup, false);
  assert.equal(app.accountSetupView(), undefined);
  assert.equal(app.selected[0], 1, 'profile continues at the state selector');
  press(app, 'l');
  assert.equal(app.screen, 0);
  assert.equal(app.accountSetup, true);
  assert.equal(app.accountSetupView()?.selected, 0);
  assert.deepEqual(browser.calls, ['open:99acres', 'close'], 'L only reopens the TUI stage');
  await assertProfileUnchanged(store, originalConfig, config);
});

test('expanded account diagnostics close with Escape and still allow Enter to open the website', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  press(app, 'e');
  assert.ok(app.details);
  press(app, 'escape');
  assert.equal(app.details, undefined);
  assert.equal(app.accountSetup, true, 'Escape closes the diagnostic before leaving account setup');
  assert.deepEqual(browser.calls, []);
  press(app, 'e');
  await accountAction(app, 'return');
  assert.equal(app.details, undefined);
  assert.deepEqual(browser.calls, ['open:99acres']);
  assert.equal(app.accountSetup, true);
  await assertProfileUnchanged(store, originalConfig, config);
});

test('N dismisses the keyboard guide so completing account setup reveals the profile', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  press(app, '?');
  assert.equal(app.help, true);
  await accountAction(app, 'n');
  assert.equal(app.help, false);
  assert.equal(app.accountSetup, false);
  assert.equal(app.screen, 0);
  assert.equal(app.selected[0], 1);
  assert.deepEqual(browser.calls, ['close']);
  await assertProfileUnchanged(store, originalConfig, config);
});

test('discovery without a confirmed login returns to Set up without a browser job or new run', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  press(app, '2');
  assert.equal(app.screen, 1);
  press(app, 'r');
  await setImmediate();
  assert.equal(app.busy, false);
  assert.equal(app.screen, 0);
  assert.equal(app.accountSetup, true);
  assert.match(app.notice, /No selected property website has a confirmed login/);
  assert.deepEqual(browser.calls, ['close']);
  assert.equal(app.current, undefined);
  assert.equal(app.runner, undefined);
  assert.deepEqual(await store.history(), []);
  await assertProfileUnchanged(store, originalConfig, config);
});

test('Enter and R on a saved queue open review without leaving the page or starting that run', async t => {
  for (const shortcut of ['return', 'r'] as const) {
    const {app, browser, store, config, originalConfig} = await fixture(t);
    const saved = createRun(config);
    saved.projects = [project('nobroker', 'Fixture saved apartment', 'https://www.nobroker.in/property/fixture-saved')];
    await store.save(saved);
    const before = structuredClone(saved);
    app.current = saved;
    press(app, '2');
    press(app, shortcut);
    await setImmediate();
    assert.equal(app.screen, 1, `${shortcut} stays on Review queue`);
    assert.equal(app.accountSetup, true);
    assert.equal(app.review, 0, 'the read-only chooser defaults to Test forms');
    assert.equal(app.current, saved, 'the original queue remains selected');
    assert.deepEqual(app.current, before);
    assert.equal(app.runner, undefined);
    assert.deepEqual(browser.calls, []);
    const history = await store.history();
    assert.equal(history.length, 1, 'opening review does not save a copied run');
    assert.deepEqual(history[0], before);
    await assertProfileUnchanged(store, originalConfig, config);
  }
});

test('a pending run-mode choice also checks accounts before copying its saved queue', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  const saved = createRun(config);
  saved.projects = [project('housing', 'Fixture saved apartment', 'https://housing.com/in/buy/fixture-saved')];
  await store.save(saved);
  const before = structuredClone(saved);
  app.current = saved;
  app.screen = 1;
  app.review = 0;
  press(app, 'return');
  await setImmediate();
  assert.equal(app.busy, false);
  assert.equal(app.screen, 1, 'a missing login preserves the current page');
  assert.equal(app.accountSetup, true);
  assert.match(app.notice, /Check website logins.*Housing.*L opens website logins/);
  assert.equal(app.review, undefined);
  assert.equal(app.current, saved);
  assert.deepEqual(app.current, before);
  assert.equal(app.runner, undefined);
  assert.deepEqual(browser.calls, []);
  assert.deepEqual(await store.history(), [before]);
  await assertProfileUnchanged(store, originalConfig, config);
});

test('launch waits for account-browser closure before validating or creating a runner', async t => {
  const {app, browser, store, config} = await fixture(t);
  await accountAction(app, 'n');
  config.city = '';
  const noticeBeforeLaunch = app.notice;
  let releaseClose!: () => void;
  browser.onClose = () => new Promise<void>(resolve => { releaseClose = resolve; });
  const launching = app.launch(true);
  assert.deepEqual(browser.calls, ['close', 'close']);
  await setImmediate();
  assert.equal(app.notice, noticeBeforeLaunch);
  assert.equal(app.current, undefined);
  assert.equal(app.runner, undefined);
  assert.deepEqual(await store.history(), []);
  releaseClose();
  await assert.rejects(launching, /Complete your setup first.*Enter a city/);
  assert.equal(app.runner, undefined, 'invalid setup never creates a real browser driver');
  assert.deepEqual(await store.history(), []);
});

test('account persistence is private metadata and ignores credential fields and supplied diagnostic text', async t => {
  const {store, config, originalConfig} = await fixture(t);
  const contaminated = {
    version: 1, apiKey: 'fixture-api-key-must-not-persist', accounts: [
      {portal: 'housing', status: 'signed-in', checkedAt, detail: 'fixture-token-must-not-persist', cookie: 'fixture-cookie-must-not-persist', password: 'fixture-password-must-not-persist', phone: '+919000000000'},
      {portal: 'olx', status: 'fixture-token-must-not-persist', checkedAt: 'not-a-time', detail: 'fixture-private-identity'},
    ],
  };
  await store.saveAccounts(contaminated as unknown as AccountSnapshot);
  const path = join(store.directory, 'accounts.json');
  const bytes = await readFile(path, 'utf8');
  const saved = JSON.parse(bytes) as AccountSnapshot;
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(store.directory)).mode & 0o777, 0o700);
  assert.deepEqual(Object.keys(saved).sort(), ['accounts', 'version']);
  assert.deepEqual(saved.accounts.map(account => account.portal), portalAccounts.map(portal => portal.id));
  for (const account of saved.accounts) assert.deepEqual(Object.keys(account).sort(), ['checkedAt', 'detail', 'portal', 'status']);
  assert.deepEqual(saved.accounts.find(account => account.portal === 'housing'), {portal: 'housing', status: 'signed-in', checkedAt, detail: accountStatusDetails['signed-in']});
  assert.deepEqual(saved.accounts.find(account => account.portal === 'olx'), blankAccounts().accounts.find(account => account.portal === 'olx'));
  assert.doesNotMatch(bytes, /fixture-(?:api-key|token|cookie|password|private-identity)|\+919000000000/);
  await assertProfileUnchanged(store, originalConfig, config);
});

test('a truncated account file loads blank observations while leaving the saved profile intact', async t => {
  const {store, config, originalConfig} = await fixture(t);
  await writeFile(join(store.directory, 'accounts.json'), '{"version":1,"accounts":[', {mode: 0o600});
  assert.deepEqual(await store.accounts(), blankAccounts());
  await assertProfileUnchanged(store, originalConfig, config);
});

test('account-check failures show a fixed diagnostic rather than driver tokens or private text', async t => {
  const {app, browser, store, config, originalConfig} = await fixture(t);
  browser.checkError = new Error('fixture-secret-token identity@example.test');
  await accountAction(app, 'c');
  assert.match(app.notice, /Could not open or check this website session/);
  assert.doesNotMatch(app.notice, /fixture-secret-token|identity@example/);
  assert.deepEqual(await store.accounts(), blankAccounts());
  assert.equal(app.accountSelected, 0);
  assert.equal(app.accountSetup, true);
  await assertProfileUnchanged(store, originalConfig, config);
});
