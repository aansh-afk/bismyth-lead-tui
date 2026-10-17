import { id, now } from "./store.mjs";
import { randomBytes } from "node:crypto";
export class Agent {
  constructor(store, model, transport) {
    this.store = store;
    this.model = model;
    this.transport = transport;
    this.busy = false;
    this.stopping = false;
  }
  receive(event) {
    const s = this.store,
      c = s.one("SELECT * FROM contacts WHERE id=?", event.contactId);
    if (
      !c ||
      typeof event.text !== "string" ||
      !event.externalId ||
      !Number.isFinite(Date.parse(event.timestamp))
    )
      return false;
    if (
      event.historical ||
      event.sender !== this.transport.status().phone ||
      !s.allowed(c.id, event.sender) ||
      event.timestamp < c.activated_at ||
      event.text.length > 12000
    )
      return false;
    const messageId = s.addMessage(
      c.id,
      "in",
      event.text,
      "received",
      event.externalId,
      event.timestamp,
    );
    if (!messageId) return false;
    s.run(
      "UPDATE jobs SET status='cancelled',error='A new incoming message requires fresh review.',updated_at=? WHERE contact_id=? AND status IN ('draft','ready')",
      now(),
      c.id,
    );
    s.activity("reply_received", `Reply received from ${c.name}.`, c.id);
    if (
      /\b(stop|unsubscribe|opt[ -]?out|do not (?:message|contact)|don'?t (?:message|contact)|remove (?:me|my number))\b/i.test(
        event.text,
      )
    ) {
      s.patchContact(c.id, { opted_out: true }, event.sender);
      s.activity(
        "opt_out",
        "Opt-out received. Automation stopped for this relationship.",
        c.id,
      );
      return true;
    }
    if (c.stage === "new" || c.stage === "contacted")
      s.run(
        "UPDATE contacts SET stage='replied',updated_at=? WHERE id=?",
        now(),
        c.id,
      );
    if (c.auto_reply) s.enqueue(c.id, "reply", "", event.sender, messageId);
    return true;
  }
  valid(job) {
    const s = this.store,
      c = s.contact(job.contact_id);
    return (
      s.allowed(c.id, this.transport.status().phone) &&
      job.sender === this.transport.status().phone &&
      job.scope_version === c.scope_version &&
      job.revision === s.revision() &&
      job.provider === s.settings().provider
    );
  }
  async generateOpener(contactId) {
    if (this.busy || this.stopping)
      throw new Error("Wait for the current agent operation to finish.");
    const s = this.store;
    const c = s.contact(contactId);
    if (
      s.one(
        "SELECT id FROM jobs WHERE contact_id=? AND kind='opener' AND status NOT IN ('cancelled','failed')",
        contactId,
      )
    ) {
      throw new Error(
        "An opening draft or send already exists. Review it or write an explicit follow-up.",
      );
    }
    const jobId = s.enqueue(
      contactId,
      "opener",
      "",
      this.transport.status().phone,
      null,
      "generating",
    );
    const job = s.one("SELECT * FROM jobs WHERE id=?", jobId);
    this.busy = true;
    try {
      const result = await this.model.complete({
        mode: "opening_draft",
        contact: {
          name: c.name,
          company: c.company,
          role: c.role,
          notes: c.notes,
          source: c.source,
        },
        instruction:
          "Prepare one short, honest Atlas introduction for this explicitly permitted contact. This is only a draft. Do not claim we met, spoke or researched anything absent from these records. Never infer a business problem from the contact's title. Ask one relevant question.",
      });
      if (!this.valid(job))
        throw new Error(
          "Contact access, sender or provider changed while preparing the opener.",
        );
      if (!result.reply.trim())
        throw new Error("No opening message was proposed.");
      s.run(
        "UPDATE jobs SET text=?,status='draft',updated_at=? WHERE id=?",
        result.reply,
        now(),
        jobId,
      );
      s.activity(
        "opening_draft",
        "Opening message prepared for exact review; it has not been sent.",
        contactId,
      );
      return { id: jobId };
    } catch (error) {
      s.run(
        "UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=?",
        error.message,
        now(),
        jobId,
      );
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async tick() {
    if (this.busy || this.stopping || this.store.settings().automation_paused)
      return;
    const s = this.store,
      job = s.one(
        "SELECT * FROM jobs WHERE status IN ('queued','ready') ORDER BY created_at LIMIT 1",
      );
    if (!job) return;
    if (this.transport.status().status !== "connected") return;
    this.busy = true;
    try {
      if (!this.valid(job)) {
        s.run(
          "UPDATE jobs SET status='cancelled',error='Scope, sender or settings changed.',updated_at=? WHERE id=?",
          now(),
          job.id,
        );
        return;
      }
      if (job.status === "ready") {
        await this.dispatch(job);
        return;
      }
      const c = s.contact(job.contact_id);
      if (!c.auto_reply) {
        s.run(
          "UPDATE jobs SET status='cancelled',error='Human takeover is active.' WHERE id=?",
          job.id,
        );
        return;
      }
      s.run(
        "UPDATE jobs SET status='generating',updated_at=? WHERE id=?",
        now(),
        job.id,
      );
      const detail = s.detail(c.id);
      const result = await this.model.complete({
        mode: "customer_reply",
        contact: {
          name: c.name,
          company: c.company,
          role: c.role,
          notes: c.notes,
          stage: c.stage,
        },
        messages: detail.messages.slice(-40),
        memories: detail.memories.slice(0, 15),
        links: { meeting: s.settings().meeting_link },
        source_message_id: job.source_id,
      });
      if (
        !this.valid(job) ||
        s.settings().automation_paused ||
        !s.contact(c.id).auto_reply
      ) {
        s.run(
          "UPDATE jobs SET status='cancelled',error='Access changed while generating.',updated_at=? WHERE id=?",
          now(),
          job.id,
        );
        return;
      }
      // A newer inbound message invalidates this draft rather than answering stale context.
      const latest = s.one(
        "SELECT id FROM messages WHERE contact_id=? AND direction='in' ORDER BY created_at DESC,rowid DESC LIMIT 1",
        c.id,
      );
      if (latest?.id !== job.source_id) {
        s.run(
          "UPDATE jobs SET status='cancelled',error='A newer reply arrived.' WHERE id=?",
          job.id,
        );
        return;
      }
      if (result.optOut) {
        s.patchContact(c.id, { opted_out: true }, job.sender);
        s.run(
          "UPDATE jobs SET status='cancelled',error='Opt-out classified.' WHERE id=?",
          job.id,
        );
        return;
      }
      if (result.summary)
        s.memory(c.id, result.summary, job.source_id, "model_summary");
      if (result.stage)
        s.run(
          "UPDATE contacts SET stage=?,updated_at=? WHERE id=?",
          result.stage,
          now(),
          c.id,
        );
      if (!result.reply.trim()) {
        s.run(
          "UPDATE jobs SET status='cancelled',error='No reply proposed.' WHERE id=?",
          job.id,
        );
        return;
      }
      const next = s.settings().reply_mode === "auto" ? "ready" : "draft";
      s.run(
        "UPDATE jobs SET text=?,status=?,updated_at=? WHERE id=?",
        result.reply,
        next,
        now(),
        job.id,
      );
      s.activity(
        "draft_created",
        `Reply ${next === "ready" ? "queued" : "ready for review"}.`,
        c.id,
      );
    } catch (error) {
      s.run(
        "UPDATE jobs SET status=CASE WHEN status IN ('sending','uncertain') THEN 'uncertain' ELSE 'failed' END,error=?,updated_at=? WHERE id=?",
        error.message,
        now(),
        job.id,
      );
      s.activity("agent_error", error.message, job.contact_id);
    } finally {
      this.busy = false;
    }
  }
  async dispatch(job) {
    const s = this.store;
    if (!this.valid(job) || s.settings().automation_paused)
      throw new Error("Send cancelled: scope, sender or settings changed.");
    if (job.source_id) {
      const latest = s.one(
        "SELECT id FROM messages WHERE contact_id=? AND direction='in' ORDER BY created_at DESC,rowid DESC LIMIT 1",
        job.contact_id,
      );
      if (latest?.id !== job.source_id)
        throw new Error("A newer incoming message requires a fresh reply.");
    }
    const settings = s.settings(),
      hour = new Date().getHours();
    const quiet =
      settings.quiet_start === settings.quiet_end
        ? false
        : settings.quiet_start > settings.quiet_end
          ? hour >= settings.quiet_start || hour < settings.quiet_end
          : hour >= settings.quiet_start && hour < settings.quiet_end;
    if (quiet) return;
    const count = s.one(
      "SELECT COUNT(*) n FROM messages WHERE direction='out' AND status IN ('sending','sent','delivered','read','uncertain') AND created_at>=?",
      new Date().toISOString().slice(0, 10),
    ).n;
    if (count >= settings.daily_limit) return;
    const externalId =
      job.external_id || randomBytes(16).toString("hex").toUpperCase();
    s.run(
      "UPDATE jobs SET status='sending',external_id=?,updated_at=? WHERE id=?",
      externalId,
      now(),
      job.id,
    );
    const messageId = s.addMessage(
      job.contact_id,
      "out",
      job.text,
      "sending",
      externalId,
    );
    try {
      const receivedId = await this.transport.send(
        s.contact(job.contact_id).phone,
        job.text,
        externalId,
      );
      s.run(
        "UPDATE jobs SET status='sent',external_id=?,updated_at=? WHERE id=?",
        receivedId,
        now(),
        job.id,
      );
      s.run(
        "UPDATE messages SET status='sent',external_id=? WHERE id=?",
        receivedId,
        messageId,
      );
      s.activity(
        "message_sent",
        "Message accepted by WhatsApp transport.",
        job.contact_id,
      );
      if (s.contact(job.contact_id).stage === "new")
        s.run(
          "UPDATE contacts SET stage='contacted' WHERE id=?",
          job.contact_id,
        );
    } catch (error) {
      s.run(
        "UPDATE jobs SET status='uncertain',error=?,updated_at=? WHERE id=?",
        "Transport outcome uncertain. Inspect WhatsApp before taking any further action.",
        now(),
        job.id,
      );
      s.run("UPDATE messages SET status='uncertain' WHERE id=?", messageId);
      throw error;
    }
  }
  review(jobId, body, send) {
    const s = this.store,
      j = s.one("SELECT * FROM jobs WHERE id=?", jobId);
    if (!j || !["draft", "failed"].includes(j.status))
      throw new Error("This draft is no longer reviewable.");
    if (!this.valid(j))
      throw new Error("Scope or settings changed. Generate a fresh draft.");
    if (j.source_id) {
      const latest = s.one(
        "SELECT id FROM messages WHERE contact_id=? AND direction='in' ORDER BY created_at DESC,rowid DESC LIMIT 1",
        j.contact_id,
      );
      if (latest?.id !== j.source_id)
        throw new Error("A newer message requires a fresh reply.");
    }
    if (typeof body !== "string" || !body.trim() || body.length > 5000)
      throw new Error("Enter a message of 1–5,000 characters.");
    s.run(
      "UPDATE jobs SET text=?,status=?,updated_at=? WHERE id=?",
      body.trim(),
      send ? "ready" : "draft",
      now(),
      jobId,
    );
    s.activity(
      "draft_reviewed",
      send ? "Exact message approved for dispatch." : "Draft saved.",
      j.contact_id,
    );
  }
  async chat(message) {
    const s = this.store;
    if (typeof message !== "string" || !message.trim() || message.length > 6000)
      throw new Error("Enter a question of up to 6,000 characters.");
    const chatId = id();
    s.run(
      "INSERT INTO chat VALUES(?,?,?,?)",
      chatId,
      "user",
      message.trim(),
      now(),
    );
    const state = s.state(),
      terms = new Set(
        message
          .toLowerCase()
          .split(/[^\p{L}\p{N}+]/u)
          .filter((term) => term.length >= 3),
      );
    const matching = state.contacts.filter((c) =>
      [c.name, c.company, c.phone]
        .join(" ")
        .toLowerCase()
        .split(/[^\p{L}\p{N}+]/u)
        .some((term) => terms.has(term)),
    );
    const related = (matching.length ? matching : state.contacts)
      .slice(0, 6)
      .map((c) => {
        const detail = s.detail(c.id);
        return {
          id: c.id,
          name: c.name,
          company: c.company,
          stage: c.stage,
          notes: c.notes.slice(0, 1200),
          next_action: c.next_action,
          followup_at: c.followup_at,
          active: c.active,
          messages: detail.messages
            .slice(-12)
            .map((m) => ({ ...m, text: m.text.slice(0, 1500) })),
          memories: detail.memories
            .slice(0, 6)
            .map((m) => ({ ...m, content: m.content.slice(0, 1000) })),
        };
      });
    const result = await this.model.complete({
      mode: "operator_dashboard",
      question: message.trim(),
      analytics: state.analytics,
      related_contacts: related,
      contact_overview: state.contacts
        .slice(0, 40)
        .map((c) => ({ name: c.name, company: c.company, stage: c.stage })),
      omitted_contact_count: Math.max(0, state.contacts.length - 40),
      meetings: state.meetings.slice(0, 30),
      runs: state.runs,
      activity: state.activity.slice(0, 40),
      previous_chat: state.chat.slice(-12),
      current_time: now(),
      instruction:
        "Answer the operator from the supplied records. Only a bounded selection of relationships is supplied; say when the question requires more records. This chat cannot send messages, change contacts or create meetings. Direct the operator to the appropriate TUI action for changes. Distinguish sent, delivered, uncertain, requested and confirmed local meeting records. Prefer operator corrections over model summaries.",
    });
    s.run(
      "INSERT INTO chat VALUES(?,?,?,?)",
      id(),
      "assistant",
      result.reply,
      now(),
    );
    return { reply: result.reply };
  }
}
