#!/usr/bin/env node
import {open, readFile, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {browserPath, PortalBrowser} from './browser.js';
import {counts} from './model.js';
import {Store} from './store.js';
import {TerminalApp} from './tui.js';
import {chooseWithSubscription, subscriptionStatus} from './subscription.js';
import {doctorFix} from './doctor.js';
import {audioPrerequisites} from './audio-captcha.js';
import {firecrawlKey, promptFirecrawlKey} from './credentials.js';
import {FirecrawlClient} from './firecrawl.js';
import {choosePublicContacts} from './contact-ai.js';
import {Runner} from './runner.js';
import {WhatsAppRouter} from './whatsapp.js';

const help = `Bismyth property enquiry TUI

Usage:
  bismyth-leads                       Interactive terminal app
  bismyth-leads doctor                Check runtime, Chrome and ChatGPT login
  bismyth-leads doctor-fix            Repair browser, Codex and audio prerequisites
  bismyth-leads check-subscription    Verify ChatGPT login with a real decision
  bismyth-leads firecrawl-login       Save a Firecrawl API key (hidden input)
  bismyth-leads collect-contacts ID N Collect up to N public listing pages (default 10)
  bismyth-leads export-contacts ID csv|json  Export collected contacts only
  bismyth-leads history               List saved runs
  bismyth-leads export ID csv|json     Export a saved run
  bismyth-leads --help                 Show this help
  bismyth-leads --version              Show the installed version

Node >=20.19 and Chrome/Chromium are required.
Local data: BISMYTH_TUI_DATA (defaults to ~/.local/share/bismyth-lead-tui)
Browser: BISMYTH_BROWSER_PATH or the Chrome path in Setup.
Set up starts with website logins: Enter opens Chrome, C checks, N continues.
Audio Python override: BISMYTH_AUDIO_PYTHON (otherwise private app environment).
Firecrawl: FIRECRAWL_API_KEY or firecrawl-login; BISMYTH_FIRECRAWL_URL is optional.
WhatsApp: BISMYTH_WHATSAPP_ROUTER_URL / _API_KEY and BISMYTH_WHATSAPP_SESSION_ID.
In the TUI: Saved runs → W chooses recipients; Space toggles, B selects approved, Z clears.
Enter reviews only checked recipients; H collects contacts and 5 opens Contacts.
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
  if (command === '--version') { console.log((JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {version: string}).version); return; }
  const store = new Store(); await store.init();
  const doctor = async (): Promise<void> => {
    const config = await store.config();
    console.log('Node:', process.version); console.log('Data:', store.directory);
    try { console.log('Chrome:', await browserPath(config.browserPath)); } catch (error) { console.log('Chrome: missing (' + (error as Error).message + ')'); }
    try { console.log('AI:', await subscriptionStatus()); } catch (error) { console.log('AI: unavailable (' + (error as Error).message + ')'); }
    const audio = audioPrerequisites(store.directory);
    console.log('CAPTCHA: GPT-6 Luna Low; automatic audio disabled');
    console.log('Optional audio helper:', audio.missing.length ? 'missing ' + audio.missing.join(', ') : 'ready (unused by the app)');
    console.log('Saved runs:', (await store.history()).length);
    try { console.log('Firecrawl:', await firecrawlKey(store.directory) ? 'key configured (not a live access check)' : 'run bismyth-leads firecrawl-login'); }
    catch { console.log('Firecrawl: local credential unavailable; run firecrawl-login'); }
    try { console.log('WhatsApp:', WhatsAppRouter.fromEnvironment() ? 'router configured (not a live connection check)' : 'router URL/key/session not configured'); }
    catch { console.log('WhatsApp: router configuration invalid'); }
  };
  if (command === 'doctor') { await doctor(); return; }
  if (command === 'doctor-fix') {
    const config = await store.config();
    console.log('Preparing local Bismyth data…');
    const repaired = await doctorFix({findBrowser: () => browserPath(config.browserPath), dataDirectory: store.directory});
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
  if (command === 'firecrawl-login') { await promptFirecrawlKey(store.directory); return; }
  if (command === 'collect-contacts') {
    if (!id) throw new Error('Usage: collect-contacts RUN_ID [maximum-pages]');
    const apiKey = await firecrawlKey(store.directory);
    if (!apiKey) throw new Error('Run bismyth-leads firecrawl-login before collecting contacts.');
    const maximum = format === undefined ? 10 : Number(format);
    const client = new FirecrawlClient({apiKey, baseUrl: process.env.BISMYTH_FIRECRAWL_URL, chooseContacts: choosePublicContacts});
    client.assertConfigured();
    const release = await lock(store.directory);
    let runner: Runner | undefined;
    const stop = (): void => { void runner?.stop(); };
    try {
      const run = await store.load(id); runner = new Runner(run, store, new PortalBrowser(store.directory));
      let last = ''; runner.on('change', () => { const message = run.events.at(-1)?.message; if (message && message !== last) { console.log(message); last = message; } });
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      await runner.collectContacts(client, maximum);
      if (run.state === 'stopped') process.exitCode = 1;
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await release(); }
    return;
  }
  if (command === 'export-contacts') {
    if (!id || !['csv', 'json'].includes(format)) throw new Error('Usage: export-contacts ID csv|json');
    console.log(await store.exportContacts(await store.load(id), format as 'csv' | 'json')); return;
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
