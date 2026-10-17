import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  mkdirSync,
  openSync,
  writeFileSync,
  readFileSync,
  closeSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { Store, text } from "./store.mjs";
import { Model } from "./model.mjs";
import { WhatsApp } from "./transport.mjs";
import { Agent } from "./agent.mjs";
import { csvRows, csvExport, legacyRows, loadSavedDirectory } from "./import.mjs";
export async function createApp({
  dataDir = process.env.ORACLE_LEADS_DATA ||
    join(homedir(), ".local/share/oracle-leads"),
  loadSavedContacts = dataDir === join(homedir(), ".local/share/oracle-leads"),
  savedContactsLoader = legacyRows,
  modelFactory = (s) => new Model(s),
  transportFactory = (s, receive) => new WhatsApp(s, receive),
} = {}) {
  process.umask(0o077);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = join(dataDir, "service.lock");
  let lock;
  try {
    lock = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner;
    try {
      owner = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      throw new Error(
        "Workspace lock is unreadable. Inspect it before starting another service.",
      );
    }
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") alive = false;
    }
    if (alive)
      throw new Error(
        "This workspace is already open in another Oracle Leads service.",
      );
    unlinkSync(lockPath);
    lock = openSync(lockPath, "wx", 0o600);
  }
  const nonce = randomBytes(16).toString("hex");
  writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce }));
  closeSync(lock);
  const store = new Store(join(dataDir, "oracle-leads.sqlite"));
  if(loadSavedContacts) await loadSavedDirectory(store,savedContactsLoader);
  const model = modelFactory(store);
  let agent;
  const transport = transportFactory(store, (e) => agent.receive(e));
  agent = new Agent(store, model, transport);
  const token = randomBytes(32).toString("hex");
  const keyPath = join(dataDir, ".session-key");
  writeFileSync(keyPath, token, { mode: 0o600 });
  const server = http.createServer(async (req, res) => {
    const send = (status, value, type = "application/json") => {
      res.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      res.end(type === "application/json" ? JSON.stringify(value) : value);
    };
    try {
      const host = req.headers.host || "";
      if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host))
        return send(403, { error: "Loopback host required." });
      if (req.headers.origin && req.headers.origin !== `http://${host}`)
        return send(403, { error: "Origin rejected." });
      const url = new URL(req.url, `http://${host}`),
        path = url.pathname;
      if (path === "/api/bootstrap" && req.method === "GET") {
        const supplied = req.headers["x-oracle-key"] || "";
        if (
          typeof supplied !== "string" ||
          supplied.length !== token.length ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
        )
          return send(401, { error: "Private local session key required." });
        res.setHeader(
          "Set-Cookie",
          `oracle_leads=${token}; HttpOnly; SameSite=Strict; Path=/`,
        );
        return send(200, { ok: true });
      }
      const value =
        /oracle_leads=([a-f0-9]+)/.exec(req.headers.cookie || "")?.[1] || "";
      if (
        value.length !== token.length ||
        !timingSafeEqual(Buffer.from(value), Buffer.from(token))
      )
        return send(401, {
          error: "Open Oracle Leads to initialize the local session.",
        });
      if (req.method === "GET") {
        if (path === "/api/state")
          return send(200, {
            ...store.state(),
            whatsapp: transport.status(),
            agent_busy: agent.busy,
          });
        if (path === "/api/provider") return send(200, await model.status());
        if (path.startsWith("/api/contact/"))
          return send(200, store.detail(path.split("/").pop()));
        if (path === "/api/export") return send(200, store.backup());
        if (path === "/api/export.csv")
          return send(
            200,
            csvExport(store.state().contacts),
            "text/csv; charset=utf-8",
          );
        return send(404, { error: "Route not found." });
      }
      if (
        req.method !== "POST" ||
        req.headers["x-oracle-request"] !== "1" ||
        !String(req.headers["content-type"]).startsWith("application/json")
      )
        return send(403, {
          error: "Explicit JSON application request required.",
        });
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 6000000) {
          send(413, { error: "Request is too large." });
          return;
        }
      }
      const body = JSON.parse(raw || "{}");
      if (path === "/api/settings") return send(200, store.saveSettings(body));
      if (path === "/api/contacts/refresh") return send(200,await transport.refreshContacts());
      if (path === "/api/whatsapp/connect")
        return send(200, await transport.connect({ qr: true }));
      if (path === "/api/whatsapp/pair-phone")
        return send(200, await transport.pairPhone(body.phone));
      if (path === "/api/whatsapp/disconnect") {
        transport.disconnect();
        store.saveSettings({ automation_paused: true });
        return send(200, { ok: true });
      }
      if (path === "/api/whatsapp/unlink") {
        await transport.unlink();
        return send(200, { ok: true });
      }
      if (path === "/api/import")
        return send(
          200,
          store.importContacts(
            body.csv !== undefined ? csvRows(body.csv) : body.contacts,
          ),
        );
      if (path === "/api/import-legacy")
        return send(200, store.importContacts(await legacyRows()));
      if (path === "/api/restore") {
        let backup = body.backup;
        if (body.path !== undefined) {
          const file = text(body.path, 4000);
          if (statSync(file).size > 128 * 1024 * 1024)
            throw new Error("Restore files are limited to 128 MB.");
          backup = JSON.parse(readFileSync(file, "utf8"));
        }
        return send(200, store.restore(backup));
      }
      if (path === "/api/contact/update")
        return send(
          200,
          store.patchContact(body.id, body.patch, transport.status().phone),
        );
      if (path === "/api/contact/delete") {
        const c = store.contact(body.id);
        store.run("DELETE FROM contacts WHERE id=?", c.id);
        store.set(`directory_deleted:${c.phone}`,true);
        store.run("DELETE FROM activity WHERE contact_id=?", c.id);
        store.activity(
          "contact_deleted",
          "Contact, messages, meetings and relationship memories deleted.",
        );
        return send(200, { ok: true });
      }
      if (path === "/api/memory") {
        store.memory(body.contact_id, body.content);
        return send(200, { ok: true });
      }
      if (path === "/api/memory/delete") {
        store.run("DELETE FROM memories WHERE id=?", body.id);
        return send(200, { ok: true });
      }
      if (path === "/api/memory/update") {
        if (!store.one("SELECT id FROM memories WHERE id=?", body.id))
          throw new Error("Memory not found.");
        store.run(
          "UPDATE memories SET content=?,kind='operator_correction' WHERE id=?",
          text(body.content, 12000),
          body.id,
        );
        store.activity(
          "memory_corrected",
          "Relationship memory corrected by the operator.",
        );
        return send(200, { ok: true });
      }
      if (path === "/api/meeting") return send(200, store.createMeeting(body));
      if (path === "/api/meeting/update") {
        const previous = store.one(
          "SELECT * FROM meetings WHERE id=?",
          body.id,
        );
        const result = store.updateMeeting(body.id, body);
        const link =
          body.status === "successful"
            ? store.settings().success_link
            : body.status === "unsuccessful"
              ? store.settings().unsuccessful_link
              : "";
        const key = `meeting_followup:${body.id}:${body.status}`;
        if (
          previous.status !== body.status &&
          link &&
          !store.get(key) &&
          store.allowed(result.contact_id, transport.status().phone)
        ) {
          const job = store.enqueue(
            result.contact_id,
            "meeting_followup",
            `Thank you for your time. ${link}`,
            transport.status().phone,
            null,
            store.settings().reply_mode === "auto" ? "ready" : "draft",
          );
          store.set(key, job);
          store.activity(
            "meeting_followup",
            "Configured meeting outcome link prepared for the permitted contact.",
            result.contact_id,
          );
        }
        return send(200, result);
      }
      if (path === "/api/meeting/delete") {
        const m = store.one("SELECT * FROM meetings WHERE id=?", body.id);
        if (!m) throw new Error("Meeting not found.");
        store.run("DELETE FROM meetings WHERE id=?", body.id);
        store.activity(
          "meeting_deleted",
          "Local meeting record deleted.",
          m.contact_id,
        );
        return send(200, { ok: true });
      }
      if (path === "/api/draft/generate")
        return send(200, await agent.generateOpener(body.contact_id));
      if (path === "/api/draft")
        return send(200, {
          id: store.enqueue(
            body.contact_id,
            "manual",
            text(body.text, 5000),
            transport.status().phone,
            null,
            "draft",
          ),
        });
      if (path === "/api/draft/review") {
        agent.review(body.id, body.text, body.send === true);
        return send(200, { ok: true });
      }
      if (path === "/api/draft/cancel") {
        store.run(
          "UPDATE jobs SET status='cancelled' WHERE id=? AND status IN ('queued','draft','ready','failed')",
          body.id,
        );
        return send(200, { ok: true });
      }
      if (path === "/api/draft/resolve") {
        const job = store.one(
          "SELECT * FROM jobs WHERE id=? AND status='uncertain'",
          body.id,
        );
        if (!job) throw new Error("Uncertain operation not found.");
        if (!["sent", "cancelled"].includes(body.status))
          throw new Error("Choose sent or cancelled after checking WhatsApp.");
        store.run(
          "UPDATE jobs SET status=?,updated_at=? WHERE id=?",
          body.status,
          new Date().toISOString(),
          job.id,
        );
        store.run(
          "UPDATE messages SET status=? WHERE external_id=?",
          body.status,
          job.external_id,
        );
        store.activity(
          "send_resolved",
          `Uncertain send manually marked ${body.status}.`,
          job.contact_id,
        );
        return send(200, { ok: true });
      }
      if (path === "/api/chat")
        return send(200, await agent.chat(body.message));
      return send(404, { error: "Route not found." });
    } catch (error) {
      send(400, {
        error:
          error instanceof SyntaxError
            ? "Invalid JSON request."
            : error.message || "Request failed.",
      });
    }
  });
  const backupTimer = setInterval(() => {
    try {
      store.autoBackup();
    } catch {
      store.activity(
        "backup_error",
        "Automatic backup failed. Export a memory backup manually.",
      );
    }
  }, 3600000);
  const worker = setInterval(() => agent.tick().catch(() => {}), 1200),
    heartbeat = setInterval(() => store.heartbeat(), 5000);
  // Reuse an explicitly linked account; the store keeps outreach paused on startup.
  void transport.resumeSession?.().catch(() => {});
  return {
    localToken: token,
    server,
    store,
    agent,
    transport,
    close: async () => {
      agent.stopping = true;
      clearInterval(worker);
      clearInterval(heartbeat);
      clearInterval(backupTimer);
      model.cancel?.();
      transport.disconnect();
      await new Promise((resolve) => server.close(resolve));
      for (let i = 0; i < 50 && agent.busy; i++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      store.close();
      try {
        if (readFileSync(keyPath, "utf8") === token) unlinkSync(keyPath);
        if (JSON.parse(readFileSync(lockPath, "utf8")).nonce === nonce)
          unlinkSync(lockPath);
      } catch {}
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const portIndex = process.argv.indexOf("--port");
  const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 4317;
  const app = await createApp();
  app.server.listen(port, "127.0.0.1", () => {
    console.log(
      JSON.stringify({ ready: true, port: app.server.address().port }),
    );
  });
  let stopping = false;
  const parentPid = Number(process.env.ORACLE_LEADS_PARENT_PID || 0);
  if (parentPid) {
    const watchdog = setInterval(async () => {
      if (process.ppid !== parentPid && !stopping) {
        stopping = true;
        clearInterval(watchdog);
        await app.close();
        process.exit(0);
      }
    }, 1000);
    watchdog.unref();
  }
  for (const sig of ["SIGINT", "SIGTERM"])
    process.on(sig, async () => {
      if (stopping) return;
      stopping = true;
      await app.close();
      process.exit(0);
    });
}
