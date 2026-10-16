import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {accountStatusDetails, blankAccounts, discoveryAccess} from '../accounts.js';
import type {AccountPortal, AccountSnapshot, AccountStatus, PortalAccount} from '../accounts.js';
import {defaults} from '../model.js';
import type {Config, Run, Site} from '../model.js';
import {Runner} from '../runner.js';
import {Store} from '../store.js';
import {TerminalApp} from '../tui.js';

const checkedAt = '2026-10-16T06:30:00.000Z';
function observations(statuses: Partial<Record<AccountPortal, AccountStatus>>): AccountSnapshot {
  const result = blankAccounts();
  for (const account of result.accounts) {
    const status = statuses[account.portal];
    if (status) Object.assign(account, {status, checkedAt, detail: accountStatusDetails[status]});
  }
  return result;
}

test('discovery access allows only selected, supported portals with a valid signed-in observation', () => {
  const snapshot = observations({nobroker: 'signed-in', housing: 'unknown', '99acres': 'signed-in', quikr: 'signed-in'});
  const selected: readonly Site[] = Object.freeze(['housing', 'nobroker', '99acres', 'nobroker', 'housing'] as Site[]);
  const before = structuredClone(snapshot);
  assert.deepEqual(discoveryAccess(selected, snapshot), {allowed: ['nobroker', '99acres'], skipped: ['housing']});
  assert.deepEqual(selected, ['housing', 'nobroker', '99acres', 'nobroker', 'housing']);
  assert.deepEqual(snapshot, before, 'filtering must not change account observations');
  assert.deepEqual(discoveryAccess(['housing'], snapshot), {allowed: [], skipped: ['housing']}, 'an unselected authenticated portal is not added');
  assert.deepEqual(discoveryAccess([], snapshot), {allowed: [], skipped: []});
});

test('discovery access excludes every unverified account status', () => {
  for (const status of ['unchecked', 'signed-out', 'unknown', 'blocked', 'skipped'] as const) {
    assert.deepEqual(discoveryAccess(['nobroker'], observations({nobroker: status})), {allowed: [], skipped: ['nobroker']}, status);
  }
});

test('discovery access normalizes corrupt and unobserved signed-in metadata before filtering', () => {
  for (const value of [null, {version: 2, accounts: []}, {version: 1, accounts: 'invalid'}]) {
    assert.deepEqual(discoveryAccess(['housing'], value as unknown as AccountSnapshot), {allowed: [], skipped: ['housing']});
  }
  for (const timestamp of [null, undefined, '', 'not-a-time', '2026-10-16']) {
    const snapshot = {version: 1, accounts: [{portal: 'housing', status: 'signed-in', checkedAt: timestamp}]};
    assert.deepEqual(discoveryAccess(['housing'], snapshot as unknown as AccountSnapshot), {allowed: [], skipped: ['housing']}, String(timestamp));
  }
  const duplicate = {version: 1, accounts: [
    {portal: 'housing', status: 'signed-out', checkedAt},
    {portal: 'housing', status: 'signed-in', checkedAt},
  ]};
  assert.deepEqual(discoveryAccess(['housing'], duplicate as unknown as AccountSnapshot), {allowed: [], skipped: ['housing']}, 'a duplicate record cannot replace the first observation');
});

test('login-only Quikr cannot become a discovery adapter through saved preferences', () => {
  const snapshot = observations({quikr: 'signed-in'});
  assert.deepEqual(discoveryAccess(['nobroker', 'housing', '99acres'], snapshot), {allowed: [], skipped: ['nobroker', 'housing', '99acres']});
  // Runtime data may be stale or malformed even though Config.sites is typed.
  assert.deepEqual(discoveryAccess(['quikr' as Site], snapshot), {allowed: [], skipped: ['quikr']});
});

interface Controller {
  screen: number;
  accountSetup: boolean;
  accounts: AccountSnapshot;
  current?: Run;
  runner?: Runner;
  task?: Promise<void>;
  notice: string;
  render: () => void;
  launch: (discover: boolean) => Promise<void>;
  importQueue: () => Promise<void>;
}

class InspectionOnlyBrowser {
  closes = 0;
  async open(): Promise<PortalAccount> { throw new Error('Discovery must not open a login window in this fixture'); }
  async check(): Promise<PortalAccount> { throw new Error('Discovery must not inspect another website in this fixture'); }
  async close(): Promise<void> { this.closes++; }
}

async function fixture(t: TestContext): Promise<{app: Controller; store: Store; config: Config; browser: InspectionOnlyBrowser; originalConfig: string}> {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-discovery-access-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const store = new Store(directory);
  const config: Config = {...structuredClone(defaults), stateCode: 'MH', city: 'Mumbai', name: 'Fixture User', email: 'fixture@example.test', phone: '9000000000', sites: ['nobroker', 'housing'], browserPath: '/fixture/chrome'};
  await store.saveConfig(config);
  const originalConfig = await readFile(join(directory, 'config.json'), 'utf8');
  const browser = new InspectionOnlyBrowser();
  const app = new TerminalApp(config, store, browser) as unknown as Controller;
  app.render = () => undefined;
  app.accountSetup = false;
  return {app, store, config, browser, originalConfig};
}

test('TUI discovery passes only logged-in selected websites and their seeds to Runner', async t => {
  const {app, store, config, browser} = await fixture(t);
  config.seedUrls = ['https://www.nobroker.in/property/buy/mumbai/fixture/detail', 'https://housing.com/in/buy/mumbai'];
  await store.saveConfig(config);
  const originalConfig = await readFile(join(store.directory, 'config.json'), 'utf8');
  app.accounts = observations({nobroker: 'signed-in', housing: 'unknown', quikr: 'signed-in'});
  const seen: Config[] = [];
  t.mock.method(Runner.prototype, 'discover', async function(this: Runner) { seen.push(structuredClone(this.run.config)); });
  await app.launch(true);
  await app.task;
  assert.equal(browser.closes, 1);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].sites, ['nobroker']);
  assert.deepEqual(seen[0].seedUrls, ['https://www.nobroker.in/property/buy/mumbai/fixture/detail']);
  assert.deepEqual(app.current?.config.sites, ['nobroker']);
  assert.deepEqual(config.sites, ['nobroker', 'housing'], 'saved selection remains available for a future login');
  assert.equal(await readFile(join(store.directory, 'config.json'), 'utf8'), originalConfig);
  assert.equal((await store.history()).length, 1);
});

test('TUI discovery with no qualifying website stops before creating a run or browser job', async t => {
  const {app, store, config, browser, originalConfig} = await fixture(t);
  app.accounts = observations({nobroker: 'signed-out', housing: 'blocked', quikr: 'signed-in'});
  let calls = 0;
  t.mock.method(Runner.prototype, 'discover', async () => { calls++; });
  await assert.rejects(app.launch(true), /sign.?in|log.?in|connect/i);
  assert.equal(calls, 0);
  assert.equal(app.current, undefined);
  assert.equal(app.runner, undefined);
  assert.equal(app.task, undefined);
  assert.equal(app.screen, 0);
  assert.equal(app.accountSetup, true);
  assert.equal(browser.closes, 1);
  assert.deepEqual(await store.history(), []);
  assert.deepEqual(config.sites, ['nobroker', 'housing']);
  assert.equal(await readFile(join(store.directory, 'config.json'), 'utf8'), originalConfig);
});

test('TUI validates the profile before applying discovery login filtering', async t => {
  const {app, store, config, browser} = await fixture(t);
  config.city = '';
  app.accounts = blankAccounts();
  let calls = 0;
  t.mock.method(Runner.prototype, 'discover', async () => { calls++; });
  await assert.rejects(app.launch(true), /Complete your setup first.*Enter a city/);
  assert.equal(browser.closes, 1);
  assert.equal(calls, 0);
  assert.equal(app.current, undefined);
  assert.equal(app.runner, undefined);
  assert.deepEqual(await store.history(), []);
});

test('URL import filters unverified portals before inspecting their project paths', async t => {
  const {app, store, config} = await fixture(t);
  config.seedUrls = ['https://housing.com/in/buy/mumbai', 'https://www.nobroker.in/property/buy/mumbai/fixture/detail'];
  app.accounts = observations({nobroker: 'signed-in', housing: 'unknown'});
  await app.importQueue();
  assert.deepEqual(app.current?.config.sites, ['nobroker']);
  assert.deepEqual(app.current?.config.seedUrls, ['https://www.nobroker.in/property/buy/mumbai/fixture/detail']);
  assert.deepEqual(app.current?.projects.map(item => item.site), ['nobroker']);
  assert.equal(app.runner, undefined, 'import should not launch Chrome');
  assert.deepEqual(config.sites, ['nobroker', 'housing']);
  assert.equal((await store.history()).length, 1);
});

test('URL import with no logged-in supported portal does not save an empty or guest queue', async t => {
  const {app, store, config} = await fixture(t);
  config.seedUrls = ['https://www.nobroker.in/property/buy/mumbai/fixture/detail'];
  app.accounts = observations({nobroker: 'skipped', housing: 'unknown', quikr: 'signed-in'});
  await assert.rejects(app.importQueue(), /sign.?in|log.?in|connect/i);
  assert.equal(app.current, undefined);
  assert.equal(app.runner, undefined);
  assert.equal(app.screen, 0);
  assert.equal(app.accountSetup, true);
  assert.deepEqual(await store.history(), []);
});
