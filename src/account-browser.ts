import {chromium} from 'playwright-core';
import type {BrowserContext, Page} from 'playwright-core';
import {chmod, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {browserPath} from './browser.js';
import {accountPortalIds, accountStatusDetails, portalAccounts} from './accounts.js';
import type {AccountPortal, AccountStatus, PortalAccount} from './accounts.js';
import type {Config} from './model.js';

export interface AccountBrowserOptions {
  launchOptions?: {executablePath?: string; chromiumSandbox?: boolean; args?: string[]};
  /** Loopback-only URLs for local fixtures. Production always uses the catalog. */
  portalUrls?: Partial<Record<AccountPortal, string>>;
}

/** Manual website login shares the exact persistent profile used by PortalBrowser. */
export class AccountBrowser {
  browser?: BrowserContext;
  page?: Page;
  private readonly pages = new Map<AccountPortal, Page>();
  private readonly httpStatuses = new Map<AccountPortal, number>();
  private readonly failedNavigations = new Set<AccountPortal>();
  private readonly loginEnteredPages = new WeakSet<Page>();
  private generation = 0;
  constructor(private readonly dataDirectory: string, private readonly headless = false, private readonly options: AccountBrowserOptions = {}) {
    for (const url of Object.values(options.portalUrls || {})) {
      const parsed = new URL(url!);
      if (!['http:', 'https:'].includes(parsed.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) throw new Error('Account fixture URLs must use a loopback http(s) origin without credentials.');
    }
  }

  private definition(portal: AccountPortal): {url: string; origins: string[]} {
    const entry = portalAccounts.find(item => item.id === portal);
    if (!entry) throw new Error('Unknown website account.');
    const fixture = this.options.portalUrls?.[portal];
    if (fixture) return {url: fixture, origins: [new URL(fixture).origin]};
    const url = new URL(entry.url);
    const host = url.hostname.replace(/^www\./, '');
    return {url: url.href, origins: ['https://' + host, 'https://www.' + host]};
  }

  private observation(portal: AccountPortal, status: AccountStatus, detail = accountStatusDetails[status]): PortalAccount {
    return {portal, status, checkedAt: new Date().toISOString(), detail};
  }

  private forgetBrowser(browser: BrowserContext): void {
    if (this.browser !== browser) return;
    this.browser = undefined;
    this.page = undefined;
    this.pages.clear();
    this.httpStatuses.clear();
    this.failedNavigations.clear();
    this.generation++;
  }

  private async start(config: Pick<Config, 'browserPath'>): Promise<BrowserContext> {
    if (this.browser) return this.browser;
    const profile = join(this.dataDirectory, 'browser-profile');
    await mkdir(profile, {recursive: true, mode: 0o700});
    await chmod(profile, 0o700);
    let browser: BrowserContext;
    try {
      browser = await chromium.launchPersistentContext(profile, {
        executablePath: this.options.launchOptions?.executablePath || await browserPath(config.browserPath),
        headless: this.headless, viewport: {width: 1280, height: 800}, chromiumSandbox: true,
        ...this.options.launchOptions,
      });
    } catch (error) {
      if (/Singleton|ProcessSingleton|profile.*(?:use|lock)|user data directory.*use/i.test((error as Error).message)) throw new Error('The saved Chrome profile is already open. Stop the active run or close its Chrome window, then try again.');
      throw new Error('Could not open Chrome for website login. Check the Browser path and try again.');
    }
    this.browser = browser;
    const generation = this.generation;
    browser.on('close', () => { if (generation === this.generation) this.forgetBrowser(browser); });
    return browser;
  }

  async open(portal: AccountPortal, config: Pick<Config, 'browserPath'>): Promise<PortalAccount> {
    this.definition(portal);
    const browser = await this.start(config);
    let page = this.pages.get(portal);
    if (!page || page.isClosed()) {
      const assigned = new Set(this.pages.values());
      page = browser.pages().find(candidate => !candidate.isClosed() && candidate.url() === 'about:blank' && !assigned.has(candidate)) || await browser.newPage();
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(20000);
      this.pages.set(portal, page);
      const accountPage = page;
      page.on('framenavigated', frame => { if (frame === accountPage.mainFrame()) this.loginEnteredPages.delete(accountPage); });
    }
    // Explicit Open can recover an error page or an external sign-in redirect.
    // Keep a current first-party account page untouched, including login progress.
    if (this.failedNavigations.has(portal) && this.allowed(page, portal)) await this.check(portal);
    if (!this.allowed(page, portal) || this.failedNavigations.has(portal)) {
      try {
        const response = await page.goto(this.definition(portal).url, {waitUntil: 'domcontentloaded', timeout: 20000});
        this.httpStatuses.set(portal, response?.status() || 0);
        this.failedNavigations.delete(portal);
      } catch {
        this.failedNavigations.add(portal);
        this.httpStatuses.delete(portal);
        if (page.isClosed()) return this.observation(portal, 'unknown', 'Chrome was closed. Open this website again to continue.');
        this.page = page;
        await page.bringToFront().catch(() => undefined);
        // Chrome may commit its error document after goto rejects, or finish
        // the requested page after reporting an interrupted navigation. Wait
        // briefly for that transition before deciding whether it recovered.
        const origins = this.definition(portal).origins;
        await page.waitForURL(url => origins.includes(url.origin), {waitUntil: 'domcontentloaded', timeout: 2000}).catch(() => undefined);
        const current = await this.check(portal);
        return current.status === 'unknown' ? this.observation(portal, 'unknown', 'The website did not finish loading. Check Chrome, then check again.') : current;
      }
    }
    this.page = page;
    await page.bringToFront().catch(() => undefined);
    let observation = await this.check(portal);
    // Opening a login dialog is the only automated account action. Never submit,
    // fill credentials, activate OTP, or touch a security challenge.
    const visibleLoginFields = await page.locator('input, textarea, [contenteditable="true"]').evaluateAll(nodes => nodes.some(node => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (!box.width || !box.height || style.visibility === 'hidden' || style.display === 'none') return false;
      const type = (node.getAttribute('type') || 'text').toLowerCase();
      const attributes = ['autocomplete', 'name', 'id', 'placeholder', 'aria-label'].map(name => node.getAttribute(name) || '').join(' ');
      if (['password', 'tel', 'email', 'number'].includes(type)) return true;
      if (/one.?time.?code|otp|password|username|user.?name|user.?id|phone|mobile|e.?mail|verification|login|sign.?in/i.test(attributes)) return true;
      if (node.getAttribute('role') === 'combobox' || type === 'search' || /search|locality|location|city|find propert/i.test(attributes)) return false;
      // Plain-div login forms often omit useful semantics. Treat any remaining
      // text field as possible credential progress, even when empty. This also
      // protects populated generic fields without reading passwords or OTPs
      // (or reading any input value at all).
      return ['text', 'url'].includes(type) || node.tagName === 'TEXTAREA' || node.getAttribute('contenteditable') === 'true';
    })).catch(() => true);
    if (observation.status !== 'signed-in' && observation.status !== 'blocked' && this.allowed(page, portal) && !this.loginEnteredPages.has(page) && !visibleLoginFields) {
      const login = /^(?:log\s*in|sign\s*in|login\s*\/\s*register|login\s*(?:or|\/)\s*sign\s*up|login\s*\/\s*signup)$/i;
      let opened = false;
      for (const role of ['button', 'link'] as const) {
        const controls = page.getByRole(role, {name: login});
        for (let index = 0; index < Math.min(await controls.count().catch(() => 0), 8); index++) {
          const control = controls.nth(index);
          const safe = await control.evaluate(node => {
            if (node.closest('form')) return false;
            return !node.matches('button[type="submit"], input, [disabled]');
          }).catch(() => false);
          if (!safe || !await control.isVisible().catch(() => false)) continue;
          this.loginEnteredPages.add(page);
          await control.click({timeout: 5000}).catch(() => undefined);
          opened = true;
          break;
        }
        if (opened) break;
      }
      observation = await this.check(portal);
    }
    return observation;
  }

  private allowed(page: Page, portal: AccountPortal): boolean {
    try { return this.definition(portal).origins.includes(new URL(page.url()).origin); } catch { return false; }
  }

  /** Recheck only the current page. No navigation, network fetches, or clicks. */
  async check(portal: AccountPortal): Promise<PortalAccount> {
    if (!accountPortalIds.includes(portal)) throw new Error('Unknown website account.');
    const page = this.pages.get(portal);
    if (!page || page.isClosed()) return this.observation(portal, 'unknown', 'Chrome is not open for this website. Open it to check login.');
    this.page = page;
    if (!this.allowed(page, portal)) return this.observation(portal, 'unknown', 'Chrome is on another website. Return to the selected website, then check again.');
    try {
      const state = await page.evaluate(portal => {
        const visible = (node: Element): boolean => {
          for (let parent: Element | null = node; parent; parent = parent.parentElement) {
            const style = window.getComputedStyle(parent);
            if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
          }
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        };
        const label = (node: Element): string => (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' ');
        const controls = [...document.querySelectorAll('button, a, [role="button"], [role="menuitem"]')].filter(visible);
        const texts = controls.map(label);
        const challenge = [...document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, [id="challenge-form"]')].some(visible);
        const headings = [...document.querySelectorAll('h1, h2, h3, [role="heading"], [role="alert"]')].filter(visible).map(label);
        const gate = /security check(?:up)?|access denied|verify (?:that )?you(?: are|'re) (?:a )?human|unusual traffic|suspicious activity|request (?:was )?blocked|just a moment|try again later/i;
        const blocked = challenge || gate.test(document.title) || headings.some(text => gate.test(text));
        const loginLabel = /^(?:log\s*in(?:\s*(?:\/|or)\s*(?:register|sign\s*up))?|sign\s*in)$/i;
        // NoBroker renders its account controls as plain divs. Its authenticated
        // profile branch keeps Sign Out mounted inside a hidden hover menu.
        const noBrokerProfile = portal === 'nobroker' && [...document.querySelectorAll('#profile-icon')].some(icon => {
          if (!visible(icon)) return false;
          return [...icon.querySelectorAll('#profile-menu-dropdown *')].some(node => /^sign\s*out$/i.test(label(node)));
        });
        const noBrokerLogin = portal === 'nobroker' && [...document.querySelectorAll('#navheaderContainer div, header div')].some(node => visible(node) && loginLabel.test(label(node)));
        // Quikr changes the guest entry's ID and dropdown target after login.
        // Its hidden dashboard/logout markup is present for guests too.
        const quikrProfile = portal === 'quikr' && [...document.querySelectorAll('#loggedInMyAc[data-togg="dropdown"][data-area="dashboardMenu"], #hamLogoutLink')].some(visible);
        const quikrLogin = portal === 'quikr' && [...document.querySelectorAll('#loginLink, #hamLoginLink')].some(node => visible(node) && /^(?:log\s*in\s*\/\s*register|log\s*in|sign\s*in)$/i.test(label(node)));
        // Housing's authenticated Log Out controls are plain divs, rather than
        // semantic buttons/links. Restrict them to its known account UI.
        const housingPopover = portal === 'housing' && [...document.querySelectorAll('.T_bottomLinksContainerStyle .T_itemStyle[data-icon="logOut2"]')].some(node => visible(node) && /^log\s*out$/i.test(label(node)));
        const housingHeader = portal === 'housing' && [...document.querySelectorAll('.T_subContainerStyle')].some(node => {
          const edit = node.nextElementSibling;
          return visible(node) && [...node.querySelectorAll('.T_HelloWrapper')].some(visible)
            && edit !== null && edit.matches('button.T_editBtnStyle') && visible(edit) && /^edit$/i.test(label(edit));
        });
        const housingProfile = portal === 'housing' && /^\/user-profile(?:\/|$)/.test(location.pathname)
          && [...document.querySelectorAll('a[href]')].some(node => {
            if (!visible(node)) return false;
            try { const url = new URL(node.getAttribute('href')!, location.href); return url.origin === location.origin && url.pathname.replace(/\/$/, '') === '/user-profile/edit-profile'; } catch { return false; }
          })
          && [...document.querySelectorAll('div, span')].some(node => visible(node) && /^log\s*out$/i.test(label(node)) && ![...node.children].some(child => /^log\s*out$/i.test(label(child))));
        const housingLogin = portal === 'housing' && [...document.querySelectorAll('.T_loginBtnStyle, input[data-testid="login_input_text"]')].some(visible);
        const signedOut = noBrokerLogin || quikrLogin || housingLogin || texts.some(text => loginLabel.test(text)) || [...document.querySelectorAll('input[type="password"], input[autocomplete="one-time-code"]')].some(visible);
        const logout = texts.some(text => /^(?:log\s*out|sign\s*out)$/i.test(text));
        const identity = headings.some(text => /^(?:signed|logged) in as\s+\S/i.test(text));
        const accountControl = texts.some(text => /^(?:my profile|edit profile|account settings)$/i.test(text));
        return {blocked, signedOut, signedIn: noBrokerProfile || quikrProfile || housingHeader || housingPopover || housingProfile || logout || (identity && accountControl && !signedOut)};
      }, portal);
      // A failed Chrome navigation can retain the requested first-party URL.
      // Clear that failure only when actual account/security UI has appeared,
      // so explicit Open can retry an error document without reloading valid
      // login progress that subsequently recovered in place.
      if (state.blocked || state.signedOut || state.signedIn) this.failedNavigations.delete(portal);
      if (state.blocked) return this.observation(portal, 'blocked');
      if (state.signedIn && !state.signedOut) return this.observation(portal, 'signed-in');
      if (state.signedOut) return this.observation(portal, 'signed-out');
      if ([401, 403, 429].includes(this.httpStatuses.get(portal) || 0)) return this.observation(portal, 'blocked', 'The website refused this page. Check Chrome and try again later.');
      return this.observation(portal, 'unknown');
    } catch {
      return this.observation(portal, 'unknown', page.isClosed() ? 'Chrome was closed. Open this website again to continue.' : 'The page changed during the check. Check again when Chrome is ready.');
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    if (!browser) { this.pages.clear(); this.page = undefined; this.httpStatuses.clear(); this.failedNavigations.clear(); return; }
    this.forgetBrowser(browser);
    await browser.close().catch(() => undefined);
  }
}
