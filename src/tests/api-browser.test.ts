import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PortalBrowser, browserPath} from '../browser.js';
import {defaults, createRun} from '../model.js';
import type {Site} from '../model.js';
import type {ListingRequest} from '../listing-api.js';
import {Runner} from '../runner.js';
import {Store} from '../store.js';

const housingSeed = 'https://housing.com/in/buy/mumbai/';
const housingState = {filters: {fParam: 'public-search-hash', service: 'buy', category: 'residential', selectedCity: {name: 'Mumbai', url: 'mumbai', cityId: 'city-id', id: 'region-id'}}, routeParams: {url: '/in/buy/mumbai/'}};
const housingRows = (page: number) => Array.from({length: 30}, (_, index) => ({url: `/in/buy/projects/page/${page * 100 + index}-fixture`, title: 'API property ' + index, listingId: String(page * 100 + index)}));

async function fixture(site: Site, seed: string, html: string, request: ListingRequest, limit: number, check: (driver: PortalBrowser, config: typeof defaults, store: Store) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'bismyth-api-browser-'));
  const config = {...defaults, stateCode: 'MH', city: 'Mumbai', seedUrls: [seed], sites: [site], browserPath: await browserPath(), limit};
  const driver = new PortalBrowser(directory, true, async () => { throw new Error('Discovery must not open contact controls'); }, undefined, request);
  try {
    const page = await driver.start(config);
    await page.route('https://**/*', route => route.fulfill({status: 200, contentType: 'text/html', body: html}));
    await check(driver, config, new Store(directory));
  } finally { await driver.close(); await rm(directory, {recursive: true, force: true}); }
}

test('browser discovery uses Housing GraphQL and saves its provenance without contacting sellers', {timeout: 30000}, async () => {
  const bodies: Record<string, unknown>[] = [];
  await fixture('housing', housingSeed, `<script>window.__INITIAL_STATE__=${JSON.stringify(housingState)}</script><button>Contact Sellers</button>`, async (url, options) => {
    assert.equal(url, 'https://mightyzeus-mum.housing.com/api/gql'); assert.equal(options?.credentials, 'omit');
    const body = JSON.parse(String(options?.body)) as {variables: {pageInfo: {page: number}; meta: {api?: {cursor?: string}}}};
    bodies.push(body);
    if (body.variables.pageInfo.page === 2) assert.equal(body.variables.meta.api?.cursor, 'cursor-1');
    return Response.json({data: {searchResults: {properties: housingRows(body.variables.pageInfo.page), meta: {api: {cursor: 'cursor-' + body.variables.pageInfo.page}}}}});
  }, 40, async (driver, config, store) => {
    const run = createRun(config); await new Runner(run, store, driver).discover();
    assert.equal(run.state, 'ready'); assert.equal(run.projects.length, 40); assert.equal(bodies.length, 2);
    assert.ok(run.projects.every(item => item.status === 'queued'));
    assert.ok(run.events.some(event => event.message.includes('public API found 40 properties in 2 requests')));
    assert.equal((await store.load(run.id)).projects.length, 40);
  });
});

test('NoBroker SEO search state is parsed as JSON and preserves filters in anonymous REST requests', {timeout: 30000}, async () => {
  const requests: URL[] = [];
  const state = {listPage: {canonicalUrl: {city: 'mumbai', canonicalURL: '/flats-for-sale-in-mumbai_mumbai', completeUrl: '/property/sale/mumbai/Mumbai?searchParam=public-filter&city=mumbai&propType=AP&minPrice=8000000'}}};
  await fixture('nobroker', 'https://www.nobroker.in/flats-for-sale-in-mumbai_mumbai', `<script>window.nb={}; nb.appState=${JSON.stringify(state)}; delete nb.appState;</script>`, async (url, options) => {
    const parsed = new URL(url); requests.push(parsed);
    assert.equal(parsed.pathname, '/api/v3/multi/property/BUY/filter'); assert.equal(parsed.searchParams.get('minPrice'), '8000000');
    assert.equal(parsed.searchParams.get('searchParam'), 'public-filter'); assert.equal(options?.credentials, 'omit');
    const page = Number(parsed.searchParams.get('pageNo'));
    return Response.json({status: 'success', statusCode: 200, data: Array.from({length: 2}, (_, index) => ({detailUrl: `/property/buy/flat-${page}-${index}/id-${page}-${index}/detail`, propertyTitle: `Flat ${page}/${index}`}))});
  }, 4, async (driver, config) => {
    const rows = await driver.discover(config, 'nobroker', 4, async () => {}, async () => 'skip');
    assert.equal(rows.length, 4); assert.deepEqual(requests.map(url => url.searchParams.get('pageNo')), ['1', '2']);
    assert.ok(rows.every(item => item.url.includes('/detail')));
  });
});

test('NoBroker canonical search URLs are not queued as property detail URLs', {timeout: 30000}, async () => {
  let requests = 0;
  const seed = 'https://www.nobroker.in/property/sale/mumbai/Mumbai?searchParam=public-filter&propType=AP';
  await fixture('nobroker', seed, '<script>window.nb={appState:{listPage:{}}}</script>', async () => {
    requests++; return Response.json({status: 'success', data: [{detailUrl: '/property/buy/flat/id/detail', propertyTitle: 'Actual listing'}]});
  }, 1, async (driver, config) => {
    const rows = await driver.discover(config, 'nobroker', 1, async () => {}, async () => 'skip');
    assert.equal(requests, 1); assert.equal(rows.length, 1); assert.match(rows[0].url, /\/buy\/flat\/id\/detail/);
  });
});

test('API partial failure merges current and later DOM listings instead of losing the queue', {timeout: 30000}, async () => {
  let requests = 0;
  const html = `<script>window.__INITIAL_STATE__=${JSON.stringify(housingState)};setTimeout(()=>{const link=document.createElement('a');link.href='/in/buy/projects/page/9002-later';link.textContent='Later DOM property';document.body.append(link)},800)</script><a href="/in/buy/projects/page/9001-visible">Visible DOM property</a>`;
  await fixture('housing', housingSeed, html, async () => {
    requests++;
    return requests === 1 ? Response.json({data: {searchResults: {properties: housingRows(1), meta: {api: {cursor: 'first'}}}}}) : new Response('unavailable', {status: 503});
  }, 40, async (driver, config) => {
    const rows = await driver.discover(config, 'housing', 40, async () => {}, async () => 'skip');
    assert.equal(rows.length, 32); assert.equal(new Set(rows.map(item => item.id)).size, 32);
    assert.ok(rows.some(item => item.url.endsWith('9001-visible'))); assert.ok(rows.some(item => item.url.endsWith('9002-later')));
    assert.ok(driver.takeDiscoveryNotes().some(note => note.includes('HTTP 503')));
  });
});

test('empty API results retain initial DOM listings', {timeout: 30000}, async () => {
  await fixture('housing', housingSeed, `<script>window.__INITIAL_STATE__=${JSON.stringify(housingState)}</script><a href="/in/buy/projects/page/9001-visible">Visible property</a>`, async () => Response.json({data: {searchResults: {properties: [], meta: {}}}}), 2, async (driver, config) => {
    const rows = await driver.discover(config, 'housing', 2, async () => {}, async () => 'skip');
    assert.equal(rows.length, 1); assert.ok(rows[0].url.endsWith('9001-visible'));
  });
});

test('mismatched city or malformed public state uses the existing DOM path', {timeout: 30000}, async () => {
  for (const state of [{...housingState, filters: {...housingState.filters, selectedCity: {...housingState.filters.selectedCity, name: 'Pune'}}}, {...housingState, routeParams: {url: 'https://['}}]) {
    await fixture('housing', housingSeed, `<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script><a href="/in/buy/projects/page/9001-visible">Visible property</a>`, async () => { throw new Error('Invalid state must not invoke API'); }, 2, async (driver, config) => {
      const rows = await driver.discover(config, 'housing', 2, async () => {}, async () => 'skip');
      assert.equal(rows.length, 1); assert.ok(driver.takeDiscoveryNotes().some(note => note.includes('context unavailable')));
    });
  }
});
