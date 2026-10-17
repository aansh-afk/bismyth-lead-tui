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
    f.sources
      .detail(f.sources.state().pages[0].id)
      .candidates.filter((c) => c.phone).length,
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

const namedPage = (url = page.metadata.sourceURL) => ({
  markdown:
    "# Meridian Realty\n\nAsha Rao, Owner, Meridian Realty. Mobile +91 98765 43210. Email asha@meridian.test\n\nDev Shah, Sales, Meridian Realty. Email dev@meridian.test\n\nOffice Meridian Realty. Call +91 99887 76655",
  links: ["https://meridian.test/"],
  metadata: { sourceURL: url, title: "Team | Meridian Realty" },
  json: {
    contacts: [
      {
        name: "Asha Rao",
        role: "Owner",
        company: "Meridian Realty",
        company_website: "https://meridian.test/",
        phone: "+91 98765 43210",
        email: "asha@meridian.test",
        kind: "person",
        evidence:
          "Asha Rao, Owner, Meridian Realty. Mobile +91 98765 43210. Email asha@meridian.test",
      },
      {
        name: "Dev Shah",
        role: "Sales",
        company: "Meridian Realty",
        company_website: "https://meridian.test/",
        phone: "",
        email: "dev@meridian.test",
        kind: "person",
        evidence: "Dev Shah, Sales, Meridian Realty. Email dev@meridian.test",
      },
      {
        name: "",
        role: "",
        company: "Meridian Realty",
        company_website: "https://meridian.test/",
        phone: "+91 99887 76655",
        email: "",
        kind: "business",
        evidence: "Office Meridian Realty. Call +91 99887 76655",
      },
    ],
  },
});
test("named extraction retains the actual person, employer, role and email, with no page-title guesses", async (t) => {
  const f = fixture(t, () => ({ success: true, data: namedPage() }));
  await f.sources.start("scrape", { url: page.metadata.sourceURL });
  const catalog = f.sources.catalog();
  assert.equal(catalog.length, 3);
  const owner = catalog.find((c) => c.name === "Asha Rao");
  assert.equal(owner.company, "Meridian Realty");
  assert.equal(owner.role, "Owner");
  assert.equal(owner.email, "asha@meridian.test");
  assert.equal(f.calls[0].body.formats[2].type, "json");
  assert.equal(f.sources.state().companies.length, 1);
  assert.equal(f.sources.state().companies[0].contacts, 3);
  const result = f.sources.importAll({ all: true });
  assert.equal(result.added, 2);
  assert.equal(result.email_only, 1);
  const c = f.store.state().contacts.find((c) => c.phone === owner.phone);
  assert.equal(c.name, "Asha Rao");
  assert.equal(c.company, "Meridian Realty");
  assert.equal(c.role, "Owner");
  assert(c.notes.includes("asha@meridian.test"));
  assert.equal(c.active, 0);
  assert.equal(c.consent, 0);
  assert.equal(f.sources.importAll({ all: true }).duplicates, 2);
});
test("fabricated names, identifiers and evidence do not become sourced identities", async (t) => {
  const p = namedPage();
  p.json.contacts = [
    { ...p.json.contacts[0], name: "Imaginary Owner" },
    {
      ...p.json.contacts[0],
      phone: "+12025550999",
      email: "invented@example.test",
    },
    {
      ...p.json.contacts[0],
      evidence: "Asha Rao call +919876543210 (this quote was invented)",
    },
  ];
  const f = fixture(t, () => ({ success: true, data: p }));
  await f.sources.start("scrape", { url: page.metadata.sourceURL });
  const records = f.sources.catalog();
  assert(records.every((c) => !c.name));
  assert(!JSON.stringify(records).includes("Imaginary"));
  assert(!records.some((c) => c.phone === "+12025550999"));
  f.sources.importAll({ all: true });
  assert(!f.store.state().contacts.some((c) => c.name === p.metadata.title));
});
test("identical contacts merge source provenance; company identities distinguish unrelated domains", async (t) => {
  let p = namedPage();
  const f = fixture(t, () => ({ success: true, data: p }));
  await f.sources.start("scrape", { url: p.metadata.sourceURL });
  p = namedPage("https://directory.example.test/meridian");
  await f.sources.start("scrape", { url: p.metadata.sourceURL });
  assert.equal(f.sources.catalog().length, 3);
  assert(f.sources.catalog().every((c) => c.sources.length === 2));
  f.sources.importAll({ all: true });
  assert(f.store.state().contacts[0].notes.includes("directory.example.test"));
  p = namedPage("https://unrelated.example.test/team");
  p.json.contacts = p.json.contacts.map((c) => ({ ...c, company_website: "" }));
  await f.sources.start("scrape", { url: p.metadata.sourceURL });
  assert.equal(f.sources.state().companies.length, 2);
});
test("multiple named people sharing a phone import as one shared business relationship", async (t) => {
  const p = namedPage();
  p.markdown += "\n\nDev Shah, Sales, Meridian Realty. Call +91 98765 43210";
  p.json.contacts[1] = {
    ...p.json.contacts[1],
    phone: "+919876543210",
    email: "",
    evidence: "Dev Shah, Sales, Meridian Realty. Call +91 98765 43210",
  };
  const f = fixture(t, () => ({ success: true, data: p }));
  await f.sources.start("scrape", { url: p.metadata.sourceURL });
  const result = f.sources.importAll({ all: true });
  assert.equal(result.added, 2);
  const shared = f.store
    .state()
    .contacts.find((c) => c.phone === "+919876543210");
  assert.equal(shared.name, "Meridian Realty · shared number");
  assert.equal(shared.role, "Shared contact");
  assert(shared.notes.includes("Asha Rao"));
  assert(shared.notes.includes("Dev Shah"));
});
test("bulk collection saves an exact bounded URL set and resumes paginated remote jobs without another POST", async (t) => {
  const f = fixture(t, (url, options) =>
    url.endsWith("/search")
      ? {
          success: true,
          data: {
            web: [
              { url: page.metadata.sourceURL, title: "Team" },
              { url: "https://other.example.test/team", title: "Other" },
            ],
          },
        }
      : options.method === "POST"
        ? { success: true, id: "batch-123" }
        : options.method === "DELETE"
          ? { success: true }
          : url.includes("skip=1")
            ? {
                status: "completed",
                completed: 2,
                total: 2,
                data: [namedPage("https://other.example.test/team")],
              }
            : {
                status: "completed",
                completed: 2,
                total: 2,
                data: [
                  namedPage(),
                  namedPage("https://unselected.example.test/team"),
                ],
                next: "https://api.firecrawl.dev/v2/batch/scrape/batch-123?skip=1",
              },
  );
  await f.sources.start("search", { query: "owners" });
  await f.sources.start("batch", { all: true, limit: 2 });
  assert.equal(f.calls[1].body.urls.length, 2);
  assert.equal(f.calls[1].body.formats[2].type, "json");
  assert.throws(() => f.sources.deletePages({ all: true }), /Cancel running/);
  await f.sources.poll();
  assert.equal(f.sources.state().runs[0].status, "collecting");
  const again = new Sources(f.store, { env: {}, fetcher: f.sources.fetcher });
  await again.poll();
  again.close();
  assert.equal(f.calls.filter((c) => c.options.method === "POST").length, 2);
  assert.equal(f.sources.state().runs[0].status, "completed");
  assert(!f.sources.state().pages.some((p) => p.url.includes("unselected")));
  assert(f.sources.state().pages.every((p) => p.status === "scraped"));
});
test("source deletion removes research and derived companies, preserving imported CRM memory and inactive permissions", async (t) => {
  const f = fixture(t, () => ({ success: true, data: namedPage() }));
  await f.sources.start("scrape", { url: page.metadata.sourceURL });
  f.sources.importAll({ all: true });
  const c = f.store.state().contacts[0];
  f.store.memory(c.id, "Keep this relationship");
  const before = f.store.detail(c.id);
  assert.throws(
    () => f.sources.deletePages({ page_ids: ["missing"] }),
    /not found/,
  );
  assert.equal(f.sources.state().count, 1);
  assert.equal(
    f.sources.deletePages({ page_ids: [f.sources.state().pages[0].id] })
      .deleted,
    1,
  );
  assert.equal(f.sources.state().count, 0);
  assert.equal(f.sources.catalog().length, 0);
  assert.equal(f.sources.state().companies.length, 0);
  assert.deepEqual(f.store.detail(c.id), before);
});
test("batch cancellation uses the batch endpoint, and collection skips already scraped pages", async (t) => {
  const f = fixture(t, (url, options) =>
    url.endsWith("/search")
      ? {
          success: true,
          data: { web: [{ url: page.metadata.sourceURL, title: "Team" }] },
        }
      : options.method === "POST"
        ? { success: true, id: "batch-cancel" }
        : { success: true },
  );
  await f.sources.start("search", { query: "owners" });
  await f.sources.start("batch", { all: true, limit: 1 });
  await f.sources.cancel(f.sources.state().runs[0].id);
  assert(f.calls.at(-1).url.endsWith("/batch/scrape/batch-cancel"));
  assert.equal(f.calls.at(-1).options.method, "DELETE");
  f.sources.savePage(
    namedPage(),
    { id: "local-fixture", target: page.metadata.sourceURL, dial_code: "91" },
    true,
  );
  const before = f.calls.length;
  await assert.rejects(
    f.sources.start("batch", { all: true }),
    /Scraped pages are skipped/,
  );
  assert.equal(f.calls.length, before);
  assert.equal(f.sources.deletePages({ all: true }).deleted, 1);
});

test("malformed structured records fall back to evidence and legacy unnamed pages can be upgraded in bulk", async (t) => {
  const f = fixture(t, () => ({ success: true, id: "upgrade-123" }));
  f.sources.savePage(
    {
      ...namedPage(),
      json: { contacts: [{}, null, { name: { malformed: true } }] },
    },
    { id: "old", target: page.metadata.sourceURL, dial_code: "91" },
    true,
  );
  const id = f.sources.state().pages[0].id;
  assert(f.sources.detail(id).candidates.every((c) => !c.name));
  f.store.run(
    "UPDATE source_pages SET candidates=? WHERE id=?",
    JSON.stringify([
      { phone: "+919876543210", evidence: "Call +919876543210" },
    ]),
    id,
  );
  await f.sources.start("batch", { all: true });
  assert.equal(f.calls[0].body.urls.length, 1);
  await f.sources.cancel(f.sources.state().runs[0].id);
  f.sources.savePage(
    namedPage(),
    { id: "new", target: page.metadata.sourceURL, dial_code: "91" },
    true,
  );
  await f.sources.start("batch", { all: true, refresh: true });
  assert.equal(f.calls.at(-1).body.urls.length, 1);
});

test("a directory does not attach another company or role merely because it appears elsewhere on the page", async (t) => {
  const p = namedPage();
  p.markdown += "\n\nOther Company, CEO: Someone Else";
  p.json.contacts[0] = {
    ...p.json.contacts[0],
    company: "Other Company",
    role: "CEO",
  };
  const f = fixture(t, () => ({ success: true, data: p }));
  await f.sources.start("scrape", { url: p.metadata.sourceURL });
  const c = f.sources.catalog().find((c) => c.name === "Asha Rao");
  assert.equal(c.company, "");
  assert.equal(c.role, "");
  assert.equal(c.phone, "+919876543210");
});

test("cached member profiles link proprietors and associates to their actual firm while excluding association footer numbers from bulk import", async (t) => {
  const f = fixture(t);
  const p = {
    url: "https://areagroup.in/groupmember/synthetic-realty/",
    markdown:
      "# Synthetic Realty\n\n## Synthetic Realty\n\n## Maya Example\n\nProprietor\n\n- Contact9876543210/ 9988776655\n\n## Members Name\n\n- NameDev Example\n- RoleAsso member\n- Contact No :9123456789\n- Email:dev\\_example@example.test\n\n## Get in touch\nphone\n[+(91) 9000000000](tel:+91 9000000000)\nemail\n[office@example.test](mailto:office@example.test)\n\n## about us\nAREA Group",
  };
  f.sources.savePage(p, { id: "cached", target: p.url, dial_code: "91" }, true);
  let rows = f.sources.catalog();
  assert.equal(rows.filter((c) => c.name === "Maya Example").length, 2);
  assert.equal(
    rows.find((c) => c.name === "Dev Example").email,
    "dev_example@example.test",
  );
  assert.equal(rows.filter((c) => c.kind === "site_contact").length, 1);
  assert(
    rows.filter((c) => c.name).every((c) => c.company === "Synthetic Realty"),
  );
  const imported = f.sources.importAll({ all: true });
  assert.equal(imported.added, 3);
  assert.equal(imported.site_contacts, 1);
  assert(!f.store.state().contacts.some((c) => c.phone === "+919000000000"));
  const id = f.sources.state().pages[0].id;
  f.store.run("UPDATE source_pages SET candidates=? WHERE id=?", "[]", id);
  const calls = f.calls.length;
  assert.equal(f.sources.reprocess({ all: true }).updated, 1);
  assert.equal(f.calls.length, calls);
  assert(f.sources.catalog().some((c) => c.name === "Maya Example"));
  assert.equal(f.store.state().contacts.length, 3);
});
test("firm/name-only membership listings never inherit the association phone", (t) => {
  const f = fixture(t);
  const p = {
    url: "https://reaak.com/members.php",
    markdown:
      "## Members\nMember Name/Firm Name\nSYNTHETIC REALTY (MR. MAYA EXAMPLE)\nANOTHER FIRM (MR. DEV EXAMPLE)\n\nCall +91 90000 00000",
  };
  f.sources.savePage(p, { id: "cached", target: p.url, dial_code: "91" }, true);
  const records = f.sources.catalog();
  assert.equal(records.filter((c) => c.name).length, 2);
  assert(records.filter((c) => c.name).every((c) => !c.phone));
  assert.equal(f.sources.importAll({ all: true }).added, 0);
  assert.equal(f.sources.importAll({ all: true }).without_phone, 2);
});

test("cached directory pagination keeps each firm next to its own managing director and phone", (t) => {
  const f = fixture(t);
  const p = {
    url: "https://areagroup.in/our-members/page/2",
    markdown:
      "# Our Members\n\n## Our Members\n\n## Example Estates\nAddress\n\n## Maya Example\n\nManaging Director\n\n- Contact9876543210\n\n[View Details](https://areagroup.in/groupmember/example-estates/)\n\n## Second Estates\nAddress\n\n## Dev Example\n\nProprietor\n\n- Contact9988776655\n\n[View Details](https://areagroup.in/groupmember/second-estates/)\n\n## Get in touch\nCall +91 90000 00000",
  };
  f.sources.savePage(p, { id: "cached", target: p.url, dial_code: "91" }, true);
  const rows = f.sources.catalog().filter((c) => c.name);
  assert.equal(rows.length, 2);
  assert.equal(
    rows.find((c) => c.phone === "+919876543210").company,
    "Example Estates",
  );
  assert.equal(
    rows.find((c) => c.phone === "+919988776655").name,
    "Dev Example",
  );
  assert.equal(rows[0].role, "Managing Director");
  assert(rows[0].profile_url.includes("/groupmember/"));
});

test("AREA membership crawls prioritize member profiles and pagination over events", async (t) => {
  const f = fixture(t, () => ({ success: true, id: "members-only" }));
  await f.sources.start("crawl", {
    url: "https://areagroup.in/our-members/",
    limit: 100,
  });
  assert.deepEqual(f.calls[0].body.includePaths, [
    "/groupmember/.*",
    "/our-members(/.*)?",
  ]);
});

test("the same named phone on multiple pages merges missing/present emails while preserving all source evidence", async (t) => {
  let p = namedPage();
  const f = fixture(t, () => ({ success: true, data: p }));
  await f.sources.start("scrape", { url: p.metadata.sourceURL });
  p = namedPage("https://broker.example.test/team");
  p.json.contacts[0].email = "";
  await f.sources.start("scrape", { url: p.metadata.sourceURL });
  const owner = f.sources
    .catalog()
    .filter((c) => c.name === "Asha Rao" && c.phone);
  assert.equal(owner.length, 1);
  assert.deepEqual(owner[0].emails, ["asha@meridian.test"]);
  assert.equal(owner[0].sources.length, 2);
  assert.equal(owner[0].role, "Owner");
});

test("explicit scrape-and-import adds inactive phone contacts immediately and returns their source page", async (t) => {
  const f = fixture(t, () => ({ success: true, data: namedPage() }));
  const r = await f.sources.start("scrape", {
    url: page.metadata.sourceURL,
    import_contacts: true,
  });
  assert.equal(r.saved, 1);
  assert.equal(r.imported.added, 2);
  assert.equal(r.imported.without_phone, 1);
  assert.equal(r.import_error, null);
  assert.equal(f.sources.detail(r.page_id).imported_contacts.length, 2);
  const c = f.store.state().contacts.find((c) => c.name === "Asha Rao");
  assert.equal(c.active, 0);
  assert.equal(c.consent, 0);
  assert.equal(c.source, page.metadata.sourceURL);
  const provenance = f.store.detail(c.id).sources;
  assert.equal(provenance.length, 1);
  assert.equal(provenance[0].url, page.metadata.sourceURL);
  assert(provenance[0].evidence.includes("Asha Rao"));
  assert(provenance[0].evidence.includes("Meridian Realty"));
  const second = await f.sources.start("scrape", {
    url: page.metadata.sourceURL,
    import_contacts: true,
  });
  assert.equal(second.imported.added, 0);
  assert.equal(second.imported.duplicates, 2);
  assert.equal(f.store.detail(c.id).sources.length, 1);
});
test("new source attribution is added to an existing phone without overwriting CRM data or permissions", async (t) => {
  let p = namedPage();
  const f = fixture(t, () => ({ success: true, data: p }));
  await f.sources.start("scrape", {
    url: p.metadata.sourceURL,
    import_contacts: true,
  });
  const c = f.store.state().contacts.find((c) => c.name === "Asha Rao");
  f.store.patchContact(
    c.id,
    { stage: "client", notes: "Operator notes", consent: true, active: true },
    "+12025550199",
  );
  const before = f.store.contact(c.id);
  p = namedPage("https://directory.example.test/meridian");
  const r = await f.sources.start("scrape", {
    url: p.metadata.sourceURL,
    import_contacts: true,
  });
  assert.equal(r.imported.duplicates, 2);
  assert.deepEqual(f.store.contact(c.id), before);
  assert.equal(f.store.detail(c.id).sources.length, 2);
  assert(
    f.store.detail(c.id).sources.some((s) => s.url === p.metadata.sourceURL),
  );
  assert.equal(
    f.sources.detail(r.page_id).imported_contacts.find((row) => row.id === c.id)
      .stage,
    "client",
  );
  f.sources.deletePages({ all: true });
  assert.equal(f.store.detail(c.id).sources.length, 2);
});
test("scraping remains research-only unless importing is explicitly requested", async (t) => {
  const f = fixture(t, () => ({ success: true, data: namedPage() }));
  const r = await f.sources.start("scrape", { url: page.metadata.sourceURL });
  assert.equal(r.imported, null);
  assert.equal(f.store.state().contacts.length, 0);
  assert.equal(f.sources.detail(r.page_id).imported_contacts.length, 0);
});
test("a successful paid scrape with a local import failure stays saved and can import later without another provider request", async (t) => {
  const f = fixture(t, () => ({ success: true, data: namedPage() }));
  const original = f.sources.importAll.bind(f.sources);
  f.sources.importAll = () => {
    throw Error("Synthetic local write failure");
  };
  const r = await f.sources.start("scrape", {
    url: page.metadata.sourceURL,
    import_contacts: true,
  });
  assert.equal(r.saved, 1);
  assert(r.import_error.includes("without scraping again"));
  assert.equal(f.sources.state().runs[0].status, "completed");
  assert.equal(f.sources.detail(r.page_id).candidates.length, 3);
  f.sources.importAll = original;
  assert.equal(f.sources.importAll({ page_ids: [r.page_id] }).added, 2);
  assert.equal(f.calls.length, 1);
});
test("per-contact source links survive backup restore and old backups without the new table still restore", async (t) => {
  const f = fixture(t, () => ({ success: true, data: namedPage() }));
  await f.sources.start("scrape", {
    url: page.metadata.sourceURL,
    import_contacts: true,
  });
  const backup = f.store.backup();
  assert.equal(backup.contact_sources.length, 2);
  const restore = (data) => {
    const path = mkdtempSync(join(tmpdir(), "source-links-restore-"));
    const store = new Store(join(path, "test.sqlite"));
    t.after(() => {
      store.close();
      rmSync(path, { recursive: true, force: true });
    });
    store.restore(data);
    return store;
  };
  const restored = restore(backup);
  assert.equal(restored.all("SELECT * FROM contact_sources").length, 2);
  assert(restored.state().contacts.every((c) => !c.active && !c.consent));
  delete backup.contact_sources;
  assert.equal(restore(backup).all("SELECT * FROM contact_sources").length, 0);
});
test("scrape-and-import excludes association contacts and keeps phone-less members in source results", async (t) => {
  const f = fixture(t, () => ({
    success: true,
    data: {
      url: "https://reaak.com/members.php",
      markdown:
        "## Members\nEXAMPLE FIRM (MR. SYNTHETIC PERSON)\nCall +91 90000 00000",
    },
  }));
  const r = await f.sources.start("scrape", {
    url: "https://reaak.com/members.php",
    import_contacts: true,
  });
  assert.equal(r.imported.added, 0);
  assert.equal(r.imported.site_contacts, 1);
  assert.equal(r.imported.without_phone, 1);
  assert.equal(f.sources.detail(r.page_id).candidates.length, 2);
  assert.equal(f.store.state().contacts.length, 0);
});

test("schema v4 workspaces gain source attribution storage without changing their existing CRM rows", (t) => {
  const f = fixture(t);
  f.store.importContacts([
    {
      phone: "+12025550101",
      name: "Existing v4 relationship",
      company: "Saved company",
      notes: "Keep permanent context",
    },
  ]);
  const c = f.store.state().contacts[0];
  f.store.memory(c.id, "Keep this fact");
  const before = f.store.contact(c.id);
  f.store.db.exec("DROP TABLE contact_sources; PRAGMA user_version=4");
  const migrated = new Store(f.store.path);
  try {
    assert.equal(migrated.one("PRAGMA user_version").user_version, 5);
    assert.deepEqual(migrated.contact(c.id), before);
    assert.equal(migrated.detail(c.id).memories[0].content, "Keep this fact");
    assert.deepEqual(migrated.detail(c.id).sources, []);
  } finally {
    migrated.close();
  }
});
