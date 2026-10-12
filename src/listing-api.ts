import {project} from './model.js';
import type {Project} from './model.js';

export interface HousingListingContext {
  site: 'housing'; endpoint: string; hash: string; service: 'buy' | 'rent';
  category: string; city: Record<string, unknown>; path: string; page?: number;
}
export interface NoBrokerListingContext {
  site: 'nobroker'; endpoint: string; params: Record<string, string>; page?: number;
}
export type PublicListingContext = HousingListingContext | NoBrokerListingContext;
export type ListingRequest = (input: string, init?: RequestInit) => Promise<Response>;
export interface PublicListingResult {
  projects: Project[]; complete: boolean; reason: string; requests: number; decodedBytes: number;
}

export const housingListingQuery = `query PublicListings($hash: String!, $service: String!, $category: String!, $city: CityInput, $pageInfo: PageInfoInput, $meta: JSON) {
  searchResults(hash: $hash, service: $service, category: $category, city: $city, pageInfo: $pageInfo, meta: $meta) {
    properties { url title listingId }
    meta
  }
}`;
const housingEndpoint = 'https://mightyzeus-mum.housing.com/api/gql';
const noBrokerEndpoint = 'https://www.nobroker.in/api/v3/multi/property/BUY/filter';
const maximumBodyBytes = 2 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validContext(context: PublicListingContext, limit: number): boolean {
  if (!record(context) || !Number.isInteger(limit) || limit < 1 || limit > 300) return false;
  if (context.page !== undefined && (!Number.isInteger(context.page) || context.page < 1)) return false;
  if (context.site === 'housing') {
    return context.endpoint === housingEndpoint && typeof context.hash === 'string' && Boolean(context.hash.trim())
      && ['buy', 'rent'].includes(context.service) && typeof context.category === 'string' && Boolean(context.category.trim())
      && record(context.city) && Object.keys(context.city).length > 0
      && typeof context.path === 'string' && /^\/(?!\/)/.test(context.path) && !/[\u0000-\u001f\\]/.test(context.path);
  }
  return context.site === 'nobroker' && context.endpoint === noBrokerEndpoint && record(context.params)
    && Object.values(context.params).every(value => typeof value === 'string')
    && typeof context.params.city === 'string' && Boolean(context.params.city.trim())
    && typeof context.params.searchParam === 'string' && Boolean(context.params.searchParam.trim());
}
function listingProject(site: PublicListingContext['site'], value: unknown): Project | undefined {
  if (!record(value)) return;
  const raw = site === 'housing' ? value.url : value.detailUrl;
  const title = site === 'housing' ? value.title : value.propertyTitle;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 8192 || /[\u0000-\u001f\\]/.test(raw)) return;
  try {
    const host = site === 'housing' ? 'housing.com' : 'nobroker.in';
    const url = new URL(raw, `https://${host}/`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || ![host, `www.${host}`].includes(url.hostname)) return;
    const pattern = site === 'housing'
      ? /^\/(?:in\/buy\/(?:projects|resale)\/page\/[^/]+|rent\/\d[^/]*)\/?$/
      : /^\/property\/buy\/[^/]+\/[^/]+\/detail\/?$/;
    if (!pattern.test(url.pathname)) return;
    url.hostname = site === 'housing' ? 'housing.com' : 'www.nobroker.in';
    return project(site, typeof title === 'string' ? title : '', url.href);
  } catch { return; }
}
async function responseText(response: Response, signal: AbortSignal, received: (bytes: number) => void): Promise<string> {
  if (!response.body) throw new Error('Empty listing response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      received(chunk.value.byteLength);
      if (bytes > maximumBodyBytes) {
        await reader.cancel();
        throw new Error('Listing response exceeds 2 MiB.');
      }
      parts.push(decoder.decode(chunk.value, {stream: true}));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally { reader.releaseLock(); }
}

export async function discoverPublicListings(
  context: PublicListingContext, limit: number, signal: AbortSignal,
  checkpoint: () => Promise<void>, request: ListingRequest = fetch,
): Promise<PublicListingResult> {
  const result: PublicListingResult = {projects: [], complete: false, reason: '', requests: 0, decodedBytes: 0};
  const finish = (reason: string, complete = false): PublicListingResult => ({...result, reason, complete});
  signal.throwIfAborted();
  if (!validContext(context, limit)) return finish('Unsupported public search context.');
  const found = new Map<string, Project>();
  const cursorKeys = new Set<string>();
  let cursor: Record<string, unknown> | undefined;
  let page = context.page ?? (context.site === 'nobroker' ? Number(context.params.pageNo || 1) : 1);
  if (!Number.isInteger(page) || page < 1) return finish('Invalid public search page.');
  const maximumRequests = Math.min(12, Math.ceil(limit / 30) + 2);
  for (let index = 0; index < maximumRequests; index++, page++) {
    signal.throwIfAborted();
    await checkpoint();
    signal.throwIfAborted();
    if (context.site === 'nobroker' && page > 2) return finish('NoBroker requires browser sign-in after page 2.');
    const requestController = new AbortController();
    const timeout = setTimeout(() => requestController.abort(new Error('Public listing request timed out.')), 15000);
    const requestSignal = AbortSignal.any([signal, requestController.signal]);
    let payload: unknown;
    try {
      const headers = {'Accept': 'application/json'};
      const options: RequestInit = {credentials: 'omit', redirect: 'error', signal: requestSignal, headers};
      let url = context.endpoint;
      if (context.site === 'housing') {
        const meta = {pagination_flow: page > 1 && !cursor, url: context.path, ...(cursor ? {api: cursor} : {})};
        options.method = 'POST';
        options.headers = {...headers, 'Content-Type': 'application/json'};
        options.body = JSON.stringify({query: housingListingQuery, variables: {
          hash: context.hash, service: context.service, category: context.category, city: context.city,
          pageInfo: {page, size: 30}, meta,
        }});
      } else {
        const parameters = new URLSearchParams(context.params);
        parameters.set('pageNo', String(page));
        url += '?' + parameters.toString();
      }
      result.requests++;
      const response = await request(url, options);
      requestSignal.throwIfAborted();
      if (!response.ok) {
        await response.body?.cancel();
        return finish('Public listings returned HTTP ' + response.status + '.');
      }
      const text = await responseText(response, requestSignal, bytes => result.decodedBytes += bytes);
      if (!text.trim()) return finish('Empty listing response.');
      try { payload = JSON.parse(text); }
      catch { return finish('Invalid listing JSON.'); }
    } catch (error) {
      signal.throwIfAborted();
      if (requestSignal.aborted) return finish('Public listing request timed out.');
      return finish(error instanceof Error && /^(Empty listing response|Listing response exceeds)/.test(error.message)
        ? error.message : 'Public listing request failed.');
    } finally { clearTimeout(timeout); }
    signal.throwIfAborted();
    if (!record(payload)) return finish('Invalid listing response shape.');
    let rows: unknown[];
    let metadata: unknown;
    if (context.site === 'housing') {
      if (payload.errors !== undefined && (!Array.isArray(payload.errors) || payload.errors.length > 0)) return finish('Housing returned GraphQL errors.');
      const searchResults = record(payload.data) ? payload.data.searchResults : undefined;
      if (!record(searchResults) || !Array.isArray(searchResults.properties)) return finish('Invalid Housing listing response.');
      rows = searchResults.properties;
      metadata = searchResults.meta;
    } else {
      for (const key of ['status', 'status_code', 'statusCode']) {
        const successful = key === 'status' ? [true, 200, '200', 'success', 'SUCCESS', 'ok', 'OK'] : [200, '200'];
        if (key in payload && !successful.some(value => value === payload[key])) return finish('NoBroker declined the listing request.');
      }
      if (!Array.isArray(payload.data)) return finish('Invalid NoBroker listing response.');
      rows = payload.data;
    }
    if (!rows.length) return finish('Public listing search exhausted.', true);
    const before = found.size;
    for (const row of rows) {
      const item = listingProject(context.site, row);
      if (item) found.set(item.id, item);
      if (found.size >= limit) break;
    }
    result.projects = [...found.values()];
    if (found.size >= limit) return finish('Public listing target reached.', true);
    if (found.size === before) return finish('Public listing page added no valid new projects.');
    if (context.site === 'housing') {
      if (!record(metadata) || !record(metadata.api) || !Object.keys(metadata.api).length) return finish('Housing pagination metadata unavailable.');
      const key = JSON.stringify(metadata.api);
      if (cursorKeys.has(key)) return finish('Housing pagination cursor repeated.');
      cursorKeys.add(key);
      cursor = metadata.api;
    }
  }
  return finish('Public listing request limit reached.');
}
