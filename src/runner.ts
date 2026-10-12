import {EventEmitter} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import type {Driver, Handoff} from './browser.js';
import {duplicateKey} from './model.js';
import type {Project, ProjectStatus, Run} from './model.js';
import {Store} from './store.js';

export class RunStopped extends Error { constructor() { super('Run stopped.'); } }
export class Runner extends EventEmitter {
  paused = false;
  stopped = false;
  private controller = new AbortController();
  private handoffResolve?: (answer: 'continue' | 'skip') => void;
  handoffMessage = '';
  active = false;
  private resumeState: Run['state'] = 'running';
  constructor(readonly run: Run, private readonly store: Store, private readonly driver: Driver) { super(); }
  private async record(message: string): Promise<void> {
    this.run.events.push({at: new Date().toISOString(), message});
    this.run.events = this.run.events.slice(-200);
    await this.store.save(this.run);
    this.emit('change');
  }
  async checkpoint(): Promise<void> {
    if (this.stopped) throw new RunStopped();
    while (this.paused) {
      await sleep(100, undefined, {signal: this.controller.signal}).catch(() => { throw new RunStopped(); });
      if (this.stopped) throw new RunStopped();
    }
  }
  pause(): void {
    if (!this.paused) this.resumeState = this.run.state;
    this.paused = !this.paused; this.run.state = this.paused ? 'paused' : this.resumeState; this.emit('change');
  }
  continue(answer: 'continue' | 'skip'): void { this.handoffResolve?.(answer); }
  async stop(): Promise<void> {
    this.stopped = true; this.controller.abort(); this.handoffResolve?.('skip');
    await this.driver.close().catch(() => undefined);
  }
  private handoff: Handoff = async message => {
    await this.checkpoint();
    this.handoffMessage = message;
    const waiting = new Promise<'continue' | 'skip'>(resolve => { this.handoffResolve = resolve; });
    this.emit('change'); this.emit('handoff', message);
    const result = await waiting;
    this.handoffResolve = undefined; this.handoffMessage = '';
    await this.checkpoint();
    this.emit('change'); return result;
  };
  async discover(): Promise<void> {
    await this.execute(async () => {
      this.run.state = 'discovering'; await this.record('Discovering ' + this.run.config.city + ' / ' + this.run.config.intent);
      const seen = new Set(this.run.projects.map(item => item.id));
      const selected = this.run.config.sites;
      const expandable: typeof selected = [];
      for (let index = 0; index < selected.length; index++) {
        await this.checkpoint();
        const site = selected[index];
        const remaining = this.run.config.limit - this.run.projects.length;
        if (remaining <= 0) break;
        const share = Math.ceil(remaining / (selected.length - index));
        try {
          const found = await this.driver.discover(this.run.config, site, share, () => this.checkpoint(), this.handoff);
          if (found.length >= share) expandable.push(site);
          for (const item of found) if (!seen.has(item.id) && this.run.projects.length < this.run.config.limit) { this.run.projects.push(item); seen.add(item.id); }
          await this.record(site + ': found ' + found.length + ' projects.');
        } catch (error) { if (this.stopped) throw new RunStopped(); await this.record(site + ': ' + (error as Error).message); }
      }
      // A portal with spare listings can fill capacity left by another portal.
      for (const site of expandable) {
        await this.checkpoint();
        const remaining = this.run.config.limit - this.run.projects.length;
        if (remaining <= 0) break;
        try {
          const existing = this.run.projects.filter(item => item.site === site).length;
          const found = await this.driver.discover(this.run.config, site, remaining + existing, () => this.checkpoint(), this.handoff);
          for (const item of found) if (!seen.has(item.id) && this.run.projects.length < this.run.config.limit) { this.run.projects.push(item); seen.add(item.id); }
          await this.record(site + ': filled remaining queue capacity.');
        } catch (error) { if (this.stopped) throw new RunStopped(); await this.record(site + ': ' + (error as Error).message); }
      }
      this.run.state = 'ready';
      await this.record('Queue ready: ' + this.run.projects.length + '/' + this.run.config.limit + ' projects.');
    });
  }
  private async mark(item: Project, status: ProjectStatus, detail: string): Promise<void> {
    item.status = status; item.detail = detail; item.updatedAt = new Date().toISOString();
    await this.record(item.site + ' / ' + status + ': ' + item.title);
  }
  async process(): Promise<void> {
    await this.execute(async () => {
      this.run.state = 'running'; await this.record('Starting ' + this.run.config.mode + ' run.');
      const previous = await this.store.priorContacts(this.run.id);
      for (const item of this.run.projects) {
        await this.checkpoint();
        if (item.status !== 'queued') continue;
        if (this.run.config.mode === 'submit' && previous.has(duplicateKey(this.run.config, item))) {
          await this.mark(item, 'skipped', 'This contact already has a submitted or uncertain enquiry here.'); continue;
        }
        await this.mark(item, 'working', 'Opening contact form.');
        let submitted = false;
        try {
          let preparation = await this.driver.prepare(item, this.run.config);
          await this.checkpoint();
          const baseline = preparation.baseline;
          while (!preparation.ready) {
            const answer = await this.handoff(preparation.reason + ' Complete the form in Chrome; c rechecks, k skips.');
            if (answer === 'skip') { await this.mark(item, 'skipped', preparation.reason); break; }
            if (this.run.config.mode === 'submit' && await this.driver.confirmed(item, baseline)) { await this.mark(item, 'submitted', 'New portal confirmation observed after browser handoff.'); break; }
            preparation = await this.driver.prepare(item, this.run.config, false);
          }
          if ((item.status as ProjectStatus) !== 'working') continue;
          await this.checkpoint();
          if (this.run.config.mode === 'preview') {
            await this.mark(item, 'prepared', 'Contact form prepared; submit was not clicked.');
          } else {
            // Checkpoint working before any click; interruption recovers as uncertain.
            submitted = true;
            const clicked = await this.driver.submit(item);
            if (!clicked) {
              await this.handoff('Submit control not found. Submit in Chrome, then c checks confirmation; k leaves this uncertain.');
            }
            let confirmed = await this.driver.confirmed(item, baseline);
            const deadline = Date.now() + 2500;
            while (!confirmed && Date.now() < deadline) {
              await sleep(100, undefined, {signal: this.controller.signal});
              confirmed = await this.driver.confirmed(item, baseline);
            }
            if (!confirmed && clicked) {
              await this.handoff('Complete any OTP or remaining steps in Chrome. c checks confirmation; k leaves this uncertain.');
              confirmed = await this.driver.confirmed(item, baseline);
            }
            await this.mark(item, confirmed ? 'submitted' : 'uncertain', confirmed ? 'New portal confirmation observed.' : 'No new confirmation observed; inspect before retrying.');
            if (confirmed) previous.add(duplicateKey(this.run.config, item));
          }
        } catch (error) {
          await this.mark(item, submitted || this.stopped ? 'uncertain' : 'failed', (error as Error).message);
          if (this.stopped) throw new RunStopped();
        }
        if (this.run.config.delayMs) await sleep(this.run.config.delayMs, undefined, {signal: this.controller.signal});
      }
      this.run.state = 'complete'; await this.record('Run finished.');
    });
  }
  private async execute(task: () => Promise<void>): Promise<void> {
    if (this.active) throw new Error('A run is already active.');
    this.active = true; this.stopped = false; this.paused = false; this.controller = new AbortController();
    try { await task(); }
    catch (error) { this.run.state = 'stopped'; await this.record(this.stopped ? 'Stopped; progress saved.' : 'Run error: ' + (error as Error).message); }
    finally { this.active = false; this.handoffMessage = ''; await this.driver.close().catch(() => undefined); await this.store.save(this.run); this.emit('change'); }
  }
}
