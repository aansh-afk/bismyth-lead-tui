#!/usr/bin/env node
import {open, readFile, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {browserPath} from './browser.js';
import {counts} from './model.js';
import {Store} from './store.js';
import {TerminalApp} from './tui.js';
import {chooseWithSubscription, subscriptionStatus} from './subscription.js';
import {doctorFix} from './doctor.js';

const help = `Bismyth property enquiry TUI

Usage:
  bismyth-leads                       Interactive terminal app
  bismyth-leads doctor                Check runtime, Chrome and ChatGPT login
  bismyth-leads doctor-fix            Repair Codex and Chromium where possible
  bismyth-leads check-subscription    Verify ChatGPT login with a real decision
  bismyth-leads history               List saved runs
  bismyth-leads export ID csv|json     Export a saved run
  bismyth-leads --help                 Show this help

Node >=20.19 and Chrome/Chromium are required.
Local data: BISMYTH_TUI_DATA (defaults to ~/.local/share/bismyth-lead-tui)
Browser: BISMYTH_BROWSER_PATH or the Chrome path in Setup.
`;
async function lock(directory: string): Promise<() => Promise<void>> {
  const path = join(directory, 'session.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      await file.writeFile(String(process.pid)); await file.close();
      return async () => { await unlink(path).catch(() => undefined); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(await readFile(path, 'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Session lock is incomplete. Retry after the other app finishes starting.');
      let running = Number.isInteger(pid) && pid > 0;
      if (running) { try { process.kill(pid, 0); } catch (error) { running = (error as NodeJS.ErrnoException).code !== 'ESRCH'; } }
      if (running) throw new Error('Another terminal app is using this data directory.');
      await unlink(path).catch(() => undefined);
    }
  }
  throw new Error('Could not acquire the terminal session lock.');
}
async function main(): Promise<void> {
  const [command, id, format] = process.argv.slice(2);
  if (command === '--help' || command === 'help') { console.log(help); return; }
  const store = new Store(); await store.init();
  const doctor = async (): Promise<void> => {
    const config = await store.config();
    console.log('Node:', process.version); console.log('Data:', store.directory);
    try { console.log('Chrome:', await browserPath(config.browserPath)); } catch (error) { console.log('Chrome: missing (' + (error as Error).message + ')'); }
    try { console.log('AI:', await subscriptionStatus()); } catch (error) { console.log('AI: unavailable (' + (error as Error).message + ')'); }
    console.log('Saved runs:', (await store.history()).length); return;
  };
  if (command === 'doctor') {
    await doctor(); return;
  }
  if (command === 'doctor-fix') {
    const config = await store.config();
    console.log('Preparing local Bismyth data…');
    const repaired = await doctorFix({findBrowser: () => browserPath(config.browserPath)});
    for (const action of repaired.actions) console.log(action);
    if (repaired.browser) console.log('Chrome ready:', repaired.browser);
    console.log(''); await doctor(); return;
  }
  if (command === 'check-subscription') {
    console.log(await subscriptionStatus());
    const choice = await chooseWithSubscription('Open the property contact form', [{id: 'contact', label: 'Contact owner'}, {id: 'gallery', label: 'View gallery'}]);
    if (choice !== 'contact') throw new Error('Subscription responded, but the decision check failed.');
    console.log('Live subscription decision passed: Contact owner.'); return;
  }
  if (command === 'history') {
    for (const run of await store.history()) console.log(run.id, run.createdAt, run.config.city, run.config.mode, run.state, JSON.stringify(counts(run)));
    return;
  }
  if (command === 'export') {
    if (!id || !['csv', 'json'].includes(format)) throw new Error('Usage: export ID csv|json');
    console.log(await store.export(await store.load(id), format as 'csv' | 'json')); return;
  }
  if (command) throw new Error('Unknown command: ' + command + '\n' + help);
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Open an interactive terminal to launch the TUI. Use --help for noninteractive commands.');
  const release = await lock(store.directory);
  try { await new TerminalApp(await store.config(), store).start(); } finally { await release(); }
}
main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
