import type {Page} from 'playwright-core';
import {canonicalUrl, siteForUrl} from './model.js';
import type {Config, Project} from './model.js';
import {extractBrowserContacts, normalizeIndianPhone} from './contacts.js';
import type {ContactCapture} from './contacts.js';

/** Read visible listing evidence only; account navigation and unrelated cards are excluded. */
export async function visibleListingContacts(page: Page, item: Project, config: Config, history = false): Promise<ContactCapture> {
  const attemptedAt = new Date().toISOString();
  const current = new URL(page.url());
  const listing = new URL(item.url);
  if (current.origin !== listing.origin && siteForUrl(current.href) !== item.site) {
    return {status: 'blocked', attemptedAt, detail: 'Contact page left the listing website; no contacts read.', contacts: []};
  }
  const observed = await page.evaluate(({listingUrl, history}) => {
    const target = new URL(listingUrl);
    const path = (url: URL): string => url.pathname.replace(/\/+$/, '') || '/';
    const visible = (node: Element): boolean => {
      const box = node.getBoundingClientRect(); const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };
    const blocked = [...document.querySelectorAll('h1,h2,[role="alert"]')].some(node => visible(node) && /security check|verify.*human|access denied|unusual traffic/i.test(node.textContent || ''));
    if (blocked || /\/(?:login|sign-?in|auth)(?:\/|$)/i.test(location.pathname)) return {blocked: true, markdown: ''};
    const matches = (anchor: HTMLAnchorElement): boolean => {
      try { const url = new URL(anchor.href); return url.protocol === target.protocol && url.hostname.replace(/^www\./, '') === target.hostname.replace(/^www\./, '') && url.port === target.port && path(url) === path(target); } catch { return false; }
    };
    const scopes: Element[] = [];
    const excluded = (node: Element): boolean => {
      if (node.closest('header,footer,nav,[data-chat-widget],.chat-widget,.customer-support')) return true;
      const surface = node.closest('form,[role="dialog"],.account-profile,.user-profile,[data-testid="account-profile"]');
      if (!surface) return false;
      const text = (surface as HTMLElement).innerText;
      if ([...surface.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"],input[name*="otp" i],input[id*="otp" i]')].some(visible)) return true;
      if (/\b(?:sign\s?in|log\s?in|enter.{0,12}otp|my profile|edit profile|account details|personal details|registered (?:phone|mobile|email))\b/i.test(text)) return true;
      return surface.matches('[role="dialog"]') && !/\b(?:seller|owner|broker|agent|builder|developer|advertiser)\b/i.test(text);
    };
    const visibleText = (scope: Element): string => {
      const pieces: string[] = [];
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      for (let current = walker.nextNode(); current; current = walker.nextNode()) {
        const parent = current.parentElement;
        if (parent && visible(parent) && !excluded(parent) && !parent.closest('script,style,textarea,input')) pieces.push(current.textContent || '');
      }
      return pieces.join(' ').replace(/\s+/g, ' ').trim();
    };
    if (history) {
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        if (!visible(anchor) || !matches(anchor)) continue;
        let node: Element | null = anchor.parentElement;
        for (let depth = 0; node && depth < 9 && node !== document.body; depth++, node = node.parentElement) {
          const links = [...node.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(link => /\/property\//.test(link.pathname));
          if (links.some(link => !matches(link))) break;
          if (node.querySelector('a[href^="tel:"], a[href*="wa.me/"], a[href^="mailto:"], [data-contact-details], [class*="phone" i], [class*="call" i]')) { scopes.push(node); break; }
        }
      }
    } else {
      if (path(new URL(location.href)) !== path(target)) return {blocked: true, markdown: ''};
      for (const node of document.querySelectorAll('[data-contact-details], [data-testid*="seller" i], [data-testid*="contact" i], [class*="seller" i], [class*="owner-detail" i], [class*="contact-detail" i], [role="dialog"]')) {
        if (!visible(node) || excluded(node) || (node as HTMLElement).innerText.length > 7000) continue;
        const text = visibleText(node);
        const credentialSurface = [...node.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"],input[name*="otp" i],input[id*="otp" i]')].some(input => visible(input) && !excluded(input));
        const profileSurface = /\b(?:sign\s?in|log\s?in|enter.{0,12}otp|my profile|edit profile|account details|personal details|registered (?:phone|mobile|email))\b/i.test(text);
        if (credentialSurface || profileSurface) continue;
        if (node.matches('[role="dialog"]') && !/\b(?:seller|owner|broker|agent|builder|developer|advertiser)\b/i.test(text)) continue;
        scopes.push(node);
      }
      for (const link of document.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me/"]')) {
        if (visible(link) && !excluded(link)) scopes.push(link.closest('[data-contact-details]') || link);
      }
    }
    const blocks: string[] = [];
    for (const scope of new Set(scopes)) {
      if (!visible(scope) || excluded(scope)) continue;
      const text = visibleText(scope);
      if (text.length > 7000 || /customer\s*(?:care|support)|help\s*desk|support\s*(?:team|number)/i.test(text)) continue;
      blocks.push(text);
      const anchors = [...(scope.matches('a[href]') ? [scope as HTMLAnchorElement] : []), ...scope.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"],a[href^="mailto:"],a[href*="wa.me/"]')];
      for (const anchor of anchors) {
        if (visible(anchor) && !excluded(anchor)) blocks.push('Listing contact: ' + anchor.href);
      }
    }
    return {blocked: false, markdown: [...new Set(blocks)].join('\n').slice(0, 25000)};
  }, {listingUrl: item.url, history});
  if (observed.blocked) return {status: 'blocked', attemptedAt, detail: 'The contact page needs login or verification in Chrome.', contacts: []};
  const source = new URL(page.url()); source.search = ''; source.hash = '';
  const ownPhone = normalizeIndianPhone(config.phone);
  const contacts = extractBrowserContacts({url: canonicalUrl(source.href), listingUrl: item.url, visibility: 'authenticated', markdown: observed.markdown, observedAt: attemptedAt})
    .filter(contact => contact.kind === 'email' ? contact.value !== config.email.trim().toLowerCase() : contact.value !== ownPhone);
  return {status: contacts.length ? 'captured' : 'not-found', attemptedAt,
    detail: contacts.length ? `${contacts.length} listing-matched contact details read from the signed-in portal. Numbers may be portal relays; WhatsApp availability is unchecked.`
      : history ? 'No visible contact number matched this property in the contacted-properties page. Enquiry confirmation was retained.' : 'No seller contact details were visibly revealed for this listing. Enquiry confirmation was retained.', contacts};
}

/** NoBroker's desktop phone icon is an official Copy action, not a telephone call. */
export async function captureNoBrokerCopiedNumber(page: Page, item: Project, config: Config): Promise<ContactCapture | undefined> {
  if (item.site !== 'nobroker' || !/\/profile\/myContacts\/?$/i.test(new URL(page.url()).pathname)) return;
  if ((page.viewportSize()?.width || 0) < 900) return;
  const cards = page.locator('.nb__ZsnRA');
  const matches = [];
  const target = new URL(item.url);
  for (let index = 0; index < await cards.count(); index++) {
    const card = cards.nth(index);
    if (!await card.isVisible()) continue;
    const linked = await card.locator('a[href]').evaluateAll((nodes, targetUrl) => {
      const expected = new URL(targetUrl);
      const same = (url: URL): boolean => url.protocol === expected.protocol && url.hostname.replace(/^www\./, '') === expected.hostname.replace(/^www\./, '') && url.port === expected.port && url.pathname.replace(/\/+$/, '') === expected.pathname.replace(/\/+$/, '');
      return nodes.some(node => { try { return same(new URL((node as HTMLAnchorElement).href)); } catch { return false; } });
    }, target.href);
    if (linked) matches.push(card);
  }
  if (matches.length !== 1) return;
  const icon = matches[0].locator('img[src$="/List-Page/callIconActive.svg"]').filter({visible: true});
  if (await icon.count() !== 1) return;
  const button = icon.locator('..');
  const key = '__bismythPhoneCopy_' + Date.now().toString(36);
  await page.evaluate(key => {
    const state: {value?: string; restore: () => void} = {restore: () => undefined};
    const host = window as unknown as Record<string, unknown>;
    const descriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const original = document.execCommand;
    const existing = new WeakSet(document.querySelectorAll('input,textarea'));
    Object.defineProperty(document, 'execCommand', {configurable: true, writable: true, value(command: string, ...args: unknown[]) {
      if (command.toLowerCase() === 'copy') {
        const input = document.activeElement;
        if ((input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) && !existing.has(input) && input.selectionStart === 0 && input.selectionEnd === input.value.length) state.value = input.value;
        return true;
      }
      return Reflect.apply(original, document, [command, ...args]);
    }});
    state.restore = () => { if (descriptor) Object.defineProperty(document, 'execCommand', descriptor); else delete (document as unknown as Record<string, unknown>).execCommand; delete host[key]; };
    host[key] = state;
  }, key);
  let copied: string | undefined;
  try {
    await button.click();
    await page.waitForFunction(key => Boolean((window as unknown as Record<string, {value?: string}>)[key]?.value), key, {timeout: 5000}).catch(() => undefined);
    copied = await page.evaluate(key => (window as unknown as Record<string, {value?: string}>)[key]?.value, key);
  } finally {
    await page.evaluate(key => (window as unknown as Record<string, {restore?: () => void}>)[key]?.restore?.(), key).catch(() => undefined);
  }
  if (!copied || !normalizeIndianPhone(copied) || normalizeIndianPhone(copied) === normalizeIndianPhone(config.phone)) return;
  const attemptedAt = new Date().toISOString();
  const sourceUrl = new URL(page.url()); sourceUrl.search = ''; sourceUrl.hash = '';
  const contacts = extractBrowserContacts({url: sourceUrl.href, listingUrl: item.url, visibility: 'authenticated', markdown: `Listing contact copied by the matched property's phone control: ${copied}`, observedAt: attemptedAt});
  return {status: contacts.length ? 'captured' : 'not-found', attemptedAt, collectionMethod: 'playwright', detail: contacts.length ? 'NoBroker listing phone copied from its matched contacted-property card. This may be a portal relay; WhatsApp availability is unchecked.' : 'The copied property contact was not a complete supported number.', contacts};
}

export async function capturePortalContacts(page: Page, item: Project, config: Config, checkpoint: () => Promise<void>): Promise<ContactCapture> {
  await checkpoint();
  const listingContacts = await visibleListingContacts(page, item, config);
  if (item.site !== 'nobroker' || listingContacts.contacts.length) return listingContacts;
  // Keep the confirmed listing page intact. Use the account's normal contact-history UI.
  const history = await page.context().newPage();
  try {
    const url = new URL('/profile/myContacts', page.url());
    await history.goto(url.href, {waitUntil: 'domcontentloaded'});
    await checkpoint();
    await history.locator('a[href*="/property/"]').first().waitFor({state: 'visible', timeout: 5000}).catch(() => undefined);
    await checkpoint();
    const found = await visibleListingContacts(history, item, config, true);
    return found.contacts.length || found.status === 'blocked' ? found : await captureNoBrokerCopiedNumber(history, item, config) || found;
  } finally { await history.close().catch(() => undefined); }
}
