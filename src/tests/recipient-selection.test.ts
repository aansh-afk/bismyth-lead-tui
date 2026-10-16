import test from 'node:test';
import type {TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Key} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {createRun, defaults, project} from '../model.js';
import type {Config, Run} from '../model.js';
import {extractPublicContacts} from '../contacts.js';
import type {ContactCapture, PublicContact} from '../contacts.js';
import {contactsForRun, selectableContactsForRun, selectedContactsForRun} from '../outreach.js';
import {Runner} from '../runner.js';
import type {Driver} from '../browser.js';
import {Store} from '../store.js';
import {TerminalApp} from '../tui.js';

const timestamp = '2026-10-16T12:00:00.000Z';
const firstPhone = '+919000001001';
const secondPhone = '+919000001002';
const config: Config = {...structuredClone(defaults), stateCode: 'MH', city: 'Mumbai', name: 'Synthetic Operator',
  phone: '9000000000', email: 'operator@example.test', senderBusiness: 'Synthetic Business', sites: ['housing'], delayMs: 0};

interface Controller {
  screen: number; selected: number[]; current?: Run; history: Run[]; busy: boolean; notice: string;
  runner?: {active: boolean}; task?: Promise<void>;
  contactReview?: {runId: string; contacts: PublicContact[]; choice: number};
  render: () => void; keypress: (text: string | undefined, key: Key) => void;
  launchOutreach: (action: string, contacts: PublicContact[]) => Promise<void>;
}

function contact(value: string, overrides: Partial<PublicContact> = {}, sourceUrl = 'https://housing.com/in/buy/synthetic-one'): PublicContact {
  const contacts = extractPublicContacts({url: sourceUrl, markdown: '# Synthetic seller\nOwner contact: ' + value, observedAt: timestamp});
  assert.equal(contacts.length, 1);
  return {...contacts[0]!, review: 'approved', role: 'owner', ...overrides};
}

function capture(contacts: PublicContact[]): ContactCapture {
  return {status: 'captured', attemptedAt: timestamp, detail: 'Synthetic source evidence', contacts};
}

function populatedRun(contacts = [contact(firstPhone), contact(secondPhone)]): Run {
  const run = createRun(config);
  const listing = project('housing', 'Synthetic apartment', 'https://housing.com/in/buy/synthetic-one');
  listing.contactCapture = capture(contacts);
  run.projects = [listing];
  return run;
}

function controller(store: Store, run?: Run): Controller {
  const app = new TerminalApp(config, store) as unknown as Controller;
  app.render = () => undefined;
  app.screen = 4;
  app.current = run;
  return app;
}

function press(app: Controller, name: string): void {
  app.keypress(name === 'space' ? ' ' : name.length === 1 ? name : undefined, {name});
}

async function idle(app: Controller): Promise<void> {
  const deadline = Date.now() + 5000;
  while (app.busy && Date.now() < deadline) await delay(1);
  assert.equal(app.busy, false, 'the keyboard action completes without external services');
  await app.task;
}

async function fixture(t: TestContext, run = populatedRun()): Promise<{store: Store; app: Controller}> {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-recipient-selection-'));
  const store = new Store(directory);
  await store.save(run);
  const app = controller(store, await store.load(run.id));
  app.history = await store.history();
  t.after(async () => { await idle(app); await rm(directory, {recursive: true, force: true}); });
  return {store, app};
}

test('recipient choices persist after a controller restart and saved-run W opens Contacts without sending', async t => {
  const {app, store} = await fixture(t);
  const originalId = app.current!.id;
  assert.deepEqual(selectedContactsForRun(app.current!), []);
  press(app, 'space'); await idle(app);
  const selectedId = contactsForRun(app.current!)[0]!.id;
  assert.deepEqual((await store.load(originalId)).outreachSelection, {contactIds: [selectedId]});
  assert.deepEqual(app.history.find(run => run.id === originalId)!.outreachSelection, {contactIds: [selectedId]});

  const restarted = controller(store);
  restarted.history = await store.history(); restarted.screen = 3;
  const launches: string[] = [];
  restarted.launchOutreach = async action => { launches.push(action); };
  press(restarted, 'w'); await idle(restarted);
  assert.equal(restarted.screen, 4);
  assert.equal(restarted.current!.id, originalId);
  assert.deepEqual(selectedContactsForRun(restarted.current!).map(item => item.id), [selectedId]);
  assert.equal(restarted.contactReview, undefined);
  assert.deepEqual(launches, [], 'loading recipients does not preview or send');

  restarted.screen = 3;
  press(restarted, 'return'); await idle(restarted);
  assert.equal(restarted.screen, 1, 'the existing Saved runs Enter shortcut still loads the property queue');
  assert.equal(restarted.current!.id, originalId);
  assert.deepEqual(launches, []);
});

test('the same phone in different saved runs has independent checked state', async t => {
  const first = populatedRun([contact(firstPhone)]);
  const second = populatedRun([contact(firstPhone)]);
  const {app, store} = await fixture(t, first);
  await store.save(second);
  press(app, 'space'); await idle(app);
  assert.equal(selectedContactsForRun(app.current!).length, 1);

  app.history = await store.history(); app.screen = 3;
  app.selected[3] = app.history.findIndex(run => run.id === second.id);
  press(app, 'w'); await idle(app);
  assert.equal(app.current!.id, second.id);
  assert.deepEqual(selectedContactsForRun(app.current!), [], 'another run does not inherit the phone selection');
  press(app, 'space'); await idle(app); press(app, 'z'); await idle(app);
  assert.deepEqual(selectedContactsForRun(await store.load(second.id)), []);

  app.screen = 3; app.selected[3] = app.history.findIndex(run => run.id === first.id);
  press(app, 'w'); await idle(app);
  assert.equal(app.current!.id, first.id);
  assert.deepEqual(selectedContactsForRun(app.current!).map(item => item.value), [firstPhone]);
});

test('copying a queue retains contact evidence but creates no checked recipients; fresh runs also start empty', async t => {
  const {app, store} = await fixture(t);
  press(app, 'b'); await idle(app);
  const original = structuredClone(app.current!);
  assert.equal(selectedContactsForRun(original).length, 2);
  press(app, 'v'); await idle(app);
  const copied = structuredClone(app.current!);
  assert.notEqual(copied.id, original.id);
  assert.deepEqual(contactsForRun(copied), contactsForRun(original));
  assert.deepEqual(selectedContactsForRun(copied), []);
  assert.equal(copied.outreachSelection, undefined);
  assert.deepEqual((await store.load(original.id)).outreachSelection, original.outreachSelection);
  press(app, 'n'); await idle(app);
  assert.notEqual(app.current!.id, copied.id);
  assert.deepEqual(app.current!.projects, []);
  assert.equal(app.current!.outreachSelection, undefined);
});

test('a phone repeated across listing sources and WhatsApp links has one checkbox and keeps all provenance', async t => {
  const run = populatedRun([contact(firstPhone)]);
  const second = project('housing', 'Synthetic second apartment', 'https://housing.com/in/buy/synthetic-two');
  second.contactCapture = capture([contact(firstPhone, {kind: 'whatsapp'}, second.url)]);
  run.projects.push(second);
  const {app, store} = await fixture(t, run);
  assert.equal(contactsForRun(app.current!).length, 1);
  assert.equal(contactsForRun(app.current!)[0]!.attributions!.length, 2);
  press(app, 'space'); await idle(app);
  assert.equal(app.current!.outreachSelection!.contactIds.length, 1);
  assert.deepEqual(selectedContactsForRun(app.current!).map(item => item.value), [firstPhone]);
  const reloaded = await store.load(run.id);
  assert.equal(contactsForRun(reloaded)[0]!.attributions!.length, 2);
  press(app, 'space'); await idle(app);
  assert.deepEqual(selectedContactsForRun(app.current!), []);
});

test('later contact collection keeps previous choices and leaves newly discovered people unchecked', async t => {
  const run = populatedRun([contact(firstPhone)]);
  run.projects.push(project('housing', 'Synthetic new apartment', 'https://housing.com/in/buy/synthetic-new'));
  const {app, store} = await fixture(t, run);
  press(app, 'space'); await idle(app);
  let collectionRequests = 0;
  const driver: Driver = {
    discover: async () => { throw new Error('No browser discovery expected'); },
    prepare: async () => { throw new Error('No property form expected'); },
    submit: async () => { throw new Error('No submission expected'); },
    confirmed: async () => false, close: async () => undefined,
  };
  await new Runner(app.current!, store, driver).collectContacts({assertConfigured() {}, async capture(page) {
    collectionRequests++;
    return capture([contact(secondPhone, {}, page.url)]);
  }}, 2);
  const saved = await store.load(run.id);
  assert.equal(collectionRequests, 1, 'the existing captured listing is not collected again');
  assert.deepEqual(contactsForRun(saved).map(item => item.value), [firstPhone, secondPhone]);
  assert.deepEqual(selectedContactsForRun(saved).map(item => item.value), [firstPhone]);
});

test('Space rejects email and unapproved rows; select-all includes only eligible phones and clear persists', async t => {
  const eligible = contact(firstPhone);
  const unapproved = contact(secondPhone, {review: 'needs-review'});
  const email = contact('seller@example.test');
  const unknown = contact('+919000001003', {role: 'unknown'});
  const {app, store} = await fixture(t, populatedRun([eligible, unapproved, email, unknown]));
  assert.deepEqual(selectableContactsForRun(app.current!).map(item => item.value), [firstPhone]);
  for (const value of [secondPhone, 'seller@example.test', unknown.value]) {
    app.selected[4] = contactsForRun(app.current!).findIndex(item => item.value === value);
    press(app, 'space'); await idle(app);
    assert.match(app.notice, /Only approved Indian phone contacts/);
    assert.deepEqual(selectedContactsForRun(app.current!), []);
  }
  press(app, 'b'); await idle(app);
  assert.deepEqual(selectedContactsForRun(app.current!).map(item => item.value), [firstPhone]);
  assert.deepEqual((await store.load(app.current!.id)).outreachSelection, app.current!.outreachSelection);
  press(app, 'z'); await idle(app);
  assert.deepEqual((await store.load(app.current!.id)).outreachSelection, {contactIds: []});
  assert.equal(contactsForRun(app.current!).length, 4, 'clear changes selection without deleting contacts');
});

test('Enter and W review checked recipients only, even when an unchecked person has keyboard focus', async t => {
  const {app} = await fixture(t);
  const calls: {action: string; phones: string[]}[] = [];
  app.launchOutreach = async (action, contacts) => { calls.push({action, phones: contacts.map(item => item.value)}); };
  for (const shortcut of ['return', 'w']) {
    press(app, shortcut);
    assert.equal(app.contactReview, undefined, 'no checked recipients means no review dialog');
  }
  press(app, 'space'); await idle(app);
  app.selected[4] = 1;
  for (const [shortcut, choice] of [['return', 0], ['w', 1]] as const) {
    press(app, shortcut);
    assert.equal(app.contactReview!.runId, app.current!.id);
    assert.deepEqual(app.contactReview!.contacts.map(item => item.value), [firstPhone]);
    assert.equal(app.contactReview!.choice, 0, 'every review begins with Preview selected');
    if (choice === 1) press(app, 'down');
    press(app, 'return'); await idle(app);
  }
  assert.deepEqual(calls, [{action: 'preview', phones: [firstPhone]}, {action: 'send', phones: [firstPhone]}]);
});

test('a changed run, removed selection or revoked approval invalidates an open send review', async t => {
  const {app} = await fixture(t);
  const original = structuredClone(app.current!);
  let launches = 0;
  app.launchOutreach = async () => { launches++; };
  for (const change of ['run', 'selection', 'approval'] as const) {
    app.current = structuredClone(original);
    press(app, 'space'); await idle(app);
    press(app, 'w'); press(app, 'down');
    assert.equal(app.contactReview!.choice, 1);
    if (change === 'run') app.current = populatedRun();
    else if (change === 'selection') app.current!.outreachSelection = {contactIds: []};
    else app.current!.projects[0]!.contactCapture!.contacts[0]!.review = 'needs-review';
    press(app, 'return'); await idle(app);
    assert.equal(launches, 0, change + ' prevents invoking the send task');
    assert.equal(app.contactReview, undefined);
    assert.match(app.notice, change === 'run' ? /loaded run changed/ : /selection or approval changed/i);
  }
});

test('failed selection persistence leaves the in-memory run, history and saved choices unchanged', async t => {
  const {app, store} = await fixture(t);
  press(app, 'space'); await idle(app);
  const before = structuredClone(app.current!);
  const previousReference = app.current;
  const previousHistory = structuredClone(app.history);
  const path = join(store.directory, 'runs', before.id + '.json');
  const saved = await readFile(path, 'utf8');
  t.mock.method(store, 'save', async () => { throw new Error('Synthetic disk unavailable'); });
  app.selected[4] = 1;
  press(app, 'space'); await idle(app);
  assert.match(app.notice, /Synthetic disk unavailable/);
  assert.equal(app.current, previousReference, 'the unsuccessful replacement run is not installed');
  assert.deepEqual(app.current, before);
  assert.deepEqual(app.history, previousHistory);
  assert.equal(await readFile(path, 'utf8'), saved);
});

test('failed approval revocation retains the previous approval and selected recipients in memory and on disk', async t => {
  const {app, store} = await fixture(t);
  press(app, 'space'); await idle(app);
  const before = structuredClone(app.current!);
  const previousReference = app.current;
  const previousHistory = structuredClone(app.history);
  const path = join(store.directory, 'runs', before.id + '.json');
  const saved = await readFile(path, 'utf8');
  assert.equal(contactsForRun(before)[0]!.review, 'approved');
  assert.deepEqual(selectedContactsForRun(before).map(item => item.value), [firstPhone]);
  t.mock.method(store, 'save', async () => { throw new Error('Synthetic approval write failure'); });
  press(app, 'a'); await idle(app);
  assert.match(app.notice, /Synthetic approval write failure/);
  assert.equal(app.current, previousReference, 'an unsaved approval change cannot replace the current run');
  assert.deepEqual(app.current, before);
  assert.deepEqual(app.history, previousHistory);
  assert.equal(contactsForRun(app.current!)[0]!.review, 'approved');
  assert.deepEqual(selectedContactsForRun(app.current!).map(item => item.value), [firstPhone]);
  assert.equal(await readFile(path, 'utf8'), saved);
  assert.deepEqual(selectedContactsForRun(await store.load(before.id)).map(item => item.value), [firstPhone]);
});

test('active work blocks recipient changes and saved-run recipient loading', async t => {
  const {app, store} = await fixture(t);
  press(app, 'space'); await idle(app);
  const before = structuredClone(app.current!);
  const saved = await readFile(join(store.directory, 'runs', before.id + '.json'), 'utf8');
  const launches: string[] = [];
  app.launchOutreach = async action => { launches.push(action); };
  app.runner = {active: true};
  app.selected[4] = 1;
  for (const shortcut of ['space', 'b', 'z', 'w', 'return']) {
    press(app, shortcut); await idle(app);
    assert.deepEqual(app.current, before, shortcut + ' cannot change choices during active work');
    assert.equal(app.contactReview, undefined);
  }
  app.screen = 3;
  press(app, 'w'); await idle(app);
  assert.equal(app.screen, 3);
  assert.deepEqual(launches, []);
  assert.equal(await readFile(join(store.directory, 'runs', before.id + '.json'), 'utf8'), saved);
});
