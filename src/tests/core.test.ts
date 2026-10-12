import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, stat, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {createServer} from 'node:http';
import {defaults, canonicalUrl, counts, createRun, duplicateKey, project, recoverRun, siteForUrl, validateConfig} from '../model.js';
import type {Config, Project} from '../model.js';
import {Store} from '../store.js';
import {Runner} from '../runner.js';
import type {Driver} from '../browser.js';
import {chooseElement, validateChoice} from '../laya.js';
import {clean} from '../tui.js';
import {renderView} from '../terminal-view.js';
import {subscriptionEnvironment} from '../subscription.js';
import {indiaStates, citiesForState, validLocation} from '../locations.js';
import {doctorFix} from '../doctor.js';

const config: Config = {...defaults, city: 'Pune', name: 'Fixture User', email: 'fixture@example.test', phone: '+91 9000000000', delayMs: 0};
const item = (): Project => project('99acres', 'Fixture project', 'https://www.99acres.com/fixture-npxid-1');
async function temporary(): Promise<{store: Store; close: () => Promise<void>}> {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-tui-'));
  const store = new Store(directory); await store.init();
  return {store, close: () => rm(directory, {recursive: true, force: true})};
}
function fake(overrides: Partial<Driver> = {}): Driver {
  return {discover: async () => [item()], prepare: async () => ({ready: true, reason: '', baseline: []}), submit: async () => true, confirmed: async () => true, close: async () => {}, ...overrides};
}
test('browser solver activity is visible during a run and persisted in saved history', async () => {
  const {store, close} = await temporary();
  try {
    let activity: ((message: string) => Promise<void>) | undefined;
    const message = 'CAPTCHA: GPT-6 Luna · low reasoning analysing 9 tiles (1/4).';
    const driver = fake({setActivity: listener => { activity = listener; }, discover: async () => { await activity!(message); return [item()]; }});
    const run = createRun({...config, sites: ['99acres']});
    const runner = new Runner(run, store, driver); let visible = false;
    runner.on('change', () => { if (run.events.some(event => event.message === message)) visible = true; });
    await runner.discover();
    assert.equal(visible, true);
    assert.ok((await store.load(run.id)).events.some(event => event.message === message));
    const rendered = renderView({width: 110, height: 30, screen: 2, advanced: false, selected: [0, 0, 0, 0], config: run.config, run, history: [], fields: [], help: false, auth: 'ChatGPT subscription connected', notice: '', handoff: '', active: true, stopping: false, animationFrame: 0, elapsedMs: 0});
    assert.ok(rendered.includes('GPT-6 Luna'));
  } finally { await close(); }
});
test('configuration validates meeting inputs and bounded batches', () => {
  assert.deepEqual(validateConfig(config), []);
  assert.ok(validateConfig({...config, limit: 301}).length);
  assert.ok(validateConfig({...config, phone: 'bad', email: ''}).length >= 2);
  assert.deepEqual(validateConfig({...config, phone: '', email: '', name: ''}, false), []);
});
test('canonical URLs dedupe tracking while retaining meaningful query parameters', () => {
  assert.equal(canonicalUrl('https://housing.com/rent/123/?utm_source=a&fltcnt=b&bedrooms=2#gallery'), 'https://housing.com/rent/123?bedrooms=2');
  assert.equal(siteForUrl('https://www.99acres.com/a'), '99acres');
  assert.equal(siteForUrl('https://99acres.com.evil.test/a'), undefined);
  assert.equal(canonicalUrl('https://nobroker.in/property/buy/flat/id/detail'), 'https://www.nobroker.in/property/buy/flat/id/detail');
  assert.throws(() => canonicalUrl('javascript:alert(1)'));
});
test('contact deduplication separates distinct contact profiles', () => {
  assert.equal(duplicateKey(config, item()), duplicateKey({...config, phone: '+919000000000'}, item()));
  assert.equal(duplicateKey(config, item()), duplicateKey({...config, phone: '9000000000'}, item()));
  assert.notEqual(duplicateKey(config, item()), duplicateKey({...config, phone: '9000000001'}, item()));
  assert.equal(duplicateKey(config, {...item(), id: 'historical-id', url: 'https://99acres.com/fixture-npxid-1'}), duplicateKey(config, item()));
});
test('interrupted in-flight projects recover as uncertain, never queued', () => {
  const run = createRun(config); run.state = 'running'; run.projects = [{...item(), status: 'working'}];
  recoverRun(run); assert.equal(run.state, 'stopped'); assert.equal(run.projects[0].status, 'uncertain');
});
test('storage persists private snapshots, history and safe CSV exports', async () => {
  const {store, close} = await temporary();
  try {
    await store.saveConfig(config); assert.equal((await store.config()).city, 'Pune');
    const run = createRun(config); run.projects = [{...item(), title: '=FORMULA,"title"'}];
    await store.save(run); assert.equal((await store.history()).length, 1);
    assert.equal((await store.load(run.id)).projects[0].title, '=FORMULA,"title"');
    assert.equal((await stat(join(store.directory, 'runs', run.id + '.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(store.directory)).mode & 0o777, 0o700);
    const csv = await readFile(await store.export(run, 'csv'), 'utf8');
    assert.ok(csv.includes('"\'=FORMULA,""title"""'));
    assert.throws(() => store.validId('../config'));
  } finally { await close(); }
});
test('preview prepares forms without calling submit', async () => {
  const {store, close} = await temporary();
  try {
    const run = createRun(config); run.projects = [item()]; let calls = 0;
    const runner = new Runner(run, store, fake({submit: async () => { calls++; return true; }}));
    await runner.process(); assert.equal(calls, 0); assert.equal(counts(run).prepared, 1); assert.equal(run.state, 'complete');
  } finally { await close(); }
});
test('historical saved enquiry IDs still deduplicate across portal hostname aliases', async () => {
  const {store, close} = await temporary();
  try {
    const before = createRun({...config, mode: 'submit'});
    before.projects = [{...item(), id: 'historical-id', url: 'https://99acres.com/fixture-npxid-1', status: 'submitted'}];
    await store.save(before);
    const next = createRun({...config, mode: 'submit'}); next.projects = [item()]; let calls = 0;
    await new Runner(next, store, fake({prepare: async () => { calls++; return {ready: true, reason: '', baseline: []}; }})).process();
    assert.equal(calls, 0); assert.equal(counts(next).skipped, 1);
  } finally { await close(); }
});
test('submit needs confirmation; uncertain outcomes block future duplicate contact', async () => {
  const {store, close} = await temporary();
  try {
    const run = createRun({...config, mode: 'submit'}); run.projects = [item()];
    const runner = new Runner(run, store, fake({confirmed: async () => false}));
    runner.on('change', () => { if (runner.handoffMessage) runner.continue('skip'); });
    // Handoff resolver is installed before change notification; skip resolves immediately.
    await runner.process(); assert.equal(counts(run).uncertain, 1);
    const next = createRun({...config, mode: 'submit'}); next.projects = [item()]; let calls = 0;
    await new Runner(next, store, fake({prepare: async () => { calls++; return {ready: true, reason: '', baseline: []}; }})).process();
    assert.equal(calls, 0); assert.equal(counts(next).skipped, 1);
  } finally { await close(); }
});
test('confirmed success is saved and not resubmitted on resume', async () => {
  const {store, close} = await temporary();
  try {
    const run = createRun({...config, mode: 'submit'}); run.projects = [item()]; let calls = 0;
    const driver = fake({submit: async () => { calls++; return true; }});
    await new Runner(run, store, driver).process(); await new Runner(await store.load(run.id), store, driver).process();
    assert.equal(calls, 1); assert.equal(counts(run).submitted, 1);
  } finally { await close(); }
});
test('manual verification can be skipped and stop resolves a pending handoff', async () => {
  const {store, close} = await temporary();
  try {
    const run = createRun(config); run.projects = [item()];
    const runner = new Runner(run, store, fake({prepare: async () => ({ready: false, reason: 'OTP', baseline: []})}));
    const waiting = once(runner, 'handoff');
    const task = runner.process(); await waiting; await runner.stop(); await task;
    assert.equal(run.state, 'stopped'); assert.equal(run.projects[0].status, 'uncertain');
  } finally { await close(); }
});
test('a cleared CAPTCHA handoff resumes preparation on the existing page without another navigation', {timeout: 5000}, async () => {
  const {store, close} = await temporary();
  const run = createRun(config); run.projects = [item()];
  const navigations: Array<boolean | undefined> = [];
  let reads = 0;
  const driver = fake({
    prepare: async (_item, _config, navigate) => {
      navigations.push(navigate);
      return navigations.length === 1 ? {ready: false, reason: 'CAPTCHA', baseline: [], verification: true} : {ready: true, reason: '', baseline: []};
    },
    verificationReady: async () => { reads++; return true; },
  });
  const runner = new Runner(run, store, driver);
  const task = runner.process();
  try {
    await task;
    assert.deepEqual(navigations, [undefined, false]);
    assert.equal(reads, 1);
    assert.equal(run.projects[0].status, 'prepared');
    assert.ok(run.events.some(event => event.message.includes('verification cleared in Chrome')));
  } finally { await runner.stop(); await task; await close(); }
});
test('CAPTCHA handoff keeps waiting while portal continuation is disabled', {timeout: 5000}, async () => {
  const {store, close} = await temporary();
  const run = createRun(config); run.projects = [item()];
  let preparations = 0; let reads = 0; let portalReady = false; let readStarted!: () => void;
  const observing = new Promise<void>(resolve => { readStarted = resolve; });
  const runner = new Runner(run, store, fake({
    prepare: async () => ++preparations === 1 ? {ready: false, reason: 'CAPTCHA callback pending', baseline: [], verification: true} : {ready: true, reason: '', baseline: []},
    verificationReady: async () => { reads++; readStarted(); return portalReady; },
  }));
  const task = runner.process();
  try {
    await observing; await sleep(30);
    assert.equal(preparations, 1);
    assert.equal(run.projects[0].status, 'working');
    portalReady = true; await task;
    assert.equal(preparations, 2);
    assert.equal(reads, 2);
    assert.equal(run.projects[0].status, 'prepared');
  } finally { await runner.stop(); await task; await close(); }
});
test('generic OTP handoffs remain manual even when CAPTCHA readiness reports true', {timeout: 5000}, async () => {
  const {store, close} = await temporary();
  const run = createRun(config); run.projects = [item()];
  let preparations = 0; let reads = 0; let finished = false;
  const runner = new Runner(run, store, fake({
    prepare: async () => ++preparations === 1 ? {ready: false, reason: 'Enter OTP', baseline: []} : {ready: true, reason: '', baseline: []},
    verificationReady: async () => { reads++; return true; },
  }));
  const waiting = once(runner, 'handoff');
  const task = runner.process().then(() => { finished = true; });
  try {
    await waiting; await sleep(1150);
    assert.equal(reads, 0);
    assert.equal(preparations, 1);
    assert.equal(finished, false);
    assert.equal(run.projects[0].status, 'working');
    runner.continue('continue'); await task;
    assert.equal(run.projects[0].status, 'prepared');
  } finally { await runner.stop(); await task; await close(); }
});
test('automatic post-submit CAPTCHA continuation leaves remaining OTP manual and never submits twice', {timeout: 8000}, async () => {
  const {store, close} = await temporary();
  const run = createRun({...config, mode: 'submit'}); run.projects = [item()];
  let submissions = 0; let verifications = 0; let reads = 0; let confirmed = false;
  const runner = new Runner(run, store, fake({
    submit: async () => { submissions++; return true; },
    verifyCaptcha: async () => ++verifications === 1 ? {pending: true, reason: 'CAPTCHA after Submit'} : {pending: false, reason: ''},
    verificationReady: async () => { reads++; return true; },
    confirmed: async () => confirmed,
  }));
  const firstWaiting = once(runner, 'handoff'); const task = runner.process();
  try {
    await firstWaiting;
    const otpWaiting = once(runner, 'handoff'); await otpWaiting;
    assert.match(runner.handoffMessage, /OTP or remaining steps/);
    await sleep(1150);
    assert.equal(reads, 1);
    assert.equal(submissions, 1);
    assert.equal(run.projects[0].status, 'working');
    confirmed = true; runner.continue('continue'); await task;
    assert.equal(run.projects[0].status, 'submitted');
    assert.equal(submissions, 1);
  } finally { await runner.stop(); await task; await close(); }
});
test('pause holds automatic CAPTCHA handoff observation until resumed', {timeout: 5000}, async () => {
  const {store, close} = await temporary();
  const run = createRun(config); run.projects = [item()];
  let preparations = 0; let reads = 0;
  const runner = new Runner(run, store, fake({
    prepare: async () => ++preparations === 1 ? {ready: false, reason: 'CAPTCHA', baseline: [], verification: true} : {ready: true, reason: '', baseline: []},
    verificationReady: async () => { reads++; return true; },
  }));
  const waiting = once(runner, 'handoff'); const task = runner.process();
  try {
    await waiting; runner.pause(); await sleep(1150);
    assert.equal(reads, 0);
    assert.equal(preparations, 1);
    assert.equal(run.state, 'paused');
    runner.pause(); await task;
    assert.equal(reads, 1);
    assert.equal(run.projects[0].status, 'prepared');
  } finally { await runner.stop(); await task; await close(); }
});
test('a late CAPTCHA readiness answer after K cannot continue a later manual handoff', {timeout: 5000}, async () => {
  const {store, close} = await temporary();
  const first = item(); const second = project('99acres', 'Second project', 'https://www.99acres.com/fixture-npxid-2');
  const run = createRun(config); run.projects = [first, second];
  let reads = 0; let finishRead!: (ready: boolean) => void; let readStarted!: () => void;
  const observing = new Promise<void>(resolve => { readStarted = resolve; });
  const runner = new Runner(run, store, fake({
    prepare: async current => ({ready: false, reason: current.id === first.id ? 'First CAPTCHA' : 'Second OTP', baseline: [], verification: current.id === first.id}),
    verificationReady: async () => { reads++; readStarted(); return new Promise<boolean>(resolve => { finishRead = resolve; }); },
  }));
  const firstWaiting = once(runner, 'handoff'); const task = runner.process();
  try {
    await firstWaiting; await observing;
    const secondWaiting = once(runner, 'handoff'); runner.continue('skip'); await secondWaiting;
    finishRead(true); await sleep(30);
    assert.match(runner.handoffMessage, /Second OTP/);
    assert.equal(second.status, 'working');
    assert.equal(reads, 1);
    runner.continue('skip'); await task;
    assert.deepEqual(run.projects.map(current => current.status), ['skipped', 'skipped']);
  } finally { finishRead?.(true); await runner.stop(); await task; await close(); }
});
test('stop cancels a CAPTCHA handoff observer and ignores its late readiness answer', {timeout: 5000}, async () => {
  const {store, close} = await temporary();
  const run = createRun(config); run.projects = [item()];
  let preparations = 0; let reads = 0; let finishRead!: (ready: boolean) => void; let readStarted!: () => void;
  const observing = new Promise<void>(resolve => { readStarted = resolve; });
  const runner = new Runner(run, store, fake({
    prepare: async () => { preparations++; return {ready: false, reason: 'CAPTCHA', baseline: [], verification: true}; },
    verificationReady: async () => { reads++; readStarted(); return new Promise<boolean>(resolve => { finishRead = resolve; }); },
  }));
  const task = runner.process();
  try {
    await observing; await runner.stop(); await task;
    finishRead(true); await sleep(30);
    assert.equal(preparations, 1);
    assert.equal(reads, 1);
    assert.equal(run.state, 'stopped');
    assert.equal(run.projects[0].status, 'uncertain');
    assert.equal(runner.handoffMessage, '');
  } finally { finishRead?.(true); await runner.stop(); await task; await close(); }
});
test('CAPTCHA-specific discovery handoffs automatically continue after verification clears', {timeout: 5000}, async () => {
  const {store, close} = await temporary();
  const run = createRun({...config, limit: 1, sites: ['99acres']}); let reads = 0;
  const driver = fake({
    discover: async (_config, _site, _limit, _checkpoint, handoff) => {
      assert.equal(await handoff('Discovery CAPTCHA', true), 'continue');
      return [item()];
    },
    verificationReady: async () => { reads++; return true; },
  });
  const runner = new Runner(run, store, driver); const task = runner.discover();
  try {
    await task;
    assert.equal(reads, 1);
    assert.equal(run.projects.length, 1);
    assert.equal(run.state, 'ready');
  } finally { await runner.stop(); await task; await close(); }
});
test('pause prevents processing until resumed', async () => {
  const {store, close} = await temporary();
  try {
    const run = createRun(config); const runner = new Runner(run, store, fake());
    runner.pause(); let done = false; const task = runner.checkpoint().then(() => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 120)); assert.equal(done, false);
    runner.pause(); await task; assert.equal(done, true);
  } finally { await close(); }
});
test('pause holds in-flight browser actions until the run resumes', {timeout: 5000}, async () => {
  const {store, close} = await temporary();
  let checkpoint: (() => Promise<void>) | undefined;
  let firstAction!: () => void;
  const started = new Promise<void>(resolve => { firstAction = resolve; });
  let release!: () => void;
  const nextAction = new Promise<void>(resolve => { release = resolve; });
  const actions: number[] = [];
  const driver = fake({
    setCheckpoint: listener => { checkpoint = listener; },
    prepare: async () => {
      actions.push(1); firstAction();
      await nextAction; await checkpoint!();
      actions.push(2);
      return {ready: true, reason: '', baseline: []};
    },
  });
  const run = createRun(config); run.projects = [item()];
  const runner = new Runner(run, store, driver);
  const task = runner.process();
  try {
    await started; runner.pause(); release();
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.deepEqual(actions, [1]);
    assert.equal(run.state, 'paused');
    runner.pause(); await task;
    assert.deepEqual(actions, [1, 2]);
    assert.equal(run.projects[0].status, 'prepared');
    assert.equal(run.state, 'complete');
  } finally { release(); await runner.stop(); await task; await close(); }
});
test('stop cancels in-flight browser actions waiting at a paused checkpoint', {timeout: 5000}, async () => {
  const {store, close} = await temporary();
  let checkpoint: (() => Promise<void>) | undefined;
  let firstAction!: () => void;
  const started = new Promise<void>(resolve => { firstAction = resolve; });
  let release!: () => void;
  const nextAction = new Promise<void>(resolve => { release = resolve; });
  let checkpointEntered!: () => void;
  const waiting = new Promise<void>(resolve => { checkpointEntered = resolve; });
  const actions: number[] = [];
  let closed = 0;
  const driver = fake({
    setCheckpoint: listener => { checkpoint = listener; },
    prepare: async () => {
      actions.push(1); firstAction();
      await nextAction; checkpointEntered(); await checkpoint!();
      actions.push(2);
      return {ready: true, reason: '', baseline: []};
    },
    close: async () => { closed++; },
  });
  const run = createRun(config); run.projects = [item()];
  const runner = new Runner(run, store, driver);
  const task = runner.process();
  try {
    await started; runner.pause(); release(); await waiting;
    await runner.stop(); await task;
    assert.deepEqual(actions, [1]);
    assert.equal(run.state, 'stopped');
    assert.equal(run.projects[0].status, 'uncertain');
    assert.ok(closed >= 1);
    assert.equal((await store.load(run.id)).state, 'stopped');
  } finally { release(); await runner.stop(); await task; await close(); }
});
test('discovery respects batch limit and deduplicates URLs', async () => {
  const {store, close} = await temporary();
  try {
    const run = createRun({...config, limit: 2});
    await new Runner(run, store, fake({discover: async (_config, site) => [project(site, 'A', 'https://www.' + (site === '99acres' ? '99acres.com' : site === 'nobroker' ? 'nobroker.in' : 'housing.com') + '/fixture'), project(site, 'Duplicate', 'https://www.' + (site === '99acres' ? '99acres.com' : site === 'nobroker' ? 'nobroker.in' : 'housing.com') + '/fixture')]})).discover();
    assert.equal(run.projects.length, 2); assert.equal(new Set(run.projects.map(item => item.id)).size, 2);
  } finally { await close(); }
});
test('Laya choices require valid probabilities, offered IDs, and a unique high score', () => {
  const candidates = [{id: 'e0', label: 'Contact'}, {id: 'none', label: 'None'}];
  assert.equal(validateChoice({choice: 'e0', probabilities: {e0: 0.95, none: 0.05}}, candidates), 'e0');
  for (const answer of [{choice: 'evil', probabilities: {e0: 1, none: 0}}, {choice: 'e0', probabilities: {e0: 0.5, none: 0.5}}, {choice: 'e0', probabilities: {e0: 1}}, {choice: 'e0', probabilities: {e0: NaN, none: 0}}, {choice: 'e0', probabilities: {e0: 0.95, none: 0.05}, abstention: true}]) assert.equal(validateChoice(answer, candidates), undefined);
});
test('Laya optional HTTP client speaks the official typed-choice contract', async () => {
  let received: unknown;
  const server = createServer((request, response) => {
    let content = ''; request.on('data', chunk => { content += String(chunk); });
    request.on('end', () => { received = JSON.parse(content); response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({answers: {element: {choice: 'e0', probabilities: {e0: 0.98, none: 0.02}}}})); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object');
    assert.equal(await chooseElement(`http://127.0.0.1:${address.port}/v1/systemone`, 'Open contact form', [{id: 'e0', label: 'Contact'}]), 'e0');
    assert.equal((received as {questions: {element: {type: string}}}).questions.element.type, 'choice');
    await assert.rejects(chooseElement('https://remote.test/v1/systemone', 'Open', [{id: 'e0', label: 'Contact'}]));
  } finally { server.close(); await once(server, 'close'); }
});
test('terminal output removes embedded control sequences', () => { assert.equal(clean('\x1b[2Jbad\nproject'), '[2Jbad project'); });
test('guided terminal view shows subscription, next steps, and explicit review choices', () => {
  const view = {width: 100, height: 30, screen: 0, selected: [0, 0, 0, 0], config, history: [], fields: [{index: 0, label: 'City / location', value: 'Pune', hint: 'Choose your city'}], advanced: false, notice: 'Start here', help: false, handoff: '', active: false, auth: 'ChatGPT subscription connected'};
  const screen = renderView(view);
  assert.ok(screen.includes('Start a property enquiry run')); assert.ok(screen.includes('F / Ctrl+R Find properties'));
  assert.ok(screen.includes('Subscription AI')); assert.ok(!screen.includes('Laya endpoint'));
  const run = createRun(config); run.projects = [item()];
  const review = renderView({...view, screen: 1, run, review: 0});
  assert.ok(review.includes('Test forms')); assert.ok(review.includes('Send enquiries')); assert.ok(review.includes('Back to queue'));
  const compact = renderView({...view, width: 80, height: 24}); assert.ok(compact.includes('Start a property enquiry run'));
  assert.ok(renderView({...view, width: 40}).includes('Resize to at least 70'));
});
test('run feedback animates work and accurately labels pause, browser handoff and completion', () => {
  const run = createRun(config); run.state = 'running'; run.projects = [item()];
  const view = {width: 100, height: 30, screen: 2, selected: [0, 0, 0, 0], config, run, history: [], fields: [], advanced: false, notice: '', help: false, handoff: '', active: true, auth: 'ChatGPT subscription connected', elapsedMs: 65000};
  const first = renderView({...view, animationFrame: 0});
  const second = renderView({...view, animationFrame: 1});
  assert.match(first, /⠋ Testing forms · 1:05/); assert.match(second, /⠙ Testing forms · 1:05/);
  assert.notEqual(first, second);
  assert.match(renderView({...view, screen: 0, animationFrame: 1}), /⠙ Testing forms/);
  assert.match(renderView({...view, width: 40, animationFrame: 1}), /⠙ Testing forms/);
  run.state = 'discovering'; assert.match(renderView(view), /Finding properties/);
  run.config.mode = 'submit'; run.state = 'running'; assert.match(renderView(view), /Sending enquiries/);
  for (const [state, handoff, stopping, label] of [
    ['paused', '', false, 'Paused'], ['running', 'Complete fixture step', false, 'Needs you in Chrome'],
    ['running', '', true, 'Stopping'], ['ready', '', false, 'Queue ready'], ['complete', '', false, 'Run finished'], ['stopped', '', false, 'Run stopped'],
  ] as const) {
    run.state = state;
    const current = {...view, handoff, stopping};
    const rendered = renderView({...current, animationFrame: 0});
    assert.ok(rendered.includes(label)); assert.doesNotMatch(rendered, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    assert.equal(rendered, renderView({...current, animationFrame: 1}));
  }
  run.state = 'paused'; assert.match(renderView(view), /Enter \/ P Resume/);
  run.state = 'running'; assert.match(renderView({...view, handoff: 'Fixture'}), /Enter\/C Recheck/);
  assert.match(renderView({...view, active: false}), /Enter \/ Ctrl\+R Review queue/);
});
test('subscription child environment excludes API keys and API gateway overrides', () => {
  const before = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fixture-api-key';
  try { assert.equal(subscriptionEnvironment().OPENAI_API_KEY, undefined); assert.ok(subscriptionEnvironment().PATH); }
  finally { if (before === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = before; }
});
test('post-submit CAPTCHA acceptance still requires independent enquiry confirmation', async () => {
  const {store, close} = await temporary();
  try {
    const run = createRun({...config, mode: 'submit'}); run.projects = [item()];
    let verified = false;
    await new Runner(run, store, fake({verifyCaptcha: async () => { verified = true; return {pending: false, reason: ''}; }, confirmed: async () => verified})).process();
    assert.equal(verified, true); assert.equal(counts(run).submitted, 1);
    const unconfirmed = createRun({...config, mode: 'submit'});
    unconfirmed.projects = [project('99acres', 'Another fixture', 'https://www.99acres.com/fixture-npxid-2')];
    const runner = new Runner(unconfirmed, store, fake({verifyCaptcha: async () => ({pending: false, reason: ''}), confirmed: async () => false}));
    runner.on('handoff', () => runner.continue('skip'));
    await runner.process();
    assert.equal(counts(unconfirmed).submitted, 0); assert.equal(counts(unconfirmed).uncertain, 1);
  } finally { await close(); }
});
test('India-only state/city data and validation reject mismatches and typos', () => {
  assert.equal(indiaStates.length, 36);
  assert.ok(citiesForState('MH').includes('Mumbai')); assert.ok(citiesForState('MH').includes('Pune'));
  assert.equal(validLocation('MH', 'Mumbai'), true);
  assert.equal(validLocation('KA', 'Mumbai'), false);
  assert.equal(validLocation('MH', 'Mumbi'), false);
  assert.equal(validLocation('US', 'New York'), false);
  assert.equal(validLocation('', 'London'), false);
  assert.equal(validLocation('', 'Mumbai'), true);
});
test('doctor-fix installs only missing prerequisites and leaves ChatGPT sign-in to the user', async () => {
  const calls: string[] = []; let chromium = false; let codex = false; const messages: string[] = [];
  const command = (name: string, args: string[]) => {
    calls.push(name + ' ' + args.join(' '));
    if (name === 'codex' && args[0] === '--version') return {status: codex ? 0 : 1};
    if (name === 'codex') return {status: 1};
    if (name === 'npm') { codex = true; return {status: 0}; }
    if (name === 'apt-get' && args[0] === '--version') return {status: 0};
    if (name === 'sudo') { chromium = true; return {status: 0}; }
    return {status: 1};
  };
  const result = await doctorFix({platform: 'linux', command, findBrowser: async () => { if (!chromium) throw new Error('missing'); return '/usr/bin/chromium'; }, log: message => messages.push(message)});
  assert.deepEqual(result.actions, ['Installed Codex CLI.', 'Installed Chromium.']);
  assert.equal(result.browser, '/usr/bin/chromium');
  assert.ok(calls.includes('npm install --global @openai/codex'));
  assert.ok(calls.includes('sudo apt-get install -y chromium'));
  assert.ok(messages.some(message => message.includes('ChatGPT sign-in')));
});
test('discovery fills spare capacity from a portal when other portals are exhausted', async () => {
  const {store, close} = await temporary();
  try {
    const run = createRun({...config, limit: 100});
    await new Runner(run, store, fake({discover: async (_config, site, limit) => site === '99acres' ? Array.from({length: limit}, (_, index) => project(site, 'Project ' + index, `https://www.99acres.com/fixture-npxid-${index}`)) : []})).discover();
    assert.equal(run.projects.length, 100); assert.equal(new Set(run.projects.map(item => item.id)).size, 100);
  } finally { await close(); }
});
test('stopped batch resumes remaining work without repeating confirmed submissions', async () => {
  const {store, close} = await temporary();
  try {
    const run = createRun({...config, mode: 'submit', limit: 100});
    run.projects = Array.from({length: 100}, (_, index) => project('99acres', 'Project ' + index, `https://www.99acres.com/fixture-npxid-${index}`));
    let sent = 0; const driver = fake({submit: async () => { sent++; return true; }});
    const runner = new Runner(run, store, driver);
    runner.on('change', () => { if (counts(run).submitted === 25 && !runner.stopped) void runner.stop(); });
    await runner.process(); assert.equal(counts(run).submitted, 25); assert.equal(run.state, 'stopped');
    const saved = await store.load(run.id); await new Runner(saved, store, driver).process();
    assert.equal(counts(saved).submitted, 100); assert.equal(sent, 100);
  } finally { await close(); }
});
