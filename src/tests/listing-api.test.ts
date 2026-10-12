import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {once} from 'node:events';
import {discoverPublicListings, housingListingQuery} from '../listing-api.js';
import type {HousingListingContext, ListingRequest, NoBrokerListingContext, PublicListingContext} from '../listing-api.js';
import {project} from '../model.js';

const housing: HousingListingContext = {
  site: 'housing', endpoint: 'https://mightyzeus-mum.housing.com/api/gql', hash: 'observed-city-hash',
  service: 'buy', category: 'residential', city: {name: 'Mumbai', id: 'city-id'}, path: '/in/buy/mumbai/',
};
const noBroker: NoBrokerListingContext = {
  site: 'nobroker', endpoint: 'https://www.nobroker.in/api/v3/multi/property/BUY/filter',
  params: {city: 'mumbai', propType: 'AP', searchParam: JSON.stringify([{lat: 19.1, lon: 72.9, placeId: 'observed-place'}]), pageNo: '1', filter: 'a b&c'},
};
const activeSignal = (): AbortSignal => new AbortController().signal;
const checkpoint = async (): Promise<void> => {};
const housingRow = (index: number) => ({url: `/in/buy/resale/page/${index}-fixture`, title: `Housing ${index}`, listingId: `untrusted-${index}`, status: 'submitted'});
const noBrokerRow = (index: number) => ({detailUrl: `/property/buy/fixture-${index}/id-${index}/detail`, propertyTitle: `NoBroker ${index}`, url: '/repeated/search/path', id: `untrusted-${index}`, status: 'submitted'});
const housingResponse = (properties: unknown[], api: unknown = {offset: 30}) => ({data: {searchResults: {properties, meta: {api}}}});

async function httpFixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  run: (request: ListingRequest, observed: {input: string; init?: RequestInit}[]) => Promise<void>,
): Promise<void> {
  const observed: {input: string; init?: RequestInit}[] = [];
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => { response.statusCode = 500; response.end(); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const request: ListingRequest = async (input, init) => {
    observed.push({input, init});
    const original = new URL(input);
    return fetch(`http://127.0.0.1:${address.port}${original.pathname}${original.search}`, init);
  };
  try { await run(request, observed); }
  finally {
    const closed = once(server, 'close');
    server.closeAllConnections();
    server.close();
    await closed;
  }
}
async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(Buffer.from(part));
  return JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown>;
}

test('Housing native HTTP discovery carries observed cursor, limits results and never sends credentials', async () => {
  const bodies: Record<string, unknown>[] = [];
  let checkpoints = 0;
  await httpFixture(async (request, response) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
    const body = await jsonBody(request); bodies.push(body);
    const start = bodies.length === 1 ? 1 : 31;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(housingResponse(Array.from({length: 30}, (_, offset) => housingRow(start + offset)), {offset: start + 29, nested: {cursor: `page-${bodies.length}`}})));
  }, async (request, observed) => {
    const result = await discoverPublicListings(housing, 35, activeSignal(), async () => { checkpoints++; }, request);
    assert.equal(result.complete, true);
    assert.equal(result.projects.length, 35);
    assert.equal(result.requests, 2);
    assert.equal(checkpoints, 2);
    assert.ok(result.decodedBytes > 0);
    assert.equal(new Set(result.projects.map(item => item.id)).size, 35);
    assert.deepEqual(result.projects[0], {...project('housing', 'Housing 1', 'https://housing.com/in/buy/resale/page/1-fixture'), updatedAt: result.projects[0].updatedAt});
    assert.equal(result.projects[0].status, 'queued');
    assert.equal(bodies[0].query, housingListingQuery);
    for (const observedRequest of observed) {
      assert.equal(observedRequest.input, housing.endpoint);
      assert.equal(observedRequest.init?.credentials, 'omit');
      assert.equal(observedRequest.init?.redirect, 'error');
      assert.ok(observedRequest.init?.signal instanceof AbortSignal);
      assert.deepEqual(Object.keys(observedRequest.init!.headers as object).sort(), ['Accept', 'Content-Type']);
    }
  });
  assert.deepEqual(bodies[0].variables, {
    hash: housing.hash, service: 'buy', category: 'residential', city: housing.city,
    pageInfo: {page: 1, size: 30}, meta: {pagination_flow: false, url: housing.path},
  });
  assert.deepEqual((bodies[1].variables as Record<string, unknown>).meta, {
    pagination_flow: false, url: housing.path, api: {offset: 30, nested: {cursor: 'page-1'}},
  });
  assert.deepEqual((bodies[1].variables as Record<string, unknown>).pageInfo, {page: 2, size: 30});
});

test('Housing uses pagination_flow when starting on an observed later page and recognises empty exhaustion', async () => {
  let body: Record<string, unknown> | undefined;
  const result = await discoverPublicListings({...housing, page: 4}, 50, activeSignal(), checkpoint, async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json(housingResponse([]));
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.projects, []);
  assert.equal(result.requests, 1);
  assert.deepEqual((body!.variables as Record<string, unknown>).pageInfo, {page: 4, size: 30});
  assert.deepEqual((body!.variables as Record<string, unknown>).meta, {pagination_flow: true, url: housing.path});
});

test('Housing stops repeated cursors and duplicate pages while retaining valid partial listings', async () => {
  for (const repeatedRows of [false, true]) {
    let requests = 0;
    const result = await discoverPublicListings(housing, 90, activeSignal(), checkpoint, async () => {
      requests++;
      return Response.json(housingResponse([housingRow(repeatedRows || requests === 1 ? 1 : 2)], {cursor: 'same'}));
    });
    assert.equal(result.complete, false);
    assert.equal(result.requests, 2);
    assert.equal(result.projects.length, repeatedRows ? 1 : 2);
    assert.match(result.reason, repeatedRows ? /no valid new projects/ : /cursor repeated/);
  }
});

test('Housing pagination cannot exceed its request budget', async () => {
  let calls = 0;
  const result = await discoverPublicListings(housing, 300, activeSignal(), checkpoint, async () => {
    calls++;
    return Response.json(housingResponse([housingRow(calls)], {offset: calls}));
  });
  assert.equal(result.complete, false);
  assert.equal(result.requests, 12);
  assert.equal(result.projects.length, 12);
  assert.match(result.reason, /request limit/);
});

test('NoBroker preserves observed filters, uses detailUrl and respects its anonymous two-page limit', async () => {
  const parameters: URLSearchParams[] = [];
  await httpFixture((request, response) => {
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
    const query = new URL(request.url!, 'http://fixture.test').searchParams; parameters.push(query);
    const index = Number(query.get('pageNo'));
    response.end(JSON.stringify({status: 'success', status_code: 200, statusCode: '200', data: [noBrokerRow(index)]}));
  }, async (request, observed) => {
    const result = await discoverPublicListings(noBroker, 3, activeSignal(), checkpoint, request);
    assert.equal(result.complete, false);
    assert.equal(result.projects.length, 2);
    assert.equal(result.requests, 2);
    assert.match(result.reason, /sign-in after page 2/);
    assert.equal(result.projects[0].url, 'https://www.nobroker.in/property/buy/fixture-1/id-1/detail');
    assert.equal(result.projects[0].title, 'NoBroker 1');
    assert.equal(result.projects[0].status, 'queued');
    assert.equal(observed[0].init?.credentials, 'omit');
    assert.equal(observed[0].init?.redirect, 'error');
  });
  assert.deepEqual(parameters.map(query => query.get('pageNo')), ['1', '2']);
  for (const query of parameters) {
    for (const [key, value] of Object.entries(noBroker.params)) if (key !== 'pageNo') assert.equal(query.get(key), value);
  }
  const result = await discoverPublicListings({...noBroker, page: 3}, 1, activeSignal(), checkpoint, async () => { throw new Error('Must not fetch page 3.'); });
  assert.equal(result.requests, 0);
  assert.match(result.reason, /sign-in/);
});

test('NoBroker starts from the observed pageNo and completes when its safe target is reached', async () => {
  const result = await discoverPublicListings({...noBroker, params: {...noBroker.params, pageNo: '2'}}, 1, activeSignal(), checkpoint, async input => {
    assert.equal(new URL(input).searchParams.get('pageNo'), '2');
    return Response.json({data: [noBrokerRow(2), noBrokerRow(3)]});
  });
  assert.equal(result.complete, true);
  assert.equal(result.projects.length, 1);
  assert.equal(result.requests, 1);
});

test('Public API rows cannot inject unsupported URLs, credentials, IDs or processing status', async () => {
  const badUrls = [
    'https://evil.test/in/buy/resale/page/1-fixture', 'https://housing.com.evil.test/in/buy/resale/page/1-fixture',
    'https://user:password@housing.com/in/buy/resale/page/1-fixture', 'javascript:alert(1)',
    'http://housing.com/in/buy/resale/page/1-fixture', 'https://housing.com:8443/in/buy/resale/page/1-fixture',
    'https://housing.com/login', 'https://housing.com/in/buy/mumbai/',
  ];
  const rows = badUrls.map(url => ({...housingRow(1), url}));
  rows.push({...housingRow(5), url: 'https://www.housing.com/in/buy/resale/page/5-fixture/?utm_source=api#external'});
  rows.push(housingRow(5));
  const result = await discoverPublicListings(housing, 10, activeSignal(), checkpoint, async () => Response.json(housingResponse(rows, null)));
  assert.equal(result.complete, false);
  assert.equal(result.projects.length, 1);
  const expected = project('housing', 'Housing 5', 'https://housing.com/in/buy/resale/page/5-fixture');
  assert.equal(result.projects[0].id, expected.id);
  assert.equal(result.projects[0].url, expected.url);
  assert.equal(result.projects[0].status, 'queued');
  assert.match(result.reason, /metadata unavailable/);
  const noBrokerResult = await discoverPublicListings(noBroker, 2, activeSignal(), checkpoint, async () => Response.json({data: [
    {...noBrokerRow(1), detailUrl: 'https://evil.test/property/buy/a/b/detail'},
    {...noBrokerRow(2), detailUrl: undefined},
  ]}));
  assert.deepEqual(noBrokerResult.projects, []);
  assert.match(noBrokerResult.reason, /no valid new projects/);
});

test('Unsupported context and limits never make a public request', async () => {
  let requests = 0;
  const request: ListingRequest = async () => { requests++; throw new Error('Not expected.'); };
  const contexts: PublicListingContext[] = [
    {...housing, endpoint: 'https://evil.test/api/gql'}, {...housing, hash: ''}, {...housing, city: {}},
    {...housing, path: '//evil.test/search'}, {...housing, page: 0},
    {...noBroker, endpoint: noBroker.endpoint + '/private'}, {...noBroker, params: {city: 'mumbai'}},
  ];
  for (const context of contexts) {
    const result = await discoverPublicListings(context, 10, activeSignal(), checkpoint, request);
    assert.equal(result.complete, false);
    assert.equal(result.requests, 0);
  }
  for (const limit of [0, -1, 301, 1.5]) assert.equal((await discoverPublicListings(housing, limit, activeSignal(), checkpoint, request)).complete, false);
  assert.equal(requests, 0);
});

test('HTTP refusal, redirects, malformed JSON and failed GraphQL/REST shapes trigger fallback', async () => {
  const cases: {context: PublicListingContext; response: () => Response; reason: RegExp}[] = [
    ...[401, 403, 429, 500].map(status => ({context: housing, response: () => new Response('refused', {status}), reason: new RegExp('HTTP ' + status)})),
    {context: housing, response: () => new Response(''), reason: /Empty/},
    {context: housing, response: () => new Response('not JSON'), reason: /Invalid listing JSON/},
    {context: housing, response: () => Response.json({errors: [{message: 'schema mismatch'}], ...housingResponse([housingRow(1)])}), reason: /GraphQL errors/},
    {context: housing, response: () => Response.json({data: {searchResults: {properties: {url: 'not-an-array'}}}}), reason: /Invalid Housing/},
    {context: housing, response: () => Response.json(null), reason: /response shape/},
    {context: noBroker, response: () => Response.json({status: 'failed', data: [noBrokerRow(1)]}), reason: /declined/},
    {context: noBroker, response: () => Response.json({status_code: 403, data: [noBrokerRow(1)]}), reason: /declined/},
    {context: noBroker, response: () => Response.json({status_code: 'success', data: [noBrokerRow(1)]}), reason: /declined/},
    {context: noBroker, response: () => Response.json({statusCode: 500, data: [noBrokerRow(1)]}), reason: /declined/},
    {context: noBroker, response: () => Response.json({status: 'success', data: {properties: []}}), reason: /Invalid NoBroker/},
  ];
  for (const fixture of cases) {
    const result = await discoverPublicListings(fixture.context, 10, activeSignal(), checkpoint, async () => fixture.response());
    assert.equal(result.complete, false);
    assert.equal(result.requests, 1);
    assert.deepEqual(result.projects, []);
    assert.match(result.reason, fixture.reason);
  }
  await httpFixture((_request, response) => {
    response.writeHead(302, {Location: '/should-not-be-followed'}); response.end();
  }, async request => {
    const result = await discoverPublicListings(housing, 1, activeSignal(), checkpoint, request);
    assert.equal(result.complete, false);
    assert.match(result.reason, /request failed/);
  });
});

test('A later response failure preserves the already discovered safe listings', async () => {
  let calls = 0;
  const result = await discoverPublicListings(housing, 40, activeSignal(), checkpoint, async () => {
    calls++;
    return calls === 1 ? Response.json(housingResponse([housingRow(1)], {offset: 1})) : new Response('rate limited', {status: 429});
  });
  assert.equal(result.complete, false);
  assert.equal(result.requests, 2);
  assert.equal(result.projects.length, 1);
  assert.match(result.reason, /HTTP 429/);
});

test('Response bodies are stopped at the 2 MiB decoded bound', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(128 * 1024).fill(32)); },
    cancel() { cancelled = true; },
  });
  const result = await discoverPublicListings(housing, 1, activeSignal(), checkpoint, async () => new Response(body));
  assert.equal(result.complete, false);
  assert.match(result.reason, /exceeds 2 MiB/);
  assert.equal(cancelled, true);
  assert.ok(result.decodedBytes > 2 * 1024 * 1024 && result.decodedBytes <= 2 * 1024 * 1024 + 128 * 1024);
});

test('External abort and checkpoint errors propagate, including during native response reads', async () => {
  const stopped = new AbortController();
  const stopReason = new Error('User stopped discovery.');
  stopped.abort(stopReason);
  await assert.rejects(discoverPublicListings(housing, 10, stopped.signal, checkpoint), error => error === stopReason);
  const checkpointError = new Error('Pause checkpoint failed.');
  await assert.rejects(discoverPublicListings(housing, 10, activeSignal(), async () => { throw checkpointError; }), error => error === checkpointError);
  const controller = new AbortController();
  await httpFixture((_request, response) => {
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.write('{"data":');
  }, async request => {
    const abortWhileReading: ListingRequest = async (input, init) => {
      const response = await request(input, init);
      setTimeout(() => controller.abort(stopReason), 20);
      return response;
    };
    await assert.rejects(discoverPublicListings(housing, 10, controller.signal, checkpoint, abortWhileReading), error => error === stopReason);
  });
});

test('A stalled request reaches the owned timeout and returns a browser fallback', async context => {
  context.mock.timers.enable({apis: ['setTimeout']});
  let requestStarted!: () => void;
  const started = new Promise<void>(resolve => { requestStarted = resolve; });
  const resultPromise = discoverPublicListings(housing, 1, activeSignal(), checkpoint, async (_input, init) => {
    requestStarted();
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), {once: true});
    });
  });
  await started;
  context.mock.timers.tick(15000);
  const result = await resultPromise;
  assert.equal(result.complete, false);
  assert.equal(result.requests, 1);
  assert.deepEqual(result.projects, []);
  assert.equal(result.reason, 'Public listing request timed out.');
});
