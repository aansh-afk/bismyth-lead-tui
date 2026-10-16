import {EventEmitter} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import type {Driver, Handoff, SubmissionConfirmation} from './browser.js';
import {duplicateKey} from './model.js';
import type {Project, ProjectStatus, Run} from './model.js';
import {Store} from './store.js';
import type {FirecrawlClient} from './firecrawl.js';
import {deduplicateContacts} from './contacts.js';

export class RunStopped extends Error { constructor() { super('Run stopped.'); } }
export class Runner extends EventEmitter {
  paused = false;
  stopped = false;
  private controller = new AbortController();
  private handoffResolve?: (answer: 'continue' | 'skip') => void;
  handoffMessage = '';
  active = false;
  private resumeState: Run['state'] = 'running';
  constructor(readonly run: Run, private readonly store: Store, private readonly driver: Driver) {
    super();
    driver.setActivity?.(message => this.record(message));
    driver.setCheckpoint?.(() => this.checkpoint());
  }
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
  private async observeVerification(resolve: (answer: 'continue' | 'skip') => void, signal: AbortSignal): Promise<void> {
    const current = (): boolean => !signal.aborted && !this.stopped && this.handoffResolve === resolve;
    try {
      while (current()) {
        await sleep(1000, undefined, {signal});
        if (!current()) return;
        await this.checkpoint();
        if (!current()) return;
        let ready = false;
        // A verification iframe can disappear during this read-only observation.
        // Recheck the live page on the next tick rather than failing the handoff.
        try { ready = await this.driver.verificationReady!(); } catch { continue; }
        if (!ready || !current()) continue;
        await this.checkpoint();
        if (!current()) return;
        await this.record('CAPTCHA: verification cleared in Chrome; continuing on the current page.');
        if (current()) resolve('continue');
        return;
      }
    } catch (error) {
      if (!signal.aborted && !this.stopped) throw error;
    }
  }
  private handoff: Handoff = async (message, verification = false) => {
    await this.checkpoint();
    this.handoffMessage = message;
    let resolveHandoff!: (answer: 'continue' | 'skip') => void;
    const waiting = new Promise<'continue' | 'skip'>(resolve => { this.handoffResolve = resolveHandoff = resolve; });
    const observation = new AbortController();
    if (verification && this.driver.verificationReady) {
      const signal = AbortSignal.any([this.controller.signal, observation.signal]);
      void this.observeVerification(resolveHandoff, signal).catch(() => undefined);
    }
    this.emit('change'); this.emit('handoff', message);
    let result: 'continue' | 'skip';
    try { result = await waiting; }
    finally {
      observation.abort();
      if (this.handoffResolve === resolveHandoff) { this.handoffResolve = undefined; this.handoffMessage = ''; }
    }
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
          for (const note of this.driver.takeDiscoveryNotes?.() || []) await this.record(note);
          await this.checkpoint();
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
          for (const note of this.driver.takeDiscoveryNotes?.() || []) await this.record(note);
          await this.checkpoint();
          for (const item of found) if (!seen.has(item.id) && this.run.projects.length < this.run.config.limit) { this.run.projects.push(item); seen.add(item.id); }
          await this.record(site + ': filled remaining queue capacity.');
        } catch (error) { if (this.stopped) throw new RunStopped(); await this.record(site + ': ' + (error as Error).message); }
      }
      await this.checkpoint();
      this.run.state = 'ready';
      await this.record('Queue ready: ' + this.run.projects.length + '/' + this.run.config.limit + ' projects.');
    });
  }
  async collectContacts(client: Pick<FirecrawlClient, 'assertConfigured' | 'capture'>, maximumRequests = 10): Promise<void> {
    // Preflight before changing a run, so a missing credential never starts a job.
    client.assertConfigured();
    if (!Number.isInteger(maximumRequests) || maximumRequests < 1 || maximumRequests > 300) throw new Error('Choose 1–300 contact pages.');
    const previousState = this.run.state;
    await this.execute(async () => {
      this.run.state = 'enriching';
      await this.record(`Collecting public contacts with Firecrawl · at most ${maximumRequests} pages. Portal enquiries are unchanged.`);
      let requested = 0;
      for (const item of this.run.projects) {
        await this.checkpoint();
        if (requested >= maximumRequests) break;
        if (item.contactCapture?.status === 'captured' || item.contactCapture?.status === 'not-found' && item.contactCapture.collectionMethod !== 'playwright') continue;
        const retained = item.contactCapture?.contacts || [];
        item.contactCapture = {status: 'working', attemptedAt: new Date().toISOString(), detail: 'Reading the public listing with Firecrawl.', contacts: retained};
        await this.record(`${item.site}: collecting public contact details (${++requested}/${maximumRequests}).`);
        try {
          const capture = await client.capture({url: item.url, title: item.title}, this.controller.signal);
          await this.checkpoint();
          item.contactCapture = {...capture, collectionMethod: 'firecrawl', contacts: deduplicateContacts([...retained, ...capture.contacts])};
          if (item.contactCapture.contacts.length) item.contactCapture.status = 'captured';
          await this.record(`${item.site}: ${capture.detail}`);
          if (capture.stopBatch) { await this.record('Contact pass stopped at the provider limit. Remaining pages were not requested.'); break; }
        } catch (error) {
          item.contactCapture = {status: 'failed', attemptedAt: new Date().toISOString(), detail: this.stopped ? 'Contact collection stopped; prior evidence retained.' : 'Contact collection failed; prior evidence retained.', contacts: retained};
          await this.store.save(this.run);
          if (this.stopped || this.controller.signal.aborted) throw new RunStopped();
          await this.record(`${item.site}: contact collection failed; portal enquiry status was retained.`);
          if ((error as Error).name === 'FirecrawlConfigurationError') break;
        }
      }
      this.run.state = previousState === 'complete' ? 'complete' : 'ready';
      await this.record(`Contact pass finished after ${requested} public page requests. 5 opens contacts; portal enquiries remain available.`);
    });
  }
  async workflow(label: string, task: (signal: AbortSignal, checkpoint: () => Promise<void>, progress: (message: string) => Promise<void>) => Promise<void>): Promise<void> {
    const previousState = this.run.state;
    await this.execute(async () => {
      this.run.state = 'messaging'; await this.record(label);
      await task(this.controller.signal, () => this.checkpoint(), message => this.record(message));
      await this.checkpoint(); this.run.state = previousState === 'complete' ? 'complete' : 'ready';
      await this.record('WhatsApp task finished. Enquiry counts were not changed.');
    });
  }
  private async mark(item: Project, status: ProjectStatus, detail: string): Promise<void> {
    item.status = status; item.detail = detail; item.updatedAt = new Date().toISOString();
    await this.record(item.site + ' / ' + status + ': ' + item.title);
  }
  private async confirmation(item: Project, baseline: string[]): Promise<SubmissionConfirmation | undefined> {
    if (this.driver.confirmation) return this.driver.confirmation(item, baseline);
    return await this.driver.confirmed(item, baseline) ? {detail: 'New portal confirmation observed.'} : undefined;
  }
  private async markSubmitted(item: Project, confirmation: SubmissionConfirmation): Promise<void> {
    if (item.site === 'nobroker' && confirmation.visitStatus) item.contactAction = {
      kind: 'visit-booking', visitStatus: confirmation.visitStatus,
      summary: item.contactAction?.kind === 'visit-booking' ? item.contactAction.summary : 'Viewing request using your signed-in NoBroker account.',
    };
    await this.mark(item, 'submitted', confirmation.detail);
    if (item.contactAction?.visitStatus === 'pending') await this.record('NoBroker: visit request received; awaiting confirmation. Continuing without another booking attempt.');
  }
  private async captureRevealedContacts(item: Project): Promise<void> {
    if (!this.driver.captureContacts) return;
    await this.checkpoint();
    const retained = item.contactCapture?.contacts || [];
    try {
      const capture = await this.driver.captureContacts(item, this.run.config);
      item.contactCapture = {...capture, collectionMethod: 'playwright', contacts: deduplicateContacts([...retained, ...capture.contacts])};
      if (item.contactCapture.contacts.length) item.contactCapture.status = 'captured';
      await this.record(item.site + ': ' + capture.detail);
    } catch {
      item.contactCapture = {status: retained.length ? 'captured' : 'failed', attemptedAt: new Date().toISOString(), detail: 'Portal contact collection did not finish. The acknowledged submission was retained.', contacts: retained};
      await this.store.save(this.run);
      if (this.stopped || this.controller.signal.aborted) throw new RunStopped();
      await this.record(item.site + ': contact collection failed; confirmed submission retained.');
    }
    await this.checkpoint();
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
          if (preparation.alreadyShared) {
            await this.mark(item, 'skipped', 'The same Atlas introduction is already visible in this conversation; no duplicate was sent.');
            continue;
          }
          let baseline = preparation.baseline;
          item.contactAction = {kind: preparation.actionKind || 'interest', summary: preparation.summary || 'Share the configured callback details through the property portal.'};
          while (!preparation.ready && !preparation.alreadyShared) {
            const answer = await this.handoff(preparation.reason + ' Complete the form in Chrome; c rechecks, k skips.', preparation.verification);
            if (answer === 'skip') { await this.mark(item, 'skipped', preparation.reason); break; }
            if (this.run.config.mode === 'submit' && preparation.allowHandoffConfirmation !== false) {
              const confirmation = await this.confirmation(item, baseline);
              if (confirmation) { await this.markSubmitted(item, confirmation); break; }
            }
            preparation = await this.driver.prepare(item, this.run.config, false);
            baseline = preparation.baseline;
          }
          if (preparation.alreadyShared && (item.status as ProjectStatus) === 'working') {
            await this.mark(item, 'skipped', 'The same Atlas introduction is already visible in this conversation; no duplicate was sent.');
          }
          if ((item.status as ProjectStatus) !== 'working') {
            if ((item.status as ProjectStatus) === 'submitted') {
              previous.add(duplicateKey(this.run.config, item));
              await this.captureRevealedContacts(item);
            }
            continue;
          }
          item.contactAction = {kind: preparation.actionKind || 'interest', summary: preparation.summary || 'Share the configured callback details through the property portal.'};
          await this.checkpoint();
          if (this.run.config.mode === 'preview') {
            await this.mark(item, 'prepared', preparation.actionKind === 'visit-booking' ? 'Viewing slot selected for review; Confirm Booking was not clicked.' : preparation.actionKind === 'portal-message' ? 'Atlas introduction and callback details drafted; Send was not clicked.' : 'Contact form prepared; submit was not clicked.');
          } else {
            // Checkpoint working before any click; interruption recovers as uncertain.
            submitted = true;
            const clicked = await this.driver.submit(item);
            if (clicked && this.driver.verifyCaptcha) {
              let verification = await this.driver.verifyCaptcha();
              while (verification.pending) {
                const answer = await this.handoff(verification.reason + ' Complete verification in Chrome; c checks confirmation, k leaves this uncertain.', true);
                if (answer === 'skip') break;
                verification = await this.driver.verifyCaptcha();
              }
            }
            if (!clicked) {
              await this.handoff('Submit control not found. Submit in Chrome, then c checks confirmation; k leaves this uncertain.');
            }
            let confirmed = await this.confirmation(item, baseline);
            const deadline = Date.now() + 2500;
            while (!confirmed && Date.now() < deadline) {
              await sleep(100, undefined, {signal: this.controller.signal});
              confirmed = await this.confirmation(item, baseline);
            }
            if (!confirmed && clicked) {
              const verification = await this.driver.verifyCaptcha?.();
              confirmed = await this.confirmation(item, baseline);
              if (!confirmed) await this.handoff((verification?.pending ? verification.reason + ' ' : '') + 'Complete any OTP or remaining steps in Chrome. c checks confirmation; k leaves this uncertain.');
              confirmed = await this.confirmation(item, baseline);
            }
            if (confirmed) await this.markSubmitted(item, confirmed);
            else await this.mark(item, 'uncertain', 'No new confirmation observed; inspect before retrying.');
            if (confirmed) {
              previous.add(duplicateKey(this.run.config, item));
              await this.captureRevealedContacts(item);
            }
          }
        } catch (error) {
          if ((item.status as ProjectStatus) !== 'submitted') await this.mark(item, submitted || this.stopped ? 'uncertain' : 'failed', (error as Error).message);
          if (this.stopped) throw new RunStopped();
        }
        if (this.run.config.delayMs) await sleep(this.run.config.delayMs, undefined, {signal: this.controller.signal});
      }
      this.run.state = 'complete';
      const confirmed = this.run.projects.filter(item => item.status === 'submitted');
      const bookings = confirmed.filter(item => item.contactAction?.kind === 'visit-booking').length;
      const pending = confirmed.filter(item => item.contactAction?.kind === 'visit-booking' && item.contactAction.visitStatus === 'pending').length;
      const messages = confirmed.filter(item => item.contactAction?.kind === 'portal-message').length;
      const numbers = deduplicateContacts(this.run.projects.flatMap(item => item.contactCapture?.contacts || [])).length;
      await this.record(`Run finished. ${confirmed.length - bookings - messages} confirmed interests; ${messages} portal messages; ${bookings - pending} viewing bookings${pending ? `; ${pending} visit requests awaiting confirmation` : ''}; ${numbers} contacts collected. WhatsApp follow-up is separate; 5 opens Contacts.`);
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
