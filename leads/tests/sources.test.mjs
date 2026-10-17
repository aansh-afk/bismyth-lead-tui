import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { Sources, publicUrl, extractContacts } from "../server/sources.mjs";
import { createApp } from "../server/index.mjs";
const KEY = "fc-synthetic-key-only";
const page = {
  markdown:
    "# Example Brokerage\nCall +91 98765 43210\nEmail owner@example.test",
  links: ["tel:+919876543210"],
  metadata: {
    sourceURL: "https://broker.example.test/contact",
    title: "Example Brokerage",
  },
};
function fixture(t, handler = () => ({ success: true, data: { web: [] } })) {
  const dir = mkdtempSync(join(tmpdir(), "oracle-sources-"));
  const store = new Store(join(dir, "test.sqlite"));
  const calls = [];
  const sources = new Sources(store, {
    env: {},
    fetcher: async (url, options) => {
      calls.push({
        url,
        options,
        body: options.body ? JSON.parse(options.body) : null,
      });
      return new Response(JSON.stringify(await handler(url, options)), {
        status: 200,
      });
    },
  });
  sources.setKey(KEY);
  t.after(() => {
    sources.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, sources, calls, dir };
}
test("source URL validation rejects private targets and unsupported schemes", () => {
  assert.equal(
    publicUrl("https://example.test/contact#phone"),
    "https://example.test/contact",
  );
  for (const url of [
    "file:///etc/passwd",
    "https://user:password@example.test",
    "http://127.1",
    "http://10.0.0.1",
    "http://169.254.169.254",
    "http://172.20.0.1",
    "http://192.168.1.2",
    "http://localhost",
    "http://[::1]",
    "https://example.test:9000",
  ])
    assert.throws(() => publicUrl(url), url);
});
test("contact extraction keeps evidence, deduplicates and never guesses generic local numbers", () => {
  const r = extractContacts(
    "Call +91 98765 43210 or mobile 9876543210. Email OWNER@example.test. Order 1234567890.",
    ["tel:+919876543210", "https://wa.me/12025550199"],
    "91",
  );
  assert.deepEqual(
    r.candidates.map((c) => c.phone),
    ["+919876543210", "+12025550199"],
  );
  assert(r.candidates.every((c) => c.evidence));
  assert.deepEqual(r.emails, ["owner@example.test"]);
  assert.equal(
    extractContacts("Order 8765432109.", [], "91").candidates.length,
    0,
  );
});
test("masked credential is stored privately and excluded from state and backups", (t) => {
  const f = fixture(t);
  assert.equal(statSync(join(f.dir, "firecrawl.key")).mode & 0o777, 0o600);
  assert(!JSON.stringify(f.sources.state()).includes(KEY));
  assert(!JSON.stringify(f.store.backup()).includes(KEY));
  assert.throws(() => f.sources.setKey("bad"), /valid/);
  f.sources.setKey("");
  assert.equal(f.sources.status().configured, false);
});
test("search saves provenance, scrape extracts contacts, and import starts inactive", async (t) => {
  const f = fixture(t, (url) =>
    url.endsWith("/search")
      ? {
          success: true,
          creditsUsed: 2,
          data: {
            web: [
              {
                url: page.metadata.sourceURL,
                title: "Example Brokerage",
                description: "Public business page",
              },
            ],
          },
        }
      : { success: true, data: page },
  );
  await f.sources.start("search", {
    query: "brokerages Pune",
    limit: 3,
    country: "IN",
  });
  assert.equal(f.sources.state().count, 1);
  const id = f.sources.state().pages[0].id;
  assert.equal(f.sources.detail(id).status, "discovered");
  await f.sources.start("scrape", { url: page.metadata.sourceURL });
  assert.equal(f.sources.state().count, 1);
  assert.equal(f.sources.detail(id).candidates[0].phone, "+919876543210");
  const imported = f.sources.importContact({
    page_id: id,
    phone: "+919876543210",
    name: "Example Owner",
  });
  assert.equal(imported.added, 1);
  const c = f.store.state().contacts[0];
  assert.equal(c.active, 0);
  assert.equal(c.consent, 0);
  assert.equal(c.source, page.metadata.sourceURL);
  assert(c.notes.includes("tel:+919876543210"));
  assert.throws(
    () => f.sources.importContact({ page_id: id, phone: "+12025550999" }),
    /Select a phone/,
  );
  assert.equal(f.calls[0].body.sources[0], "web");
  assert.equal(f.calls[0].options.redirect, "error");
});
test("duplicate import preserves existing consent, stage and sender binding", async (t) => {
  const f = fixture(t, () => ({ success: true, data: page }));
  await f.sources.start("scrape", { url: page.metadata.sourceURL });
  f.store.importContacts([
    { name: "Existing client", phone: "+919876543210", stage: "client" },
  ]);
  const c = f.store.state().contacts[0];
  f.store.patchContact(c.id, { active: true, consent: true }, "+12025550199");
  const before = f.store.contact(c.id);
  const result = f.sources.importContact({
    page_id: f.sources.state().pages[0].id,
    phone: c.phone,
  });
  assert.equal(result.duplicates, 1);
  assert.deepEqual(f.store.contact(c.id), before);
});
test("whole-domain crawl persists job ID, limits pages and ignores outside-domain results", async (t) => {
  const f = fixture(t, (url, options) =>
    options.method === "POST"
      ? { success: true, id: "crawl-123" }
      : {
          status: "completed",
          completed: 2,
          total: 2,
          creditsUsed: 2,
          data: [
            page,
            {
              ...page,
              metadata: { sourceURL: "https://outside.example.test/contact" },
            },
          ],
        },
  );
  await f.sources.start("crawl", {
    url: "https://broker.example.test",
    limit: 2,
  });
  assert.equal(f.calls[0].body.crawlEntireDomain, true);
  assert.equal(f.calls[0].body.allowExternalLinks, false);
  assert.equal(f.calls[0].body.allowSubdomains, false);
  assert.equal(f.sources.state().runs[0].external_id, "crawl-123");
  await f.sources.poll();
  assert.equal(f.sources.state().runs[0].status, "completed");
  assert.equal(f.sources.state().count, 1);
  assert.equal(
    f.sources.detail(f.sources.state().pages[0].id).candidates.length,
    1,
  );
});
test("saved crawls resume status checks without restarting paid requests; cancellation persists", async (t) => {
  const f = fixture(t, (url, options) =>
    options.method === "POST"
      ? { success: true, id: "resume-123" }
      : options.method === "DELETE"
        ? { success: true }
        : { status: "scraping", completed: 0, total: 3, data: [] },
  );
  await f.sources.start("crawl", {
    url: "https://broker.example.test",
    limit: 3,
  });
  const again = new Sources(f.store, { env: {}, fetcher: f.sources.fetcher });
  await again.poll();
  assert.equal(f.calls.filter((c) => c.options.method === "POST").length, 1);
  assert(f.calls[1].url.endsWith("/crawl/resume-123"));
  await again.cancel(f.sources.state().runs[0].id);
  assert.equal(f.sources.state().runs[0].status, "cancelled");
  again.close();
});
test("untrusted pagination never sends credentials to another server", async (t) => {
  const f = fixture(t, (url, options) =>
    options.method === "POST"
      ? { success: true, id: "crawl-123" }
      : {
          status: "completed",
          data: [],
          next: "https://evil.example.test/steal",
        },
  );
  await f.sources.start("crawl", { url: "https://broker.example.test" });
  await f.sources.poll();
  assert(f.sources.state().runs[0].error.includes("continuation"));
  assert(
    f.calls.every((c) => c.url.startsWith("https://api.firecrawl.dev/v2/")),
  );
});
test("provider errors are sanitized and failed paid requests are not retried automatically", async (t) => {
  const f = fixture(t);
  f.sources.fetcher = async () =>
    new Response(JSON.stringify({ error: KEY }), { status: 401 });
  await assert.rejects(
    f.sources.start("search", { query: "broker" }),
    /rejected the key/,
  );
  const run = f.sources.state().runs[0];
  assert.equal(run.status, "uncertain");
  assert(!JSON.stringify(run).includes(KEY));
  await f.sources.poll();
  assert.equal(f.sources.state().runs[0].status, "uncertain");
});
test("sources and provenance survive backup restore while crawl jobs cannot resume from imports", async (t) => {
  const f = fixture(t, (url, options) =>
    url.endsWith("/scrape")
      ? { success: true, data: page }
      : { success: true, id: "restore-123" },
  );
  await f.sources.start("scrape", { url: page.metadata.sourceURL });
  await f.sources.start("crawl", { url: "https://broker.example.test" });
  const other = mkdtempSync(join(tmpdir(), "source-restore-"));
  const restored = new Store(join(other, "test.sqlite"));
  t.after(() => {
    restored.close();
    rmSync(other, { recursive: true, force: true });
  });
  restored.restore(f.store.backup());
  assert.equal(restored.one("SELECT COUNT(*) AS n FROM source_pages").n, 1);
  assert.equal(
    restored.one("SELECT status FROM source_runs WHERE kind='crawl'").status,
    "interrupted",
  );
  assert.equal(
    restored.one("SELECT external_id FROM source_runs WHERE kind='crawl'")
      .external_id,
    null,
  );
});
test("private HTTP API protects research and never returns the credential", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sources-http-"));
  const app = await createApp({
    dataDir: dir,
    loadSavedContacts: false,
    modelFactory: () => ({}),
    transportFactory: () => ({
      status: () => ({ status: "disconnected" }),
      disconnect() {},
    }),
    sourcesFactory: (s) =>
      new Sources(s, {
        env: {},
        fetcher: async () =>
          new Response(
            JSON.stringify({ success: true, data: { remainingCredits: 250 } }),
          ),
      }),
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal(
    (await fetch(base + "/api/sources/key", { method: "POST", body: "{}" }))
      .status,
    401,
  );
  const b = await fetch(base + "/api/bootstrap", {
    headers: { "X-Oracle-Key": app.localToken },
  });
  const cookie = b.headers.get("set-cookie").split(";")[0];
  const headers = {
    Cookie: cookie,
    "Content-Type": "application/json",
    "X-Oracle-Request": "1",
  };
  const saved = await fetch(base + "/api/sources/key", {
    method: "POST",
    headers,
    body: JSON.stringify({ api_key: KEY }),
  });
  assert.equal(saved.status, 200);
  assert(!(await saved.text()).includes(KEY));
  const r = await fetch(base + "/api/sources/credits", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal((await r.json()).remaining, 250);
  const state = await fetch(base + "/api/state", {
    headers: { Cookie: cookie },
  });
  assert(!(await state.text()).includes(KEY));
  assert.equal(app.store.state().analytics.contacts, 0);
});
test("crawl pagination resumes safely and accepts the canonical www hostname", async (t) => {
  const f = fixture(t, (url, options) =>
    options.method === "POST"
      ? { success: true, id: "pages-123" }
      : url.includes("skip=1")
        ? {
            status: "completed",
            total: 2,
            completed: 2,
            data: [
              {
                ...page,
                metadata: {
                  sourceURL: "https://www.broker.example.test/about",
                },
              },
            ],
          }
        : {
            status: "completed",
            total: 2,
            completed: 2,
            data: [page],
            next: "https://api.firecrawl.dev/v2/crawl/pages-123?skip=1",
          },
  );
  await f.sources.start("crawl", {
    url: "https://broker.example.test",
    limit: 3,
  });
  await f.sources.poll();
  assert.equal(f.sources.state().runs[0].status, "collecting");
  const again = new Sources(f.store, { env: {}, fetcher: f.sources.fetcher });
  await again.poll();
  assert.equal(f.sources.state().runs[0].status, "completed");
  assert.equal(f.sources.state().count, 2);
  assert(f.calls.at(-1).url.endsWith("/crawl/pages-123?skip=1"));
  again.close();
});
test("late polling results cannot reopen a cancelled crawl", async (t) => {
  let finish;
  const f = fixture(t, (url, options) =>
    options.method === "POST"
      ? { success: true, id: "race-123" }
      : options.method === "DELETE"
        ? { success: true }
        : new Promise((resolve) => (finish = resolve)),
  );
  await f.sources.start("crawl", { url: "https://broker.example.test" });
  const pending = f.sources.poll();
  await f.sources.cancel(f.sources.state().runs[0].id);
  finish({ status: "scraping", total: 2, completed: 1, data: [page] });
  await pending;
  assert.equal(f.sources.state().runs[0].status, "cancelled");
  assert.equal(f.sources.state().count, 0);
});
test("missing credentials and invalid limits prevent billable requests", async (t) => {
  const f = fixture(t);
  f.sources.setKey("");
  await assert.rejects(
    f.sources.start("search", { query: "prospects" }),
    /API key/,
  );
  assert.equal(f.calls.length, 0);
  f.sources.setKey(KEY);
  for (const limit of [0, 101, 2.5])
    await assert.rejects(
      f.sources.start("crawl", { url: "https://broker.example.test", limit }),
      /limit/,
    );
  assert.equal(f.calls.length, 0);
});
test("HTTP-error pages are not reported as a successful scrape", async (t) => {
  const f = fixture(t, () => ({
    success: true,
    data: { ...page, metadata: { ...page.metadata, statusCode: 404 } },
  }));
  await assert.rejects(
    f.sources.start("scrape", { url: page.metadata.sourceURL }),
    /no usable/,
  );
  assert.equal(f.sources.state().count, 0);
});
