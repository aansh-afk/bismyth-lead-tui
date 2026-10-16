import {readFile} from 'node:fs/promises';
import {sites} from './model.js';
import type {Site} from './model.js';
import {portalCatalog} from './portal-catalog.js';

export interface Adapter {
  site: Site; home: string; projectPattern: string;
  openLabels: string[]; submitLabels: string[]; successPattern: string;
  fields: Record<string, string[]>; openSelector?: string; submitSelector?: string;
  successSelector?: string; nextSelector?: string;
}
const commonFields = {
  name: ['input[name="name"]', 'input[autocomplete="name"]', 'input[placeholder*="name" i]'],
  phone: ['input[name="phone"]', 'input[name="mobile"]', 'input[type="tel"]', 'input[placeholder*="phone" i]', 'input[placeholder*="mobile" i]'],
  email: ['input[type="email"]', 'input[name="email"]', 'input[placeholder*="email" i]'],
};
const successPattern = '(thank you|thanks).{0,100}(enquir|interest|contact|request)|(?:enquir[yies]+|request|details).{0,60}(?:successfully (?:sent|submitted|shared)|has been (?:sent|submitted|shared))|(?:owner|advertiser|agent|seller|builder).{0,40}(?:will (?:contact|call)|contact you soon)';
export const adapters = Object.fromEntries(sites.map(site => {
  const definition = portalCatalog[site];
  return [site, {site, home: definition.home, projectPattern: definition.projectPattern,
    openLabels: definition.openLabels, submitLabels: definition.submitLabels, fields: structuredClone(commonFields), successPattern}];
})) as unknown as Record<Site, Adapter>;

export async function loadAdapters(path: string): Promise<Record<Site, Adapter>> {
  const result = structuredClone(adapters);
  if (!path) return result;
  const overrides = JSON.parse(await readFile(path, 'utf8')) as Record<string, Partial<Adapter>>;
  for (const [site, override] of Object.entries(overrides)) {
    if (!sites.includes(site as Site) || typeof override !== 'object' || override === null) throw new Error('Invalid adapter site: ' + site);
    const current = result[site as Site];
    result[site as Site] = {...current, ...override, site: current.site, home: current.home, fields: {...current.fields, ...override.fields}};
    new RegExp(result[site as Site].projectPattern);
    new RegExp(result[site as Site].successPattern, 'i');
  }
  return result;
}
