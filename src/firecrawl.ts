import {extractPublicContacts} from './contacts.js';
import type {ContactCapture, ContactSelection, PublicContact} from './contacts.js';

export type {ContactSelection} from './contacts.js';
export interface ContactPage {url: string; title?: string; markdown: string}
export type ContactChooser = (candidates: PublicContact[], page: ContactPage, signal: AbortSignal) => Promise<ContactSelection[]>;
export interface FirecrawlOptions {
  apiKey?: string; baseUrl?: string; request?: typeof fetch; timeoutMs?: number; chooseContacts?: ContactChooser;
}
export class FirecrawlConfigurationError extends Error {}
const maximumBytes = 2 * 1024 * 1024;
const roles = ['owner', 'broker', 'developer', 'sales', 'agency', 'unknown'];
const roleEvidence = {
  owner: /\b(?:owner|landlord|landlady|ownership)\b/i,
  broker: /\b(?:broker|agent|realtor)\b/i,
  developer: /\b(?:developer|builder|promoter)\b/i,
  sales: /\b(?:sales|selling|salesperson)\b/i,
  agency: /\b(?:agency|agencies|real\s+estate|realt(?:y|ors))\b/i,
};

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function endpoint(raw: string): string {
  const url = new URL(raw);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new FirecrawlConfigurationError('Firecrawl needs HTTPS, or HTTP on localhost, without URL credentials or query parameters.');
  }
  return `${url.href.replace(/\/$/, '').replace(/\/v2$/, '')}/v2/scrape`;
}
function listingUrl(raw: string): string {
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || hostname.includes(':') || /^\d+(?:\.\d+){0,3}$/.test(hostname)) {
    throw new Error('Firecrawl contacts require a public HTTPS listing URL without credentials.');
  }
  url.hash = '';
  return url.href;
}
function sameListingPath(left: string, right: string): boolean {
  const path = (raw: string): string => new URL(raw).pathname.replace(/\/+$/, '') || '/';
  return path(left) === path(right);
}
async function limitedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = Number(response.headers.get('content-length'));
  if (length > maximumBytes) { await response.body?.cancel(); throw new Error('Firecrawl response exceeds 2 MiB.'); }
  if (!response.body) throw new Error('Firecrawl response is empty.');
  const reader = response.body.getReader();
  const cancel = (): void => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, {once: true});
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximumBytes) { await reader.cancel(); throw new Error('Firecrawl response exceeds 2 MiB.'); }
      chunks.push(decoder.decode(part.value, {stream: true}));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join('')) as unknown;
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
function blockedPage(markdown: string, title: string): boolean {
  const start = `${title}\n${markdown.slice(0, 3000)}`;
  return /(?:verify (?:that )?you(?: are|'re) (?:a )?human|security check(?:up)?|checking your browser|unusual traffic|access denied|cf-chl-|captcha|automated requests|just a moment\.\.\.)/i.test(start);
}
function loginPage(markdown: string, title: string, urls: string[]): boolean {
  return urls.some(raw => /\/(?:log-?in|sign-?in|authentication|auth|sso|captcha|security-check)(?:\/|$)/i.test(new URL(raw).pathname))
    || /^\s*(?:log\s?in|sign\s?in|authenticate)(?:\b|\s)/i.test(title)
    || /^\s*#{1,3}\s+(?:log\s?in|sign\s?in)\b[\s\S]{0,800}\b(?:password|enter\s+otp|verification\s+code)\b/i.test(markdown);
}
function validatedChoice(candidate: PublicContact, choice: ContactSelection, markdown: string): PublicContact | undefined {
  if (typeof choice.evidence !== 'string' || !choice.evidence || choice.evidence.length > 1400 || !markdown.includes(choice.evidence)
    || (!choice.evidence.includes(candidate.raw) && !choice.evidence.includes(candidate.value))) return;
  if (choice.name !== undefined && (typeof choice.name !== 'string' || !choice.name.trim() || !choice.evidence.includes(choice.name))) return;
  if (choice.organization !== undefined && (typeof choice.organization !== 'string' || !choice.organization.trim() || !choice.evidence.includes(choice.organization))) return;
  if (!choice.role || !roles.includes(choice.role) || choice.role === 'unknown' || !roleEvidence[choice.role].test(choice.evidence)) return;
  if (/\b(?:customer\s*(?:care|support|service)|help\s*desk|technical\s*support|grievance|complaints?|privacy\s+policy)\b/i.test(choice.evidence)) return;
  const contact: PublicContact = {...candidate, evidence: choice.evidence, review: 'approved', ...(choice.name ? {name: choice.name} : {}), ...(choice.organization ? {organization: choice.organization} : {}), ...(choice.role ? {role: choice.role} : {})};
  contact.attributions = [{sourceUrl: contact.sourceUrl, evidence: contact.evidence, observedAt: contact.observedAt, ...(contact.name ? {name: contact.name} : {}), ...(contact.organization ? {organization: contact.organization} : {}), ...(contact.role ? {role: contact.role} : {})}];
  return contact;
}

export class FirecrawlClient {
  private readonly options: FirecrawlOptions;
  constructor(options: FirecrawlOptions = {}) { this.options = options; }
  configured(): boolean { return Boolean((this.options.apiKey ?? process.env.FIRECRAWL_API_KEY ?? '').trim()); }
  assertConfigured(): void {
    if (!this.configured()) throw new FirecrawlConfigurationError('Set your Firecrawl API key before collecting public contacts.');
    endpoint(this.options.baseUrl ?? 'https://api.firecrawl.dev');
  }
  async capture(page: {url: string; title?: string}, signal: AbortSignal = new AbortController().signal): Promise<ContactCapture> {
    this.assertConfigured();
    signal.throwIfAborted();
    const url = listingUrl(page.url);
    const apiEndpoint = endpoint(this.options.baseUrl ?? 'https://api.firecrawl.dev');
    const attemptedAt = new Date().toISOString();
    const result = (status: ContactCapture['status'], detail: string, contacts: PublicContact[] = [], stopBatch = false): ContactCapture => ({status, attemptedAt, detail, contacts, ...(stopBatch ? {stopBatch: true} : {})});
    const requestController = new AbortController();
    const timeoutMs = Math.max(1, Math.min(45000, this.options.timeoutMs ?? 45000));
    const timeout = setTimeout(() => requestController.abort(new Error('Firecrawl request timed out.')), timeoutMs);
    const requestSignal = AbortSignal.any([signal, requestController.signal]);
    let document: unknown;
    try {
      const response = await (this.options.request ?? fetch)(apiEndpoint, {
        method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${(this.options.apiKey ?? process.env.FIRECRAWL_API_KEY ?? '').trim()}`},
        credentials: 'omit', redirect: 'error', signal: requestSignal,
        body: JSON.stringify({url, formats: ['markdown', 'links'], onlyMainContent: true, proxy: 'auto', timeout: Math.min(40000, timeoutMs)}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) return result('blocked', 'Firecrawl rate limit reached (HTTP 429); no automatic retry was made.', [], true);
        if (response.status === 401 || response.status === 403) return result('failed', `Firecrawl rejected the API key or access (HTTP ${response.status}); check your key.`, [], true);
        if (response.status === 402) return result('failed', 'Firecrawl credits are exhausted (HTTP 402); no automatic retry was made.', [], true);
        return result('failed', `Firecrawl request failed (HTTP ${response.status}); no automatic retry was made.`);
      }
      document = await limitedJson(response, requestSignal);
    } catch {
      signal.throwIfAborted();
      return result('failed', requestController.signal.aborted ? 'Firecrawl request timed out; no automatic retry was made.' : 'Firecrawl returned an unavailable, invalid or oversized response; no automatic retry was made.');
    } finally { clearTimeout(timeout); }
    signal.throwIfAborted();
    if (!record(document) || document.success !== true || !record(document.data)) return result('failed', 'Firecrawl did not return a successful public page.');
    const data = document.data;
    if (!record(data.metadata)) return result('failed', 'Firecrawl page metadata is missing; public source could not be verified.');
    const metadata = data.metadata;
    const statusCode = metadata.statusCode;
    if (typeof statusCode !== 'number' || statusCode < 200 || statusCode >= 300) {
      return result(typeof statusCode === 'number' && [401, 403, 429].includes(statusCode) ? 'blocked' : 'failed', 'The source website did not return a successful public page.');
    }
    const reportedUrls = [metadata.sourceURL, metadata.url].filter((value): value is string => typeof value === 'string');
    try {
      if (!reportedUrls.length || reportedUrls.some(reported => new URL(listingUrl(reported)).origin !== new URL(url).origin)) return result('failed', 'Firecrawl returned a different source origin; contacts were not accepted.');
    } catch { return result('failed', 'Firecrawl source URL could not be verified.'); }
    const markdown = typeof data.markdown === 'string' ? data.markdown : '';
    const title = typeof metadata.title === 'string' ? metadata.title : page.title ?? '';
    if (blockedPage(markdown, title)) return result('blocked', 'The source website returned a security challenge; no contact details were collected.');
    if (loginPage(markdown, title, reportedUrls)) return result('blocked', 'The source website returned a login page; public contact collection does not sign in.');
    if (reportedUrls.some(reported => !sameListingPath(url, reported))) return result('failed', 'The source website returned a different listing path; contacts were not attributed to the original listing.');
    if (!markdown.trim()) return result('not-found', 'The public page contained no readable contact details.');
    const links = Array.isArray(data.links) ? data.links.filter((item): item is string => typeof item === 'string').slice(0, 2000) : [];
    let contacts = extractPublicContacts({url, markdown, links, observedAt: attemptedAt});
    if (!contacts.length) return result('not-found', 'No unmasked public Indian mobile numbers or seller email addresses were found.');
    if (this.options.chooseContacts) {
      try {
        const choices = await this.options.chooseContacts(structuredClone(contacts), {url, title, markdown}, signal);
        signal.throwIfAborted();
        if (!Array.isArray(choices)) throw new Error('Contact classification is invalid.');
        const byId = new Map(choices.filter(choice => record(choice) && typeof choice.id === 'string').map(choice => [choice.id, choice]));
        contacts = contacts.map(contact => {
          const choice = byId.get(contact.id);
          return choice ? validatedChoice(contact, choice, markdown) ?? contact : contact;
        });
      } catch {
        signal.throwIfAborted();
        return result('captured', `${contacts.length} public contact candidates collected; AI review was unavailable. Review them before WhatsApp outreach.`, contacts);
      }
    }
    const approved = contacts.filter(contact => contact.review === 'approved').length;
    return result('captured', `${contacts.length} public contact candidates collected; ${approved} identified as listing contacts, ${contacts.length - approved} need review.`, contacts);
  }
}
