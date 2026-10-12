import {emitKeypressEvents} from 'node:readline';
import type {Key} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {createRun, project, siteForUrl, sites, validateConfig} from './model.js';
import type {Config, Run, Site} from './model.js';
import {PortalBrowser} from './browser.js';
import {Runner} from './runner.js';
import {Store} from './store.js';
import {loadAdapters} from './adapters.js';
import {messageDetailLayout, renderView} from './terminal-view.js';
import {subscriptionStatus} from './subscription.js';
import {indiaStates, citiesForState} from './locations.js';
export {clean} from './terminal-view.js';

interface Field {key: Exclude<keyof Config, 'seedUrls'> | 'importFile'; label: string; hint: string}
const fields: Field[] = [
  {key: 'stateCode', label: 'State / UT', hint: 'Choose an Indian state or union territory'},
  {key: 'city', label: 'City', hint: 'Choose a city from the selected state/UT'},
  {key: 'intent', label: 'Property intent', hint: 'buy or rent'},
  {key: 'name', label: 'Contact name', hint: 'Name supplied to the property form'},
  {key: 'email', label: 'Email', hint: 'Contact email address'},
  {key: 'phone', label: 'Phone', hint: 'Phone number; +91 is supported'},
  {key: 'sites', label: 'Websites', hint: 'Comma separated: 99acres,nobroker,housing'},
  {key: 'limit', label: 'Batch size', hint: '1–300 projects; meeting target is 100–300'},
  {key: 'mode', label: 'Run mode', hint: 'preview fills forms; submit clicks the final submit control'},
  {key: 'delayMs', label: 'Delay (ms)', hint: '0–60000 milliseconds between projects'},
  {key: 'browserPath', label: 'Chrome path', hint: 'Blank detects installed Chrome/Chromium'},
  {key: 'importFile', label: 'Import URL file', hint: 'Text file with one URL per line, or a JSON array of URLs'},
  {key: 'adapterFile', label: 'Adapter overrides', hint: 'Optional JSON file with portal selectors'},
  {key: 'extraFields', label: 'Extra form values', hint: 'JSON object; keys match adapter field names'},
];

export class TerminalApp {
  private screen = 0;
  private selected = [0, 0, 0, 0];
  private editing?: {field: Field; buffer: string};
  private notice = 'Enter your search and contact profile. Press ? for keyboard help.';
  private help = false;
  private details?: {offset: number; message: string};
  private runner?: Runner;
  private current?: Run;
  private history: Run[] = [];
  private busy = false;
  private closing = false;
  private task?: Promise<void>;
  private finish?: () => void;
  private importFile = '';
  private advanced = false;
  private review?: number;
  private auth = 'Checking ChatGPT login…';
  private picker?: {kind: 'state' | 'city'; query: string; selected: number};
  private animationTimer?: ReturnType<typeof setInterval>;
  private animationFrame = 0;
  private startedAt = 0;
  private elapsedMs = 0;
  constructor(private config: Config, private readonly store: Store) {}
  async start(): Promise<void> {
    this.history = await this.store.history();
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true); process.stdin.resume();
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    process.stdin.on('keypress', this.keypress);
    process.stdout.on('resize', this.render);
    process.on('SIGINT', this.signal); process.on('SIGTERM', this.signal);
    this.render();
    void subscriptionStatus().then(status => { this.auth = status; this.render(); }, () => { this.auth = 'Not connected · run codex login'; this.render(); });
    await new Promise<void>(resolve => { this.finish = resolve; });
  }
  private signal = (): void => { void this.shutdown(); };
  private keypress = (text: string | undefined, key: Key): void => {
    if (key.ctrl && key.name === 'c') { void this.shutdown(); return; }
    if (this.busy) return;
    if (this.picker) {
      const choices = this.pickerChoices();
      if (key.name === 'escape') this.picker = undefined;
      else if (key.name === 'up' || key.name === 'down') this.picker.selected = Math.max(0, Math.min(choices.length - 1, this.picker.selected + (key.name === 'up' ? -1 : 1)));
      else if (key.name === 'backspace') { this.picker.query = this.picker.query.slice(0, -1); this.picker.selected = 0; }
      else if (key.name === 'return' && choices[this.picker.selected]) {
        const choice = choices[this.picker.selected]; const kind = this.picker.kind;
        if (kind === 'state') { if (this.config.stateCode !== choice.value) this.config.city = ''; this.config.stateCode = choice.value; this.selected[0] = 1; }
        else this.config.city = choice.value;
        this.picker = undefined;
        void this.action(async () => { await this.store.saveConfig(this.config); this.notice = kind === 'state' ? 'State selected. Enter chooses a city from its list.' : 'City selected: ' + this.config.city; });
      } else if (text && !key.ctrl && !key.meta && !text.startsWith('\x1b')) { this.picker.query += text; this.picker.selected = 0; }
      this.render(); return;
    }
    if (this.review !== undefined) {
      if (key.name === 'escape') this.review = undefined;
      else if (key.name === 'up' || key.name === 'down') this.review = (this.review + (key.name === 'up' ? 2 : 1)) % 3;
      else if (key.name === 'return') {
        const choice = this.review; this.review = undefined;
        if (choice < 2 && this.current) void this.action(async () => {
          const run = createRun({...this.current!.config, mode: choice === 0 ? 'preview' : 'submit'});
          run.projects = this.current!.projects.map(item => project(item.site, item.title, item.url));
          this.current = run; await this.store.save(run); await this.launch(false);
        });
      }
      this.render(); return;
    }
    if (this.editing) {
      if (key.name === 'escape') { this.editing = undefined; this.render(); return; }
      if (key.name === 'return') { void this.action(() => this.saveEdit()); return; }
      if (key.name === 'backspace') this.editing.buffer = Array.from(this.editing.buffer).slice(0, -1).join('');
      else if ((key.name === 'left' || key.name === 'right') && ['intent', 'mode', 'limit'].includes(this.editing.field.key)) {
        const choices = this.editing.field.key === 'intent' ? ['buy', 'rent'] : this.editing.field.key === 'mode' ? ['preview', 'submit'] : ['100', '200', '300'];
        this.editing.buffer = choices[(choices.indexOf(this.editing.buffer) + (key.name === 'left' ? choices.length - 1 : 1)) % choices.length];
      }
      else if (key.ctrl && key.name === 'u') this.editing.buffer = '';
      else if (!key.ctrl && !key.meta && text && !text.startsWith('\x1b')) this.editing.buffer += text.replace(/[\x00-\x1f\x7f]/g, '');
      this.render(); return;
    }
    if (key.name === 'q') { void this.shutdown(); return; }
    if (this.busy) return;
    if (key.name === 'e') {
      this.details = this.details ? undefined : {offset: 0, message: this.runner?.handoffMessage || this.notice};
      this.render(); return;
    }
    if (this.details) {
      if (key.name === 'escape') { this.details = undefined; this.render(); return; }
      if (['up', 'down', 'pageup', 'pagedown', 'home', 'end'].includes(key.name || '')) {
        const layout = messageDetailLayout({width: process.stdout.columns || 100, height: process.stdout.rows || 30, handoff: this.runner?.handoffMessage || '', notice: this.notice, details: this.details, active: Boolean(this.runner?.active), run: this.current});
        const step = key.name === 'pageup' || key.name === 'pagedown' ? layout.pageSize : 1;
        this.details.offset = key.name === 'home' ? 0 : key.name === 'end' ? layout.maxOffset : Math.min(layout.maxOffset, Math.max(0, layout.offset + (key.name === 'up' || key.name === 'pageup' ? -step : step)));
        this.render(); return;
      }
      if (['return', 'c', 'k', 's', 'tab'].includes(key.name || '') || text && /^[1-4]$/.test(text)) this.details = undefined;
      else if (key.name !== 'p') return;
    }
    if (text && /^[1-4]$/.test(text)) { this.screen = Number(text) - 1; this.render(); return; }
    if (key.name === 'tab') { this.screen = (this.screen + (key.shift ? 3 : 1)) % 4; this.render(); return; }
    if (text === '?') { this.help = !this.help; this.render(); return; }
    if (key.name === 'up' || key.name === 'down') { this.move(key.name === 'up' ? -1 : 1); return; }
    if (key.name === 'pageup' || key.name === 'pagedown') { this.move(key.name === 'pageup' ? -8 : 8); return; }
    if (key.name === 'return' && this.runner?.active && this.runner.paused && !this.runner.stopped) { this.runner.pause(); this.render(); return; }
    if (key.name === 'return' && this.runner?.active && this.runner.handoffMessage && !this.runner.stopped) { this.runner.continue('continue'); return; }
    if (key.name === 'p' && this.runner?.active) { this.runner.pause(); this.render(); return; }
    if (key.name === 's' && this.runner?.active) { void this.runner.stop(); this.notice = 'Stopping browser; saving progress…'; this.render(); return; }
    if (key.name === 'c') { this.runner?.continue('continue'); return; }
    if (key.name === 'k') { this.runner?.continue('skip'); return; }
    if (this.runner?.active) { this.notice = 'Pause, continue, skip or stop the current run first.'; this.render(); return; }
    if (key.name === 'a' && this.screen === 0) { this.advanced = !this.advanced; this.selected[0] = this.advanced ? 8 : 0; this.render(); return; }
    if (key.name === 'return' && this.screen === 0) { this.beginEdit(); this.render(); return; }
    const runShortcut = key.name === 'r';
    if ((key.name === 'return' && [1, 2].includes(this.screen) || runShortcut && this.screen !== 0) && this.current?.projects.length) { this.review = 0; this.render(); return; }
    if (key.name === 'return' && [1, 2].includes(this.screen)) { this.notice = 'Queue empty. Ctrl+R finds properties from your setup.'; this.render(); return; }
    void this.action(async () => {
      if (key.name === 'return') {
        if (this.screen === 3 && this.history[this.selected[3]]) {
          this.current = await this.store.load(this.history[this.selected[3]].id);
          this.screen = 1; this.selected[1] = 0;
          this.notice = 'Loaded saved run. r resumes queued projects; n creates a fresh run.';
        }
      }
      if (key.name === 'n') {
        this.current = createRun(this.config); await this.store.save(this.current);
        this.screen = 1; this.selected[1] = 0; this.notice = 'New empty run created. d discovers projects; i imports configured URLs.';
      }
      if (key.name === 'd' || runShortcut) await this.launch(true);
      if (key.name === 'i') await this.importQueue();
      if (key.name === 'v' && this.current) {
        const run = createRun(this.config);
        run.projects = this.current.projects.map(item => project(item.site, item.title, item.url)).slice(0, run.config.limit);
        this.current = run; await this.store.save(run); this.screen = 1;
        this.notice = 'Queue copied into a new run using the current Setup profile and mode.';
      }
      if (key.name === 'x' || key.name === 'j') {
        const run = this.screen === 3 ? this.history[this.selected[3]] : this.current;
        if (!run) throw new Error('Select a run to export.');
        this.notice = 'Exported: ' + await this.store.export(run, key.name === 'x' ? 'csv' : 'json');
      }
      if (key.name === 'f') {
        if (this.screen === 0) await this.launch(true);
        else { this.history = await this.store.history(); this.notice = 'History refreshed.'; }
      }
    });
  };
  private async action(task: () => Promise<void>): Promise<void> {
    this.busy = true;
    try { await task(); } catch (error) { this.notice = (error as Error).message; }
    finally { this.busy = false; this.render(); }
  }
  private move(delta: number): void {
    const length = this.screen === 0 ? (this.advanced ? fields.length : 8) : this.screen === 3 ? this.history.length : this.screen === 1 ? this.current?.projects.length || 0 : this.current?.events.length || 0;
    this.selected[this.screen] = Math.max(this.screen === 0 && this.advanced ? 8 : 0, Math.min(length - 1, this.selected[this.screen] + delta)); this.render();
  }
  private fieldValue(field: Field): string {
    if (field.key === 'importFile') return this.importFile;
    const value = this.config[field.key];
    if (field.key === 'extraFields') return JSON.stringify(value);
    if (Array.isArray(value)) return value.join(',');
    return String(value);
  }
  private beginEdit(): void {
    const field = fields[this.selected[0]];
    if (field.key === 'stateCode' || field.key === 'city') {
      if (field.key === 'city' && !this.config.stateCode) { this.notice = 'Choose a state/UT first.'; this.selected[0] = 0; return; }
      this.picker = {kind: field.key === 'stateCode' ? 'state' : 'city', query: '', selected: 0}; return;
    }
    this.editing = {field, buffer: this.fieldValue(field)};
  }
  private pickerChoices(): {value: string; label: string}[] {
    if (!this.picker) return [];
    const choices = this.picker.kind === 'state' ? indiaStates.map(state => ({value: state.code, label: state.name})) : citiesForState(this.config.stateCode).map(city => ({value: city, label: city}));
    const query = this.picker.query.toLowerCase();
    return choices.filter(choice => choice.label.toLowerCase().includes(query)).sort((a, b) => Number(b.label.toLowerCase() === query) - Number(a.label.toLowerCase() === query) || Number(b.label.toLowerCase().startsWith(query)) - Number(a.label.toLowerCase().startsWith(query)) || a.label.localeCompare(b.label));
  }
  private async saveEdit(): Promise<void> {
    if (!this.editing) return;
    const {field, buffer} = this.editing;
    const value = buffer.trim();
    const next = structuredClone(this.config);
    if (field.key === 'importFile') {
      const content = await readFile(value, 'utf8');
      const urls: unknown = content.trim().startsWith('[') ? JSON.parse(content) : content.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      if (!Array.isArray(urls) || urls.some(url => typeof url !== 'string' || !siteForUrl(url))) throw new Error('Import file must contain supported portal URLs.');
      next.seedUrls = urls as string[]; this.importFile = value;
    } else if (field.key === 'sites') {
      const selected = [...new Set(value.split(',').map(site => site.trim().toLowerCase()))];
      if (!selected.length || selected.some(site => !sites.includes(site as Site))) throw new Error('Use 99acres,nobroker,housing separated by commas.');
      next.sites = selected as Site[];
    } else if (field.key === 'limit' || field.key === 'delayMs') {
      const number = Number(value);
      if (!value || !Number.isInteger(number) || number < (field.key === 'limit' ? 1 : 0) || number > (field.key === 'limit' ? 300 : 60000)) throw new Error(field.hint);
      next[field.key] = number;
    } else if (field.key === 'intent' || field.key === 'mode') {
      if (!(field.key === 'intent' ? ['buy', 'rent'] : ['preview', 'submit']).includes(value)) throw new Error(field.hint);
      if (field.key === 'intent') next.intent = value as Config['intent']; else next.mode = value as Config['mode'];
    } else if (field.key === 'extraFields') {
      const extra: unknown = JSON.parse(value);
      if (!extra || typeof extra !== 'object' || Array.isArray(extra) || Object.values(extra).some(value => typeof value !== 'string')) throw new Error('Use a JSON object of string values.');
      next.extraFields = extra as Record<string, string>;
    } else next[field.key] = value;
    await this.store.saveConfig(next); this.config = next; this.editing = undefined;
    this.notice = 'Saved ' + field.label + '. New runs use this profile; saved runs keep their original profile.';
  }
  private async importQueue(): Promise<void> {
    if (!this.config.seedUrls.length) throw new Error('Set an Import URL file in Setup first.');
    const run = createRun(this.config);
    const seen = new Set<string>();
    const definitions = await loadAdapters(this.config.adapterFile);
    for (const url of this.config.seedUrls) {
      const site = siteForUrl(url);
      if (!site || !run.config.sites.includes(site)) continue;
      if (!new RegExp(definitions[site].projectPattern, 'i').test(new URL(url).pathname)) throw new Error('This import includes search-result URLs. Press d to discover their projects.');
      const item = project(site, new URL(url).pathname.split('/').pop() || url, url);
      if (!seen.has(item.id) && run.projects.length < run.config.limit) { run.projects.push(item); seen.add(item.id); }
    }
    this.current = run; await this.store.save(run); this.screen = 1; this.selected[1] = 0;
    this.notice = 'Imported ' + run.projects.length + ' URLs. Use d instead for search-result URLs.';
  }
  private async launch(discover: boolean): Promise<void> {
    if (discover) {
      const errors = validateConfig(this.config);
      if (errors.length) { this.screen = 0; this.advanced = false; throw new Error('Complete your setup first. ' + errors.join(' ')); }
      this.current = createRun(this.config); await this.store.save(this.current);
    }
    if (!this.current || !discover && !this.current.projects.length) throw new Error('Discover or import projects before starting a run.');
    const errors = validateConfig(this.current.config, !discover);
    if (errors.length) throw new Error(errors.join(' '));
    this.animationFrame = 0; this.startedAt = Date.now(); this.elapsedMs = 0;
    this.runner = new Runner(this.current, this.store, new PortalBrowser(this.store.directory));
    this.runner.on('change', this.render); this.screen = 2;
    this.notice = discover ? 'Discovering projects in Chrome…' : 'Processing saved queue in ' + this.current.config.mode + ' mode…';
    this.task = (discover ? this.runner.discover() : this.runner.process()).then(async () => {
      this.history = await this.store.history(); this.selected[2] = Math.max(0, (this.current?.events.length || 0) - 1);
      if (discover) { this.screen = 1; this.selected[1] = 0; this.notice = this.current?.projects.length ? 'Properties found. Review the list, then press Enter to choose a test or live run.' : 'No properties found. Check your city or import project URLs in Advanced settings.'; }
      this.render();
    });
  }
  private render = (): void => {
    if (this.closing) return;
    if (this.details && this.details.message !== (this.runner?.handoffMessage || this.notice)) this.details = undefined;
    const animating = this.runner?.active && !this.runner.paused && !this.runner.stopped && !this.runner.handoffMessage && ['discovering', 'running'].includes(this.current?.state || '');
    if (animating) {
      this.elapsedMs = Date.now() - this.startedAt;
      if (!this.animationTimer) {
        this.animationTimer = setInterval(() => { this.animationFrame = (this.animationFrame + 1) % 10; this.render(); }, 120);
        this.animationTimer.unref();
      }
    } else if (this.animationTimer) { clearInterval(this.animationTimer); this.animationTimer = undefined; }
    process.stdout.write(renderView({
      width: process.stdout.columns || 100, height: process.stdout.rows || 30,
      screen: this.screen, selected: this.selected, config: this.config,
      run: this.current, history: this.history, advanced: this.advanced,
      notice: this.notice, help: this.help, handoff: this.runner?.handoffMessage || '',
      details: this.details,
      active: Boolean(this.runner?.active), auth: this.auth, review: this.review,
      animationFrame: this.animationFrame, elapsedMs: this.elapsedMs, stopping: Boolean(this.runner?.active && this.runner.stopped),
      editing: this.editing ? {label: this.editing.field.label, buffer: this.editing.buffer, hint: this.editing.field.hint} : undefined,
      picker: this.picker ? {title: this.picker.kind === 'state' ? 'Choose a state / UT · India' : 'Choose a city · ' + (indiaStates.find(state => state.code === this.config.stateCode)?.name || ''), query: this.picker.query, selected: this.picker.selected, choices: this.pickerChoices().map(choice => choice.label)} : undefined,
      fields: fields.map((field, index) => ({index, label: field.label, hint: field.hint, value: field.key === 'stateCode' ? indiaStates.find(state => state.code === this.config.stateCode)?.name || '' : this.fieldValue(field)})).filter(field => this.advanced ? field.index >= 8 : field.index < 8),
    }));
  };
  private async shutdown(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.animationTimer) { clearInterval(this.animationTimer); this.animationTimer = undefined; }
    try { if (this.runner?.active) await this.runner.stop(); await this.task; }
    finally {
      process.stdin.off('keypress', this.keypress); process.stdout.off('resize', this.render);
      process.off('SIGINT', this.signal); process.off('SIGTERM', this.signal);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause(); process.stdout.write('\x1b[?25h\x1b[?1049l'); this.finish?.();
    }
  }
}
