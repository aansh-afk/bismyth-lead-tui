import test from 'node:test';
import assert from 'node:assert/strict';
import {portalCatalog} from '../portal-catalog.js';
import {sites} from '../model.js';
import type {Site} from '../model.js';

test('every supported portal has bounded official navigation and a distinct send surface', () => {
  assert.deepEqual(Object.keys(portalCatalog), [...sites]);
  for (const site of sites) {
    const entry = portalCatalog[site];
    const home = new URL(entry.home);
    assert.equal(home.protocol, 'https:');
    assert.ok(entry.openLabels.length);
    assert.ok(entry.submitLabels.length);
    assert.ok(entry.evidenceUrls.length);
    assert.ok(!entry.submitLabels.some(label => /show number|view number|schedule|book|call seller|chat with seller/i.test(label)));
    for (const intent of ['buy', 'rent'] as const) {
      const url = new URL(entry.searchUrl('  Navi Mumbai  ', intent));
      assert.equal(url.origin, home.origin);
      assert.equal(url.search, '');
      assert.equal(url.hash, '');
      assert.equal(url.username, '');
      assert.match(url.pathname, /navi-mumbai/);
    }
  }
});

test('search city text cannot create an off-site URL, query, fragment, or credentials', () => {
  for (const entry of Object.values(portalCatalog)) {
    const url = new URL(entry.searchUrl(' Mumbai /?phone=123#@evil.example ', 'buy'));
    assert.equal(url.origin, new URL(entry.home).origin);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
    assert.equal(url.username, '');
    assert.throws(() => entry.searchUrl(' /?# ', 'buy'), /Choose an Indian city/);
  }
});

const listingExamples: Record<Site, string[]> = {
  '99acres': ['https://www.99acres.com/1-bhk-bedroom-apartment-flat-for-sale-in-mumbai-650-sq-ft-spid-B12345678'],
  nobroker: ['https://www.nobroker.in/property/buy/1-bhk-apartment-for-sale-in-kurla-east-mumbai/8a9f8c8390bc803c0190bc9baace05b1/detail', 'https://www.nobroker.in/new-projects-in-mumbai'],
  housing: ['https://housing.com/in/buy/resale/page/19401658-2-bhk-apartment-in-mumbai-for-rs-15000000', 'https://housing.com/rent/19401658-2-bhk-apartment-in-mumbai'],
  squareyards: ['https://www.squareyards.com/resale-1-5-bhk-500-sq-ft-apartment-in-chandiwala-pearl-heaven/10738754', 'https://www.squareyards.com/rental-2-bhk-794-sq-ft-apartment-in-sheth-auris-serenity-tower-3/10737263', 'https://www.squareyards.com/mumbai-residential-property/purva-estrella/343137/project'],
  magicbricks: ['https://www.magicbricks.com/propertyDetails/1-BHK-468-Sq-ft-Multistorey-Apartment-FOR-Sale-Vasai-in-Mumbai&id=4d423836393532363437', 'https://www.magicbricks.com/propertyDetails/1-BHK-468-Sq-ft-Multistorey-Apartment-FOR-Rent-Vasai-in-Mumbai&id=4d423836393532363437', 'https://www.magicbricks.com/windsor-grande-residences-andheri-west-mumbai-pdpid-4d4235303431303430'],
  olx: ['https://www.olx.in/item/for-sale-houses-apartments-c1725-2-bhk-flats-apartments-880-sq-ft-in-kalyan-east-mumbai-iid-1850164767', 'https://www.olx.in/item/for-rent-houses-apartments-c1723-2-bhk-flats-apartments-570-sq-ft-in-naigaon-east-mumbai-iid-1855241479'],
  quikr: ['https://www.quikr.com/homes/1-bhk-apartment-of-650sqft-for-sale-in-mumbai/p/375389152?source=qh', 'https://www.quikr.com/homes/project/pashmina-lake-riviera%2Bpowai%2Bmumbai%2B204224'],
};

test('listing patterns accept public detail shapes and reject navigation and search pages', () => {
  for (const site of sites) {
    const entry = portalCatalog[site];
    const pattern = new RegExp(entry.projectPattern, 'i');
    for (const example of listingExamples[site]) {
      // NoBroker's project search is a negative example, not a property.
      assert.equal(pattern.test(new URL(example).pathname), !example.endsWith('/new-projects-in-mumbai'), `${site}: ${example}`);
    }
    for (const path of ['/', '/contactus', '/user/my-portfolio', '/profile/myContacts', '/homes/city/mumbai', '/homes/property/residential-for-sale-in-Mumbai-cid_31', '/sale/property-for-sale-in-mumbai', '/sale/resale-properties-in-a-building-mumbai', '/property-for-sale-in-mumbai-pppfs', '/properties_c3/q-mumbai', '/item/used-phone-iid-123456', '/item/for-sale-houses-apartments-without-an-id']) {
      assert.equal(pattern.test(path), false, `${site} unexpectedly accepted ${path}`);
    }
  }
});

test('chat and phone reveal are separate from a verified enquiry or outbound message', () => {
  assert.equal(portalCatalog.olx.contactMode, 'chat');
  assert.deepEqual(portalCatalog.olx.submitLabels, ['Send']);
  assert.ok(portalCatalog.olx.searchNeedsSelection?.('Mumbai'));
  assert.equal(portalCatalog.quikr.searchNeedsSelection?.('Mumbai'), false);
  assert.equal(portalCatalog.quikr.searchNeedsSelection?.('Pune'), true);
  assert.match(portalCatalog.quikr.searchUrl('Mumbai', 'rent'), /residential-for-rent-in-Mumbai-cid_31$/);
  assert.deepEqual(portalCatalog.nobroker.contactHistoryPaths, ['/profile/myContacts']);
  assert.ok(!portalCatalog.nobroker.openLabels.some(label => /schedule|visit/i.test(label)));
});
