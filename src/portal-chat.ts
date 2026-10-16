import {createHash} from 'node:crypto';
import type {ElementHandle, Page} from 'playwright-core';
import type {Config} from './model.js';
import {renderManagerIntroduction} from './whatsapp.js';

export interface PortalChatPreparation {detected: boolean; ready: boolean; reason: string; draft?: string; alreadyShared?: boolean}
type ChatElement = ElementHandle<HTMLElement>;
interface ChatPreparation {url: string; draft: string; composer: ChatElement; send: ChatElement}
const preparations = new WeakMap<Page, ChatPreparation>();
const attempts = new WeakMap<Page, Set<string>>();
const normalize = (value: string): string => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
const attemptKey = (page: Page, draft: string): string => page.url() + '\n' + normalize(draft);

/** A business introduction, followed by the callback details selected in Setup. */
export function portalIntroduction(config: Config): string {
  const phone = config.phone.trim(); const email = config.email.trim();
  if (!/^\+?[\d ().-]{8,25}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set your callback phone and email before preparing a portal message.');
  }
  return renderManagerIntroduction({senderName: config.name, senderBusiness: config.senderBusiness || 'Bismyth'}) + '\nReach me at ' + phone + ' / ' + email;
}

async function blockedReason(page: Page): Promise<string> {
  return page.evaluate(() => {
    const visible = (node: Element): boolean => {
      const box = node.getBoundingClientRect(); const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        && style.opacity !== '0' && !node.closest('[hidden],[aria-hidden="true"],[inert]');
    };
    if (/\/(?:login|sign-?in|auth)(?:\/|$)/i.test(location.pathname)) return 'Sign in to the portal in Chrome before preparing a message.';
    if ([...document.querySelectorAll('input[type="password"],input[autocomplete="one-time-code"],input[name*="otp" i],input[id*="otp" i]')].some(visible)) return 'Complete login or OTP verification in Chrome before preparing a message.';
    const headings = [...document.querySelectorAll('h1,h2,[role="dialog"] h3,[role="alert"]')].filter(visible).map(node => node.textContent || '').join('\n');
    if (/security check|verify.{0,20}(?:human|identity)|access denied|unusual traffic|captcha/i.test(headings)) return 'Complete the portal security check in Chrome before preparing a message.';
    if (/choose (?:a )?plan|buy (?:a )?plan|payment required|pay to (?:contact|chat)|unlock (?:contact|chat)|subscribe to (?:contact|chat)/i.test(headings)) return 'The portal requires a plan or payment; no message was prepared.';
    return '';
  });
}

async function findComposer(page: Page): Promise<ChatElement | undefined> {
  const candidates = page.locator('textarea,[contenteditable="true"][role="textbox"]');
  const matches: ChatElement[] = [];
  for (let index = 0; index < Math.min(await candidates.count(), 100); index++) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible() || !await candidate.isEditable()) continue;
    const suitable = await candidate.evaluate(node => {
      if (node.closest('header,nav,[data-chat-widget],.chat-widget,.customer-support,[hidden],[aria-hidden="true"],[inert]')) return false;
      const descriptor = [node.getAttribute('placeholder'), node.getAttribute('aria-label'), node.getAttribute('data-testid'), node.getAttribute('name')].join(' ');
      if (!/message|chat/i.test(descriptor) && !node.matches('[contenteditable="true"][role="textbox"]')) return false;
      for (let ancestor: Element | null = node; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.opacity === '0' || style.visibility === 'hidden' || style.display === 'none') return false;
        const identity = [ancestor.id, ancestor.className, ancestor.getAttribute('aria-label'), ancestor.getAttribute('data-testid')].join(' ');
        if (/support|help.?desk|customer.?care|natasha|chat.?bot|assistant/i.test(identity)) return false;
      }
      return true;
    });
    if (suitable) {
      const handle = await candidate.elementHandle();
      if (handle) matches.push(handle as ChatElement);
    }
  }
  // Two visible conversations are ambiguous; do not choose a recipient for the operator.
  return matches.length === 1 ? matches[0] : undefined;
}

async function findSend(composer: ChatElement): Promise<ChatElement | undefined> {
  const result = await composer.evaluateHandle(node => {
    const visible = (element: Element): boolean => {
      const box = element.getBoundingClientRect(); const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
        && !element.closest('[hidden],[aria-hidden="true"],[inert],[aria-disabled="true"],fieldset[disabled]');
    };
    for (let scope = node.parentElement, depth = 0; scope && scope !== document.body && depth < 6; scope = scope.parentElement, depth++) {
      const composers = [...scope.querySelectorAll('textarea,[contenteditable="true"][role="textbox"]')].filter(visible);
      if (composers.length !== 1) return null;
      const sends = [...scope.querySelectorAll<HTMLElement>('button,[role="button"],input[type="submit"],input[type="button"]')].filter(button => {
        const label = button.getAttribute('aria-label') || (button instanceof HTMLInputElement ? button.value : button.innerText);
        return /^(?:send|send message)$/i.test((label || '').replace(/\s+/g, ' ').trim()) && visible(button)
          && !button.matches(':disabled') && !button.closest('[data-chat-widget],.chat-widget,.customer-support');
      });
      if (sends.length === 1) return sends[0];
      if (sends.length > 1 || scope.tagName === 'FORM') return null;
    }
    return null;
  });
  return result.asElement() as ChatElement | undefined || undefined;
}

/** Exact text in visible outgoing bubbles only; an editor's value is not delivery evidence. */
export async function portalChatEvidence(page: Page, draft: string): Promise<string[]> {
  const expected = normalize(draft);
  if (!expected) return [];
  const fingerprint = createHash('sha256').update(expected).digest('hex');
  const ids = await page.evaluate(expected => {
    const normalized = (value: string): string => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const selector = '[data-message],[data-message-id],[data-testid*="message" i],[class*="bubble" i],[class*="message" i]';
    const visible = (node: Element): boolean => {
      const box = node.getBoundingClientRect(); const style = getComputedStyle(node);
      for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) {
        const inherited = getComputedStyle(ancestor);
        if (inherited.opacity === '0' || inherited.display === 'none' || inherited.visibility === 'hidden') return false;
      }
      return box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0 && box.left < innerWidth && box.right > 0
        && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0' && !node.closest('[hidden],[aria-hidden="true"],[inert]');
    };
    const matches: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>(selector)) {
      if (!visible(node) || node.matches('textarea,input,[contenteditable="true"],[role="textbox"],[role="log"]')
        || node.querySelector('textarea,input,[contenteditable="true"],[role="textbox"]')
        || node.closest('textarea,input,[contenteditable="true"],[role="textbox"],header,footer,nav,[data-chat-widget],.chat-widget,.customer-support,[id*="support" i],[class*="support" i],[data-testid*="support" i]')) continue;
      if (normalized(node.innerText || '') !== expected) continue;
      // Prefer the message leaf, never its transcript/scroll container.
      if ([...node.querySelectorAll<HTMLElement>(selector)].some(child => visible(child) && normalized(child.innerText || '') === expected)) continue;
      let outgoing = false; let excluded = false; let id = '';
      for (let ancestor: Element | null = node, depth = 0; ancestor && ancestor !== document.body && depth < 5; ancestor = ancestor.parentElement, depth++) {
        const descriptor = [ancestor.className, ancestor.getAttribute('data-testid'), ancestor.getAttribute('data-message'), ancestor.getAttribute('data-direction')].join(' ');
        const status = [descriptor, ancestor.getAttribute('data-status'), ancestor.getAttribute('data-state'), ancestor.getAttribute('data-message-status'), ancestor.getAttribute('data-delivery-status'), ancestor.getAttribute('aria-label'), ancestor.getAttribute('title')].join(' ');
        if (/(?:^|[\s_-])(?:pending|queued|sending|failed|error|errored)(?:$|[\s_-])/i.test(status)) excluded = true;
        if (/not[\s_-]+sent|could(?:n['’]t| not) send|failed to send/i.test(status)) excluded = true;
        if (/support|help.?desk|customer.?care|natasha|chat.?bot|assistant/i.test([ancestor.id, descriptor, ancestor.getAttribute('aria-label')].join(' '))) excluded = true;
        if (ancestor.getAttribute('data-from-me') === 'false' || /(?:^|[\s_-])(?:incoming|received)(?:$|[\s_-])/i.test(descriptor)) {excluded = true; break;}
        if (ancestor.getAttribute('data-from-me') === 'true' || /(?:^|[\s_-])(?:outgoing|sent|from-me|mine)(?:$|[\s_-])/i.test(descriptor)) outgoing = true;
        id ||= ancestor.getAttribute('data-message-id') || ancestor.getAttribute('data-id') || (ancestor.matches(selector) ? ancestor.id : '');
      }
      const bubble = node.closest('[data-message-id],[data-message],[class*="bubble" i],[class*="outgoing" i]') || node;
      const failedIndicators = bubble.querySelectorAll('[aria-label*="failed" i],[title*="failed" i],[aria-label*="not sent" i],[title*="not sent" i],[data-status="failed"],[data-status="error"]');
      if ([...failedIndicators].some(visible)) excluded = true;
      if (outgoing && !excluded) matches.push(id.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 512));
    }
    return [...new Set(matches)];
  }, expected);
  return ids.map(id => 'portal-message:' + (id ? encodeURIComponent(id) + ':' : '') + fingerprint);
}

/** Fill the selected business introduction. This function never clicks Send or presses Enter. */
export async function preparePortalChat(page: Page, config: Config): Promise<PortalChatPreparation> {
  preparations.delete(page);
  const blocked = await blockedReason(page);
  if (blocked) return {detected: true, ready: false, reason: blocked};
  const draft = portalIntroduction(config);
  if ((await portalChatEvidence(page, draft)).length) return {detected: true, ready: false, alreadyShared: true, draft, reason: 'This introduction is already visible in the outgoing conversation; no duplicate was prepared.'};
  const composer = await findComposer(page);
  if (!composer) return {detected: false, ready: false, reason: 'No single visible seller-message composer was found.'};
  if (attempts.get(page)?.has(attemptKey(page, draft))) return {detected: true, ready: false, draft, reason: 'This message already had a send attempt. Check the conversation before retrying.'};
  const send = await findSend(composer);
  if (!send) return {detected: true, ready: false, draft, reason: 'The seller-message composer has no unambiguous Send button.'};
  const existing = await composer.evaluate(node => node instanceof HTMLTextAreaElement ? node.value : node.innerText);
  if (normalize(existing) && normalize(existing) !== normalize(draft)) return {detected: true, ready: false, draft, reason: 'The conversation contains an unfinished draft. Review it in Chrome before replacing it.'};
  await composer.fill(draft);
  preparations.set(page, {url: page.url(), draft, composer, send});
  return {detected: true, ready: true, draft, reason: 'Atlas business introduction and your callback details are drafted. Sending requires the live run confirmation.'};
}

/** One final click per conversation URL and draft; ambiguous outcomes are not retried. */
export async function submitPortalChat(page: Page, draft: string): Promise<boolean> {
  const preparation = preparations.get(page);
  const key = attemptKey(page, draft);
  if (!preparation || preparation.url !== page.url() || preparation.draft !== draft || attempts.get(page)?.has(key) || await blockedReason(page)) return false;
  if ((await portalChatEvidence(page, draft)).length) return false;
  try {
    if (!await preparation.composer.isVisible() || !await preparation.composer.isEditable() || !await preparation.send.isVisible() || !await preparation.send.isEnabled()) return false;
    const unchanged = await preparation.composer.evaluate((node, expected) => {
      const value = node instanceof HTMLTextAreaElement ? node.value : node.innerText;
      return value.normalize('NFKC').replace(/\s+/g, ' ').trim() === expected;
    }, normalize(draft));
    if (!unchanged) return false;
    const currentSend = await findSend(preparation.composer);
    if (!currentSend || !await currentSend.evaluate((node, original) => node === original, preparation.send)) return false;
    const attempted = attempts.get(page) || new Set<string>(); attempted.add(key); attempts.set(page, attempted);
    await preparation.send.click({timeout: 5000});
    return true;
  } catch {
    // A timed-out click can still have sent the message. Preserve the attempt guard.
    return false;
  }
}
