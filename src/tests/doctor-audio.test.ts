import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {doctorFix} from '../doctor.js';
import type {CommandRunner} from '../doctor.js';
import type {AudioPrerequisite} from '../audio-captcha.js';

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-doctor-audio-'));
  const calls: Array<{name: string; args: string[]}> = [];
  const messages: string[] = [];
  const environment = join(directory, 'audio-venv');
  const python = join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return {directory, calls, messages, environment, python, close: () => rm(directory, {recursive: true, force: true})};
}
function noOverride(): () => void {
  const previous = process.env.BISMYTH_AUDIO_PYTHON;
  delete process.env.BISMYTH_AUDIO_PYTHON;
  return () => { if (previous === undefined) delete process.env.BISMYTH_AUDIO_PYTHON; else process.env.BISMYTH_AUDIO_PYTHON = previous; };
}
const browser = async () => '/usr/bin/chromium';

test('doctor-fix repairs audio prerequisites and installs only into a private venv', async () => {
  const fixture = await setup(); const restore = noOverride();
  let pythonReady = false; let ffmpegReady = false; let speechReady = false;
  const check = () => ({python: pythonReady ? fixture.python : 'python3', missing: [!pythonReady && 'python3', !ffmpegReady && 'ffmpeg', !speechReady && 'SpeechRecognition'].filter(Boolean) as AudioPrerequisite[]});
  const command: CommandRunner = (name, args) => {
    fixture.calls.push({name, args});
    if (name === 'codex' || name === 'apt-get') return {status: 0};
    if (name === 'sudo') { pythonReady = true; ffmpegReady = true; return {status: 0}; }
    if (name === 'python3' && args[0] === '-c') return {status: pythonReady ? 0 : 1};
    if (name === 'python3' && args[1] === 'venv') {
      mkdirSync(join(fixture.environment, 'bin'), {recursive: true}); writeFileSync(fixture.python, 'fixture'); return {status: 0};
    }
    if (name === fixture.python && args[1] === 'pip') { speechReady = true; return {status: 0}; }
    return {status: 1};
  };
  try {
    const result = await doctorFix({dataDirectory: fixture.directory, platform: 'linux', command, audioCheck: check, findBrowser: browser, log: line => fixture.messages.push(line)});
    assert.deepEqual(result.actions, ['Installed audio system prerequisites.', 'Prepared private audio transcription environment.']);
    assert.ok(fixture.calls.some(call => call.name === 'sudo' && call.args.join(' ') === 'apt-get install -y python3 python3-venv ffmpeg'));
    assert.ok(fixture.calls.some(call => call.name === fixture.python && call.args.join(' ') === '-m pip install SpeechRecognition==3.17.0'));
    assert.ok(!fixture.calls.some(call => call.name === 'pip' || call.args.includes('--break-system-packages')));
    assert.equal((await stat(fixture.environment)).mode & 0o777, 0o700);
  } finally { restore(); await fixture.close(); }
});

test('doctor-fix repairs only FFmpeg when the selected audio Python is already ready', async () => {
  const fixture = await setup(); const restore = noOverride(); let ready = false;
  const command: CommandRunner = (name, args) => { fixture.calls.push({name, args}); if (name === 'sudo') ready = true; return {status: 0}; };
  try {
    await doctorFix({dataDirectory: fixture.directory, platform: 'linux', command, audioCheck: () => ({python: 'python3', missing: ready ? [] : ['ffmpeg']}), findBrowser: browser, log: line => fixture.messages.push(line)});
    assert.ok(fixture.calls.some(call => call.name === 'sudo' && call.args.join(' ') === 'apt-get install -y ffmpeg'));
    assert.ok(!fixture.calls.some(call => call.args.includes('venv') || call.args.includes('pip')));
  } finally { restore(); await fixture.close(); }
});

test('doctor-fix adds SpeechRecognition to an existing private venv without rebuilding it', async () => {
  const fixture = await setup(); const restore = noOverride(); let ready = false;
  await mkdir(join(fixture.environment, 'bin'), {recursive: true}); writeFileSync(fixture.python, 'existing interpreter');
  const command: CommandRunner = (name, args) => { fixture.calls.push({name, args}); if (name === fixture.python) ready = true; return {status: 0}; };
  try {
    await doctorFix({dataDirectory: fixture.directory, platform: 'linux', command, audioCheck: () => ({python: fixture.python, missing: ready ? [] : ['SpeechRecognition']}), findBrowser: browser, log: line => fixture.messages.push(line)});
    assert.ok(!fixture.calls.some(call => call.args.includes('venv') || call.name === 'sudo'));
    assert.equal(await readFile(fixture.python, 'utf8'), 'existing interpreter');
    assert.ok(fixture.calls.some(call => call.name === fixture.python && call.args.includes('SpeechRecognition==3.17.0')));
  } finally { restore(); await fixture.close(); }
});

test('doctor-fix preserves an explicit audio Python override and reports its missing library', async () => {
  const fixture = await setup(); const restore = noOverride(); process.env.BISMYTH_AUDIO_PYTHON = '/operator/python';
  const command: CommandRunner = (name, args) => { fixture.calls.push({name, args}); return {status: 0}; };
  try {
    await doctorFix({dataDirectory: fixture.directory, platform: 'linux', command, audioCheck: () => ({python: '/operator/python', missing: ['SpeechRecognition']}), findBrowser: browser, log: line => fixture.messages.push(line)});
    assert.ok(!fixture.calls.some(call => call.name === 'sudo' || call.args.includes('venv') || call.args.includes('pip')));
    assert.ok(fixture.messages.some(line => line.includes('BISMYTH_AUDIO_PYTHON') && line.includes('unchanged')));
  } finally { restore(); await fixture.close(); }
});

test('doctor-fix does not fall back to global pip for a damaged existing audio environment', async () => {
  const fixture = await setup(); const restore = noOverride();
  await mkdir(fixture.environment);
  const command: CommandRunner = (name, args) => { fixture.calls.push({name, args}); return {status: name === fixture.python ? 1 : 0}; };
  try {
    await doctorFix({dataDirectory: fixture.directory, platform: 'linux', command, audioCheck: () => ({python: 'python3', missing: ['SpeechRecognition']}), findBrowser: browser, log: line => fixture.messages.push(line)});
    assert.ok(!fixture.calls.some(call => call.name === 'python3' && call.args.includes('pip')));
    assert.ok(!fixture.calls.some(call => call.args.includes('venv')));
    assert.ok(fixture.messages.some(line => line.includes('Existing environments are preserved')));
  } finally { restore(); await fixture.close(); }
});

test('doctor-fix reports unsupported audio system installation without invoking sudo', async () => {
  const fixture = await setup(); const restore = noOverride();
  const command: CommandRunner = (name, args) => { fixture.calls.push({name, args}); return {status: 0}; };
  try {
    await doctorFix({dataDirectory: fixture.directory, platform: 'darwin', command, audioCheck: () => ({python: 'python3', missing: ['python3', 'ffmpeg', 'SpeechRecognition']}), findBrowser: browser, log: line => fixture.messages.push(line)});
    assert.ok(!fixture.calls.some(call => call.name === 'sudo' || call.args.includes('pip') || call.args.includes('venv')));
    assert.ok(fixture.messages.some(line => line.includes('Install Python 3.9+') && line.includes('FFmpeg')));
  } finally { restore(); await fixture.close(); }
});
