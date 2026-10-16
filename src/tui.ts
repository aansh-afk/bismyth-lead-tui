import {emitKeypressEvents} from 'node:readline';
import type {Key} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {copyProject, createRun, project, siteForUrl, sites, validateConfig} from './model.js';
import type {Config, Run, Site} from './model.js';
import {PortalBrowser} from './browser.js';
import {Runner} from './runner.js';
import {Store} from './store.js';
import {loadAdapters} from './adapters.js';
import {messageDetailLayout, renderView} from './terminal-view.js';
import {subscriptionStatus} from './subscription.js';
import {indiaStates, citiesForState} from './locations.js';
import {AccountBrowser} from './account-browser.js';
import {blankAccounts, portalAccounts} from './accounts.js';
import type {AccountSnapshot, PortalAccount} from './accounts.js';
import {FirecrawlClient} from './firecrawl.js';
import {firecrawlKey} from './credentials.js';
import {choosePublicContacts} from './contact-ai.js';
import {contactsForRun, OutreachService} from './outreach.js';
import type {OutreachBook} from './outreach.js';
import type {PublicContact} from './contacts.js';
import {renderManagerIntroduction, WhatsAppRouter} from './whatsapp.js';
export {clean} from './terminal-view.js';

interface Field {key: Exclude<keyof Config, 'seedUrls'> | 'importFile' | 'accounts'; label: string; hint: string}
const fields: Field[] = [
  {key: 'accounts', label: 'Website logins', hint: 'Enter connects website accounts in Chrome; L also opens this step'},
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
  {key: 'senderBusiness', label: 'WhatsApp business', hint: 'Your actual business name, used in the introduction preview'},
];

export class TerminalApp {
  private screen = 0;
  private selected = [0, 0, 0, 0, 0];
  private editing?: {field: Field; buffer: string};
  private notice = 'First connect your website accounts. Enter opens Chrome; N continues to your profile.';
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
  private accountSetup = true;
  private accounts: AccountSnapshot = blankAccounts();
  private accountSelected = 0;
  private accountsReviewed = false;
  private accountOperation?: string;
  private accountTask?: Promise<void>;
  private accountBrowser?: Pick<AccountBrowser, 'open' | 'check' | 'close'>;
  private captureReview?: number;
  private contactReview?: {contacts: PublicContact[]; choice: number};
  private contactSelection = new Set<string>();
  private firecrawlStatus = 'Checking local key…';
  private routerStatus = 'Not configured';
  private outreach: OutreachBook = {version: 1, entries: [], cursors: {}};
  constructor(private config: Config, private readonly store: Store, accountBrowser?: Pick<AccountBrowser, 'open' | 'check' | 'close'>) { this.accountBrowser = accountBrowser; }
  async start(): Promise<void> {
    this.history = await this.store.history();
    this.accounts = await this.store.accounts();
    this.outreach = await this.store.outreach();
    try { this.firecrawlStatus = await firecrawlKey(this.store.directory) ? 'Key saved · H collects public contacts' : 'Not configured · bismyth-leads firecrawl-login'; }
    catch { this.firecrawlStatus = 'Credential unavailable · bismyth-leads firecrawl-login'; }
    try { this.routerStatus = WhatsAppRouter.fromEnvironment() ? 'Configured · C checks sender' : 'Not configured · set router URL/key/session'; }
    catch { this.routerStatus = 'Router settings invalid'; }
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
    if (this.busy) { if (key.name === 'q' && this.accountOperation) void this.shutdown(); return; }
    if (this.captureReview !== undefined && !this.details) {
      if (key.name === 'escape') this.captureReview = undefined;
      else if (key.name === 'up' || key.name === 'down') this.captureReview = Math.max(1, Math.min(this.current?.projects.length || 1, this.captureReview + (key.name === 'up' ? -1 : 1)));
      else if (key.name === 'return') { const budget = this.captureReview; this.captureReview = undefined; void this.action(() => this.launchContacts(budget)); }
      else if (key.name === 'q') void this.shutdown();
      this.render(); return;
    }
    if (this.contactReview && !this.details) {
      if (key.name === 'escape') this.contactReview = undefined;
      else if (key.name === 'up' || key.name === 'down') this.contactReview.choice = (this.contactReview.choice + (key.name === 'up' ? 2 : 1)) % 3;
      else if (key.name === 'e') { this.notice = this.introductionDetails(this.contactReview.contacts); this.details = {offset: 0, message: this.notice}; }
      else if (key.name === 'return') {
        const review = this.contactReview; this.contactReview = undefined;
        if (review.choice < 2) void this.action(() => this.launchOutreach(review.choice === 0 ? 'preview' : 'send', review.contacts));
      } else if (key.name === 'q') void this.shutdown();
      this.render(); return;
    }
    if (this.picker) {
      const choices = this.pickerChoices();
      if (key.name === 'escape') this.picker = undefined;
      else if (key.name === 'up' || key.name === 'down') this.picker.selected = Math.max(0, Math.min(choices.length - 1, this.picker.selected + (key.name === 'up' ? -1 : 1)));
      else if (key.name === 'backspace') { this.picker.query = this.picker.query.slice(0, -1); this.picker.selected = 0; }
      else if (key.name === 'return' && choices[this.picker.selected]) {
        const choice = choices[this.picker.selected]; const kind = this.picker.kind;
        if (kind === 'state') { if (this.config.stateCode !== choice.value) this.config.city = ''; this.config.stateCode = choice.value; this.selected[0] = 2; }
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
          if (!this.ensureAccountsReviewed()) return;
          const run = createRun({...this.current!.config, mode: choice === 0 ? 'preview' : 'submit'});
          run.projects = this.current!.projects.map(copyProject);
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
        const layout = messageDetailLayout({width: process.stdout.columns || 100, height: process.stdout.rows || 30, handoff: this.runner?.handoffMessage || '', notice: this.notice, details: this.details, active: Boolean(this.runner?.active), run: this.current, screen: this.screen, accountSetup: this.accountSetupView()});
        const step = key.name === 'pageup' || key.name === 'pagedown' ? layout.pageSize : 1;
        this.details.offset = key.name === 'home' ? 0 : key.name === 'end' ? layout.maxOffset : Math.min(layout.maxOffset, Math.max(0, layout.offset + (key.name === 'up' || key.name === 'pageup' ? -step : step)));
        this.render(); return;
      }
      if (['return', 'c', 'k', 's', 'n', 'l', 'tab'].includes(key.name || '') || text && /^[1-5]$/.test(text)) this.details = undefined;
      else if (key.name !== 'p') return;
    }
    if (text && /^[1-5]$/.test(text)) { this.screen = Number(text) - 1; if (this.screen === 4) this.contactNotice(); this.render(); return; }
    if (key.name === 'tab') { this.screen = (this.screen + (key.shift ? 4 : 1)) % 5; if (this.screen === 4) this.contactNotice(); this.render(); return; }
    if (text === '?') { this.help = !this.help; this.render(); return; }
    if (this.screen === 0 && this.accountSetup && !this.runner?.active) {
      if (key.name === 'up' || key.name === 'down' || key.name === 'pageup' || key.name === 'pagedown') {
        const delta = key.name === 'up' || key.name === 'pageup' ? -1 : 1;
        this.accountSelected = Math.max(0, Math.min(portalAccounts.length - 1, this.accountSelected + delta)); this.render(); return;
      }
      if (key.name === 'return' || key.name === 'c') { this.runAccountAction(key.name === 'return' ? 'open' : 'check'); return; }
      if (key.name === 'k') { this.runAccountAction('skip'); return; }
      if (key.name === 'n' || key.name === 'escape') { this.runAccountAction('done'); return; }
      this.notice = 'Enter opens this website. C checks login; K skips; N continues to your profile.';
      this.render(); return;
    }
    if (key.name === 'up' || key.name === 'down') { this.move(key.name === 'up' ? -1 : 1); return; }
    if (key.name === 'pageup' || key.name === 'pagedown') { this.move(key.name === 'pageup' ? -8 : 8); return; }
    if (key.name === 'return' && this.runner?.active && this.runner.paused && !this.runner.stopped) { this.runner.pause(); this.render(); return; }
    if (key.name === 'return' && this.runner?.active && this.runner.handoffMessage && !this.runner.stopped) { this.runner.continue('continue'); return; }
    if (key.name === 'p' && this.runner?.active) { this.runner.pause(); this.render(); return; }
    if (key.name === 's' && this.runner?.active) { void this.runner.stop(); this.notice = 'Stopping task; saving progress…'; this.render(); return; }
    if (this.screen === 4 && !this.runner?.active) {
      if (key.name === 'space') { const contact = this.current && contactsForRun(this.current)[this.selected[4]]; if (contact) this.contactSelection.has(contact.id) ? this.contactSelection.delete(contact.id) : this.contactSelection.add(contact.id); this.render(); return; }
      if (key.name === 'a') { void this.action(() => this.approveContact()); return; }
      if (key.name === 'c' || key.name === 'u') { void this.action(() => this.launchOutreach(key.name === 'c' ? 'status' : 'refresh', this.current ? contactsForRun(this.current) : [])); return; }
      if (key.name === 'return' || key.name === 'w') {
        try {
          const contacts = this.current ? contactsForRun(this.current) : [];
          const chosen = key.name === 'return' ? contacts.filter((_, index) => index === this.selected[4]) : contacts.filter(contact => this.contactSelection.has(contact.id));
          if (!chosen.length) throw new Error('Select contacts with Space, or Enter reviews the current contact.');
          if (chosen.some(contact => contact.review !== 'approved' || contact.kind === 'email')) throw new Error('WhatsApp needs approved phone contacts. Read the source evidence with E, then A confirms a contact.');
          this.introductionDetails(chosen);
          this.contactReview = {contacts: chosen, choice: 0};
        } catch (error) { this.notice = (error as Error).message; }
        this.render(); return;
      }
    }
    if (key.name === 'c') { this.runner?.continue('continue'); return; }
    if (key.name === 'k') { this.runner?.continue('skip'); return; }
    if (this.runner?.active) { this.notice = 'Pause, continue, skip or stop the current run first.'; this.render(); return; }
    if (key.name === 'h') {
      if (!this.current?.projects.length) this.notice = 'Load or discover a property queue before collecting public contacts.';
      else this.captureReview = Math.min(10, this.current.projects.length);
      this.render(); return;
    }
    if (key.name === 'l') { this.screen = 0; this.accountSetup = true; this.advanced = false; this.help = false; this.notice = 'Website logins are part of Set up. Enter opens Chrome; C checks; N returns to your profile.'; this.render(); return; }
    if (key.name === 'a' && this.screen === 0) { this.advanced = !this.advanced; this.selected[0] = this.advanced ? 9 : 0; this.render(); return; }
    if (key.name === 'return' && this.screen === 0) { this.beginEdit(); this.render(); return; }
    const runShortcut = key.name === 'r';
    if ((key.name === 'return' && [1, 2].includes(this.screen) || runShortcut && this.screen !== 0) && this.current?.projects.length) { if (this.ensureAccountsReviewed()) this.review = 0; this.render(); return; }
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
        run.projects = this.current.projects.map(copyProject).slice(0, run.config.limit);
        this.current = run; await this.store.save(run); this.screen = 1;
        this.notice = 'Queue copied into a new run using the current Setup profile and mode.';
      }
      if (key.name === 'x' || key.name === 'j') {
        const run = this.screen === 3 ? this.history[this.selected[3]] : this.current;
        if (!run) throw new Error('Select a run to export.');
        this.notice = 'Exported: ' + await this.store.export(run, key.name === 'x' ? 'csv' : 'json');
      }
      if (key.name === 'o') {
        const run = this.screen === 3 ? this.history[this.selected[3]] : this.current;
        if (!run) throw new Error('Load or select a run to export its contacts.');
        this.notice = 'Contacts exported: ' + await this.store.exportContacts(run, key.shift ? 'json' : 'csv');
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
  private accountSetupView(): {accounts: PortalAccount[]; selected: number; busy: boolean; operation?: string} | undefined {
    return this.accountSetup && this.screen === 0 ? {accounts: this.accounts.accounts, selected: this.accountSelected, busy: Boolean(this.accountOperation), operation: this.accountOperation} : undefined;
  }
  private runAccountAction(action: 'open' | 'check' | 'skip' | 'done'): void {
    const portal = portalAccounts[this.accountSelected];
    this.help = false;
    this.busy = true;
    this.accountOperation = action === 'open' ? 'Opening Chrome' : action === 'check' ? 'Checking login' : 'Saving website sessions';
    this.animationFrame = 0; this.startedAt = Date.now(); this.elapsedMs = 0;
    this.render();
    this.accountTask = (async () => {
      try {
        if (action === 'done') {
          await this.accountBrowser?.close();
          await this.store.saveAccounts(this.accounts);
          this.accountsReviewed = true; this.accountSetup = false; this.selected[0] = 1;
          this.notice = 'Website sessions saved. Continue with your location and contact details; L reopens website logins.';
          return;
        }
        let account: PortalAccount;
        if (action === 'skip') account = {portal: portal.id, status: 'skipped', checkedAt: null, detail: 'Skipped in setup; existing browser login data has been kept.'};
        else {
          this.accountBrowser ||= new AccountBrowser(this.store.directory);
          account = action === 'open' ? await this.accountBrowser.open(portal.id, this.config) : await this.accountBrowser.check(portal.id);
        }
        const next: AccountSnapshot = {version: 1, accounts: this.accounts.accounts.map(existing => existing.portal === account.portal ? account : existing)};
        await this.store.saveAccounts(next); this.accounts = next;
        const nextStep = account.status === 'signed-in' ? ' Login successful. Session saved in Chrome.' : account.status === 'unknown' ? ' Enter opens the website; open its account menu in Chrome, then C checks.' : account.status === 'blocked' ? ' Complete the security check in Chrome; C rechecks, or K skips.' : ' Complete login in Chrome, then C checks the same page.';
        this.notice = portal.label + ': ' + account.detail + nextStep;
        if (action === 'skip' || action === 'check' && account.status === 'signed-in') {
          this.accountSelected = Math.min(portalAccounts.length - 1, this.accountSelected + 1);
          if (action === 'skip') this.notice = portal.label + ' skipped. Its saved browser data was kept. Enter opens the next website; N continues to your profile.';
          else this.notice = portal.label + ' login successful. ' + (this.accountSelected === portalAccounts.length - 1 && portal.id === portalAccounts.at(-1)!.id ? 'N continues to your profile.' : 'Enter opens ' + portalAccounts[this.accountSelected].label + '; N continues to your profile.');
        }
      } catch { this.notice = 'Could not open or check this website session. Reopen it with Enter, or K skips it. Chrome path is in Advanced settings.'; }
      finally { this.accountOperation = undefined; this.busy = false; this.render(); }
    })();
  }
  private move(delta: number): void {
    const length = this.screen === 0 ? (this.advanced ? fields.length : 9) : this.screen === 3 ? this.history.length : this.screen === 4 ? (this.current ? contactsForRun(this.current).length : 0) : this.screen === 1 ? this.current?.projects.length || 0 : this.current?.events.length || 0;
    this.selected[this.screen] = Math.max(this.screen === 0 && this.advanced ? 9 : 0, Math.min(length - 1, this.selected[this.screen] + delta));
    if (this.screen === 4) this.contactNotice();
    this.render();
  }
  private fieldValue(field: Field): string {
    if (field.key === 'accounts') return `${this.accounts.accounts.filter(account => account.status === 'signed-in').length} last verified · Enter to connect`;
    if (field.key === 'importFile') return this.importFile;
    const value = this.config[field.key];
    if (field.key === 'extraFields') return JSON.stringify(value);
    if (Array.isArray(value)) return value.join(',');
    return value === undefined ? '' : String(value);
  }
  private beginEdit(): void {
    const field = fields[this.selected[0]];
    if (field.key === 'accounts') { this.accountSetup = true; this.help = false; this.notice = 'Enter opens the selected website. Passwords and OTPs go directly into Chrome.'; return; }
    if (field.key === 'stateCode' || field.key === 'city') {
      if (field.key === 'city' && !this.config.stateCode) { this.notice = 'Choose a state/UT first.'; this.selected[0] = 1; return; }
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
    if (field.key === 'accounts') return;
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
    if (!this.ensureAccountsReviewed()) return;
    await this.accountBrowser?.close();
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
  private contactNotice(): void {
    const contact = this.current && contactsForRun(this.current)[this.selected[4]];
    if (!contact) {
      const captures = this.current?.projects.flatMap(item => item.contactCapture ? [item.contactCapture] : []) || [];
      this.notice = captures.length ? `${captures.length} pages checked. ${captures.at(-1)!.detail} H checks remaining/retryable pages; 3 shows activity.`
        : 'H gathers public contacts from the loaded property queue. O exports contacts; C checks the configured WhatsApp sender.';
      return;
    }
    const sources = contact.attributions || [contact];
    const history = this.outreach.entries.filter(entry => entry.to === contact.value && entry.senderSessionId === process.env.BISMYTH_WHATSAPP_SESSION_ID);
    this.notice = `${contact.value} · ${contact.name || contact.organization || 'Identity not supplied'} · ${contact.role || 'unknown role'} · ${contact.review}. `
      + sources.map(source => `Source ${source.sourceUrl} · observed ${source.observedAt}. Evidence: ${source.evidence}`).join(' ')
      + history.map(entry => ` WhatsApp: ${entry.status}. ${entry.replies.map(reply => 'Reply: ' + reply.text).join(' ')} ${(entry.referrals || []).map(referral => 'Referral supplied in reply: ' + referral.phone).join(' ')}`).join(' ');
  }
  private introductionDetails(contacts: PublicContact[]): string {
    if (!this.current) return 'Load a property queue first.';
    const message = renderManagerIntroduction({senderName: this.current.config.name, senderBusiness: this.current.config.senderBusiness || 'Bismyth'});
    return `Selected sender session: ${process.env.BISMYTH_WHATSAPP_SESSION_ID || 'Not configured'}. Recipients: ${contacts.map(contact => contact.value).join(', ')}. `
      + `Exact message: ${message} ` + contacts.map(contact => `Contact ${contact.value}: ${contact.sourceUrl}. Evidence: ${contact.evidence}`).join(' ');
  }
  private async approveContact(): Promise<void> {
    if (!this.current) throw new Error('Load a run first.');
    const selected = contactsForRun(this.current)[this.selected[4]];
    if (!selected) throw new Error('Select a collected contact first.');
    for (const item of this.current.projects) for (const contact of item.contactCapture?.contacts || []) {
      if (contact.id === selected.id || contact.value === selected.value) {
        contact.review = selected.review === 'approved' ? 'needs-review' : 'approved';
        if (contact.review === 'approved') contact.reviewedBy = 'operator'; else delete contact.reviewedBy;
      }
    }
    await this.store.save(this.current); this.contactNotice();
  }
  private async launchContacts(maximumRequests: number): Promise<void> {
    if (this.closing) return;
    if (!this.current?.projects.length) throw new Error('Discover, import or load a property queue first.');
    const apiKey = await firecrawlKey(this.store.directory);
    if (this.closing) return;
    if (!apiKey) throw new Error('Configure Firecrawl first: bismyth-leads firecrawl-login.');
    const client = new FirecrawlClient({apiKey, baseUrl: process.env.BISMYTH_FIRECRAWL_URL, chooseContacts: choosePublicContacts});
    client.assertConfigured();
    this.firecrawlStatus = 'Key configured · public contact collection';
    await this.accountBrowser?.close();
    if (this.closing) return;
    this.animationFrame = 0; this.startedAt = Date.now(); this.elapsedMs = 0;
    this.runner = new Runner(this.current, this.store, new PortalBrowser(this.store.directory));
    this.runner.on('change', this.render); this.screen = 2;
    this.notice = 'Reading public pages with Firecrawl. P pauses, S stops; enquiries are unchanged.';
    this.task = this.runner.collectContacts(client, maximumRequests).then(async () => {
      this.history = await this.store.history(); this.screen = 4; this.selected[4] = 0;
      if (this.current?.state === 'stopped') this.notice = this.current.events.at(-1)?.message || 'Contact collection stopped; progress saved.';
      else if (!contactsForRun(this.current!).length) this.contactNotice();
      else this.notice = 'Contact pass saved. Enter reviews one introduction, Space selects a batch, W reviews selected contacts. O exports.';
      this.render();
    }).catch(error => { this.notice = (error as Error).message; this.render(); });
  }
  private async launchOutreach(action: 'preview' | 'send' | 'status' | 'refresh', contacts: PublicContact[]): Promise<void> {
    if (this.closing) return;
    if (!this.current) throw new Error('Load a property queue first.');
    const router = WhatsAppRouter.fromEnvironment();
    if (!router) throw new Error('Set BISMYTH_WHATSAPP_ROUTER_URL, BISMYTH_WHATSAPP_ROUTER_API_KEY and BISMYTH_WHATSAPP_SESSION_ID after the Baileys router is deployed.');
    const service = new OutreachService(this.store, router, process.env.BISMYTH_WHATSAPP_SESSION_ID || '');
    await this.accountBrowser?.close();
    if (this.closing) return;
    this.animationFrame = 0; this.startedAt = Date.now(); this.elapsedMs = 0;
    this.runner = new Runner(this.current, this.store, new PortalBrowser(this.store.directory));
    this.runner.on('change', this.render);
    this.notice = action === 'send' ? 'Sending the selected reviewed introductions. S stops remaining contacts.' : 'Checking WhatsApp router; no live send is requested.';
    let result = '';
    this.task = this.runner.workflow(action === 'send' ? 'Sending explicitly confirmed WhatsApp introductions.' : 'Checking WhatsApp contact and delivery information.', async (signal, checkpoint, progress) => {
      if (action === 'status') {
        const status = await router.status(signal);
        this.routerStatus = status.session.status + (status.health.ready ? ' · router ready' : ' · router not ready');
        result = 'WhatsApp sender: ' + this.routerStatus + '. Pairing and session setup are owned by the router.';
      } else if (action === 'preview') {
        const preview = await service.preview(this.current!, contacts, signal);
        result = `Dry-run preview: ${preview.filter(item => item.status === 'ready').length} ready, ${preview.filter(item => item.status !== 'ready').length} unavailable/already contacted. No message was sent.`;
      } else if (action === 'send') {
        const sent = await service.send(this.current!, contacts, signal, async message => { await checkpoint(); await progress(message); await checkpoint(); });
        result = `${sent.length} new WhatsApp operations recorded. Acceptance, delivery and replies are tracked separately. U refreshes receipts.`;
      } else {
        await service.reconcile(signal); await checkpoint();
        await service.refresh(contacts.filter(contact => contact.kind !== 'email').map(contact => contact.value), signal);
        result = 'Saved WhatsApp operations and selected-contact replies refreshed. No follow-up message was sent.';
      }
      await checkpoint();
    }).then(async () => {
      this.outreach = await this.store.outreach(); this.history = await this.store.history();
      if (this.current?.state === 'stopped') this.notice = this.current.events.at(-1)?.message || 'WhatsApp task stopped; saved operations will not be resent automatically.';
      else if (result) this.notice = result;
      this.render();
    }).catch(error => { this.notice = (error as Error).message; this.render(); });
  }
  private ensureAccountsReviewed(): boolean {
    if (this.accountsReviewed) return true;
    this.screen = 0; this.accountSetup = true; this.advanced = false; this.help = false;
    this.notice = 'Connect your website accounts first, or press N to continue with available/guest sessions.';
    return false;
  }
  private render = (): void => {
    if (this.closing) return;
    if (this.details && this.details.message !== (this.runner?.handoffMessage || this.notice)) this.details = undefined;
    const animating = Boolean(this.accountOperation) || this.runner?.active && !this.runner.paused && !this.runner.stopped && !this.runner.handoffMessage && ['discovering', 'running', 'enriching', 'messaging'].includes(this.current?.state || '');
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
      accountSetup: this.accountSetupView(),
      contacts: this.current ? contactsForRun(this.current) : [], contactSelection: [...this.contactSelection],
      firecrawlStatus: this.firecrawlStatus, routerStatus: this.routerStatus, outreach: this.outreach, senderSessionId: process.env.BISMYTH_WHATSAPP_SESSION_ID,
      dialog: this.captureReview !== undefined ? {title: 'Collect public contact details', body: [`At most ${this.captureReview} public listing pages.`, 'Firecrawl scrape credits and Codex usage apply.', 'Previously collected pages are skipped.', '↑↓ changes the page budget. Portal enquiries are unchanged.'], choice: 0, options: ['Start collection'], hint: 'Enter Start · Esc Cancel'} : this.contactReview ? {
        title: 'Review WhatsApp introduction', body: [`${this.contactReview.contacts.length} recipients: ${this.contactReview.contacts.map(contact => contact.value).slice(0, 3).join(', ')}${this.contactReview.contacts.length > 3 ? ' …' : ''}`, 'Sender: ' + (process.env.BISMYTH_WHATSAPP_SESSION_ID || 'Not configured'),
          renderManagerIntroduction({senderName: this.current?.config.name || '', senderBusiness: this.current?.config.senderBusiness || 'Bismyth'})],
        choice: this.contactReview.choice, options: ['Preview only — no message sent', 'Send reviewed introductions', 'Back to contacts'], hint: '↑↓ Choose · Enter Confirm · E Full text/source · Esc Cancel',
      } : undefined,
      active: Boolean(this.runner?.active), auth: this.auth, review: this.review,
      animationFrame: this.animationFrame, elapsedMs: this.elapsedMs, stopping: Boolean(this.runner?.active && this.runner.stopped),
      editing: this.editing ? {label: this.editing.field.label, buffer: this.editing.buffer, hint: this.editing.field.hint} : undefined,
      picker: this.picker ? {title: this.picker.kind === 'state' ? 'Choose a state / UT · India' : 'Choose a city · ' + (indiaStates.find(state => state.code === this.config.stateCode)?.name || ''), query: this.picker.query, selected: this.picker.selected, choices: this.pickerChoices().map(choice => choice.label)} : undefined,
      fields: fields.map((field, index) => ({index, label: field.label, hint: field.hint, value: field.key === 'stateCode' ? indiaStates.find(state => state.code === this.config.stateCode)?.name || '' : this.fieldValue(field)})).filter(field => this.advanced ? field.index >= 9 : field.index < 9),
    }));
  };
  private async shutdown(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    if (this.animationTimer) { clearInterval(this.animationTimer); this.animationTimer = undefined; }
    try { if (this.runner?.active) await this.runner.stop(); await this.task; await this.accountTask; await this.accountBrowser?.close(); }
    finally {
      process.stdin.off('keypress', this.keypress); process.stdout.off('resize', this.render);
      process.off('SIGINT', this.signal); process.off('SIGTERM', this.signal);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause(); process.stdout.write('\x1b[?25h\x1b[?1049l'); this.finish?.();
    }
  }
}
