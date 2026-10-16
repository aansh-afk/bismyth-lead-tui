import {createHash, randomUUID} from 'node:crypto';
import {deduplicateContacts, normalizeIndianPhone} from './contacts.js';
import type {PublicContact} from './contacts.js';
import type {Run} from './model.js';
import {renderManagerIntroduction, WhatsAppRouterError} from './whatsapp.js';
import type {RouterEvent, RouterSendStatus, WhatsAppRouter} from './whatsapp.js';

export type OutreachStatus = 'pending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'uncertain' | 'opted-out';
export interface OutreachEntry {
  senderSessionId: string; to: string; purpose: 'manager-introduction-v1'; clientRequestId: string;
  runId: string; contactId: string; message: string; sourceUrls: string[]; status: OutreachStatus;
  operationId: string | null; messageId: string | null; createdAt: string; updatedAt: string;
  replies: {id: string; text: string; occurredAt: string}[];
  referrals?: {phone: string; raw: string; sourceMessageId: string}[];
  chatIds?: string[];
}
export interface OutreachBook {version: 1; entries: OutreachEntry[]; cursors: Record<string, string>}
export interface OutreachStorage {
  outreach(): Promise<OutreachBook>; saveOutreach(book: OutreachBook): Promise<void>;
  withOutreachLock?<T>(work: () => Promise<T>): Promise<T>;
}
export interface OutreachPreview {
  contactId: string; to: string; message: string; sourceUrls: string[];
  status: 'ready' | 'unavailable' | 'skipped'; detail: string;
}
type OutreachRouter = Pick<WhatsAppRouter, 'status' | 'checkContact' | 'preview' | 'send' | 'operation' | 'events'>;
type Progress = (message: string) => void | Promise<void>;
const purpose = 'manager-introduction-v1';
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ranks: Partial<Record<OutreachStatus, number>> = {pending: 0, accepted: 1, sent: 2, delivered: 3, read: 4, replied: 5};
// Queue callers sharing one store; persistent stores also exclude other instances/processes.
const locks = new WeakMap<OutreachStorage, Promise<unknown>>();

export function contactsForRun(run: Run): PublicContact[] {
  return deduplicateContacts(run.projects.flatMap(project => project.contactCapture?.contacts ?? []));
}
function approvedPhones(contacts: PublicContact[]): PublicContact[] {
  return deduplicateContacts(contacts.filter(contact => contact.review === 'approved' && contact.kind !== 'email'
    && (contact.reviewedBy === 'operator' || ['owner', 'broker', 'developer', 'sales', 'agency'].includes(contact.role || ''))
    && normalizeIndianPhone(contact.value) === contact.value));
}
function sourceUrls(contact: PublicContact): string[] { return [...new Set([contact.sourceUrl, ...(contact.attributions ?? []).map(item => item.sourceUrl)])]; }
function matchingEntry(book: OutreachBook, sessionId: string, number: string): OutreachEntry | undefined {
  return book.entries.find(entry => entry.senderSessionId === sessionId && entry.to === number && (entry.purpose === purpose || entry.status === 'opted-out'));
}
function transition(entry: OutreachEntry, next: OutreachStatus, at = new Date().toISOString()): void {
  if (entry.status === 'opted-out') return;
  const oldRank = ranks[entry.status]; const nextRank = ranks[next];
  if (next !== 'opted-out' && ((oldRank !== undefined && nextRank !== undefined && nextRank < oldRank)
    || ((oldRank ?? -1) >= 2 && nextRank === undefined)
    || (entry.status === 'failed' && next === 'accepted'))) return;
  entry.status = next;
  if (Date.parse(at) > Date.parse(entry.updatedAt)) entry.updatedAt = at;
}
function sendStatus(status: RouterSendStatus): OutreachStatus {
  if (status === 'queued' || status === 'sending') return 'accepted';
  if (status === 'preview') throw new Error('A live send returned a preview outcome. Reconcile the saved operation.');
  return status;
}
function stopRequest(text: string): boolean {
  return /^\s*(?:stop|unsubscribe|opt[\s-]?out|cancel)\s*[.!]?\s*$/i.test(text)
    || /\b(?:please\s+stop(?:\s+(?:messaging|contacting|texting)(?:\s+me)?)?|do\s+not\s+(?:contact|message|text)\s+me|don['’]t\s+(?:contact|message|text)\s+me|remove\s+my\s+(?:number|contact))\b/i.test(text);
}
function referrals(text: string, messageId: string): NonNullable<OutreachEntry['referrals']> {
  const found: NonNullable<OutreachEntry['referrals']> = [];
  for (const match of text.matchAll(/(?<![\w+])\+?\d[\d \t().-]{7,25}\d(?![\w])/g)) {
    const raw = match[0].trim(); const phone = normalizeIndianPhone(raw);
    if (phone && !found.some(item => item.phone === phone)) found.push({phone, raw, sourceMessageId: messageId});
  }
  return found;
}

/** One explicitly confirmed introduction per sender/number, with durable IDs and no send retries. */
export class OutreachService {
  readonly #store: OutreachStorage;
  readonly #router: OutreachRouter;
  readonly #sessionId: string;
  constructor(store: OutreachStorage, router: OutreachRouter | undefined, sessionId: string) {
    if (!router || !sessionPattern.test(sessionId)) throw new Error('Configure the WhatsApp router and sender-session UUID before preparing outreach.');
    this.#store = store; this.#router = router; this.#sessionId = sessionId;
  }
  async #ready(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const {health, session} = await this.#router.status(signal);
    if (!health.ok || !health.ready || health.apiVersion !== '1' || session.userId !== this.#sessionId || session.status !== 'connected') {
      throw new Error('Connect the selected WhatsApp sender session before preparing outreach.');
    }
  }
  #exclusive<T>(work: () => Promise<T>): Promise<T> {
    const pending = (locks.get(this.#store) ?? Promise.resolve()).catch(() => undefined)
      .then(() => this.#store.withOutreachLock ? this.#store.withOutreachLock(work) : work());
    locks.set(this.#store, pending.catch(() => undefined)); return pending;
  }
  #message(run: Run): string { return renderManagerIntroduction({senderName: run.config.name, senderBusiness: run.config.senderBusiness || 'Bismyth'}); }

  /** Dry-run router validation never persists a pending operation or calls live send. */
  async preview(run: Run, contacts: PublicContact[], signal?: AbortSignal): Promise<OutreachPreview[]> {
    const message = this.#message(run); await this.#ready(signal);
    const book = await this.#store.outreach(); const result: OutreachPreview[] = [];
    for (const contact of approvedPhones(contacts)) {
      signal?.throwIfAborted();
      const item: OutreachPreview = {contactId: contact.id, to: contact.value, message, sourceUrls: sourceUrls(contact), status: 'ready', detail: 'Ready for explicit send confirmation.'};
      if (matchingEntry(book, this.#sessionId, contact.value)) {
        result.push({...item, status: 'skipped', detail: 'An introduction or opt-out already exists for this sender and contact.'}); continue;
      }
      const availability = await this.#router.checkContact(contact.value, signal);
      if (!availability.onWhatsApp) { result.push({...item, status: 'unavailable', detail: 'This public number is not available on WhatsApp.'}); continue; }
      await this.#router.preview({to: contact.value, message, clientRequestId: randomUUID()}, signal);
      result.push(item);
    }
    return result;
  }

  /** Call only after the user has reviewed the exact drafts and explicitly confirmed sending. */
  async send(run: Run, contacts: PublicContact[], signal?: AbortSignal, onProgress: Progress = () => {}): Promise<OutreachEntry[]> {
    return this.#exclusive(async () => {
      const message = this.#message(run); await this.#ready(signal);
      const book = await this.#store.outreach(); const created: OutreachEntry[] = [];
      for (const contact of approvedPhones(contacts)) {
        signal?.throwIfAborted();
        if (matchingEntry(book, this.#sessionId, contact.value)) { await onProgress('WhatsApp introduction skipped: this sender already has a saved operation or opt-out for the contact.'); continue; }
        const availability = await this.#router.checkContact(contact.value, signal);
        if (!availability.onWhatsApp) { await onProgress('Public number is not available on WhatsApp; no message sent.'); continue; }
        await onProgress('Saving the exact WhatsApp introduction and request ID before sending.');
        signal?.throwIfAborted();
        const now = new Date().toISOString();
        const entry: OutreachEntry = {senderSessionId: this.#sessionId, to: contact.value, purpose,
          clientRequestId: randomUUID(), runId: run.id, contactId: contact.id, message, sourceUrls: sourceUrls(contact),
          status: 'pending', operationId: null, messageId: null, createdAt: now, updatedAt: now, replies: [],
          chatIds: availability.jid ? [availability.jid] : [],
        };
        book.entries.push(entry); await this.#store.saveOutreach(book); created.push(entry);
        try {
          await onProgress('Sending the explicitly reviewed WhatsApp draft using its saved request ID.');
          signal?.throwIfAborted();
          const response = await this.#router.send({to: entry.to, message: entry.message, clientRequestId: entry.clientRequestId}, signal);
          if (response.userId !== this.#sessionId || response.clientRequestId !== entry.clientRequestId || !response.operationId) throw new Error('Invalid send identity.');
          entry.operationId = response.operationId; entry.messageId = response.messageId;
          transition(entry, sendStatus(response.status));
        } catch (error) {
          transition(entry, error instanceof WhatsAppRouterError && !error.uncertain ? 'failed' : 'uncertain');
          await this.#store.saveOutreach(book);
          await onProgress(entry.status === 'uncertain' ? 'WhatsApp outcome uncertain. Reconcile the saved operation; it will not be resent automatically.' : 'WhatsApp send rejected. The saved request will not be retried automatically.');
          break;
        }
        await this.#store.saveOutreach(book);
        await onProgress(`WhatsApp introduction ${entry.status}; actual receipts determine delivery.`);
      }
      return created;
    });
  }

  async reconcile(signal?: AbortSignal): Promise<OutreachBook> {
    return this.#exclusive(async () => {
      signal?.throwIfAborted(); const book = await this.#store.outreach();
      for (const entry of book.entries.filter(item => item.senderSessionId === this.#sessionId && ['pending', 'accepted', 'uncertain'].includes(item.status))) {
        signal?.throwIfAborted();
        try {
          const operation = await this.#router.operation(entry.clientRequestId, signal);
          if (operation.userId !== this.#sessionId || operation.clientRequestId !== entry.clientRequestId) throw new Error('The router operation does not match its saved request.');
          entry.operationId = operation.operationId; entry.messageId = operation.messageId;
          transition(entry, sendStatus(operation.status), operation.updatedAt);
        } catch (error) {
          if (!(error instanceof WhatsAppRouterError) || error.code !== 'OPERATION_NOT_FOUND') throw error;
          transition(entry, 'uncertain');
        }
        await this.#store.saveOutreach(book);
      }
      return book;
    });
  }

  async refresh(phones: string[], signal?: AbortSignal): Promise<OutreachBook> {
    return this.#exclusive(async () => {
      signal?.throwIfAborted(); const book = await this.#store.outreach();
      const allowed = new Set(phones.filter(number => normalizeIndianPhone(number) === number));
      const entries = book.entries.filter(entry => entry.senderSessionId === this.#sessionId && allowed.has(entry.to));
      const selectedPhones = [...new Set(entries.map(entry => entry.to))].sort();
      if (!selectedPhones.length) return book;
      if (selectedPhones.length > 300) throw new Error('Refresh at most 300 selected outreach contacts at a time.');
      const cursorKey = this.#sessionId + ':' + createHash('sha256').update(selectedPhones.join(',')).digest('hex').slice(0, 24);
      const chatIds = [...new Set(entries.flatMap(entry => entry.chatIds ?? []))].slice(0, 300);
      for (let page = 0; page < 5; page++) {
        signal?.throwIfAborted(); const after = book.cursors[cursorKey];
        const response = await this.#router.events({phones: selectedPhones, chatIds, ...(after ? {after} : {}), limit: 100}, signal);
        for (const event of response.events) this.#event(entries, event);
        const next = response.nextCursor ?? response.events.at(-1)?.cursor;
        if (next) book.cursors[cursorKey] = next;
        await this.#store.saveOutreach(book);
        if (!response.nextCursor || response.nextCursor === after) break;
      }
      return book;
    });
  }

  #event(entries: OutreachEntry[], event: RouterEvent): void {
    if (event.userId !== this.#sessionId) return;
    if (event.type === 'message:status') {
      const receipt = event.data;
      const entry = entries.find(item => (receipt.clientRequestId === item.clientRequestId || (receipt.operationId !== null && receipt.operationId === item.operationId)
        || (item.messageId !== null && receipt.messageId === item.messageId))
        && (receipt.clientRequestId === null || receipt.clientRequestId === item.clientRequestId)
        && (receipt.operationId === null || item.operationId === null || receipt.operationId === item.operationId)
        && (item.messageId === null || receipt.messageId === item.messageId)
        && (receipt.chatId === item.to.slice(1) + '@s.whatsapp.net' || (item.chatIds ?? []).includes(receipt.chatId)));
      if (!entry) return;
      if (entry.messageId === null) entry.messageId = receipt.messageId;
      if (entry.operationId === null) entry.operationId = receipt.operationId;
      transition(entry, receipt.status, receipt.timestamp); return;
    }
    const message = event.data;
    const cardPhones = message.contacts.flatMap(contact => contact.phones).filter(number => normalizeIndianPhone(number) === number);
    const text = message.text ?? (cardPhones.length ? message.contacts.map(contact => [contact.displayName, ...contact.phones].filter(Boolean).join(': ')).join('\n') : '');
    if (message.fromMe || /@(?:g\.us|broadcast)$/.test(message.remoteJid) || /@(?:g\.us|broadcast)$/.test(message.chatId) || !text || text.length > 4096) return;
    const entry = entries.find(item => (message.senderPhone === item.to || message.chatId === item.to.slice(1) + '@s.whatsapp.net'
      || (item.chatIds ?? []).includes(message.chatId) || (item.chatIds ?? []).includes(message.remoteJid))
      && (message.senderPhone === null || message.senderPhone === item.to) && Date.parse(message.timestamp) >= Date.parse(item.createdAt));
    if (!entry || entry.replies.some(reply => reply.id === message.messageId)) return;
    entry.replies.push({id: message.messageId, text, occurredAt: message.timestamp});
    const directReferrals = [...referrals(text, message.messageId), ...cardPhones.map(phone => ({phone, raw: phone, sourceMessageId: message.messageId}))];
    entry.referrals = [...new Map([...(entry.referrals ?? []), ...directReferrals].map(item => [item.phone + ':' + item.sourceMessageId, item])).values()];
    entry.chatIds = [...new Set([...(entry.chatIds ?? []), message.chatId, message.remoteJid])];
    transition(entry, stopRequest(text) ? 'opted-out' : 'replied', message.timestamp);
  }
}
