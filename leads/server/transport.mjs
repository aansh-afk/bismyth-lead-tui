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
  constructor(store, onMessage) {
    this.store = store;
    this.onMessage = onMessage;
    this.socket = null;
    this.connecting = false;
    this.timer = null;
    this.state = { status: "disconnected", phone: null, qr: null, error: null };
  }
  status() {
    return { ...this.state };
  }
  async connect() {
    if (this.connecting || this.socket) return this.status();
    this.connecting = true;
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
        },
        { default: pino },
        { default: QRCode },
      ] = await Promise.all([
        import("@whiskeysockets/baileys"),
        import("pino"),
        import("qrcode"),
      ]);
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
        browser: ["Oracle Leads", "Desktop", "0.2.0"],
      });
      this.socket = sock;
      sock.ev.on("creds.update", (update) => {
        Object.assign(creds, update);
        put("creds", creds);
      });
      sock.ev.on("connection.update", (update) => {
        if (this.socket !== sock) return;
        if (update.qr) {
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
          this.store.bindSender(this.state.phone);
          this.store.activity(
            "whatsapp_connected",
            `Paired account ${this.state.phone} connected.`,
          );
        }
        if (update.connection === "close") {
          const code = update.lastDisconnect?.error?.output?.statusCode;
          this.socket = null;
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
      this.connecting = false;
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
    clearTimeout(this.timer);
    const sock = this.socket;
    this.socket = null;
    this.connecting = false;
    this.state = { status: "disconnected", phone: null, qr: null, error: null };
    sock?.end(undefined);
  }
  async unlink() {
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
