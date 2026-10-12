import {spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export type AudioSolver = (url: string, signal: AbortSignal) => Promise<string>;
export type AudioPrerequisite = 'python3' | 'ffmpeg' | 'SpeechRecognition';
const maximumAudioBytes = 1024 * 1024;
const helper = fileURLToPath(new URL('../scripts/transcribe-audio.py', import.meta.url));

export function audioEnvironmentDirectory(dataDirectory = process.env.BISMYTH_TUI_DATA || join(homedir(), '.local', 'share', 'bismyth-lead-tui')): string {
  return join(dataDirectory, 'audio-venv');
}
export function audioPython(dataDirectory?: string): string {
  if (process.env.BISMYTH_AUDIO_PYTHON) return process.env.BISMYTH_AUDIO_PYTHON;
  const executable = join(audioEnvironmentDirectory(dataDirectory), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return existsSync(executable) ? executable : 'python3';
}
export function audioPrerequisites(dataDirectory?: string): {missing: AudioPrerequisite[]; python: string} {
  const python = audioPython(dataDirectory);
  const missing: AudioPrerequisite[] = [];
  const available = (command: string, args: string[]): boolean => {
    const result = spawnSync(command, args, {stdio: 'ignore', timeout: 5000, maxBuffer: 1024, windowsHide: true});
    return result.status === 0 && !result.error;
  };
  if (!available('ffmpeg', ['-version'])) missing.push('ffmpeg');
  if (!available(python, ['--version'])) missing.push('python3', 'SpeechRecognition');
  else if (!available(python, ['-c', 'import speech_recognition'])) missing.push('SpeechRecognition');
  return {missing, python};
}

function audioURL(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Unsupported audio challenge URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !['google.com', 'www.google.com', 'recaptcha.net', 'www.recaptcha.net'].includes(url.hostname) || !/^\/recaptcha\/(api2|enterprise)\/payload$/.test(url.pathname)) throw new Error('Unsupported audio challenge URL.');
  return url.href;
}
export function isRecaptchaAudioUrl(value: string): boolean {
  try { audioURL(value); return true; } catch { return false; }
}

async function downloadAudio(url: string, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new Error('Audio challenge download timed out.')); }, 15000);
    abort = () => reject(signal.reason || new Error('Audio challenge cancelled.'));
    signal.addEventListener('abort', abort, {once: true});
  });
  try {
    return await Promise.race([interrupted, (async () => {
      const response = await fetch(url, {credentials: 'omit', redirect: 'error', signal: combined, headers: {Accept: 'audio/mpeg, application/octet-stream'}});
      if (!response.ok || !response.body) throw new Error('Audio challenge download failed.');
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > maximumAudioBytes) throw new Error('Audio challenge is too large.');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maximumAudioBytes) throw new Error('Audio challenge is too large.');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      if (!total) throw new Error('Audio challenge is empty.');
      return Buffer.concat(chunks, total);
    })()]);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && /^Audio challenge (download timed out|download failed|is too large|is empty)\.$/.test(error.message)) throw error;
    throw new Error('Audio challenge download failed.');
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abort) signal.removeEventListener('abort', abort);
    controller.abort();
  }
}

function transcribeAudio(bytes: Uint8Array, signal: AbortSignal, dataDirectory?: string): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(audioPython(dataDirectory), [helper], {stdio: ['pipe', 'pipe', 'pipe'], detached: grouped, windowsHide: true});
    let output = '';
    let outputBytes = 0;
    let failure: Error | undefined;
    let hardStop: ReturnType<typeof setTimeout> | undefined;
    const kill = (force: boolean): void => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        else child.kill(force ? 'SIGKILL' : 'SIGTERM');
      } catch { /* The process may have exited between events. */ }
    };
    const stop = (error: Error): void => {
      if (failure) return;
      failure = error;
      kill(false);
      hardStop = setTimeout(() => kill(true), 500);
    };
    const abort = (): void => stop(new Error('Audio challenge cancelled.'));
    const timeout = setTimeout(() => stop(new Error('Audio transcription timed out.')), 40000);
    signal.addEventListener('abort', abort, {once: true});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > 4096) stop(new Error('Audio transcription returned invalid output.'));
      else output += chunk;
    });
    // Provider diagnostics can contain the challenge payload URL. Never forward them.
    child.stderr.resume();
    child.stdin.on('error', () => undefined);
    child.stdin.end(bytes);
    const cleanup = (): void => {
      clearTimeout(timeout);
      if (hardStop) clearTimeout(hardStop);
      signal.removeEventListener('abort', abort);
    };
    child.on('error', () => { cleanup(); reject(new Error('Audio transcription could not start. Run bismyth-leads doctor-fix.')); });
    child.on('close', code => {
      cleanup();
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(new Error('Audio transcription failed. Run doctor-fix or complete verification in Chrome.')); return; }
      try {
        const value = JSON.parse(output) as {transcript?: unknown};
        const transcript = typeof value.transcript === 'string' ? value.transcript.trim() : '';
        if (!transcript || transcript.length > 256 || !/^[a-zA-Z0-9 ,.'?!-]+$/.test(transcript)) throw new Error();
        resolve(transcript);
      } catch { reject(new Error('Audio transcription returned no usable words.')); }
    });
    if (signal.aborted) abort();
  });
}

export async function solveAudioWithGoogle(url: string, signal: AbortSignal, dataDirectory?: string): Promise<string> {
  const checkedURL = audioURL(url);
  signal.throwIfAborted();
  const bytes = await downloadAudio(checkedURL, signal);
  return transcribeAudio(bytes, signal, dataDirectory);
}
