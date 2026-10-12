import {spawnSync} from 'node:child_process';

export interface CommandResult {status: number | null; error?: Error}
export type CommandRunner = (command: string, args: string[]) => CommandResult;
export interface DoctorFixOptions {
  platform?: NodeJS.Platform;
  command?: CommandRunner;
  findBrowser: () => Promise<string>;
  log?: (line: string) => void;
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
  if (codexInstalled && !succeeds(command, 'codex', ['login', 'status'])) log('ChatGPT sign-in still needs you: run codex login and choose Sign in with ChatGPT.');
  return {actions, browser, codexInstalled};
}
