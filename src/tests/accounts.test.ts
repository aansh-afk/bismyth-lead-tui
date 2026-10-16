import test from 'node:test';
import assert from 'node:assert/strict';
import {accountPortalIds, accountStatusDetails, blankAccounts, normalizeAccounts, portalAccounts} from '../accounts.js';

test('all website accounts are separate from the three enquiry adapters', () => {
  assert.deepEqual(portalAccounts.map(item => item.id), [...accountPortalIds]);
  assert.deepEqual(portalAccounts.filter(item => item.integrated).map(item => item.id), ['99acres', 'nobroker', 'housing']);
  assert.deepEqual(blankAccounts().accounts.map(item => item.status), Array(7).fill('unchecked'));
  const first = blankAccounts(); first.accounts[0].status = 'skipped';
  assert.equal(blankAccounts().accounts[0].status, 'unchecked');
});

test('account metadata normalizes corrupt snapshots and drops credentials and identity text', () => {
  for (const value of [null, [], {version: 2, accounts: []}, {version: 1, accounts: 'bad'}]) assert.deepEqual(normalizeAccounts(value), blankAccounts());
  const timestamp = '2026-10-13T10:20:30.000Z';
  const saved = normalizeAccounts({version: 1, token: 'must not persist', accounts: [
    {portal: 'housing', status: 'signed-in', checkedAt: timestamp, detail: 'secret identity@example.test', cookie: 'session-secret', phone: '+919000000000'},
    {portal: 'housing', status: 'blocked', checkedAt: timestamp},
    {portal: 'olx', status: 'not-a-status', checkedAt: 'invalid'},
    {portal: 'foreign', status: 'signed-in', checkedAt: timestamp},
  ]});
  const housing = saved.accounts.find(item => item.portal === 'housing')!;
  assert.deepEqual(housing, {portal: 'housing', status: 'signed-in', checkedAt: timestamp, detail: accountStatusDetails['signed-in']});
  assert.deepEqual(saved.accounts.find(item => item.portal === 'olx'), blankAccounts().accounts.find(item => item.portal === 'olx'));
  assert.equal(JSON.stringify(saved).includes('secret'), false);
  assert.equal(JSON.stringify(saved).includes('identity@example'), false);
  assert.equal(saved.accounts.length, 7);
});

test('a signed-in snapshot without a valid observation time is not verified', () => {
  for (const checkedAt of [undefined, null, '', 'invalid', '2026-99-99T00:00:00.000Z']) {
    const snapshot = normalizeAccounts({version: 1, accounts: [{portal: '99acres', status: 'signed-in', checkedAt}]});
    assert.deepEqual(snapshot.accounts[0], {portal: '99acres', status: 'unknown', checkedAt: null, detail: accountStatusDetails.unknown});
  }
});
