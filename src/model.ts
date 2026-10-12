import {createHash, randomUUID} from 'node:crypto';
import {stateForCity, validLocation} from './locations.js';

export const sites = ['99acres', 'nobroker', 'housing'] as const;
export type Site = typeof sites[number];
export type ProjectStatus = 'queued' | 'working' | 'prepared' | 'submitted' | 'failed' | 'skipped' | 'uncertain';
export interface Config {
  stateCode: string; city: string; intent: 'buy' | 'rent'; name: string; email: string; phone: string;
  sites: Site[]; limit: number; delayMs: number; mode: 'preview' | 'submit';
  browserPath: string; seedUrls: string[]; adapterFile: string;
  layaEndpoint: string;
  extraFields: Record<string, string>;
}
export interface Project {
  id: string; site: Site; title: string; url: string; status: ProjectStatus;
  detail: string; updatedAt: string;
}
export interface Run {
  version: 1; id: string; createdAt: string; updatedAt: string;
  state: 'ready' | 'discovering' | 'running' | 'paused' | 'stopped' | 'complete';
  config: Config; projects: Project[]; events: {at: string; message: string}[];
}
export const defaults: Config = {
  stateCode: '', city: '', intent: 'buy', name: '', email: '', phone: '', sites: [...sites],
  limit: 100, delayMs: 3000, mode: 'preview', browserPath: '', seedUrls: [],
  adapterFile: '', extraFields: {}, layaEndpoint: '',
};
export function validateConfig(config: Config, contact = true): string[] {
  const errors: string[] = [];
  if (!config.city.trim()) errors.push('Enter a city/location.');
  else if (!validLocation(config.stateCode, config.city)) errors.push('Select an Indian state/UT and a city from its list.');
  if (!['buy', 'rent'].includes(config.intent)) errors.push('Intent must be buy or rent.');
  if (!['preview', 'submit'].includes(config.mode)) errors.push('Mode must be preview or submit.');
  if (!Number.isInteger(config.limit) || config.limit < 1 || config.limit > 300) errors.push('Batch size must be 1–300.');
  if (!Number.isInteger(config.delayMs) || config.delayMs < 0 || config.delayMs > 60000) errors.push('Delay must be 0–60000 ms.');
  if (!config.sites.length || config.sites.some(site => !sites.includes(site))) errors.push('Select at least one supported site.');
  if (contact) {
    if (!config.name.trim()) errors.push('Enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) errors.push('Enter a valid email.');
    if (!/^\+?[\d ()-]{8,20}$/.test(config.phone) || config.phone.replace(/\D/g, '').length < 8) errors.push('Enter a valid phone number.');
  }
  return errors;
}
export function canonicalUrl(raw: string): string {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an http(s) URL without credentials.');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid|fbclid|fltcnt|ref$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.href;
}
export function siteForUrl(raw: string): Site | undefined {
  const host = new URL(raw).hostname;
  return sites.find(site => host === ({'99acres': '99acres.com', nobroker: 'nobroker.in', housing: 'housing.com'}[site]) || host.endsWith('.' + ({'99acres': '99acres.com', nobroker: 'nobroker.in', housing: 'housing.com'}[site])));
}
export function project(site: Site, title: string, raw: string): Project {
  const url = canonicalUrl(raw);
  return {id: createHash('sha256').update(site + ':' + url).digest('hex').slice(0, 20), site, title: title.trim() || url, url, status: 'queued', detail: '', updatedAt: new Date().toISOString()};
}
export function createRun(config: Config): Run {
  const now = new Date().toISOString();
  return {version: 1, id: randomUUID(), createdAt: now, updatedAt: now, state: 'ready', config: structuredClone(config), projects: [], events: []};
}
export function contactKey(config: Config): string {
  const digits = config.phone.replace(/\D/g, '');
  const phone = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return createHash('sha256').update(phone + ':' + config.email.trim().toLowerCase()).digest('hex');
}
export function duplicateKey(config: Config, item: Project): string { return contactKey(config) + ':' + item.id; }
export function counts(run: Run): Record<ProjectStatus, number> {
  const result: Record<ProjectStatus, number> = {queued: 0, working: 0, prepared: 0, submitted: 0, failed: 0, skipped: 0, uncertain: 0};
  for (const item of run.projects) result[item.status]++;
  return result;
}
export function recoverRun(run: Run): Run {
  run.config.stateCode ||= stateForCity(run.config.city)?.code || '';
  // A process may have died after a submit click but before checkpointing.
  for (const item of run.projects) if (item.status === 'working') {
    item.status = 'uncertain'; item.detail = 'Interrupted while processing; inspect before retrying.';
  }
  if (['running', 'discovering', 'paused'].includes(run.state)) run.state = 'stopped';
  return run;
}
