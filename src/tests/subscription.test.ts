import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import test from 'node:test';
import {subscriptionJSON} from '../subscription.js';

const strippedKeys = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID'] as const;
const schema = {type: 'object', properties: {choice: {type: 'string'}}, required: ['choice'], additionalProperties: false};
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
type Invocation = {args: string[]; cwd: string; presentOverrides: string[]; prompt?: string; schemaMode?: number; directoryMode?: number; image?: {path: string; mode: number; base64: string}};

async function withFakeCodex(run: (calls: () => Promise<Invocation[]>) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-subscription-test-'));
  const capture = join(directory, 'invocations.jsonl');
  const environmentKeys = ['PATH', 'BISMYTH_TEST_CAPTURE', 'BISMYTH_TEST_CODEX_EXIT', ...strippedKeys];
  const before = new Map(environmentKeys.map(key => [key, process.env[key]]));
  try {
    await writeFile(join(directory, 'codex'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const record = {args, cwd: process.cwd(), presentOverrides: ${JSON.stringify(strippedKeys)}.filter(key => process.env[key] !== undefined)};
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
    fs.writeFileSync(option('--output-last-message'), JSON.stringify({choice: 'fixture'}), {mode: 0o600});
  });
} else process.exit(2);
`, {mode: 0o700});
    process.env.PATH = `${directory}${delimiter}${before.get('PATH') ?? ''}`;
    process.env.BISMYTH_TEST_CAPTURE = capture;
    delete process.env.BISMYTH_TEST_CODEX_EXIT;
    for (const key of strippedKeys) process.env[key] = 'fixture-override';
    await run(async () => (await readFile(capture, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Invocation));
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
