import {chromium} from 'playwright-core';
import type {BrowserContext, Page, Locator} from 'playwright-core';
import {access, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {adapters, loadAdapters} from './adapters.js';
import type {Adapter} from './adapters.js';
import {project, siteForUrl} from './model.js';
import type {Config, Project, Site} from './model.js';
import {chooseWithSubscription, subscriptionStatus} from './subscription.js';

export type Handoff = (message: string) => Promise<'continue' | 'skip'>;
export interface Prepared {ready: boolean; reason: string; baseline: string[]}
export interface Driver {
  discover(config: Config, site: Site, limit: number, checkpoint: () => Promise<void>, handoff: Handoff): Promise<Project[]>;
  prepare(item: Project, config: Config, navigate?: boolean): Promise<Prepared>;
  submit(item: Project): Promise<boolean>;
  confirmed(item: Project, baseline: string[]): Promise<boolean>;
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
  constructor(private readonly dataDirectory: string, private readonly headless = false, private readonly decide = chooseWithSubscription) {}
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
    const response = await this.page!.goto(url, {waitUntil: 'domcontentloaded'});
    if (response && response.status() >= 400) throw new Error('Site returned HTTP ' + response.status());
    await this.settle();
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
    const seeds = config.seedUrls.filter(url => siteForUrl(url) === site);
    for (const url of seeds) if (pattern.test(new URL(url).pathname)) {
      const item = project(site, new URL(url).pathname.split('/').pop() || url, url);
      result.set(item.id, item);
    }
    const searchSeeds = seeds.filter(url => !pattern.test(new URL(url).pathname));
    if (!searchSeeds.length && !seeds.length) {
      await this.navigate(definition.home);
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
      await this.navigate(seed);
      let challenge = await page.evaluate(() => /verifycaptcha|captcha/i.test(location.pathname) || /complete (?:the )?captcha|verify you are human|security checkup/i.test(document.body.innerText));
      while (challenge) {
        const answer = await handoff(`${site}: this site requires human CAPTCHA verification in Chrome. Complete it there, then C continues discovery. K skips this site.`);
        if (answer === 'skip') return [...result.values()].slice(0, limit);
        challenge = await page.evaluate(() => /verifycaptcha|captcha/i.test(location.pathname) || /complete (?:the )?captcha|verify you are human|security checkup/i.test(document.body.innerText));
      }
      await page.waitForFunction(pattern => Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).some(link => new RegExp(pattern, 'i').test(new URL(link.href).pathname)), definition.projectPattern, {timeout: 8000}).catch(() => undefined);
      let stagnant = 0;
      const visited = new Set<string>();
      for (let step = 0; step < 60 && result.size < limit && stagnant < 3; step++) {
        await checkpoint();
        const previous = result.size;
        const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => ({url: (node as HTMLAnchorElement).href, title: (node.textContent || '').trim()})));
        for (const link of links) if (siteForUrl(link.url) === site && pattern.test(new URL(link.url).pathname)) {
          const item = project(site, link.title, link.url);
          if (!result.has(item.id)) result.set(item.id, item);
          if (result.size >= limit) break;
        }
        stagnant = result.size === previous ? stagnant + 1 : 0;
        await page.evaluate(() => window.scrollBy(0, Math.max(800, window.innerHeight * 2)));
        // Infinite-scroll portals may append results asynchronously after the scroll.
        await page.waitForFunction(previousCount => document.querySelectorAll('a[href]').length > previousCount, links.length, {timeout: 1500}).catch(() => undefined);
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
    const baseline = await this.evidence(item);
    // Check existing forms before opening a modal; avoid closing an already open form.
    let phone = false;
    for (const selector of definition.fields.phone) { const field = await this.visible(selector); if (field) { phone = true; break; } }
    if (!phone) {
      const opened = await this.subscriptionContact();
      if (!opened) await this.clickLabels(definition.openLabels, definition.openSelector);
    }
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
    const blocked = await page.evaluate(() => {
      const body = document.body.innerText;
      if (/verify (?:your )?(?:phone|mobile)|enter (?:the )?otp|one.time (?:password|code)|captcha|verify you are human|access denied/i.test(body)) return 'Verification or login needs your attention.';
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
