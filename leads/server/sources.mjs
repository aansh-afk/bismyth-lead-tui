import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { isIP } from "node:net";
import { id, now, text, phone } from "./store.mjs";
const API = "https://api.firecrawl.dev/v2";
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");
export function publicUrl(value) {
  let u;
  try {
    u = new URL(text(value, 2000));
  } catch {
    throw new Error("Enter a full public http:// or https:// website URL.");
  }
  const h = u.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port)) ||
    !h.includes(".") ||
    /(^|\.)(localhost|local|internal|lan|home|onion)$/.test(h) ||
    isIP(h) === 6 ||
    /^0\.|^10\.|^127\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(
      h,
    )
  )
    throw new Error(
      "Use a public website URL without credentials or private network addresses.",
    );
  u.hash = "";
  return u.href;
}
function dial(value = "91") {
  const d = String(value).replace(/^\+/, "");
  if (!/^[1-9]\d{0,3}$/.test(d))
    throw new Error("Enter a country calling code such as 91 or 1.");
  return d;
}
export function extractContacts(markdown, links = [], dialCode = "91") {
  const d = dial(dialCode),
    found = new Map(),
    body = clip(markdown, 150000);
  const add = (raw, evidence, explicit = false) => {
    let n = String(raw).replace(/[\s().-]/g, "");
    if (n.startsWith("00")) n = "+" + n.slice(2);
    if (!n.startsWith("+")) {
      if (
        d === "91" &&
        /^[6-9]\d{9}$/.test(n) &&
        (explicit || /phone|mobile|contact|call|whatsapp|tel/i.test(evidence))
      )
        n = "+91" + n;
      else if (explicit && n.startsWith(d) && n.length >= 8) n = "+" + n;
      else if (
        d === "1" &&
        /^[2-9]\d{9}$/.test(n) &&
        (explicit || /phone|mobile|contact|call|whatsapp|tel/i.test(evidence))
      )
        n = "+1" + n;
      else return;
    }
    try {
      n = phone(n);
      if (!found.has(n) && found.size < 100)
        found.set(n, {
          phone: n,
          evidence: clip(evidence.replace(/[\r\n]+/g, " "), 300),
        });
    } catch {}
  };
  for (const link of links.slice(0, 1000))
    if (typeof link === "string") {
      const match =
        /^(?:tel:|https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send\?phone=)\/?)((?:\+|%2B)?[\d ()-]+)/i.exec(
          link,
        );
      if (match) {
        let number = decodeURIComponent(match[1]);
        if (/^https?:/i.test(link) && !number.startsWith("+"))
          number = "+" + number;
        add(number, link, true);
      }
    }
  for (const m of body.matchAll(/(?:\+|00)?\d[\d ().-]{6,22}\d/g))
    add(
      m[0],
      body.slice(Math.max(0, m.index - 45), m.index + m[0].length + 45),
    );
  const emails = [
    ...new Set(
      (body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((x) =>
        x.toLowerCase(),
      ),
    ),
  ].slice(0, 100);
  return { candidates: [...found.values()], emails };
}
export class Sources {
  constructor(
    store,
    {
      fetcher = fetch,
      keyPath = join(dirname(store.path), "firecrawl.key"),
      env = process.env,
    } = {},
  ) {
    this.store = store;
    this.fetcher = fetcher;
    this.keyPath = keyPath;
    this.env = env;
    this.active = false;
    this.polling = false;
    this.closed = false;
    this.controllers = new Set();
    store.run(
      "UPDATE source_runs SET status='uncertain',error='Process stopped before the request outcome was saved. Check Firecrawl before retrying.' WHERE status='starting'",
    );
  }
  key() {
    return (
      this.env.FIRECRAWL_API_KEY?.trim() ||
      (existsSync(this.keyPath)
        ? readFileSync(this.keyPath, "utf8").trim()
        : "")
    );
  }
  status() {
    return {
      configured: Boolean(this.key()),
      key_source: this.env.FIRECRAWL_API_KEY ? "environment" : "local",
      busy: this.active,
      balance: this.store.get("firecrawl_balance") || null,
    };
  }
  setKey(value) {
    if (this.env.FIRECRAWL_API_KEY)
      throw new Error(
        "The key is supplied by FIRECRAWL_API_KEY. Update that environment value and restart.",
      );
    const key = text(value, 256);
    if (key && !/^[A-Za-z0-9_-]{12,256}$/.test(key))
      throw new Error("Enter a valid Firecrawl API key.");
    if (key) {
      writeFileSync(this.keyPath + ".tmp", key, { mode: 0o600 });
      chmodSync(this.keyPath + ".tmp", 0o600);
      renameSync(this.keyPath + ".tmp", this.keyPath);
    } else if (existsSync(this.keyPath)) unlinkSync(this.keyPath);
    this.store.set("firecrawl_balance", null);
    return { ok: true, ...this.status() };
  }
  state() {
    return {
      ...this.status(),
      pages: this.store.all(
        "SELECT id,url,title,description,status,query,updated_at FROM source_pages ORDER BY updated_at DESC,rowid DESC LIMIT 500",
      ),
      runs: this.store.all(
        "SELECT * FROM source_runs ORDER BY created_at DESC,rowid DESC LIMIT 30",
      ),
      count: this.store.one("SELECT COUNT(*) AS n FROM source_pages").n,
    };
  }
  detail(pageId) {
    const p = this.store.one("SELECT * FROM source_pages WHERE id=?", pageId);
    if (!p) throw new Error("Source page not found.");
    return {
      ...p,
      candidates: JSON.parse(p.candidates),
      emails: JSON.parse(p.emails),
    };
  }
  async request(path, body, method = body === undefined ? "GET" : "POST") {
    if (this.closed) throw new Error("Source research is closed.");
    const key = this.key();
    if (!key)
      throw new Error("Add your Firecrawl API key on the Sources page first.");
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 65000);
    try {
      const response = await this.fetcher(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          {
            401: "Firecrawl rejected the key. Update it in Sources.",
            402: "Firecrawl credits are exhausted.",
            429: "Firecrawl rate limit reached. Wait and retry.",
          }[response.status] ||
            `Firecrawl request failed (HTTP ${response.status}).`,
        );
      const reader = response.body.getReader();
      let length = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 8000000) {
          await reader.cancel();
          throw new Error(
            "Firecrawl response is too large. Use a smaller page limit.",
          );
        }
        chunks.push(Buffer.from(value));
      }
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new Error("Firecrawl returned an invalid response.");
      }
      if (data.success === false)
        throw new Error(
          "Firecrawl could not complete this request. Check the URL, account and credit balance.",
        );
      return data;
    } catch (error) {
      if (error.message?.startsWith("Firecrawl")) throw error;
      throw new Error(
        "Firecrawl could not be reached or timed out. Check the account before repeating a paid request.",
      );
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
  async credits() {
    const r = await this.request("/team/credit-usage");
    const n = r.data?.remainingCredits;
    if (!Number.isFinite(n) || n < 0)
      throw new Error("Firecrawl returned an invalid credit balance.");
    const balance = { remaining: n, checked_at: now() };
    this.store.set("firecrawl_balance", balance);
    return balance;
  }
  savePage(value, run, full = false) {
    const url = publicUrl(
      value.url || value.metadata?.sourceURL || value.metadata?.url,
    );
    const old = this.store.one("SELECT * FROM source_pages WHERE url=?", url);
    if (full && Number(value.metadata?.statusCode) >= 400)
      throw new Error("Firecrawl source page returned an HTTP error.");
    const markdown = full ? clip(value.markdown, 150000) : old?.markdown || "";
    const contacts = full
      ? extractContacts(
          markdown,
          Array.isArray(value.links) ? value.links : [],
          run.dial_code,
        )
      : {
          candidates: old ? JSON.parse(old.candidates) : [],
          emails: old ? JSON.parse(old.emails) : [],
        };
    const title = clip(
        value.title ||
          value.metadata?.title ||
          old?.title ||
          new URL(url).hostname,
        300,
      ),
      description = clip(
        value.description || value.metadata?.description || old?.description,
        1500,
      );
    this.store.run(
      `INSERT INTO source_pages VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,description=excluded.description,markdown=excluded.markdown,candidates=excluded.candidates,emails=excluded.emails,status=excluded.status,query=excluded.query,run_id=excluded.run_id,updated_at=excluded.updated_at`,
      old?.id || id(),
      url,
      title,
      description,
      markdown,
      JSON.stringify(contacts.candidates),
      JSON.stringify(contacts.emails),
      full ? "scraped" : old?.status || "discovered",
      run.target,
      run.id,
      old?.created_at || now(),
      now(),
    );
    return this.store.one("SELECT id FROM source_pages WHERE url=?", url).id;
  }
  async start(kind, input) {
    if (this.active)
      throw new Error("A source request is already in progress.");
    if (!this.key())
      throw new Error("Add your Firecrawl API key on the Sources page first.");
    if (!["search", "scrape", "crawl"].includes(kind))
      throw new Error("Choose search, scrape or crawl.");
    const target =
      kind === "search" ? text(input.query, 500) : publicUrl(input.url);
    if (!target) throw new Error("Enter a search query.");
    const limit = Number(input.limit ?? (kind === "search" ? 5 : 10));
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Choose a result/page limit from 1 to 100.");
    const country = String(input.country || "IN").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country))
      throw new Error("Use a two-letter country code such as IN.");
    const run = { id: id(), target, dial_code: dial(input.dial_code), country };
    this.store.run(
      "INSERT INTO source_runs(id,kind,target,status,page_limit,dial_code,country,created_at,updated_at) VALUES(?,?,?,'starting',?,?,?,?,?)",
      run.id,
      kind,
      target,
      limit,
      run.dial_code,
      country,
      now(),
      now(),
    );
    this.active = true;
    try {
      const options = {
        formats: ["markdown", "links"],
        onlyMainContent: false,
        timeout: 45000,
      };
      const payload =
        kind === "search"
          ? {
              query: target,
              limit,
              sources: ["web"],
              country,
              ...(input.location
                ? { location: text(input.location, 200) }
                : {}),
            }
          : kind === "scrape"
            ? { url: target, ...options }
            : {
                url: target,
                limit,
                crawlEntireDomain: true,
                allowExternalLinks: false,
                allowSubdomains: false,
                ignoreQueryParameters: true,
                scrapeOptions: options,
              };
      const result = await this.request("/" + kind, payload);
      if (this.closed) throw new Error("Source research is closed.");
      let count = 0;
      if (kind === "crawl") {
        if (
          typeof result.id !== "string" ||
          !/^[A-Za-z0-9_-]{1,100}$/.test(result.id)
        )
          throw new Error(
            "Firecrawl returned an invalid crawl identifier. Check the account before retrying.",
          );
        this.store.run(
          "UPDATE source_runs SET external_id=?,status='running',updated_at=? WHERE id=?",
          result.id,
          now(),
          run.id,
        );
      } else {
        const pages =
          kind === "search"
            ? Array.isArray(result.data)
              ? result.data
              : result.data?.web
            : [result.data];
        if (
          !Array.isArray(pages) ||
          pages.some((x) => !x || typeof x !== "object")
        )
          throw new Error("Firecrawl returned invalid source pages.");
        for (const page of pages.slice(0, kind === "search" ? limit : 1)) {
          try {
            this.savePage(page, run, kind === "scrape");
            count++;
          } catch {}
        }
        if (!count && pages.length)
          throw new Error(
            "Firecrawl returned no usable public source pages. Check the URL before retrying.",
          );
        this.store.run(
          "UPDATE source_runs SET status='completed',completed=?,total=?,credits=?,updated_at=? WHERE id=?",
          count,
          count,
          Number.isFinite(result.creditsUsed) ? result.creditsUsed : null,
          now(),
          run.id,
        );
      }
      this.store.activity(
        "source_research",
        `Firecrawl ${kind}: ${count} pages saved${kind === "crawl" ? "; crawl running" : ""}.`,
      );
      return { ok: true, id: run.id, saved: count };
    } catch (error) {
      if (!this.closed)
        this.store.run(
          "UPDATE source_runs SET status='uncertain',error=?,updated_at=? WHERE id=?",
          error.message,
          now(),
          run.id,
        );
      throw error;
    } finally {
      this.active = false;
    }
  }
  async poll() {
    if (this.polling || this.closed || !this.key()) return;
    const run = this.store.one(
      "SELECT * FROM source_runs WHERE status IN ('running','collecting') ORDER BY updated_at LIMIT 1",
    );
    if (!run) return;
    this.polling = true;
    try {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(run.external_id || ""))
        throw new Error("Firecrawl crawl identifier is invalid.");
      const path =
        run.cursor || "/crawl/" + encodeURIComponent(run.external_id);
      const r = await this.request(path);
      if (
        this.closed ||
        this.store.one("SELECT status FROM source_runs WHERE id=?", run.id)
          ?.status === "cancelled"
      )
        return;
      let saved = this.store.one(
        "SELECT COUNT(*) AS n FROM source_pages WHERE run_id=?",
        run.id,
      ).n;
      for (const page of (Array.isArray(r.data) ? r.data : []).slice(
        0,
        run.page_limit,
      )) {
        const raw = page.metadata?.sourceURL || page.metadata?.url || page.url;
        try {
          const url = publicUrl(raw);
          if (
            new URL(url).hostname.replace(/^www\./, "") !==
            new URL(run.target).hostname.replace(/^www\./, "")
          )
            continue;
          const existing = this.store.one(
            "SELECT run_id FROM source_pages WHERE url=?",
            url,
          );
          if (saved >= run.page_limit && existing?.run_id !== run.id) continue;
          this.savePage({ ...page, url }, run, true);
          if (existing?.run_id !== run.id) saved++;
        } catch {}
      }
      let cursor = "";
      if (r.next && saved < run.page_limit) {
        const next = new URL(r.next);
        if (
          next.origin !== "https://api.firecrawl.dev" ||
          next.pathname !== "/v2/crawl/" + run.external_id ||
          !/^\?skip=\d+$/.test(next.search)
        )
          throw new Error("Firecrawl returned an invalid continuation URL.");
        cursor = next.pathname.slice(3) + next.search;
      }
      const status =
        r.status === "completed"
          ? cursor
            ? "collecting"
            : "completed"
          : ["failed", "cancelled"].includes(r.status)
            ? r.status
            : "running";
      this.store.run(
        "UPDATE source_runs SET status=?,completed=?,total=?,credits=?,cursor=?,error=NULL,updated_at=? WHERE id=?",
        status,
        Math.min(run.page_limit, Number(r.completed) || saved),
        Math.min(run.page_limit, Number(r.total) || saved),
        Number.isFinite(r.creditsUsed) ? r.creditsUsed : null,
        cursor,
        now(),
        run.id,
      );
    } catch (error) {
      if (!this.closed)
        this.store.run(
          "UPDATE source_runs SET error=?,updated_at=? WHERE id=?",
          error.message,
          now(),
          run.id,
        );
    } finally {
      this.polling = false;
    }
  }
  async cancel(runId) {
    const run = this.store.one(
      "SELECT * FROM source_runs WHERE id=? AND status IN ('running','collecting')",
      runId,
    );
    if (!run) throw new Error("No running crawl was found.");
    await this.request(
      "/crawl/" + encodeURIComponent(run.external_id),
      undefined,
      "DELETE",
    );
    this.store.run(
      "UPDATE source_runs SET status='cancelled',cursor='',updated_at=? WHERE id=?",
      now(),
      run.id,
    );
    return { ok: true };
  }
  importContact(input) {
    const page = this.detail(input.page_id);
    const p = phone(input.phone);
    const candidate = page.candidates.find((x) => x.phone === p);
    if (!candidate)
      throw new Error("Select a phone number found on this source page.");
    return this.store.importContacts([
      {
        phone: p,
        name: text(input.name || page.title, 200),
        company: text(input.company || page.title, 300),
        source: page.url,
        notes: `Found on ${page.url}\nEvidence: ${candidate.evidence}`,
      },
    ]);
  }
  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
  }
}
