const defaultModules = () => Promise.all([
  import("@whiskeysockets/baileys"), import("pino"), import("qrcode"),
]);
export function pairingPhone(value) {
  if (typeof value !== "string" || !/^\+?[0-9 ()-]+$/.test(value.trim()))
    throw new Error("Enter an international phone number with its country code.");
  const digits = value.trim().replace(/[+ ()-]/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits))
    throw new Error("Enter 8–15 digits including the country code; omit the local leading zero.");
  return digits;
}
export async function phoneForKey(key, lookup = async () => null) {
  const jid = key?.remoteJid || "";
  if (jid.endsWith("@g.us") || jid.endsWith("@broadcast")) return null;
  let resolved = jid;
  if (jid.endsWith("@lid"))
    resolved = key.remoteJidAlt?.endsWith("@s.whatsapp.net")
      ? key.remoteJidAlt
      : await lookup(jid);
  const match = /^([1-9]\d{7,14})(?::\d+)?@s\.whatsapp\.net$/.exec(
    resolved || "",
  );
  return match ? `+${match[1]}` : null;
}
export class WhatsApp {
  constructor(store, onMessage, { loadModules = defaultModules, pairingTimeoutMs = 20000 } = {}) {
    this.store = store;
    this.loadModules = loadModules;
    this.pairingTimeoutMs = pairingTimeoutMs;
    this.pairingReady = false;
    this.pairingAttempt = null;
    this.generation = 0;
    this.onMessage = onMessage;
    this.socket = null;
    this.connecting = false;
    this.timer = null;
    this.state = { status: "disconnected", phone: null, qr: null, error: null };
  }
  status() {
    return { ...this.state };
  }
  async connect({ qr = false } = {}) {
    if (qr && this.state.pairing_mode === "phone" && this.state.status !== "connected") {
      this.disconnect();
      const stored = this.store.one("SELECT value FROM auth WHERE key='creds'");
      if (stored && !JSON.parse(stored.value).registered) this.store.run("DELETE FROM auth");
    }
    if (this.connecting || this.socket) return this.status();
    clearTimeout(this.timer);
    this.connecting = true;
    const generation = ++this.generation;
    this.pairingReady = false;
    this.state = { status: "connecting", phone: null, qr: null, error: null };
    try {
      const [
        {
          default: makeSocket,
          BufferJSON,
          initAuthCreds,
          proto,
          DisconnectReason,
          jidDecode,
          Browsers,
        },
        { default: pino },
        { default: QRCode },
      ] = await this.loadModules();
      if (generation !== this.generation) return this.status();
      const get = (key) => {
        const row = this.store.one("SELECT value FROM auth WHERE key=?", key);
        return row ? JSON.parse(row.value, BufferJSON.reviver) : null;
      };
      const put = (key, value) => {
        this.store.run(
          "INSERT INTO auth VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          key,
          JSON.stringify(value, BufferJSON.replacer),
        );
      };
      const creds = get("creds") || initAuthCreds();
      const keys = {
        get: async (type, ids) =>
          Object.fromEntries(
            ids.map((key) => {
              let value = get(`${type}:${key}`);
              if (type === "app-state-sync-key" && value)
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              return [key, value];
            }),
          ),
        set: async (data) => {
          this.store.db.exec("BEGIN");
          try {
            for (const [type, values] of Object.entries(data))
              for (const [key, value] of Object.entries(values)) {
                if (value) put(`${type}:${key}`, value);
                else
                  this.store.run(
                    "DELETE FROM auth WHERE key=?",
                    `${type}:${key}`,
                  );
              }
            this.store.db.exec("COMMIT");
          } catch (error) {
            this.store.db.exec("ROLLBACK");
            throw error;
          }
        },
      };
      const scoped = (jid) => {
        const c = this.store.one(
          "SELECT id FROM contacts WHERE phone=?",
          `+${jidDecode(jid)?.user || ""}`,
        );
        return c && this.store.allowed(c.id, this.state.phone);
      };
      const sock = makeSocket({
        auth: { creds, keys },
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        shouldIgnoreJid: (jid) =>
          jid.endsWith("@g.us") ||
          jid.endsWith("@broadcast") ||
          (!jid.endsWith("@lid") && !scoped(jid)),
        markOnlineOnConnect: false,
        browser: Browsers.ubuntu("Chrome"),
      });
      this.socket = sock;
      sock.ev.on("creds.update", (update) => {
        if (this.socket !== sock) return;
        Object.assign(creds, update);
        put("creds", creds);
      });
      sock.ev.on("connection.update", (update) => {
        if (this.socket !== sock) return;
        if (update.connection === "connecting" || update.qr) this.pairingReady = true;
        if (update.qr && this.state.pairing_mode !== "phone") {
          const qr = QRCode.create(update.qr);
          this.state.qr_matrix = {
            size: qr.modules.size,
            data: Array.from(qr.modules.data),
          };
          this.state.status = "qr_ready";
        }
        if (update.connection === "open") {
          const raw = jidDecode(sock.user?.id)?.user || "";
          if (!/^\d{8,15}$/.test(raw)) {
            this.state.error = "Cannot verify the paired phone identity.";
            this.disconnect();
            return;
          }
          this.state = {
            status: "connected",
            phone: `+${raw}`,
            qr: null,
            error: null,
          };
          delete creds.pairingCode;
          put("creds", creds);
          this.store.bindSender(this.state.phone);
          this.store.activity(
            "whatsapp_connected",
            `Paired account ${this.state.phone} connected.`,
          );
        }
        if (update.connection === "close") {
          const code = update.lastDisconnect?.error?.output?.statusCode;
          this.socket = null;
          this.pairingReady = false;
          this.connecting = false;
          this.state = {
            status:
              code === DisconnectReason.loggedOut
                ? "logged_out"
                : "disconnected",
            phone: null,
            qr: null,
            error:
              code === DisconnectReason.loggedOut
                ? "Session logged out. Unlink locally before pairing again."
                : "Connection closed. Reconnect to continue.",
          };
          this.store.saveSettings({ automation_paused: true });
          if (
            (creds.registered || code === DisconnectReason.restartRequired) &&
            code !== DisconnectReason.loggedOut &&
            code !== DisconnectReason.connectionReplaced
          )
            this.timer = setTimeout(() => this.connect().catch(() => {}), 5000);
        }
      });
      const receiveMessages = async ({ messages, type }) => {
        if (type !== "notify" || this.state.status !== "connected") return;
        for (const m of messages) {
          if (!m.key?.id) continue;
          const number = await phoneForKey(m.key, (jid) =>
            sock.signalRepository.lidMapping.getPNForLID(jid),
          );
          if (
            !number ||
            this.socket !== sock ||
            this.state.status !== "connected"
          )
            continue;
          const c = this.store.one(
            "SELECT * FROM contacts WHERE phone=?",
            number,
          );
          if (!c || !this.store.allowed(c.id, this.state.phone)) continue;
          const content = m.message?.ephemeralMessage?.message || m.message;
          const body =
            content?.conversation || content?.extendedTextMessage?.text;
          if (!body) continue;
          const timestamp = new Date(Number(m.messageTimestamp) * 1000);
          if (!Number.isFinite(timestamp.getTime())) continue;
          if (timestamp.toISOString() < c.activated_at) continue;
          if (m.key.fromMe) {
            if (
              !this.store.one(
                "SELECT id FROM messages WHERE external_id=? AND direction='out'",
                m.key.id,
              )
            ) {
              this.store.addMessage(
                c.id,
                "out",
                body,
                "sent",
                m.key.id,
                timestamp.toISOString(),
              );
              this.store.patchContact(
                c.id,
                { auto_reply: false },
                this.state.phone,
              );
              this.store.activity(
                "human_takeover",
                "A manual phone reply paused automatic replies for this contact.",
                c.id,
              );
            }
            continue;
          }
          Promise.resolve(
            this.onMessage({
              contactId: c.id,
              sender: this.state.phone,
              externalId: m.key.id,
              text: body,
              timestamp: timestamp.toISOString(),
              historical: false,
            }),
          ).catch(() =>
            this.store.activity(
              "inbound_error",
              "A scoped incoming message could not be processed.",
              c.id,
            ),
          );
        }
      };
      sock.ev.on("messages.upsert", (event) => {
        void receiveMessages(event).catch(() => {
          if (this.socket === sock)
            this.store.activity(
              "inbound_error",
              "An incoming event could not be processed; no automatic reply was sent.",
            );
        });
      });
      sock.ev.on("messages.update", (updates) => {
        for (const { key, update } of updates) {
          if (!key.fromMe || !key.id) continue;
          const status = Number(update.status);
          if (status >= 3) {
            this.store.run(
              "UPDATE messages SET status=? WHERE external_id=? AND direction='out'",
              status >= 4 ? "read" : "delivered",
              key.id,
            );
          }
        }
      });
      return this.status();
    } catch {
      if (generation !== this.generation) return this.status();
      this.socket = null;
      this.state = {
        status: "disconnected",
        phone: null,
        qr: null,
        error:
          "WhatsApp connection failed. Check network access and the installed Baileys version.",
      };
      return this.status();
    } finally {
      if (generation === this.generation) this.connecting = false;
    }
  }
  async pairPhone(value) {
    const digits = pairingPhone(value);
    const stored = this.store.one("SELECT value FROM auth WHERE key='creds'");
    if (this.state.status === "connected" || (stored && JSON.parse(stored.value).registered))
      throw new Error("An account is already linked. Reconnect it, or unlink before choosing a different number.");
    if (this.pairingAttempt) throw new Error("A pairing request is already in progress.");
    const attempt = Symbol("pairing");
    this.pairingAttempt = attempt;
    let sock;
    try {
      await this.connect();
      if (this.pairingAttempt !== attempt) throw new Error("Pairing cancelled.");
      this.state = { ...this.state, status: "pairing_requesting", pairing_mode: "phone", pairing_phone: `+${digits}`, pairing_code: null, qr_matrix: undefined, error: null };
      await new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          if (this.pairingAttempt !== attempt || (!this.socket && !this.connecting)) return finish(new Error("Pairing connection closed. Try again."));
          if (this.socket && this.pairingReady) return finish();
          if (Date.now() - start >= this.pairingTimeoutMs) return finish(new Error("Pairing connection timed out. Try again."));
        };
        const finish = (error) => { clearInterval(timer); error ? reject(error) : resolve(); };
        const timer = setInterval(check, 25);
        check();
      });
      sock = this.socket;
      let timer;
      const code = await Promise.race([
        sock.requestPairingCode(digits),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Pairing request timed out.")), this.pairingTimeoutMs); }),
      ]).finally(() => clearTimeout(timer));
      if (this.socket !== sock || this.pairingAttempt !== attempt || this.state.status === "connected") return this.status();
      if (!/^[A-Z0-9]{8}$/i.test(code)) throw new Error("Invalid pairing code response.");
      this.state = { ...this.state, status: "pairing_code_ready", pairing_code: code };
      return this.status();
    } catch {
      if (this.pairingAttempt === attempt && this.state.status !== "connected") {
        const failedSocket=this.socket;
        this.socket=null;
        this.pairingReady=false;
        failedSocket?.end(undefined);
        this.state = { ...this.state, status: "pairing_error", pairing_code: null, error: "Could not get a pairing code. Check the number and connection, then try again or use QR." };
      }
      return this.status();
    } finally {
      if (this.pairingAttempt === attempt) this.pairingAttempt = null;
    }
  }
  async send(number, body, externalId) {
    if (!this.socket || this.state.status !== "connected")
      throw new Error("WhatsApp is disconnected.");
    const contact = this.store.one(
      "SELECT id FROM contacts WHERE phone=?",
      number,
    );
    if (!contact || !this.store.allowed(contact.id, this.state.phone))
      throw new Error("Contact is outside the paired account’s active scope.");
    const result = await this.socket.sendMessage(
      `${number.slice(1)}@s.whatsapp.net`,
      { text: body },
      { messageId: externalId },
    );
    if (!result?.key?.id)
      throw new Error("WhatsApp send outcome is uncertain.");
    return result.key.id;
  }
  disconnect() {
    this.generation++;
    this.pairingAttempt = null;
    this.pairingReady = false;
    clearTimeout(this.timer);
    const sock = this.socket;
    this.socket = null;
    this.connecting = false;
    this.state = { status: "disconnected", phone: null, qr: null, error: null };
    sock?.end(undefined);
  }
  async unlink() {
    this.generation++;
    this.pairingAttempt = null;
    this.pairingReady = false;
    const sock = this.socket;
    this.socket = null;
    clearTimeout(this.timer);
    if (sock) {
      try {
        await sock.logout();
      } catch {
        throw new Error(
          "Could not confirm unlink with WhatsApp. Remove Oracle Leads from Linked devices on your phone.",
        );
      }
    }
    this.store.run("DELETE FROM auth");
    this.store.run(
      "UPDATE contacts SET active=0,scope_version=scope_version+1",
    );
    this.store.saveSettings({ automation_paused: true });
    this.state = { status: "disconnected", phone: null, qr: null, error: null };
    this.store.activity(
      "whatsapp_unlinked",
      "Local pairing removed; contacts deactivated.",
    );
  }
}
