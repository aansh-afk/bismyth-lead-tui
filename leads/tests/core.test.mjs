import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, now } from "../server/store.mjs";
import { Agent } from "../server/agent.mjs";
import { csvRows, csvExport } from "../server/import.mjs";
import { codexArgs, modelResult, cleanEnvironment } from "../server/model.mjs";
import { createApp } from "../server/index.mjs";
const sender = "+12025550199";
const output = {
  reply: "Would a short Atlas walkthrough help?",
  summary: "The contact asked to learn about Atlas.",
  stage: "interested",
  optOut: false,
};
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "oracle-leads-test-")),
    store = new Store(join(dir, "test.sqlite"));
  const sent = [],
    calls = [];
  let handler = async () => output;
  const model = {
    complete: async (context) => {
      calls.push(context);
      return handler(context);
    },
  };
  const transport = {
    state: { status: "connected", phone: sender },
    status() {
      return this.state;
    },
    async send(number, text, externalId) {
      sent.push({ number, text, externalId });
      if (options.failSend) throw new Error("Fixture ambiguous transport");
      return externalId;
    },
  };
  const agent = new Agent(store, model, transport);
  store.importContacts([
    {
      phone: "+12025550101",
      name: "Fixture One",
      company: "Synthetic Brokerage",
    },
    { phone: "+12025550102", name: "Fixture Two" },
  ]);
  const contacts = store.all("SELECT * FROM contacts ORDER BY phone");
  store.bindSender(sender);
  store.saveSettings({
    quiet_start: 0,
    quiet_end: 0,
    automation_paused: false,
  });
  const activate = (c = contacts[0]) =>
    store.patchContact(c.id, { consent: true, active: true }, sender);
  const event = (c = contacts[0], overrides = {}) => ({
    contactId: c.id,
    sender,
    externalId: "fixture-inbound-" + Math.random(),
    text: "Can I learn more about Atlas?",
    timestamp: new Date(Date.now() + 1000).toISOString(),
    historical: false,
    ...overrides,
  });
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    store,
    agent,
    transport,
    model,
    calls,
    sent,
    contacts,
    activate,
    event,
    dir,
    setHandler: (fn) => (handler = fn),
  };
}
test("imports are deduplicated and cannot activate contacts from imported flags", (t) => {
  const f = fixture(t);
  const c = f.contacts[0];
  assert.equal(c.active, 0);
  assert.equal(c.consent, 0);
  const result = f.store.importContacts([
    { phone: c.phone, active: true, consent: true },
    { phone: "555", name: "Invalid" },
  ]);
  assert.equal(result.duplicates, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(f.store.contact(c.id).active, 0);
});
test("permission and paired sender are required for activation", (t) => {
  const f = fixture(t);
  assert.throws(
    () => f.store.patchContact(f.contacts[0].id, { active: true }, sender),
    /permission/,
  );
  assert.throws(
    () =>
      f.store.patchContact(
        f.contacts[0].id,
        { active: true, consent: true },
        null,
      ),
    /Pair/,
  );
  f.activate();
  assert.equal(f.store.allowed(f.contacts[0].id, sender), true);
});
test("unscoped, historical and unknown messages never reach storage or model", async (t) => {
  const f = fixture(t);
  assert.equal(f.agent.receive(f.event()), false);
  f.activate();
  assert.equal(
    f.agent.receive(f.event(undefined, { historical: true })),
    false,
  );
  assert.equal(
    f.agent.receive(f.event(undefined, { contactId: "unknown" })),
    false,
  );
  assert.equal(
    f.agent.receive(f.event(undefined, { timestamp: "invalid" })),
    false,
  );
  assert.equal(
    f.agent.receive(f.event(undefined, { sender: "+12025550198" })),
    false,
  );
  await f.agent.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.all("SELECT * FROM messages").length, 0);
});
test("old timestamps and duplicate inbound IDs cannot queue duplicate replies", async (t) => {
  const f = fixture(t);
  f.activate();
  assert.equal(
    f.agent.receive(f.event(undefined, { timestamp: "2020-01-01T00:00:00Z" })),
    false,
  );
  const e = f.event();
  assert.equal(f.agent.receive(e), true);
  assert.equal(f.agent.receive(e), false);
  await f.agent.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.store.all("SELECT * FROM jobs").length, 1);
});
test("opt-out immediately disables scope without an inference call", async (t) => {
  const f = fixture(t);
  f.activate();
  f.agent.receive(f.event(undefined, { text: "Please stop contacting me" }));
  await f.agent.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.store.contact(f.contacts[0].id).opted_out, 1);
  assert.equal(f.store.contact(f.contacts[0].id).active, 0);
});
test("model opt-out cannot produce a customer send", async (t) => {
  const f = fixture(t);
  f.activate();
  f.setHandler(async () => ({ ...output, optOut: true, reply: "" }));
  f.agent.receive(f.event());
  await f.agent.tick();
  assert.equal(f.store.contact(f.contacts[0].id).opted_out, 1);
  assert.equal(f.sent.length, 0);
});
test("review mode saves source-linked memory and a draft without sending", async (t) => {
  const f = fixture(t);
  f.activate();
  f.agent.receive(f.event());
  await f.agent.tick();
  const detail = f.store.detail(f.contacts[0].id);
  assert.equal(detail.jobs[0].status, "draft");
  assert.equal(detail.memories[0].source_id, detail.messages[0].id);
  assert.equal(f.sent.length, 0);
  assert.equal(f.calls[0].messages.length, 1);
  assert.equal(f.calls[0].contact.company, "Synthetic Brokerage");
});
test("auto mode dispatches once using the same sender and stable external ID", async (t) => {
  const f = fixture(t);
  f.store.saveSettings({ reply_mode: "auto" });
  f.activate();
  f.agent.receive(f.event());
  await f.agent.tick();
  await f.agent.tick();
  await f.agent.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].number, f.contacts[0].phone);
  assert.match(f.sent[0].externalId, /^[A-F0-9]{32}$/);
  assert.equal(f.store.state().analytics.sent, 1);
});
test("deactivation during inference cancels the generated reply", async (t) => {
  const f = fixture(t);
  f.activate();
  let finish;
  f.setHandler(() => new Promise((resolve) => (finish = resolve)));
  f.agent.receive(f.event());
  const tick = f.agent.tick();
  assert.equal(f.agent.busy, true);
  f.store.patchContact(f.contacts[0].id, { active: false }, sender);
  finish(output);
  await tick;
  assert.equal(f.sent.length, 0);
  assert.equal(f.store.one("SELECT status FROM jobs").status, "cancelled");
  assert.equal(f.store.all("SELECT * FROM memories").length, 0);
});
test("human takeover during inference prevents dispatch", async (t) => {
  const f = fixture(t);
  f.activate();
  let finish;
  f.setHandler(() => new Promise((resolve) => (finish = resolve)));
  f.agent.receive(f.event());
  const tick = f.agent.tick();
  f.store.patchContact(f.contacts[0].id, { auto_reply: false }, sender);
  finish(output);
  await tick;
  assert.equal(f.store.one("SELECT status FROM jobs").status, "cancelled");
});
test("provider changes during generation invalidate the result", async (t) => {
  const f = fixture(t);
  f.activate();
  let finish;
  f.setHandler(() => new Promise((resolve) => (finish = resolve)));
  f.agent.receive(f.event());
  const tick = f.agent.tick();
  f.store.saveSettings({ provider: "selfhost" });
  finish(output);
  await tick;
  assert.equal(f.store.one("SELECT status FROM jobs").status, "cancelled");
});
test("worker serialization prevents two simultaneous inferences", async (t) => {
  const f = fixture(t);
  f.activate();
  let finish;
  f.setHandler(() => new Promise((resolve) => (finish = resolve)));
  f.agent.receive(f.event());
  const tick = f.agent.tick();
  await f.agent.tick();
  assert.equal(f.calls.length, 1);
  finish(output);
  await tick;
});
test("newer inbound messages invalidate stale generated drafts", async (t) => {
  const f = fixture(t);
  f.activate();
  f.agent.receive(
    f.event(undefined, {
      timestamp: new Date(Date.now() + 1000).toISOString(),
    }),
  );
  await f.agent.tick();
  const draft = f.store.one("SELECT * FROM jobs WHERE status='draft'");
  f.agent.receive(
    f.event(undefined, {
      timestamp: new Date(Date.now() + 2000).toISOString(),
    }),
  );
  assert.throws(
    () => f.agent.review(draft.id, draft.text, true),
    /no longer reviewable/,
  );
  assert.equal(f.sent.length, 0);
});
test("sender changes suspend contacts and cancel queued messages", (t) => {
  const f = fixture(t);
  f.activate();
  const job = f.store.enqueue(
    f.contacts[0].id,
    "manual",
    "Hello",
    sender,
    null,
    "draft",
  );
  f.store.bindSender("+12025550198");
  assert.equal(f.store.contact(f.contacts[0].id).active, 0);
  assert.equal(
    f.store.one("SELECT status FROM jobs WHERE id=?", job).status,
    "cancelled",
  );
});
test("permission is rechecked just before a queued send", async (t) => {
  const f = fixture(t);
  f.activate();
  const job = f.store.enqueue(
    f.contacts[0].id,
    "manual",
    "Hello",
    sender,
    null,
    "draft",
  );
  f.agent.review(job, "Hello", true);
  f.store.patchContact(f.contacts[0].id, { consent: false }, sender);
  await f.agent.tick();
  assert.equal(f.sent.length, 0);
});
test("quiet hours retain the queue without performing transport calls", async (t) => {
  const f = fixture(t);
  const hour = new Date().getHours();
  f.store.saveSettings({ quiet_start: hour, quiet_end: (hour + 1) % 24 });
  f.activate();
  const job = f.store.enqueue(
    f.contacts[0].id,
    "manual",
    "Hello",
    sender,
    null,
    "draft",
  );
  f.agent.review(job, "Hello", true);
  await f.agent.tick();
  assert.equal(f.sent.length, 0);
  assert.equal(
    f.store.one("SELECT status FROM jobs WHERE id=?", job).status,
    "ready",
  );
});
test("daily limits include uncertain transport attempts", async (t) => {
  const f = fixture(t);
  f.store.saveSettings({ daily_limit: 1 });
  f.activate();
  f.activate(f.contacts[1]);
  f.store.addMessage(f.contacts[1].id, "out", "Earlier attempt", "uncertain");
  const job = f.store.enqueue(
    f.contacts[0].id,
    "manual",
    "Hello",
    sender,
    null,
    "draft",
  );
  f.agent.review(job, "Hello", true);
  await f.agent.tick();
  assert.equal(f.sent.length, 0);
});
test("ambiguous sends become uncertain and are not automatically retried", async (t) => {
  const f = fixture(t, { failSend: true });
  f.activate();
  const job = f.store.enqueue(
    f.contacts[0].id,
    "manual",
    "Hello",
    sender,
    null,
    "draft",
  );
  f.agent.review(job, "Hello", true);
  await f.agent.tick();
  await f.agent.tick();
  assert.equal(f.sent.length, 1);
  assert.equal(
    f.store.one("SELECT status FROM jobs WHERE id=?", job).status,
    "uncertain",
  );
  assert.equal(
    f.store.one("SELECT status FROM messages WHERE direction='out'").status,
    "uncertain",
  );
});
test("memory cannot cite another customer’s source message", (t) => {
  const f = fixture(t);
  const message = f.store.addMessage(f.contacts[1].id, "in", "Private fixture");
  assert.throws(
    () => f.store.memory(f.contacts[0].id, "Wrong source", message),
    /belong/,
  );
});
test("meeting lifecycle is persistent and does not claim external delivery", (t) => {
  const f = fixture(t);
  const m = f.store.createMeeting({
    contact_id: f.contacts[0].id,
    title: "Fixture demo",
    starts_at: "2030-01-01T10:00:00Z",
  });
  assert.equal(f.store.state().analytics.meetings, 1);
  f.store.updateMeeting(m.id, {
    status: "successful",
    notes: "Fixture outcome",
  });
  assert.equal(f.store.state().analytics.meetings, 0);
  assert.equal(
    f.store.detail(f.contacts[0].id).meetings[0].notes,
    "Fixture outcome",
  );
  assert.equal(f.sent.length, 0);
});
test("CSV quoted fields and spreadsheet-safe export round trip phone numbers", () => {
  const rows = csvRows(
    'name,phone,company\r\n"Example, One",+12025550101,"Line\nTwo"',
  );
  assert.equal(rows[0].name, "Example, One");
  assert.equal(rows[0].company, "Line\nTwo");
  const exported = csvExport([{ name: "=FORMULA", phone: "+12025550101" }]);
  assert.match(exported, /'=FORMULA/);
  assert.equal(csvRows(exported)[0].phone, "+12025550101");
  assert.throws(() => csvRows('name,phone\n"bad,+12025550101'), /unclosed/);
});
test("Codex invocation disables tools, uses subscription auth and hides secrets", () => {
  const args = codexArgs("/tmp/schema", "/tmp/result", "");
  assert.ok(args.includes('forced_login_method="chatgpt"'));
  assert.ok(args.includes("features.shell_tool=false"));
  assert.ok(args.includes("--ignore-user-config"));
  assert.ok(args.includes("features.plugins=false"));
  assert.equal(cleanEnvironment().ORACLE_API_KEY, undefined);
  assert.throws(() => modelResult({ ...output, stage: "client" }), /invalid/);
});
test("backup restore retains conversation memory and resets access, excluding auth", (t) => {
  const f = fixture(t);
  f.activate();
  const source = f.store.addMessage(
    f.contacts[0].id,
    "in",
    "Fixture customer question",
  );
  f.store.memory(f.contacts[0].id, "Fixture memory", source);
  f.store.run("INSERT INTO auth VALUES(?,?)", "secret", "must-not-export");
  const backup = f.store.backup();
  assert.equal(JSON.stringify(backup).includes("must-not-export"), false);
  const dir = mkdtempSync(join(tmpdir(), "oracle-leads-restore-")),
    restored = new Store(join(dir, "restored.sqlite"));
  t.after(() => {
    restored.close();
    rmSync(dir, { recursive: true, force: true });
  });
  restored.restore(backup);
  assert.equal(restored.state().contacts.length, 2);
  assert.equal(
    restored.detail(f.contacts[0].id).memories[0].content,
    "Fixture memory",
  );
  assert.equal(restored.contact(f.contacts[0].id).active, 0);
  assert.equal(restored.settings().automation_paused, true);
  assert.throws(() => restored.restore(backup), /empty/);
});
test("invalid backup rolls back all imported rows", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oracle-leads-invalid-")),
    s = new Store(join(dir, "test.sqlite"));
  t.after(() => {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const invalid = {
    version: 1,
    contacts: [{ id: "x", phone: "invalid", stage: "new" }],
  };
  assert.throws(() => s.restore(invalid));
  assert.equal(s.state().contacts.length, 0);
});
test("restart retains memory, marks interrupted sends uncertain, and starts paused", () => {
  const dir = mkdtempSync(join(tmpdir(), "oracle-leads-restart-"));
  try {
    let s = new Store(join(dir, "test.sqlite"));
    s.importContacts([{ phone: "+12025550101", name: "Fixture" }]);
    const c = s.state().contacts[0];
    s.patchContact(c.id, { consent: true, active: true }, sender);
    s.memory(c.id, "Persistent fixture memory");
    const job = s.enqueue(c.id, "manual", "Hello", sender, null, "sending");
    s.addMessage(c.id, "out", "Hello", "sending", "fixture-send");
    s.db.close();
    s = new Store(join(dir, "test.sqlite"));
    assert.equal(
      s.one("SELECT status FROM jobs WHERE id=?", job).status,
      "uncertain",
    );
    assert.equal(
      s.detail(c.id).memories[0].content,
      "Persistent fixture memory",
    );
    assert.equal(s.settings().automation_paused, true);
    assert.ok(s.state().runs.some((r) => r.status === "interrupted"));
    assert.equal(statSync(join(dir, "test.sqlite")).mode & 0o777, 0o600);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("real HTTP API checks session, origin, host, import, export and meetings", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oracle-leads-http-"));
  const app = await createApp({
    dataDir: dir,
    modelFactory: () => ({
      status: async () => ({ ready: true }),
      complete: async () => output,
    }),
    transportFactory: () => ({
      status: () => ({ status: "disconnected", phone: null }),
      disconnect() {},
    }),
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(base + "/api/state")).status, 401);
  assert.equal((await fetch(base + "/api/bootstrap")).status, 401);
  const bootstrap = await fetch(base + "/api/bootstrap", {
    headers: { "X-Oracle-Key": app.localToken },
  });
  const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
  const headers = {
    Cookie: cookie,
    "X-Oracle-Request": "1",
    "Content-Type": "application/json",
  };
  assert.equal(
    (
      await fetch(base + "/api/state", {
        headers: { ...headers, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  const post = async (path, body) =>
    (
      await fetch(base + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
    ).json();
  const imported = await post("/api/import", {
    contacts: [{ phone: "+12025550101", name: "HTTP Fixture", active: true }],
  });
  assert.equal(imported.added, 1);
  let state = await (await fetch(base + "/api/state", { headers })).json();
  assert.equal(state.contacts[0].active, 0);
  const c = state.contacts[0];
  assert.match(
    (
      await post("/api/contact/update", {
        id: c.id,
        patch: { active: true, consent: true },
      })
    ).error,
    /Pair/,
  );
  const m = await post("/api/meeting", {
    contact_id: c.id,
    starts_at: "2030-01-01T10:00:00Z",
  });
  assert.ok(m.id);
  await post("/api/meeting/delete", { id: m.id });
  assert.equal(app.store.state().meetings.length, 0);
  const backup = await (await fetch(base + "/api/export", { headers })).json();
  assert.equal(backup.contacts.length, 1);
  assert.equal(backup.auth, undefined);
  await post("/api/contact/delete", { id: c.id });
  assert.equal(app.store.state().contacts.length, 0);
});
test("a second service cannot open the same live workspace", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oracle-leads-lock-"));
  const app = await createApp({ dataDir: dir });
  t.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await assert.rejects(createApp({ dataDir: dir }), /already open/);
});
test("LIDs require an explicit phone mapping and groups cannot impersonate a contact", async () => {
  const { phoneForKey } = await import("../server/transport.mjs");
  assert.equal(
    await phoneForKey({ remoteJid: "12025550101@s.whatsapp.net" }),
    "+12025550101",
  );
  assert.equal(await phoneForKey({ remoteJid: "99999999999@lid" }), null);
  assert.equal(
    await phoneForKey({
      remoteJid: "99999999999@lid",
      remoteJidAlt: "12025550101@s.whatsapp.net",
    }),
    "+12025550101",
  );
  assert.equal(
    await phoneForKey(
      { remoteJid: "99999999999@lid" },
      async () => "12025550102@s.whatsapp.net",
    ),
    "+12025550102",
  );
  assert.equal(
    await phoneForKey({
      remoteJid: "123@g.us",
      remoteJidAlt: "12025550101@s.whatsapp.net",
    }),
    null,
  );
});
test("follow-up dates and next actions persist as relationship facts", (t) => {
  const f = fixture(t);
  f.store.patchContact(
    f.contacts[0].id,
    {
      next_action: "Call about their pilot",
      followup_at: "2030-01-01T10:00:00Z",
    },
    null,
  );
  assert.equal(
    f.store.contact(f.contacts[0].id).next_action,
    "Call about their pilot",
  );
  assert.equal(
    f.store.contact(f.contacts[0].id).followup_at,
    "2030-01-01T10:00:00.000Z",
  );
  assert.throws(
    () =>
      f.store.patchContact(f.contacts[0].id, { followup_at: "tomorrow" }, null),
    /valid/,
  );
});
test("meeting outcomes prepare the configured link once and memory corrections remain editable", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oracle-leads-outcomes-"));
  const app = await createApp({
    dataDir: dir,
    modelFactory: () => ({
      status: async () => ({ ready: true }),
      complete: async () => output,
    }),
    transportFactory: () => ({
      status: () => ({ status: "connected", phone: sender }),
      disconnect() {},
    }),
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const bootstrap = await fetch(base + "/api/bootstrap", {
    headers: { "X-Oracle-Key": app.localToken },
  });
  const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
  const post = async (path, body) =>
    (
      await fetch(base + path, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "X-Oracle-Request": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    ).json();
  app.store.importContacts([
    { phone: "+12025550101", name: "Outcome fixture" },
  ]);
  const c = app.store.state().contacts[0];
  app.store.patchContact(c.id, { active: true, consent: true }, sender);
  app.store.saveSettings({ success_link: "https://example.com/next-step" });
  const meeting = app.store.createMeeting({
    contact_id: c.id,
    starts_at: "2030-01-01T10:00:00Z",
  });
  await post("/api/meeting/update", { id: meeting.id, status: "successful" });
  await post("/api/meeting/update", { id: meeting.id, status: "successful" });
  assert.equal(app.store.all("SELECT * FROM jobs").length, 1);
  assert.equal(app.store.one("SELECT status FROM jobs").status, "draft");
  assert.match(
    app.store.one("SELECT text FROM jobs").text,
    /example.com\/next-step/,
  );
  app.store.memory(c.id, "Original fact");
  const memory = app.store.one("SELECT * FROM memories");
  await post("/api/memory/update", {
    id: memory.id,
    content: "Corrected fact",
  });
  assert.equal(
    app.store.one("SELECT content FROM memories").content,
    "Corrected fact",
  );
  assert.equal(
    app.store.one("SELECT kind FROM memories").kind,
    "operator_correction",
  );
});
test("generated opening messages always require exact review, even in automatic mode", async (t) => {
  const f = fixture(t);
  f.store.saveSettings({ reply_mode: "auto" });
  f.activate();
  const result = await f.agent.generateOpener(f.contacts[0].id);
  assert.equal(
    f.store.one("SELECT status FROM jobs WHERE id=?", result.id).status,
    "draft",
  );
  assert.equal(f.sent.length, 0);
  await assert.rejects(
    f.agent.generateOpener(f.contacts[0].id),
    /already exists/,
  );
});
test("revoking scope during an opener generation prevents it from being approved", async (t) => {
  const f = fixture(t);
  f.activate();
  let finish;
  f.setHandler(() => new Promise((resolve) => (finish = resolve)));
  const generation = f.agent.generateOpener(f.contacts[0].id);
  f.store.patchContact(f.contacts[0].id, { active: false }, sender);
  finish(output);
  await assert.rejects(generation, /changed/);
  const job = f.store.one("SELECT * FROM jobs");
  assert.throws(() => f.agent.review(job.id, "Any text", true), /changed/);
  assert.equal(f.sent.length, 0);
});
test("a new inbound reply cancels an already approved opener before dispatch", async (t) => {
  const f = fixture(t);
  f.activate();
  const job = f.store.enqueue(
    f.contacts[0].id,
    "manual",
    "Previously reviewed introduction",
    sender,
    null,
    "draft",
  );
  f.agent.review(job, "Previously reviewed introduction", true);
  f.agent.receive(f.event(undefined, { text: "Please wait until next week." }));
  assert.equal(
    f.store.one("SELECT status FROM jobs WHERE id=?", job).status,
    "cancelled",
  );
  assert.equal(f.sent.length, 0);
});
test("automatic backups are private and exclude paired account keys", (t) => {
  const f = fixture(t);
  f.store.run("INSERT INTO auth VALUES(?,?)", "creds", "private-fixture-key");
  const path = f.store.autoBackup();
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(
    readFileSync(path, "utf8").includes("private-fixture-key"),
    false,
  );
});
test("dashboard chat retrieves source-backed memory for the requested relationship", async (t) => {
  const f = fixture(t);
  const c = f.contacts[0];
  const message = f.store.addMessage(
    c.id,
    "in",
    "Please send a demo after Friday.",
  );
  f.store.memory(c.id, "Customer asked for a demo after Friday.", message);
  await f.agent.chat("What did Fixture One ask us to do?");
  const context = f.calls[0];
  assert.equal(context.mode, "operator_dashboard");
  assert.ok(
    context.related_contacts
      .find((record) => record.id === c.id)
      .memories.some((m) => m.source_id === message),
  );
  assert.ok(
    context.related_contacts
      .find((record) => record.id === c.id)
      .messages.some((m) => m.id === message),
  );
  assert.equal(f.sent.length, 0);
});
test("the authenticated API restores memory directly from a private local backup file", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "oracle-leads-path-restore-"));
  const source = new Store(join(dir, "source", "test.sqlite"));
  source.importContacts([{ phone: "+12025550101", name: "Restore fixture" }]);
  const backupPath = source.autoBackup();
  source.close();
  const app = await createApp({ dataDir: join(dir, "destination") });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const bootstrap = await fetch(base + "/api/bootstrap", {
    headers: { "X-Oracle-Key": app.localToken },
  });
  const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
  const response = await fetch(base + "/api/restore", {
    method: "POST",
    headers: {
      Cookie: cookie,
      "X-Oracle-Request": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: backupPath }),
  });
  assert.equal(response.status, 200);
  assert.equal(app.store.state().contacts[0].name, "Restore fixture");
  assert.equal(app.store.state().contacts[0].active, 0);
});
