import {chromium} from 'playwright-core';
import type {BrowserContext, Page, Locator} from 'playwright-core';
import {access, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {adapters, loadAdapters} from './adapters.js';
import type {Adapter} from './adapters.js';
import {canonicalUrl, project, siteForUrl} from './model.js';
import type {Config, Project, Site} from './model.js';
import {chooseWithSubscription, subscriptionStatus} from './subscription.js';
import {attemptCaptcha, blockedCaptcha, captchaBlocked, captchaCanContinue, captchaPending, solveGridWithSubscription, tokenPresent} from './captcha.js';
import type {AudioSolver} from './audio-captcha.js';
import type {CaptchaActivity, CaptchaResult, GridSolver} from './captcha.js';
import {discoverPublicListings} from './listing-api.js';
import type {PublicListingContext} from './listing-api.js';

export function publicListingContext(options: {site: Site; intent: Config['intent']; city: string}): PublicListingContext | undefined {
  const url = new URL(location.href);
  const sameCity = (value: unknown): boolean => typeof value === 'string' && value.toLowerCase().replace(/[\s_-]/g, '') === options.city.toLowerCase().replace(/[\s_-]/g, '');
  if (options.site === 'housing' && url.hostname === 'housing.com') {
    const state = (window as unknown as {__INITIAL_STATE__?: {filters?: Record<string, unknown>; routeParams?: {url?: string}}}).__INITIAL_STATE__;
    const filters = state?.filters;
    const city = filters?.selectedCity as Record<string, unknown> | undefined;
    if (!filters || !city || !sameCity(city.name) || filters.service !== options.intent || filters.category !== 'residential' || typeof filters.fParam !== 'string') return;
    if (!url.pathname.startsWith('/in/' + options.intent + '/') || typeof city.url !== 'string' || !url.pathname.split('/').includes(city.url)) return;
    try { if (state?.routeParams?.url && new URL(state.routeParams.url, url).pathname !== url.pathname) return; } catch { return; }
    const cityData = Object.fromEntries(['name', 'id', 'cityId', 'url', 'isTierTwo', 'products'].filter(key => city[key] !== undefined).map(key => [key, city[key]]));
    return {site: 'housing', endpoint: 'https://mightyzeus-mum.housing.com/api/gql', hash: filters.fParam, service: options.intent, category: 'residential', city: cityData, path: url.pathname, page: Number(url.searchParams.get('page') || 1)};
  }
  if (options.site !== 'nobroker' || url.hostname !== 'www.nobroker.in' || options.intent !== 'buy') return;
  let listingState: {canonicalUrl?: {completeUrl?: string; canonicalURL?: string; city?: string}} | undefined;
  const runtime = (window as unknown as {nb?: {appState?: {listPage?: typeof listingState}}}).nb?.appState;
  listingState = runtime?.listPage;
  if (!listingState) {
    for (const script of document.scripts) {
      const text = script.textContent || '';
      const assignment = /nb\.appState\s*=\s*/.exec(text);
      if (!assignment || text.length > 4000000) continue;
      const start = assignment.index + assignment[0].length;
      let depth = 0; let quoted = false; let escaped = false;
      for (let index = start; index < text.length; index++) {
        const character = text[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') quoted = false;
        } else if (character === '"') quoted = true;
        else if (character === '{') depth++;
        else if (character === '}' && --depth === 0) {
          try { listingState = (JSON.parse(text.slice(start, index + 1)) as {listPage?: typeof listingState}).listPage; } catch { return; }
          break;
        }
      }
      if (listingState) break;
    }
  }
  let search = url;
  const canonical = listingState?.canonicalUrl;
  if (!search.searchParams.has('searchParam')) {
    if (!canonical?.completeUrl || canonical.canonicalURL !== url.pathname || !sameCity(canonical.city)) return;
    try { search = new URL(canonical.completeUrl, url); } catch { return; }
    if (search.origin !== url.origin || !search.pathname.startsWith('/property/sale/')) return;
  }
  if (!search.pathname.startsWith('/property/sale/')) return;
  const city = search.searchParams.get('city') || search.pathname.split('/')[3];
  if (!sameCity(city) || !search.searchParams.get('searchParam')) return;
  if ([...search.searchParams.keys()].some(key => /token|cookie|authorization|session|password|email|phone|mobile|contact|userid|deviceid/i.test(key))) return;
  const params = Object.fromEntries(search.searchParams);
  params.city = city;
  return {site: 'nobroker', endpoint: 'https://www.nobroker.in/api/v3/multi/property/BUY/filter', params, page: Number(params.pageNo || 1)};
}

export type Handoff = (message: string, verification?: boolean) => Promise<'continue' | 'skip'>;
export interface Prepared {ready: boolean; reason: string; baseline: string[]; verification?: boolean}
export interface Driver {
  discover(config: Config, site: Site, limit: number, checkpoint: () => Promise<void>, handoff: Handoff): Promise<Project[]>;
  prepare(item: Project, config: Config, navigate?: boolean): Promise<Prepared>;
  submit(item: Project): Promise<boolean>;
  confirmed(item: Project, baseline: string[]): Promise<boolean>;
  verifyCaptcha?(): Promise<CaptchaResult>;
  verificationReady?(): Promise<boolean>;
  takeDiscoveryNotes?(): string[];
  setActivity?(activity: CaptchaActivity): void;
  setCheckpoint?(checkpoint: () => Promise<void>): void;
  close(): Promise<void>;
}
export async function browserPath(preferred = ''): Promise<string> {
  const candidates = [preferred, process.env.BISMYTH_BROWSER_PATH, '/usr/bin/google-chrome', '/opt/google/chrome/chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean) as string[];
  for (const path of candidates) { try { await access(path); return path; } catch { /* Try next installation. */ } }
  throw new Error('Chrome/Chromium not found. Set Browser path in Setup or BISMYTH_BROWSER_PATH.');
}

export class PortalBrowser implements Driver {
  browser?: BrowserContext;
  page?: Page;
  private definitions: Record<Site, Adapter> = structuredClone(adapters);
  private decisionController = new AbortController();
  private captchaFailure?: {url: string; result: CaptchaResult; attempts: number};
  private discoveryNotes: string[] = [];
  private activity: CaptchaActivity = async () => undefined;
  private checkpoint: () => Promise<void> = async () => undefined;
  constructor(private readonly dataDirectory: string, private readonly headless = false, private readonly decide = chooseWithSubscription, private readonly solveCaptcha: GridSolver = solveGridWithSubscription, private readonly listingRequest: (url: string, init?: RequestInit) => Promise<Response> = fetch, private readonly solveAudio?: AudioSolver) {}
  takeDiscoveryNotes(): string[] { return this.discoveryNotes.splice(0); }
  setActivity(activity: CaptchaActivity): void { this.activity = activity; }
  setCheckpoint(checkpoint: () => Promise<void>): void { this.checkpoint = checkpoint; }
  async start(config: Config): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    this.definitions = await loadAdapters(config.adapterFile);
    if (this.decide === chooseWithSubscription) await subscriptionStatus();
    this.decisionController = new AbortController();
    const profile = join(this.dataDirectory, 'browser-profile');
    await mkdir(profile, {recursive: true, mode: 0o700});
    this.browser = await chromium.launchPersistentContext(profile, {executablePath: await browserPath(config.browserPath), headless: this.headless, viewport: {width: 1280, height: 800}, chromiumSandbox: true});
    this.page = this.browser.pages()[0] || await this.browser.newPage();
    this.page.setDefaultTimeout(8000);
    this.page.setDefaultNavigationTimeout(30000);
    return this.page;
  }
  async navigate(url: string): Promise<void> {
    this.captchaFailure = undefined;
    const response = await this.page!.goto(url, {waitUntil: 'domcontentloaded'});
    if (response && response.status() >= 400) throw new Error('Site returned HTTP ' + response.status());
    await this.settle();
  }
  async verifyCaptcha(): Promise<CaptchaResult> {
    await this.checkpoint();
    const page = this.page!;
    if (!await captchaPending(page)) { this.captchaFailure = undefined; return {pending: false, reason: ''}; }
    if (await captchaBlocked(page)) { await this.activity('CAPTCHA: ' + blockedCaptcha.reason); return blockedCaptcha; }
    const attempts = this.captchaFailure?.url === page.url() ? this.captchaFailure.attempts : 0;
    if (attempts >= 2 && !await captchaCanContinue(page) && !await tokenPresent(page)) return {pending: true, reason: 'Automatic CAPTCHA attempt limit reached (2 on this page). Complete verification in Chrome or K skips.'};
    const result = await attemptCaptcha(page, this.decisionController.signal, this.solveCaptcha, this.solveAudio, this.activity, {}, this.checkpoint);
    this.captchaFailure = result.pending ? {url: page.url(), result, attempts: attempts + 1} : undefined;
    return result;
  }
  async verificationReady(): Promise<boolean> {
    const page = this.page;
    if (!page || page.isClosed()) return false;
    // A visible enabled Proceed is enough to try once, but it is not evidence
    // of progress after that click timed out. Leave this gate for an explicit
    // C recheck until Chrome actually leaves it or finishes verification.
    if (this.captchaFailure?.url === page.url() && this.captchaFailure.result.continuationFailed && await captchaPending(page)) return false;
    return captchaCanContinue(page);
  }
  private async settle(): Promise<void> {
    await this.page!.waitForLoadState('domcontentloaded').catch(() => undefined);
  }
  private async visible(selector: string): Promise<Locator | null> {
    const elements = this.page!.locator(selector);
    for (let index = 0; index < await elements.count(); index++) {
      const element = elements.nth(index);
      if (await element.isVisible() && await element.isEnabled()) return element;
    }
    return null;
  }
  private async clickLabels(labels: string[], selector?: string): Promise<boolean> {
    if (selector) {
      const element = await this.visible(selector);
      if (element) { await element.click(); await this.settle(); return true; }
    }
    for (const label of labels) {
      const name = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
      for (const role of ['button', 'link'] as const) {
        const elements = this.page!.getByRole(role, {name});
        for (let index = 0; index < await elements.count(); index++) {
          const element = elements.nth(index);
          if (await element.isVisible() && await element.isEnabled()) { await element.click(); await this.settle(); return true; }
        }
      }
    }
    return false;
  }
  private async subscriptionContact(): Promise<boolean> {
    // Shortlist contact entry points. Never offer submit, verification, purchase, or consent controls.
    const candidates: {id: string; label: string; handle: Locator}[] = [];
    const handles = this.page!.locator('button, [role="button"], a');
    try {
      for (let index = 0; index < await handles.count(); index++) {
        const handle = handles.nth(index);
        const label = await handle.evaluate(node => {
          const b = node.getBoundingClientRect();
          if (!b.width || !b.height || node.matches(':disabled')) return '';
          return (node.getAttribute('aria-label') || node.textContent || '').trim();
        });
        if (/contact|enquir|callback|owner details/i.test(label) && !/submit|send|otp|verify|payment|buy now|agree/i.test(label) && label.length < 140) candidates.push({id: 'e' + candidates.length, label, handle});
      }
      const offered = candidates.slice(0, 8);
      const selected = await this.decide('Open the contact form for this property enquiry. Do not submit it.', offered, this.decisionController.signal);
      const candidate = offered.find(item => item.id === selected);
      if (!candidate) return false;
      const currentLabel = await candidate.handle.evaluate(node => (node.getAttribute('aria-label') || node.textContent || '').trim());
      if (currentLabel !== candidate.label) return false;
      await candidate.handle.click(); await this.settle(); return true;
    } catch (error) { throw new Error((error as Error).message); }
  }
  async discover(config: Config, site: Site, limit: number, checkpoint: () => Promise<void>, handoff: Handoff): Promise<Project[]> {
    const page = await this.start(config);
    const definition = this.definitions[site];
    const result = new Map<string, Project>();
    const pattern = new RegExp(definition.projectPattern, 'i');
    const collectPageLinks = async (): Promise<number> => {
      const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => ({url: (node as HTMLAnchorElement).href, title: (node.textContent || '').trim()})));
      for (const link of links) {
        try {
          if (siteForUrl(link.url) !== site || !pattern.test(new URL(link.url).pathname)) continue;
          const item = project(site, link.title, link.url);
          if (!result.has(item.id) && result.size < limit) result.set(item.id, item);
        } catch { continue; }
      }
      return links.length;
    };
    const seeds = config.seedUrls.filter(url => siteForUrl(url) === site);
    for (const url of seeds) if (pattern.test(new URL(url).pathname)) {
      const item = project(site, new URL(url).pathname.split('/').pop() || url, url);
      result.set(item.id, item);
    }
    const searchSeeds = seeds.filter(url => !pattern.test(new URL(url).pathname));
    if (!searchSeeds.length && !seeds.length) {
      await this.navigate(definition.home);
      let homeChallenge = await this.verifyCaptcha();
      while (homeChallenge.pending) {
        if (homeChallenge.blocked) { this.discoveryNotes.push(`${site}: provider blocked discovery; kept ${result.size} properties and continued with other websites.`); return [...result.values()].slice(0, limit); }
        if (await handoff(`${site}: ${homeChallenge.reason} Complete verification in Chrome; C rechecks, K skips.`, true) === 'skip') return [...result.values()].slice(0, limit);
        homeChallenge = await this.verifyCaptcha();
      }
      const city = config.city.toLowerCase();
      const intent = config.intent;
      const entry = await page.evaluate(([location, mode]) => {
        const word = mode === 'buy' ? /sale|buy/i : /rent/i;
        return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).find(a => (a.textContent || '').toLowerCase().includes(location) && word.test((a.textContent || '') + a.pathname))?.href;
      }, [city, intent] as const);
      if (entry && siteForUrl(entry) === site) searchSeeds.push(entry);
      else if (site === '99acres') {
        if (config.intent === 'rent') await this.clickLabels(['Rent']);
        const field = await this.visible('#keyword2');
        if (field) {
          await field.fill(config.city);
          const button = await this.visible('#searchform_search_btn');
          if (button) {
            await Promise.all([page.waitForURL(/\/search\//, {timeout: 15000}).catch(() => undefined), button.click()]);
            await this.settle();
          }
        }
        if (/\/search\//.test(page.url()) && page.url().toLowerCase().includes(intent)) searchSeeds.push(page.url());
      }
      if (!searchSeeds.length) {
        const answer = await handoff(`${site}: select ${config.intent} properties in ${config.city} in Chrome, then press c. Press k to skip this site.`);
        if (answer === 'skip') return [...result.values()];
        if (siteForUrl(page.url()) !== site) throw new Error('Search must stay on ' + site);
        searchSeeds.push(page.url());
      }
    }
    for (const seed of searchSeeds) {
      await checkpoint();
      if (result.size >= limit) break;
      if (!/^https?:\/\//.test(page.url()) || canonicalUrl(page.url()) !== canonicalUrl(seed)) await this.navigate(seed);
      let challenge = await this.verifyCaptcha();
      while (challenge.pending) {
        if (challenge.blocked) { this.discoveryNotes.push(`${site}: provider blocked discovery; kept ${result.size} properties and continued with other websites.`); return [...result.values()].slice(0, limit); }
        const answer = await handoff(`${site}: ${challenge.reason} Complete verification in Chrome; C rechecks, K skips.`, true);
        if (answer === 'skip') return [...result.values()].slice(0, limit);
        challenge = await this.verifyCaptcha();
      }
      await collectPageLinks();
      if (result.size >= limit) { this.discoveryNotes.push(`${site}: initial page filled the queue without extra listing requests.`); continue; }
      if (site !== '99acres') {
        await page.waitForFunction(() => Boolean((window as unknown as {__INITIAL_STATE__?: unknown}).__INITIAL_STATE__) || [...document.scripts].some(script => /nb\.appState\s*=/.test(script.textContent || '')), undefined, {timeout: 2500}).catch(() => undefined);
        const currentUrl = page.url();
        const context = await page.evaluate(publicListingContext, {site, intent: config.intent, city: config.city});
        if (context) {
          const api = await discoverPublicListings(context, limit, this.decisionController.signal, async () => {
            await checkpoint();
            if (page.url() !== currentUrl) throw new Error('Search page changed during API discovery.');
          }, this.listingRequest);
          await checkpoint();
          if (page.url() !== currentUrl) throw new Error('Search page changed during API discovery.');
          for (const item of api.projects) if (!result.has(item.id) && result.size < limit) result.set(item.id, item);
          this.discoveryNotes.push(`${site}: public API found ${api.projects.length} properties in ${api.requests} requests (${api.decodedBytes} decoded JSON bytes).`);
          if (api.complete) continue;
          this.discoveryNotes.push(`${site}: browser fallback — ${api.reason}`);
        } else this.discoveryNotes.push(`${site}: browser discovery; public search context unavailable or unsupported.`);
      }
      await page.waitForFunction(pattern => Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).some(link => new RegExp(pattern, 'i').test(new URL(link.href).pathname)), definition.projectPattern, {timeout: 8000}).catch(() => undefined);
      let stagnant = 0;
      const visited = new Set<string>();
      for (let step = 0; step < 60 && result.size < limit && stagnant < 3; step++) {
        await checkpoint();
        let scrollChallenge = await this.verifyCaptcha();
        while (scrollChallenge.pending) {
          if (scrollChallenge.blocked) { this.discoveryNotes.push(`${site}: provider blocked discovery; kept ${result.size} properties and continued with other websites.`); return [...result.values()].slice(0, limit); }
          if (await handoff(`${site}: ${scrollChallenge.reason} Complete verification in Chrome; C rechecks, K skips.`, true) === 'skip') return [...result.values()].slice(0, limit);
          scrollChallenge = await this.verifyCaptcha();
        }
        const previous = result.size;
        const linkCount = await collectPageLinks();
        stagnant = result.size === previous ? stagnant + 1 : 0;
        await page.evaluate(() => window.scrollBy(0, Math.max(800, window.innerHeight * 2)));
        // Infinite-scroll portals may append results asynchronously after the scroll.
        await page.waitForFunction(previousCount => document.querySelectorAll('a[href]').length > previousCount, linkCount, {timeout: 1500}).catch(() => undefined);
        if (stagnant >= 2 && !visited.has(page.url())) {
          visited.add(page.url());
          const next = await this.clickLabels(['Next', 'Next page', 'Show more', 'Load more'], definition.nextSelector || 'a[rel="next"]');
          if (next) stagnant = 0;
        }
      }
    }
    return [...result.values()].slice(0, limit);
  }
  private async evidence(item: Project): Promise<string[]> {
    const definition = this.definitions[item.site];
    return this.page!.evaluate(([pattern, selector]) => {
      const result: string[] = [];
      const visible = (node: Element): boolean => { const b = node.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(node).visibility !== 'hidden'; };
      if (selector) for (const node of document.querySelectorAll(selector)) if (visible(node)) result.push('selector:' + (node.textContent || '').trim());
      const matcher = new RegExp(pattern, 'i');
      for (const node of document.querySelectorAll('p, h1, h2, h3, [role="alert"], [role="status"], div, span')) {
        const text = (node.textContent || '').trim();
        if (text.length < 250 && matcher.test(text) && visible(node)) result.push(text);
      }
      return [...new Set(result)];
    }, [definition.successPattern, definition.successSelector] as const);
  }
  async prepare(item: Project, config: Config, navigate = true): Promise<Prepared> {
    const page = await this.start(config);
    const definition = this.definitions[item.site];
    if (navigate) await this.navigate(item.url);
    const gate = await this.verifyCaptcha();
    if (gate.pending) return {ready: false, reason: gate.reason, baseline: [], verification: true};
    const baseline = await this.evidence(item);
    // Check existing forms before opening a modal; avoid closing an already open form.
    let phone = false;
    for (const selector of definition.fields.phone) { const field = await this.visible(selector); if (field) { phone = true; break; } }
    if (!phone) {
      const opened = await this.subscriptionContact();
      if (!opened) await this.clickLabels(definition.openLabels, definition.openSelector);
    }
    const formChallenge = await this.verifyCaptcha();
    if (formChallenge.pending) return {ready: false, reason: formChallenge.reason, baseline, verification: true};
    await page.locator(definition.fields.phone.join(',')).filter({visible: true}).first().waitFor({state: 'visible', timeout: 4000}).catch(() => undefined);
    const missing: string[] = [];
    const values: Record<string, string> = {name: config.name, email: config.email, phone: config.phone, ...config.extraFields};
    let filledPhone = false;
    for (const [key, selectors] of Object.entries(definition.fields)) {
      const value = values[key];
      if (!value) continue;
      let filled = false;
      for (const selector of selectors) {
        const field = await this.visible(selector);
        if (!field) continue;
        const editable = await field.evaluate(node => node instanceof HTMLInputElement && !node.readOnly && !['checkbox', 'radio', 'submit', 'button', 'hidden', 'password'].includes(node.type) || node instanceof HTMLTextAreaElement && !node.readOnly);
        if (!editable) continue;
        // Keep country code selectors separate; portals' Indian mobile fields expect 10 digits.
        const text = key === 'phone' && /^\+?91[\d ()-]+$/.test(value) && value.replace(/\D/g, '').length === 12 ? value.replace(/\D/g, '').slice(2) : value;
        await field.fill(text);
        filled = true; break;
      }
      if (key === 'phone') filledPhone = filled;
      if (!filled && key !== 'email') missing.push(key);
    }
    const finalChallenge = await this.verifyCaptcha();
    if (finalChallenge.pending) return {ready: false, reason: finalChallenge.reason, baseline, verification: true};
    const blocked = await page.evaluate(() => {
      const body = document.body.innerText;
      if (/verify (?:your )?(?:phone|mobile)|enter (?:the )?otp|one.time (?:password|code)|verify you are human|access denied/i.test(body)) return 'Verification or login needs your attention.';
      const required = Array.from(document.querySelectorAll<HTMLInputElement>('input[required], textarea[required], select[required]')).filter(node => node.getBoundingClientRect().width > 0 && !node.checkValidity());
      if (required.length) return 'Required fields or terms need your attention in Chrome.';
      return '';
    });
    return {ready: filledPhone && !missing.length && !blocked, reason: blocked || (missing.length ? 'Missing form fields: ' + missing.join(', ') : !filledPhone ? 'Open the property contact form in Chrome.' : 'Contact fields filled.'), baseline};
  }
  async submit(item: Project): Promise<boolean> {
    const definition = this.definitions[item.site];
    return this.clickLabels(definition.submitLabels, definition.submitSelector);
  }
  async confirmed(item: Project, baseline: string[]): Promise<boolean> {
    const evidence = await this.evidence(item);
    return evidence.some(text => !baseline.includes(text));
  }
  async close(): Promise<void> {
    this.decisionController.abort();
    const browser = this.browser;
    this.browser = undefined; this.page = undefined;
    if (browser) await browser.close();
  }
}
