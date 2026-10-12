import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isRecaptchaAudioUrl, solveAudioWithGoogle} from '../audio-captcha.js';

const payloadURL = 'https://www.google.com/recaptcha/api2/payload?p=fixture';
async function fixture(run: (audio: Buffer, directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-audio-helper-'));
  const before = {python: process.env.BISMYTH_AUDIO_PYTHON, path: process.env.PYTHONPATH, words: process.env.BISMYTH_TEST_WORDS, fetch: globalThis.fetch};
  await writeFile(join(directory, 'speech_recognition.py'), `import os, wave
class AudioFile:
    def __init__(self, source): self.source=source
    def __enter__(self):
        with wave.open(self.source, 'rb') as recording:
            assert recording.getnchannels()==1
            assert recording.getsampwidth()==2
            assert recording.getframerate()==16000
            assert 0<len(recording.readframes(recording.getnframes()))<=2*1024*1024
        return self
    def __exit__(self, *args): pass
class Recognizer:
    def record(self, source): return source
    def recognize_google(self, recording, language, endpoint):
        assert self.operation_timeout==20
        assert language=='en-US'
        assert endpoint=='https://www.google.com/speech-api/v2/recognize'
        return os.environ.get('BISMYTH_TEST_WORDS', 'one two three')
`);
  process.env.BISMYTH_AUDIO_PYTHON = 'python3'; process.env.PYTHONPATH = directory;
  delete process.env.BISMYTH_TEST_WORDS;
  const audio = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=0.2', '-f', 'mp3', 'pipe:1']);
  try { await run(audio, directory); }
  finally {
    for (const [key, value] of [['BISMYTH_AUDIO_PYTHON', before.python], ['PYTHONPATH', before.path], ['BISMYTH_TEST_WORDS', before.words]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    globalThis.fetch = before.fetch;
    await rm(directory, {recursive: true, force: true});
  }
}

test('audio URLs are restricted to observed HTTPS reCAPTCHA payload endpoints', () => {
  for (const host of ['google.com', 'www.google.com', 'recaptcha.net', 'www.recaptcha.net']) {
    assert.equal(isRecaptchaAudioUrl(`https://${host}/recaptcha/api2/payload?p=fixture`), true);
    assert.equal(isRecaptchaAudioUrl(`https://${host}/recaptcha/enterprise/payload?p=fixture`), true);
  }
  for (const url of ['http://www.google.com/recaptcha/api2/payload', 'https://evil.test/recaptcha/api2/payload', 'https://www.google.com.evil.test/recaptcha/api2/payload', 'https://user:pass@www.google.com/recaptcha/api2/payload', 'https://www.google.com:8443/recaptcha/api2/payload', 'https://www.google.com/other', payloadURL + '#fragment']) assert.equal(isRecaptchaAudioUrl(url), false);
});

test('native audio helper anonymously downloads and actually converts MP3 to mono 16 kHz WAV', async () => {
  await fixture(async audio => {
    let requests = 0;
    globalThis.fetch = async (input, init) => {
      requests++; assert.equal(input, payloadURL); assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      assert.equal(new Headers(init?.headers).has('Cookie'), false);
      return new Response(new Uint8Array(audio));
    };
    assert.equal(await solveAudioWithGoogle(payloadURL, new AbortController().signal), 'one two three');
    assert.equal(requests, 1);
  });
});

test('unsafe URL and cancelled requests never download audio', async () => {
  await fixture(async () => {
    let requests = 0; globalThis.fetch = async () => { requests++; throw new Error('Must not download'); };
    await assert.rejects(solveAudioWithGoogle('https://evil.test/payload', new AbortController().signal), /Unsupported/);
    const controller = new AbortController(); const reason = new Error('Fixture stop'); controller.abort(reason);
    await assert.rejects(solveAudioWithGoogle(payloadURL, controller.signal), error => error === reason);
    assert.equal(requests, 0);
  });
});

test('empty, refused and oversized audio is rejected before Python transcription', async () => {
  await fixture(async () => {
    for (const response of [new Response(null), new Response('refused', {status: 403}), new Response(new Uint8Array(1024 * 1024 + 1)), new Response('small', {headers: {'Content-Length': String(1024 * 1024 + 1)}})]) {
      globalThis.fetch = async () => response;
      await assert.rejects(solveAudioWithGoogle(payloadURL, new AbortController().signal), /Audio challenge (download failed|is too large|is empty)/);
    }
  });
});

test('the owned audio download deadline rejects a stalled request', async context => {
  await fixture(async () => {
    context.mock.timers.enable({apis: ['setTimeout']});
    let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
    globalThis.fetch = async (_input, init) => {
      began(); return new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('Fixture aborted')), {once: true}); });
    };
    const result = solveAudioWithGoogle(payloadURL, new AbortController().signal);
    await started; context.mock.timers.tick(15000);
    await assert.rejects(result, /download timed out/);
  });
});

test('invalid transcription and corrupt MP3 cannot produce a usable answer', async () => {
  await fixture(async audio => {
    globalThis.fetch = async () => new Response(new Uint8Array(audio));
    process.env.BISMYTH_TEST_WORDS = '<script>fixture</script>';
    await assert.rejects(solveAudioWithGoogle(payloadURL, new AbortController().signal), /transcription failed/);
    delete process.env.BISMYTH_TEST_WORDS; globalThis.fetch = async () => new Response('invalid mp3');
    await assert.rejects(solveAudioWithGoogle(payloadURL, new AbortController().signal), /transcription failed/);
  });
});

test('stopping terminates the transcription process even when it ignores SIGTERM', async () => {
  await fixture(async (audio, directory) => {
    const interpreter = join(directory, 'slow python');
    await writeFile(interpreter, '#!/usr/bin/env python3\nimport sys,time,signal\nif sys.argv[1] in ["--version","-c"]: sys.exit(0)\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\ntime.sleep(30)\n', {mode: 0o700});
    process.env.BISMYTH_AUDIO_PYTHON = interpreter;
    const controller = new AbortController(); let abortTimer: ReturnType<typeof setTimeout> | undefined;
    globalThis.fetch = async () => { abortTimer = setTimeout(() => controller.abort(), 200); return new Response(new Uint8Array(audio)); };
    const started = performance.now();
    try { await assert.rejects(solveAudioWithGoogle(payloadURL, controller.signal), /cancelled/); assert.ok(performance.now() - started < 3000); }
    finally { if (abortTimer) clearTimeout(abortTimer); }
  });
});

test('a missing audio interpreter returns setup guidance without blocking the TUI', async () => {
  await fixture(async (audio, directory) => {
    process.env.BISMYTH_AUDIO_PYTHON = join(directory, 'missing python');
    globalThis.fetch = async () => new Response(new Uint8Array(audio));
    await assert.rejects(solveAudioWithGoogle(payloadURL, new AbortController().signal), /could not start.*doctor-fix/);
  });
});
