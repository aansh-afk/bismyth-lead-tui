import {spawnSync} from 'node:child_process';
import {chmod, mkdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {audioEnvironmentDirectory, audioPrerequisites} from './audio-captcha.js';

export interface CommandResult {status: number | null; error?: Error}
export type CommandRunner = (command: string, args: string[]) => CommandResult;
export interface DoctorFixOptions {
  platform?: NodeJS.Platform;
  command?: CommandRunner;
  findBrowser: () => Promise<string>;
  log?: (line: string) => void;
  dataDirectory?: string;
  audioCheck?: typeof audioPrerequisites;
}
export interface DoctorFixResult {actions: string[]; browser?: string; codexInstalled: boolean}

export const systemCommand: CommandRunner = (command, args) => {
  const result = spawnSync(command, args, {stdio: 'inherit'});
  return {status: result.status, error: result.error};
};
function succeeds(command: CommandRunner, executable: string, args: string[]): boolean {
  const result = command(executable, args);
  return result.status === 0 && !result.error;
}
function linuxBrowserInstall(command: CommandRunner): string[] | undefined {
  if (succeeds(command, 'apt-get', ['--version'])) return ['sudo', 'apt-get', 'install', '-y', 'chromium'];
  if (succeeds(command, 'dnf', ['--version'])) return ['sudo', 'dnf', 'install', '-y', 'chromium'];
  if (succeeds(command, 'pacman', ['--version'])) return ['sudo', 'pacman', '--noconfirm', '-S', 'chromium'];
  return undefined;
}
function linuxAudioInstall(command: CommandRunner, python: boolean, ffmpeg: boolean): string[] | undefined {
  if (succeeds(command, 'apt-get', ['--version'])) return ['sudo', 'apt-get', 'install', '-y', ...(python ? ['python3', 'python3-venv'] : []), ...(ffmpeg ? ['ffmpeg'] : [])];
  if (succeeds(command, 'dnf', ['--version'])) return ['sudo', 'dnf', 'install', '-y', ...(python ? ['python3', 'python3-pip'] : []), ...(ffmpeg ? ['ffmpeg'] : [])];
  if (succeeds(command, 'pacman', ['--version'])) return ['sudo', 'pacman', '--noconfirm', '-S', ...(python ? ['python', 'python-pip'] : []), ...(ffmpeg ? ['ffmpeg'] : [])];
  return undefined;
}
async function repairAudio(options: DoctorFixOptions, command: CommandRunner, log: (line: string) => void, actions: string[]): Promise<void> {
  const check = options.audioCheck || audioPrerequisites;
  let readiness = check(options.dataDirectory);
  if (!readiness.missing.length) return;
  const override = Boolean(process.env.BISMYTH_AUDIO_PYTHON);
  const ffmpeg = readiness.missing.includes('ffmpeg');
  const python = !override && (readiness.missing.includes('python3') || !succeeds(command, 'python3', ['-c', 'import venv, ensurepip']));
  if (python || ffmpeg) {
    const install = (options.platform || process.platform) === 'linux' ? linuxAudioInstall(command, python, ffmpeg) : undefined;
    if (!install) log('Audio prerequisites are missing. Install Python 3.9+, its venv support and FFmpeg, then run doctor-fix again.');
    else if (succeeds(command, install[0], install.slice(1))) actions.push('Installed audio system prerequisites.');
    else log('Could not install audio system prerequisites. Resolve the package-manager error above, then run doctor-fix again.');
    readiness = check(options.dataDirectory);
  }
  if (override) {
    if (readiness.missing.some(item => item !== 'ffmpeg')) log('BISMYTH_AUDIO_PYTHON is set. Install SpeechRecognition==3.17.0 in that Python environment or remove the override; doctor-fix leaves it unchanged.');
    return;
  }
  if (readiness.missing.includes('python3') || !readiness.missing.includes('SpeechRecognition')) return;
  const environment = audioEnvironmentDirectory(options.dataDirectory);
  const existing = await stat(environment).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; });
  if (!existing) {
    await mkdir(options.dataDirectory!, {recursive: true, mode: 0o700});
    log('Preparing private audio Python environment…');
    if (!succeeds(command, 'python3', ['-m', 'venv', environment])) { log('Could not create the audio environment. Check Python venv support, then run doctor-fix again.'); return; }
    await chmod(environment, 0o700).catch(() => undefined);
  }
  const pythonPath = join(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!succeeds(command, pythonPath, ['-m', 'pip', 'install', 'SpeechRecognition==3.17.0'])) {
    log('Could not install SpeechRecognition in the private audio environment. Existing environments are preserved; check its Python/pip and run doctor-fix again.'); return;
  }
  readiness = check(options.dataDirectory);
  if (!readiness.missing.includes('SpeechRecognition') && !readiness.missing.includes('python3')) actions.push('Prepared private audio transcription environment.');
  else log('Audio Python verification failed. Check the environment and run doctor-fix again.');
}
export async function doctorFix(options: DoctorFixOptions): Promise<DoctorFixResult> {
  const command = options.command || systemCommand;
  const log = options.log || console.log;
  const actions: string[] = [];
  let codexInstalled = succeeds(command, 'codex', ['--version']);
  if (!codexInstalled) {
    log('Repairing Codex CLI…');
    if (succeeds(command, 'npm', ['install', '--global', '@openai/codex'])) { actions.push('Installed Codex CLI.'); codexInstalled = succeeds(command, 'codex', ['--version']); }
    else log('Could not install Codex CLI. Install Node/npm, then run: npm install -g @openai/codex');
  }
  let browser: string | undefined;
  try { browser = await options.findBrowser(); }
  catch {
    if ((options.platform || process.platform) !== 'linux') log('Chrome/Chromium is missing. Install Chrome or Chromium, then run doctor-fix again.');
    else {
      const install = linuxBrowserInstall(command);
      if (!install) log('Chrome/Chromium is missing and no supported Linux package manager was found. Install Chromium, then run doctor-fix again.');
      else {
        log('Repairing Chrome/Chromium…');
        if (succeeds(command, install[0], install.slice(1))) {
          actions.push('Installed Chromium.');
          try { browser = await options.findBrowser(); } catch { log('Chromium was installed but could not be found yet. Restart the terminal and run doctor-fix again.'); }
        } else log('Could not install Chromium. Resolve the package-manager error above, then run doctor-fix again.');
      }
    }
  }
  if (options.dataDirectory) await repairAudio(options, command, log, actions);
  if (codexInstalled && !succeeds(command, 'codex', ['login', 'status'])) log('ChatGPT sign-in still needs you: run codex login and choose Sign in with ChatGPT.');
  return {actions, browser, codexInstalled};
}
