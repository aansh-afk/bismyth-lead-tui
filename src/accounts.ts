import type {Site} from './model.js';

export const accountPortalIds = ['99acres', 'nobroker', 'housing', 'squareyards', 'magicbricks', 'olx', 'quikr'] as const;
export type AccountPortal = typeof accountPortalIds[number];
export type AccountStatus = 'unchecked' | 'signed-in' | 'signed-out' | 'unknown' | 'blocked' | 'skipped';
export interface PortalAccount {portal: AccountPortal; status: AccountStatus; checkedAt: string | null; detail: string}
export interface AccountSnapshot {version: 1; accounts: PortalAccount[]}

export const portalAccounts: readonly {id: AccountPortal; label: string; url: string; integrated: boolean}[] = [
  {id: '99acres', label: '99acres', url: 'https://www.99acres.com/', integrated: true},
  {id: 'nobroker', label: 'NoBroker', url: 'https://www.nobroker.in/', integrated: true},
  {id: 'housing', label: 'Housing', url: 'https://housing.com/', integrated: true},
  {id: 'squareyards', label: 'Square Yards', url: 'https://www.squareyards.com/', integrated: true},
  {id: 'magicbricks', label: 'Magicbricks', url: 'https://www.magicbricks.com/', integrated: true},
  {id: 'olx', label: 'OLX', url: 'https://www.olx.in/', integrated: true},
  {id: 'quikr', label: 'Quikr', url: 'https://www.quikr.com/', integrated: true},
];

const statuses: readonly AccountStatus[] = ['unchecked', 'signed-in', 'signed-out', 'unknown', 'blocked', 'skipped'];
export const accountStatusDetails: Readonly<Record<AccountStatus, string>> = {
  unchecked: 'Not checked yet. Open this website to sign in.',
  'signed-in': 'A visible signed-in account control was found. Sessions can expire; recheck before use.',
  'signed-out': 'The website is asking you to sign in. Complete login in Chrome, then check again.',
  unknown: 'Login could not be confirmed. Open the account menu in Chrome, then check again.',
  blocked: 'The website requires a security check in Chrome. Complete it there, then check again.',
  skipped: 'Skipped for now. You can open this website later.',
};

export function blankAccounts(): AccountSnapshot {
  return {version: 1, accounts: accountPortalIds.map(portal => ({portal, status: 'unchecked', checkedAt: null, detail: accountStatusDetails.unchecked}))};
}

/** Only persist observation metadata. Browser credentials stay in browser-profile. */
export function normalizeAccounts(value: unknown): AccountSnapshot {
  const result = blankAccounts();
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('accounts' in value) || !Array.isArray(value.accounts)) return result;
  const seen = new Set<AccountPortal>();
  for (const entry of value.accounts) {
    if (!entry || typeof entry !== 'object' || !accountPortalIds.includes(entry.portal) || seen.has(entry.portal)) continue;
    const account = result.accounts.find(item => item.portal === entry.portal)!;
    seen.add(account.portal);
    if (statuses.includes(entry.status)) account.status = entry.status;
    if (typeof entry.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.checkedAt) && Number.isFinite(Date.parse(entry.checkedAt))) account.checkedAt = entry.checkedAt;
    if (account.status === 'signed-in' && !account.checkedAt) account.status = 'unknown';
    // Never copy arbitrary labels or account identifiers into the saved metadata.
    account.detail = accountStatusDetails[account.status];
  }
  return result;
}

/** Discovery uses only supported portals with a recorded signed-in observation. */
export function discoveryAccess(selected: readonly Site[], snapshot: AccountSnapshot): {allowed: Site[]; skipped: Site[]} {
  const signedIn = new Set(normalizeAccounts(snapshot).accounts.filter(account => account.status === 'signed-in').map(account => account.portal));
  const allowed: Site[] = [];
  const skipped: Site[] = [];
  for (const site of new Set(selected)) {
    (signedIn.has(site) && portalAccounts.some(account => account.id === site && account.integrated) ? allowed : skipped).push(site);
  }
  return {allowed, skipped};
}
