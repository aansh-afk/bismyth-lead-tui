export type RouterRequest = (url: string, init: RequestInit) => Promise<Response>;
export type RouterSendStatus = 'preview' | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'uncertain';
export interface RouterHealth {ok: boolean; apiVersion: '1'; ready: boolean}
export interface RouterSession {
  userId: string; name: string; status: 'pending' | 'connecting' | 'qr_ready' | 'connected' | 'disconnected' | 'logged_out';
  phone: string | null; updatedAt: string;
}
export interface RouterPairing {userId: string; qrRaw: string; expiresAt: string}
export interface NumberCheck {userId: string; phone: string; onWhatsApp: boolean; jid: string | null; checkedAt: string}
export interface WhatsAppDraft {to: string; message: string; clientRequestId: string}
export interface RouterSendResult {userId: string; clientRequestId: string; operationId: string | null; messageId: string | null; status: RouterSendStatus}
export interface RouterOperation extends Omit<RouterSendResult, 'operationId' | 'status'> {
  operationId: string; status: Exclude<RouterSendStatus, 'preview'>; updatedAt: string; errorCode: string | null;
}
export interface RouterMessage {
  messageId: string; chatId: string; remoteJid: string; fromMe: boolean; isHistorical: boolean;
  senderPhone: string | null; displayName: string | null; type: 'text' | 'contact' | 'contacts' | 'image' | 'audio' | 'other';
  text: string | null; contacts: {displayName: string | null; phones: string[]}[];
  timestamp: string; status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown';
}
export interface RouterReceipt {
  clientRequestId: string | null; operationId: string | null; messageId: string; chatId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'uncertain'; timestamp: string;
}
export type RouterEvent = {eventId: string; cursor: string; userId: string; occurredAt: string} & (
  {type: 'message'; data: RouterMessage} | {type: 'message:status'; data: RouterReceipt}
);
export interface RouterEvents {events: RouterEvent[]; nextCursor: string | null}
export interface RouterOptions {
  url: string; apiKey: string; sessionId: string; request?: RouterRequest; timeoutMs?: number;
}

/** An uncertain send must be resolved by its persisted clientRequestId; never resend automatically. */
export class WhatsAppRouterError extends Error {
  constructor(message: string, readonly code: string, readonly uncertain = false, readonly httpStatus?: number) {
    super(message); this.name = 'WhatsAppRouterError';
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const phonePattern = /^\+[1-9][0-9]{7,14}$/;
const sendStatuses: RouterSendStatus[] = ['preview', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'uncertain'];
const sessionStatuses: RouterSession['status'][] = ['pending', 'connecting', 'qr_ready', 'connected', 'disconnected', 'logged_out'];
const knownErrors = new Set(['INVALID_REQUEST', 'INVALID_PHONE', 'AUTH_REQUIRED', 'INVALID_API_KEY', 'SESSION_FORBIDDEN',
  'SESSION_NOT_FOUND', 'OPERATION_NOT_FOUND', 'SESSION_NOT_CONNECTED', 'ALREADY_CONNECTED', 'IDEMPOTENCY_CONFLICT',
  'CURSOR_EXPIRED', 'RATE_LIMITED', 'ROUTER_NOT_READY', 'TRANSPORT_UNAVAILABLE']);
const maxResponseBytes = 1_048_576;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object.');
  return value as Record<string, unknown>;
}
function string(value: unknown, maximum = 4096): value is string { return typeof value === 'string' && value.length > 0 && value.length <= maximum; }
function nullableString(value: unknown, maximum = 4096): value is string | null { return value === null || (typeof value === 'string' && value.length <= maximum); }
function date(value: unknown): value is string { return string(value, 64) && Number.isFinite(Date.parse(value)); }
function uuid(value: unknown): value is string { return typeof value === 'string' && uuidPattern.test(value); }
function phone(value: unknown): value is string { return typeof value === 'string' && phonePattern.test(value); }
function nullablePhone(value: unknown): value is string | null { return value === null || phone(value); }
function assert(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid router response.'); }
function validCursor(value: unknown): value is string | null { return value === null || (string(value, 2048) && !/[\u0000-\u001f\u007f]/.test(value)); }
function pageLimit(value = 50): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new WhatsAppRouterError('Choose a page size from 1 to 100.', 'INVALID_REQUEST');
  return value;
}

function parseMessage(value: unknown): RouterMessage {
  const item = object(value);
  assert(string(item.messageId) && string(item.chatId) && string(item.remoteJid));
  assert(typeof item.fromMe === 'boolean' && typeof item.isHistorical === 'boolean');
  assert(nullablePhone(item.senderPhone) && nullableString(item.displayName) && nullableString(item.text));
  assert(['text', 'contact', 'contacts', 'image', 'audio', 'other'].includes(String(item.type)));
  assert(['pending', 'sent', 'delivered', 'read', 'failed', 'unknown'].includes(String(item.status)) && date(item.timestamp));
  assert(Array.isArray(item.contacts) && item.contacts.length <= 100);
  for (const card of item.contacts) {
    const contact = object(card);
    assert(nullableString(contact.displayName) && Array.isArray(contact.phones) && contact.phones.length <= 100 && contact.phones.every(phone));
  }
  return item as unknown as RouterMessage;
}

/** Contract-v1 client for an existing self-hosted sender session. It never creates or resets sessions. */
export class WhatsAppRouter {
  readonly #origin: string;
  readonly #apiKey: string;
  readonly #sessionId: string;
  readonly #request: RouterRequest;
  readonly #timeoutMs: number;

  constructor(options: RouterOptions) {
    let url: URL;
    try { url = new URL(options.url); }
    catch { throw new WhatsAppRouterError('Set a valid WhatsApp router URL.', 'INVALID_SETTINGS'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new WhatsAppRouterError('Use an HTTPS router origin, or HTTP on localhost, without credentials, path or query.', 'INVALID_SETTINGS');
    }
    if (!string(options.apiKey, 4096) || /[\u0000-\u0020\u007f]/.test(options.apiKey) || !uuid(options.sessionId)) {
      throw new WhatsAppRouterError('Set the router API key and a valid sender-session UUID locally.', 'INVALID_SETTINGS');
    }
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000)) {
      throw new WhatsAppRouterError('Router timeout must be from 1 to 60000 ms.', 'INVALID_SETTINGS');
    }
    this.#origin = url.origin; this.#apiKey = options.apiKey; this.#sessionId = options.sessionId;
    this.#request = options.request ?? fetch; this.#timeoutMs = options.timeoutMs ?? 15_000;
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env, options: Pick<RouterOptions, 'request' | 'timeoutMs'> = {}): WhatsAppRouter | undefined {
    const url = env.BISMYTH_WHATSAPP_ROUTER_URL;
    const apiKey = env.BISMYTH_WHATSAPP_ROUTER_API_KEY;
    const sessionId = env.BISMYTH_WHATSAPP_SESSION_ID;
    if (!url && !apiKey && !sessionId) return undefined;
    if (!url || !apiKey || !sessionId) throw new WhatsAppRouterError('Set BISMYTH_WHATSAPP_ROUTER_URL, BISMYTH_WHATSAPP_ROUTER_API_KEY and BISMYTH_WHATSAPP_SESSION_ID locally.', 'INVALID_SETTINGS');
    return new WhatsAppRouter({url, apiKey, sessionId, ...options});
  }

  async #call<T>(path: string, parse: (body: unknown) => T, signal?: AbortSignal, body?: unknown, liveSend = false): Promise<T> {
    if (signal?.aborted) throw new WhatsAppRouterError('WhatsApp router request was cancelled before dispatch.', 'REQUEST_CANCELLED');
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const response = await this.#request(this.#origin + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', signal: activeSignal,
        headers: {'Accept': 'application/json', 'X-API-Key': this.#apiKey, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      });
      if (!response.ok) {
        // Error bodies can contain secrets or chat text; neither is propagated to logs/UI.
        let code = 'ROUTER_ERROR';
        try {
          const bytes = await readBounded(response);
          const reported = object(object(JSON.parse(bytes)).error).code;
          if (typeof reported === 'string' && knownErrors.has(reported)) code = reported;
        } catch { /* Keep a generic, local error. */ }
        throw new WhatsAppRouterError(`WhatsApp router rejected the request (HTTP ${response.status}; ${code}).`, code, liveSend && response.status >= 500, response.status);
      }
      const text = await readBounded(response);
      try { return parse(JSON.parse(text)); }
      catch { throw new WhatsAppRouterError('WhatsApp router returned an invalid contract-v1 response.', 'INVALID_RESPONSE', liveSend); }
    } catch (error) {
      if (error instanceof WhatsAppRouterError) throw error;
      throw new WhatsAppRouterError(liveSend ? 'WhatsApp send outcome is uncertain. Check the existing operation before any retry.' : 'WhatsApp router request failed or timed out.', 'REQUEST_FAILED', liveSend);
    }
  }

  async status(signal?: AbortSignal): Promise<{health: RouterHealth; session: RouterSession}> {
    const health = await this.#call('/api/health', body => {
      const value = object(body); assert(typeof value.ok === 'boolean' && value.apiVersion === '1' && typeof value.ready === 'boolean');
      return value as unknown as RouterHealth;
    }, signal);
    const session = await this.#call(`/api/auth/status/${this.#sessionId}`, body => {
      const value = object(body);
      assert(value.userId === this.#sessionId && string(value.name, 100) && sessionStatuses.includes(value.status as RouterSession['status']));
      assert(nullablePhone(value.phone) && date(value.updatedAt));
      return value as unknown as RouterSession;
    }, signal);
    return {health, session};
  }

  async pairing(signal?: AbortSignal): Promise<RouterPairing> {
    return this.#call(`/api/auth/qr/${this.#sessionId}`, body => {
      const value = object(body); assert(value.userId === this.#sessionId && string(value.qrRaw, 16_384) && date(value.expiresAt));
      return value as unknown as RouterPairing;
    }, signal);
  }

  /** Availability only: this does not establish listing ownership or consent. */
  async checkContact(number: string, signal?: AbortSignal): Promise<NumberCheck> {
    this.#phone(number);
    return this.#call(`/api/contacts/${this.#sessionId}/check/${encodeURIComponent(number)}`, body => {
      const value = object(body);
      assert(value.userId === this.#sessionId && value.phone === number && typeof value.onWhatsApp === 'boolean' && nullableString(value.jid) && date(value.checkedAt));
      return value as unknown as NumberCheck;
    }, signal);
  }

  async preview(draft: WhatsAppDraft, signal?: AbortSignal): Promise<RouterSendResult> { return this.#send(draft, true, signal); }

  /** Caller must durably save draft.clientRequestId + exact payload before calling. No automatic retries. */
  async send(draft: WhatsAppDraft, signal?: AbortSignal): Promise<RouterSendResult> { return this.#send(draft, false, signal); }

  async #send(draft: WhatsAppDraft, dryRun: boolean, signal?: AbortSignal): Promise<RouterSendResult> {
    this.#phone(draft.to);
    if (!uuid(draft.clientRequestId) || !string(draft.message, 4000) || !draft.message.trim()) {
      throw new WhatsAppRouterError('Provide a persisted request UUID and a message of 1–4000 characters.', 'INVALID_REQUEST');
    }
    return this.#call('/api/messages/send', body => {
      const value = object(body);
      this.#result(value, draft.clientRequestId);
      if (dryRun) assert(value.status === 'preview' && value.operationId === null && value.messageId === null);
      else assert(value.status !== 'preview' && uuid(value.operationId));
      return value as unknown as RouterSendResult;
    }, signal, {userId: this.#sessionId, to: draft.to, message: draft.message, clientRequestId: draft.clientRequestId, dryRun}, !dryRun);
  }

  async operation(clientRequestId: string, signal?: AbortSignal): Promise<RouterOperation> {
    if (!uuid(clientRequestId)) throw new WhatsAppRouterError('Provide the original request UUID.', 'INVALID_REQUEST');
    return this.#call(`/api/operations/by-client-request/${this.#sessionId}/${clientRequestId}`, body => {
      const value = object(body); this.#result(value, clientRequestId);
      assert(value.status !== 'preview' && uuid(value.operationId) && date(value.updatedAt) && nullableString(value.errorCode));
      return value as unknown as RouterOperation;
    }, signal);
  }

  /** Fetch one bounded page; advance nextCursor even when unrelated personal-chat events are discarded. */
  async events(options: {after?: string; phones: string[]; chatIds?: string[]; limit?: number}, signal?: AbortSignal): Promise<RouterEvents> {
    if (options.phones.length > 300 || (options.chatIds?.length ?? 0) > 300) throw new WhatsAppRouterError('Select at most 300 outreach contacts.', 'INVALID_REQUEST');
    options.phones.forEach(number => this.#phone(number));
    if (options.after !== undefined && !validCursor(options.after)) throw new WhatsAppRouterError('Use the saved event cursor.', 'INVALID_REQUEST');
    const query = new URLSearchParams({limit: String(pageLimit(options.limit))});
    if (options.after !== undefined) query.set('after', options.after);
    const numbers = new Set(options.phones);
    const chats = new Set([...(options.chatIds ?? []), ...options.phones.map(number => number.slice(1) + '@s.whatsapp.net')]);
    if ([...chats].some(chat => !string(chat))) throw new WhatsAppRouterError('Use valid selected chat identifiers.', 'INVALID_REQUEST');
    return this.#call(`/api/events/${this.#sessionId}?${query}`, body => {
      const page = object(body); assert(Array.isArray(page.events) && page.events.length <= pageLimit(options.limit) && validCursor(page.nextCursor));
      const events: RouterEvent[] = [];
      for (const raw of page.events) {
        const event = object(raw);
        assert(uuid(event.eventId) && string(event.cursor, 2048) && event.userId === this.#sessionId && date(event.occurredAt));
        if (event.type === 'message') {
          const message = parseMessage(event.data);
          // A selected contact's group/broadcast activity is not an outreach conversation.
          if (/@(?:g\.us|broadcast)$/.test(message.remoteJid)) continue;
          if ((message.senderPhone && numbers.has(message.senderPhone)) || chats.has(message.chatId) || chats.has(message.remoteJid)) {
            events.push(event as unknown as RouterEvent);
          }
        } else if (event.type === 'message:status') {
          const receipt = object(event.data);
          assert((receipt.clientRequestId === null || uuid(receipt.clientRequestId)) && (receipt.operationId === null || uuid(receipt.operationId)));
          assert(string(receipt.messageId) && string(receipt.chatId) && date(receipt.timestamp));
          assert(['sent', 'delivered', 'read', 'failed', 'uncertain'].includes(String(receipt.status)));
          if (chats.has(receipt.chatId as string)) events.push(event as unknown as RouterEvent);
        } else {
          assert(event.type === 'connection' || event.type === 'qr');
        }
      }
      return {events, nextCursor: page.nextCursor};
    }, signal);
  }

  async history(chatId: string, options: {before?: string; limit?: number} = {}, signal?: AbortSignal): Promise<{messages: RouterMessage[]; nextCursor: string | null}> {
    if (!string(chatId) || (options.before !== undefined && !validCursor(options.before))) throw new WhatsAppRouterError('Choose a selected outreach chat and saved cursor.', 'INVALID_REQUEST');
    const query = new URLSearchParams({limit: String(pageLimit(options.limit))});
    if (options.before !== undefined) query.set('before', options.before);
    return this.#call(`/api/chats/${this.#sessionId}/${encodeURIComponent(chatId)}/messages?${query}`, body => {
      const page = object(body); assert(Array.isArray(page.messages) && page.messages.length <= pageLimit(options.limit) && validCursor(page.nextCursor));
      const messages = page.messages.map(parseMessage);
      assert(messages.every(message => message.chatId === chatId));
      return {messages, nextCursor: page.nextCursor};
    }, signal);
  }

  #phone(number: string): void { if (!phone(number)) throw new WhatsAppRouterError('Use an international phone number beginning with + and country code.', 'INVALID_PHONE'); }
  #result(value: Record<string, unknown>, clientRequestId: string): void {
    assert(value.userId === this.#sessionId && value.clientRequestId === clientRequestId && nullableString(value.messageId));
    assert(sendStatuses.includes(value.status as RouterSendStatus));
  }
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxResponseBytes) throw new Error('Response too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxResponseBytes) throw new Error('Response too large.');
      chunks.push(chunk.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

/** Render only the approved introduction. Sender identity is supplied by the saved user profile. */
export function renderManagerIntroduction(input: {senderName: string; senderBusiness: string; contactName?: string}): string {
  const senderName = input.senderName.trim(); const senderBusiness = input.senderBusiness.trim();
  const contactName = input.contactName?.trim();
  if (!senderName || !senderBusiness || [senderName, senderBusiness, contactName ?? ''].some(value => /[\r\n\u0000-\u001f\u007f]/.test(value) || value.length > 150)) {
    throw new WhatsAppRouterError('Set your name and business before preparing an introduction.', 'INVALID_REQUEST');
  }
  return `Hi${contactName ? ' ' + contactName : ''}, ${senderName} here from ${senderBusiness}. I'm reaching out about Atlas for real-estate sales operations and business partnerships. Are you the right person to speak with, or could you introduce me to your sales manager, agency owner or business head?\n\nYou're welcome to forward this message. If they're happy to be contacted, their official work number would help. Thanks!`;
}
