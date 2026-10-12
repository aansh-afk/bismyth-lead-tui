import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {setImmediate as yieldToEventLoop} from 'node:timers/promises';
import test from 'node:test';
import {subscriptionJSON} from '../subscription.js';

const strippedKeys = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID'] as const;
const schema = {type: 'object', properties: {choice: {type: 'string'}}, required: ['choice'], additionalProperties: false};
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
type Invocation = {args: string[]; cwd: string; pid: number; presentOverrides: string[]; prompt?: string; schemaMode?: number; directoryMode?: number; image?: {path: string; mode: number; base64: string}};

async function withFakeCodex(run: (calls: () => Promise<Invocation[]>) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-subscription-test-'));
  const capture = join(directory, 'invocations.jsonl');
  const environmentKeys = ['PATH', 'BISMYTH_TEST_CAPTURE', 'BISMYTH_TEST_CODEX_EXIT', 'BISMYTH_TEST_CODEX_WAIT', ...strippedKeys];
  const before = new Map(environmentKeys.map(key => [key, process.env[key]]));
  try {
    await writeFile(join(directory, 'codex'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const record = {args, cwd: process.cwd(), pid: process.pid, presentOverrides: ${JSON.stringify(strippedKeys)}.filter(key => process.env[key] !== undefined)};
const capture = () => fs.appendFileSync(process.env.BISMYTH_TEST_CAPTURE, JSON.stringify(record) + '\\n', {mode: 0o600});
if (args[0] === 'login' && args[1] === 'status') {
  capture(); process.stdout.write('Logged in using ChatGPT\\n');
} else if (args[0] === 'exec') {
  const option = flag => args[args.indexOf(flag) + 1];
  record.schemaMode = fs.statSync(option('--output-schema')).mode & 0o777;
  record.directoryMode = fs.statSync(process.cwd()).mode & 0o777;
  if (args.includes('--image')) {
    const path = option('--image');
    record.image = {path, mode: fs.statSync(path).mode & 0o777, base64: fs.readFileSync(path).toString('base64')};
  }
  let prompt = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => prompt += chunk);
  process.stdin.on('end', () => {
    record.prompt = prompt; capture();
    if (process.env.BISMYTH_TEST_CODEX_EXIT) process.exit(Number(process.env.BISMYTH_TEST_CODEX_EXIT));
    if (process.env.BISMYTH_TEST_CODEX_WAIT) { setInterval(() => {}, 1000); return; }
    fs.writeFileSync(option('--output-last-message'), JSON.stringify({choice: 'fixture'}), {mode: 0o600});
  });
} else process.exit(2);
`, {mode: 0o700});
    process.env.PATH = `${directory}${delimiter}${before.get('PATH') ?? ''}`;
    process.env.BISMYTH_TEST_CAPTURE = capture;
    delete process.env.BISMYTH_TEST_CODEX_EXIT;
    delete process.env.BISMYTH_TEST_CODEX_WAIT;
    for (const key of strippedKeys) process.env[key] = 'fixture-override';
    await run(async () => (await readFile(capture, 'utf8')).split('\n').slice(0, -1).map(line => JSON.parse(line) as Invocation));
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(directory, {recursive: true, force: true});
  }
}

function configuration(args: string[]): string[] {
  return args.flatMap((argument, index) => argument === '-c' ? [args[index + 1]!] : []);
}

async function executionStarted(calls: () => Promise<Invocation[]>): Promise<Invocation> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    try {
      const execution = (await calls()).find(call => call.args[0] === 'exec');
      if (execution) return execution;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await yieldToEventLoop();
  }
  assert.fail('Fake Codex did not start its decision within five seconds.');
}

async function childExited(pid: number): Promise<void> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    try { process.kill(pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await yieldToEventLoop();
  }
  assert.fail('Fake Codex remained alive after its decision was cancelled.');
}

test('image decisions use GPT-6 Luna Low with ChatGPT auth and private, temporary PNG input', async () => {
  await withFakeCodex(async calls => {
    assert.deepEqual(await subscriptionJSON('Inspect the synthetic image.', schema, undefined, image), {choice: 'fixture'});
    const [login, execution] = await calls();
    assert.deepEqual(login!.args, ['login', 'status']);
    for (const call of [login!, execution!]) assert.deepEqual(call.presentOverrides, []);
    assert.equal(execution!.args[execution!.args.indexOf('--model') + 1], 'gpt-6-luna');
    assert.ok(configuration(execution!.args).includes('model_reasoning_effort="low"'));
    assert.ok(configuration(execution!.args).includes('forced_login_method="chatgpt"'));
    assert.ok(configuration(execution!.args).includes('approval_policy="never"'));
    assert.ok(execution!.args.includes('--ignore-user-config'));
    assert.ok(execution!.args.includes('--ignore-rules'));
    assert.equal(execution!.args[execution!.args.indexOf('--sandbox') + 1], 'read-only');
    assert.equal(execution!.prompt, 'Inspect the synthetic image.');
    assert.equal(execution!.directoryMode, 0o700);
    assert.equal(execution!.schemaMode, 0o600);
    assert.equal(execution!.image?.mode, 0o600);
    assert.equal(execution!.image?.base64, image.toString('base64'));
    assert.equal(execution!.image?.path, join(execution!.cwd, 'challenge.png'));
    await assert.rejects(stat(execution!.cwd), {code: 'ENOENT'});
  });
});

test('text-only subscription decisions retain the default model and reasoning effort', async () => {
  await withFakeCodex(async calls => {
    assert.deepEqual(await subscriptionJSON('Choose an offered element.', schema), {choice: 'fixture'});
    const execution = (await calls())[1]!;
    assert.ok(!execution.args.includes('--model'));
    assert.ok(!execution.args.includes('--image'));
    assert.ok(!configuration(execution.args).some(value => value.startsWith('model_reasoning_effort=')));
    assert.ok(configuration(execution.args).includes('forced_login_method="chatgpt"'));
    assert.deepEqual(execution.presentOverrides, []);
    await assert.rejects(stat(execution.cwd), {code: 'ENOENT'});
  });
});

test('a failed image decision removes its temporary screenshot and schema', async () => {
  await withFakeCodex(async calls => {
    process.env.BISMYTH_TEST_CODEX_EXIT = '1';
    await assert.rejects(subscriptionJSON('Inspect the synthetic image.', schema, undefined, image), /Codex decision failed/);
    const execution = (await calls())[1]!;
    assert.equal(execution.image?.base64, image.toString('base64'));
    await assert.rejects(stat(execution.cwd), {code: 'ENOENT'});
  });
});

test('image decisions stay running through 90 seconds and terminate at the 180-second deadline', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  await withFakeCodex(async calls => {
    process.env.BISMYTH_TEST_CODEX_WAIT = '1';
    const controller = new AbortController();
    let settled = false;
    const decision = subscriptionJSON('Inspect the synthetic image.', schema, controller.signal, image)
      .then(value => ({value, error: undefined}), error => ({value: undefined, error: error as Error}))
      .then(result => { settled = true; return result; });
    try {
      const execution = await executionStarted(calls);
      context.mock.timers.tick(90000);
      await yieldToEventLoop();
      assert.equal(settled, false, 'An image request must not stop at the former 90-second deadline.');
      context.mock.timers.tick(89999);
      await yieldToEventLoop();
      assert.equal(settled, false, 'The image request must retain its full 180-second budget.');
      context.mock.timers.tick(1);
      const result = await decision;
      assert.match(result.error?.message ?? '', /Luna image decision timed out after 180 seconds/);
      await childExited(execution.pid);
      await assert.rejects(stat(execution.cwd), {code: 'ENOENT'});
    } finally { controller.abort(); await decision; }
  });
});

test('text decisions retain their 90-second deadline and remove temporary files', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  await withFakeCodex(async calls => {
    process.env.BISMYTH_TEST_CODEX_WAIT = '1';
    const controller = new AbortController();
    let settled = false;
    const decision = subscriptionJSON('Choose an offered element.', schema, controller.signal)
      .then(value => ({value, error: undefined}), error => ({value: undefined, error: error as Error}))
      .then(result => { settled = true; return result; });
    try {
      const execution = await executionStarted(calls);
      context.mock.timers.tick(89999);
      await yieldToEventLoop();
      assert.equal(settled, false);
      context.mock.timers.tick(1);
      const result = await decision;
      assert.match(result.error?.message ?? '', /Subscription decision timed out/);
      await childExited(execution.pid);
      await assert.rejects(stat(execution.cwd), {code: 'ENOENT'});
    } finally { controller.abort(); await decision; }
  });
});

test('cancelling an extended image decision aborts promptly and removes its private inputs', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  await withFakeCodex(async calls => {
    process.env.BISMYTH_TEST_CODEX_WAIT = '1';
    const controller = new AbortController();
    let settled = false;
    const decision = subscriptionJSON('Inspect the synthetic image.', schema, controller.signal, image)
      .then(value => ({value, error: undefined}), error => ({value: undefined, error: error as Error}))
      .then(result => { settled = true; return result; });
    try {
      const execution = await executionStarted(calls);
      context.mock.timers.tick(120000);
      await yieldToEventLoop();
      assert.equal(settled, false, 'The image request must still be running before cancellation.');
      controller.abort();
      const result = await decision;
      assert.ok(result.error, 'Cancellation must reject without advancing the remaining deadline.');
      assert.doesNotMatch(result.error.message, /timed out/);
      await childExited(execution.pid);
      await assert.rejects(stat(execution.cwd), {code: 'ENOENT'});
    } finally { controller.abort(); await decision; }
  });
});
