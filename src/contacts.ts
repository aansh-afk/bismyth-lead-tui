import {createHash} from 'node:crypto';

export type ContactRole = 'owner' | 'broker' | 'developer' | 'sales' | 'agency' | 'unknown';
export interface ContactAttribution {
  sourceUrl: string; evidence: string; observedAt: string;
  name?: string; organization?: string; role?: ContactRole;
}
export interface PublicContact extends ContactAttribution {
  id: string; kind: 'phone' | 'email' | 'whatsapp'; value: string; raw: string;
  review: 'approved' | 'needs-review'; whatsapp: 'unchecked';
  reviewedBy?: 'operator';
  attributions?: ContactAttribution[];
}
export interface ContactCapture {
  status: 'working' | 'captured' | 'not-found' | 'blocked' | 'failed';
  attemptedAt: string; detail: string; contacts: PublicContact[];
  stopBatch?: boolean;
}
export interface ContactSelection {
  id: string; evidence: string; name?: string; organization?: string; role?: ContactRole;
}
export type ContactChoice = ContactSelection;
export interface ContactDocument {url: string; markdown: string; links?: string[]; observedAt?: string}

/** Accept an explicitly public Indian mobile number; never reconstruct masked digits. */
export function normalizeIndianPhone(raw: string): string | undefined {
  const text = raw.trim();
  if (!text || /[^\d+\s().-]/.test(text) || (text.includes('+') && !text.startsWith('+'))) return;
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('+') && !(digits.length === 12 && digits.startsWith('91'))) return;
  if (digits.length === 14 && digits.startsWith('0091')) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits) || /^(\d)\1{9}$/.test(digits)) return;
  return `+91${digits}`;
}

function contactId(kind: PublicContact['kind'], value: string): string {
  return createHash('sha256').update(`${kind === 'email' ? 'email' : 'phone'}:${value}`).digest('hex').slice(0, 24);
}
function attribution(contact: ContactAttribution): ContactAttribution {
  const {sourceUrl, evidence, observedAt, name, organization, role} = contact;
  return {sourceUrl, evidence, observedAt, ...(name ? {name} : {}), ...(organization ? {organization} : {}), ...(role ? {role} : {})};
}
function attributionKey(value: ContactAttribution): string { return `${value.sourceUrl}\n${value.evidence}`; }

/** Same mobile across phone/WhatsApp links or listings is one contact, with all its sources. */
export function deduplicateContacts(contacts: readonly PublicContact[]): PublicContact[] {
  const unique = new Map<string, PublicContact>();
  for (const contact of contacts) {
    const key = `${contact.kind === 'email' ? 'email' : 'phone'}:${contact.value}`;
    const existing = unique.get(key);
    const incoming = [...(contact.attributions ?? []), attribution(contact)];
    if (!existing) {
      const attributions = [...new Map(incoming.map(item => [attributionKey(item), item])).values()];
      unique.set(key, {...contact, id: contactId(contact.kind, contact.value), attributions});
      continue;
    }
    const sources = [...(existing.attributions ?? []), ...incoming];
    const attributions = [...new Map(sources.map(item => [attributionKey(item), item])).values()];
    const preferred = existing.review !== 'approved' && contact.review === 'approved' ? contact : existing;
    unique.set(key, {
      ...preferred, id: contactId(contact.kind, contact.value),
      kind: existing.kind === 'whatsapp' || contact.kind === 'whatsapp' ? 'whatsapp' : preferred.kind,
      review: existing.review === 'approved' || contact.review === 'approved' ? 'approved' : 'needs-review',
      attributions,
    });
  }
  return [...unique.values()];
}

const supportLanguage = /\b(?:customer\s*(?:care|support|service)|help\s*desk|help\s*centre|help\s*center|technical\s*support|support\s*(?:team|email|phone|number)|contact\s+support|grievance|complaints?|toll[- ]?free|privacy\s+policy|terms\s+(?:of|and)|copyright|all\s+rights\s+reserved)\b/i;
const footerHeading = /^\s*#{1,6}\s+(?:help|support|customer\s*(?:care|support|service)|contact\s+us|privacy|terms|footer|about\s+us)\b/i;
function lineBounds(markdown: string, position: number): [number, number] {
  const start = markdown.lastIndexOf('\n', position - 1) + 1;
  const end = markdown.indexOf('\n', position);
  return [start, end === -1 ? markdown.length : end];
}
function evidenceAt(markdown: string, position: number, length: number): string {
  const [start, end] = lineBounds(markdown, position);
  const previous = markdown.lastIndexOf('\n', Math.max(0, start - 2));
  const after = markdown.indexOf('\n', Math.min(markdown.length, end + 1));
  const room = Math.max(0, Math.floor((700 - length) / 2));
  const from = Math.max(start - 240, previous + 1, position - room);
  const to = Math.min(end + 200, after === -1 ? markdown.length : after, position + length + room);
  return markdown.slice(from, to).trim();
}
function supportContact(markdown: string, position: number, raw: string, sourceUrl: string): boolean {
  const [start, end] = lineBounds(markdown, position);
  const line = markdown.slice(start, end);
  const previous = markdown.slice(Math.max(0, start - 160), start);
  if (supportLanguage.test(line) || supportLanguage.test(previous.split('\n').slice(-3).join('\n'))) return true;
  const preceding = markdown.slice(0, start).split('\n');
  for (let index = preceding.length - 1; index >= 0; index--) {
    if (/^\s*#{1,6}\s+/.test(preceding[index])) {
      if (footerHeading.test(preceding[index])) return true;
      break;
    }
  }
  if (raw.includes('@')) {
    const address = raw.toLowerCase();
    if (/^(?:support|help|helpdesk|care|customercare|customerservice|grievance|privacy|noreply|no-reply)@/.test(address)) return true;
    const domain = new URL(sourceUrl).hostname.replace(/^www\./, '');
    const portals = ['99acres.com', 'nobroker.in', 'housing.com', 'magicbricks.com', 'squareyards.com', 'olx.in', 'quikr.com'];
    if (portals.some(portal => (domain === portal || domain.endsWith(`.${portal}`)) && (address.endsWith(`@${portal}`) || address.endsWith(`.${portal}`)))) return true;
  }
  return false;
}

export function extractPublicContacts(document: ContactDocument): PublicContact[] {
  const source = new URL(document.url);
  if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) throw new Error('Contacts require a public http(s) source URL.');
  source.hash = '';
  const sourceUrl = source.href;
  const observedAt = document.observedAt ?? new Date().toISOString();
  const contacts: PublicContact[] = [];
  let inspected = 0;
  const add = (kind: PublicContact['kind'], value: string, raw: string, position: number): void => {
    if (supportContact(document.markdown, position, raw, sourceUrl)) return;
    const rawPosition = document.markdown.indexOf(raw, position);
    if (rawPosition < 0 || raw.length > 700) return;
    const evidence = evidenceAt(document.markdown, rawPosition, raw.length);
    if (!evidence.includes(raw)) return;
    contacts.push({id: contactId(kind, value), kind, value, raw, sourceUrl, evidence, observedAt, role: 'unknown', review: 'needs-review', whatsapp: 'unchecked'});
  };
  for (const match of document.markdown.matchAll(/(?<![\w+])\+?\d[\d \t().-]{7,25}\d(?![\w])/g)) {
    if (++inspected > 250) break;
    const raw = match[0].trim();
    const phone = normalizeIndianPhone(raw);
    if (phone) add('phone', phone, raw, match.index);
  }
  for (const match of document.markdown.matchAll(/(?<![\w.+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}(?![\w-]|\.[A-Z0-9-])/gi)) {
    if (++inspected > 300) break;
    add('email', match[0].toLowerCase(), match[0], match.index);
  }
  // A link has to be represented in the scraped public markdown as evidence. Links returned
  // only in a hidden/navigation list do not establish the listing seller's identity.
  const publicLinks: string[] = [];
  for (const match of document.markdown.matchAll(/(?:https?:\/\/[^\s<>\[\]]+|(?:tel|mailto):[^\s<>\[\]]+)/gi)) {
    publicLinks.push(match[0].replace(/\)+$/, ''));
    if (publicLinks.length >= 2000) break;
  }
  const links = new Set([...(document.links ?? []).slice(0, 2000), ...publicLinks]);
  for (const rawLink of links) {
    if (++inspected > 500) break;
    const position = document.markdown.indexOf(rawLink);
    if (position < 0) continue;
    try {
      const link = new URL(rawLink);
      let raw: string | undefined;
      let kind: PublicContact['kind'] = 'phone';
      if (link.protocol === 'tel:') raw = decodeURIComponent(link.pathname);
      else if (link.protocol === 'mailto:') {
        const email = decodeURIComponent(link.pathname).trim();
        if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}$/i.test(email)) add('email', email.toLowerCase(), email, position);
        continue;
      } else if (link.protocol === 'https:' && ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com'].includes(link.hostname)) {
        raw = link.hostname === 'wa.me' ? link.pathname.slice(1) : link.searchParams.get('phone') ?? undefined;
        kind = 'whatsapp';
      }
      const phone = raw && normalizeIndianPhone(raw);
      if (phone && raw) add(kind, phone, raw, position);
    } catch { /* Ignore malformed links and unsupported URL schemes. */ }
  }
  return deduplicateContacts(contacts).slice(0, 50);
}
