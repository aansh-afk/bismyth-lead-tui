import { id, now } from "./store.mjs";
import { randomBytes } from "node:crypto";
export class Agent {
  constructor(store, model, transport, { clock = Date.now, random = Math.random } = {}) {
    this.store = store;
    this.model = model;
    this.transport = transport;
    this.busy = false;
    this.stopping = false;
    this.autonomous = false;
    this.clock = clock;
    this.random = random;
  }
  start() {
    if (this.stopping) throw new Error("The service is shutting down.");
    if (this.transport.status().status !== "connected")
      throw new Error("Connect WhatsApp before starting autonomous outreach.");
    this.autonomous = true;
    this.store.saveSettings({ reply_mode: "auto", automation_paused: false });
    this.store.run("UPDATE jobs SET status='cancelled',error='Replaced by autonomous context assessment.' WHERE automatic=0 AND kind IN ('opener','reply') AND status IN ('draft','queued','ready','generating')");
    const planned = this.plan();
    this.store.activity("autonomy_started", `Autonomous outreach started; ${planned} relationships prepared from their saved context.`);
    return { ok: true, planned };
  }
  pause() {
    this.store.saveSettings({ automation_paused: true });
    return { ok: true };
  }
  delayAt() {
    const s = this.store.settings();
    return new Date(this.clock() + (s.reply_delay_min + this.random() * (s.reply_delay_max - s.reply_delay_min)) * 1000).toISOString();
  }
  dispatchBlock(automatic = false) {
    const s = this.store.settings(), date = new Date(this.clock()), hour = date.getHours();
    const quiet = s.quiet_start === s.quiet_end ? false : s.quiet_start > s.quiet_end
      ? hour >= s.quiet_start || hour < s.quiet_end : hour >= s.quiet_start && hour < s.quiet_end;
    if (quiet) return {phase:"quiet",summary:`Quiet hours · sending resumes at ${String(s.quiet_end).padStart(2,"0")}:00`};
    if (this.store.one("SELECT COUNT(*) n FROM messages WHERE direction='out' AND status IN ('sending','sent','delivered','read','uncertain') AND created_at>=?", date.toISOString().slice(0, 10)).n >= s.daily_limit)
      return {phase:"limit",summary:"Daily sending limit reached"};
    const next = Date.parse(this.store.get("next_autonomous_send_at") || "1970-01-01");
    if (automatic && s.reply_delay_max>0 && this.clock()<next)
      return {phase:"timing",summary:`Natural pause · ${Math.ceil((next-this.clock())/1000)}s`};
    return null;
  }
  canDispatch(automatic = false) {
    return !this.dispatchBlock(automatic);
  }
  status() {
    if (this.store.settings().automation_paused) return {phase:"paused",summary:"Agent paused"};
    if (this.transport.status().status!=="connected") return {phase:"offline",summary:"Waiting for WhatsApp connection"};
    if (this.busy) return {phase:"working",summary:"Preparing an automatic response"};
    const blocked=this.dispatchBlock(true);if(blocked)return blocked;
    const pending=this.store.one("SELECT MIN(due_at) AS at FROM jobs WHERE automatic=1 AND status IN ('queued','ready')");
    if(pending?.at && Date.parse(pending.at)>this.clock())return {phase:"timing",summary:`Next automatic action in ${Math.ceil((Date.parse(pending.at)-this.clock())/1000)}s`};
    return {phase:"running",summary:"Autonomous · listening for new messages"};
  }
  schedule(c, kind, source = null) {
    const s = this.store;
    let previous = source ? s.one("SELECT * FROM jobs WHERE source_id=?", source.id)
      : s.one("SELECT * FROM jobs WHERE contact_id=? AND kind='opener' ORDER BY rowid DESC LIMIT 1", c.id);
    // A transport attempt is never silently replayed, even after manual cancellation.
    if (previous?.external_id) return false;
    if (previous && ["sent", "completed", "sending", "uncertain"].includes(previous.status)) return false;
    if (previous?.automatic && ["queued", "ready", "generating"].includes(previous.status) && this.valid(previous)) return false;
    const dueAt = this.delayAt(), sender = this.transport.status().phone;
    if (previous) {
      s.run("UPDATE jobs SET status='queued',automatic=1,text='',error=NULL,sender=?,scope_version=?,provider=?,revision=?,due_at=?,updated_at=? WHERE id=?",
        sender, c.scope_version, s.settings().provider, s.revision(), dueAt, now(), previous.id);
    } else {
      const jobId = s.enqueue(c.id, kind, "", sender, source?.id || null, "queued", { automatic: true, dueAt });
      if (!jobId) return false;
      previous = { id: jobId };
    }
    s.activity("autonomous_action", kind === "opener" ? "Preparing a first introduction automatically." : "Preparing a response from the latest conversation and relationship memory.", c.id);
    return true;
  }
  plan() {
    const s = this.store, sender = this.transport.status().phone;
    if (!this.autonomous || s.settings().automation_paused || this.transport.status().status !== "connected") return 0;
    for (const job of s.all("SELECT * FROM jobs WHERE automatic=1 AND status IN ('queued','ready')")) {
      if (!this.valid(job)) s.run("UPDATE jobs SET status='cancelled',error='Relationship access or settings changed.',updated_at=? WHERE id=?", now(), job.id);
    }
    let count = 0;
    for (const c of s.all("SELECT * FROM contacts WHERE active=1 AND consent=1 AND opted_out=0 AND auto_reply=1 AND sender=?", sender)) {
      if (s.one("SELECT id FROM jobs WHERE contact_id=? AND status IN ('uncertain','sending')", c.id)) continue;
      const incoming = s.one("SELECT rowid AS record_order,* FROM messages WHERE contact_id=? AND direction='in' ORDER BY created_at DESC,rowid DESC LIMIT 1", c.id);
      if (incoming) {
        if (s.one("SELECT id FROM messages WHERE contact_id=? AND direction='out' AND rowid>? AND status IN ('sending','sent','delivered','read','uncertain')", c.id, incoming.record_order)) continue;
        // A freshly received event remains new even if the stage timestamp is later
        // (WhatsApp timestamps have second precision, and activation has milliseconds).
        if (["not_interested", "low_intent", "nurture"].includes(c.stage) && incoming.created_at <= c.updated_at &&
          !s.one("SELECT id FROM jobs WHERE source_id=?",incoming.id)) continue;
        if (this.schedule(c, "reply", incoming)) count++;
      } else if (c.stage === "new" && !s.one("SELECT id FROM messages WHERE contact_id=? LIMIT 1", c.id)) {
        if (this.schedule(c, "opener")) count++;
      }
    }
    return count;
  }
  async runAutomatic(job) {
    const s = this.store, c = s.contact(job.contact_id);
    if (!c.auto_reply) {
      s.run("UPDATE jobs SET status='cancelled',error='Human takeover is active.' WHERE id=?", job.id);
      return;
    }
    if (job.kind === "opener" && (c.stage !== "new" || s.one("SELECT id FROM messages WHERE contact_id=? LIMIT 1", c.id))) {
      s.run("UPDATE jobs SET status='cancelled',error='This relationship is already in progress.' WHERE id=?", job.id);
      return;
    }
    s.run("UPDATE jobs SET status='generating',updated_at=? WHERE id=?", now(), job.id);
    const detail = s.detail(c.id);
    const stableFacts = s.all("SELECT * FROM memories WHERE contact_id=? AND kind<>'model_summary' ORDER BY created_at DESC,rowid DESC LIMIT 10",c.id);
    const incomingEvents = job.source_id ? s.all(
      "SELECT id,text,created_at FROM messages WHERE contact_id=? AND direction='in' AND rowid>COALESCE((SELECT MAX(m.rowid) FROM jobs j JOIN messages m ON m.id=j.source_id WHERE j.contact_id=? AND j.status IN ('sent','completed')),0) ORDER BY rowid DESC LIMIT 40", c.id,c.id,
    ).reverse() : [];
    const result = await this.model.complete({
      mode: job.kind === "opener" ? "autonomous_introduction" : "autonomous_reply",
      contact_id: c.id,
      contact: { name:c.name, company:c.company, role:c.role, notes:c.notes, source:c.source, stage:c.stage, next_action:c.next_action, followup_at:c.followup_at },
      messages: detail.messages.slice(-40), memories: [...stableFacts,...detail.memories.filter(m=>m.kind==="model_summary").slice(0,5)], meetings: detail.meetings,
      links: { meeting:s.settings().meeting_link, success:s.settings().success_link, unsuccessful:s.settings().unsuccessful_link },
      source_message_id: job.source_id,
      new_message: job.source_id ? s.one("SELECT id,text,created_at FROM messages WHERE id=?",job.source_id) : null,
      incoming_message_events: incomingEvents,
      instruction: job.kind === "opener"
        ? "Write one concise, honest Atlas introduction for this permitted new relationship. Personalize only from recorded facts; never pretend prior contact or infer a business problem from a job title. Ask one useful question. This message will send automatically."
        : "Each incoming_message_events item is a distinct new event, even if its text repeats an earlier message. Respond to the new_message and all new events in their current conversational context; a saved replied stage never means a fresh message was answered. Several short messages can share one coherent response. Help interested prospects, answer objections honestly, and use the approved meeting link when appropriate. A decline deserves at most one polite closure, never another pitch. Use nurture for genuine later timing, low_intent only for repeated noncommittal deflections supported by the conversation, and never accuse anyone of dishonesty. Preserve advanced client/meeting stages. Do not invent interest, dates, bookings, facts or commitments. This message will send automatically.",
    }, { isCurrent: () => this.valid(job) && !s.settings().automation_paused && Boolean(s.contact(c.id).auto_reply) });
    if (!this.valid(job) || s.settings().automation_paused || !s.contact(c.id).auto_reply) {
      s.run("UPDATE jobs SET status='cancelled',error='Access or context changed during generation.' WHERE id=?", job.id);return;
    }
    if (job.source_id) {
      const latest = s.one("SELECT id FROM messages WHERE contact_id=? AND direction='in' ORDER BY created_at DESC,rowid DESC LIMIT 1", c.id);
      if (latest?.id !== job.source_id) {
        s.run("UPDATE jobs SET status='cancelled',error='A newer message replaced this response.' WHERE id=?", job.id);return;
      }
    }
    if (result.optOut) {
      s.patchContact(c.id,{opted_out:true},job.sender);
      s.run("UPDATE jobs SET status='cancelled',error='Opt-out classified.' WHERE id=?",job.id);return;
    }
    if (result.summary) s.memory(c.id,result.summary,job.source_id,"model_summary");
    if (job.kind !== "opener" && result.stage) {
      const advanced = ["meeting_booked","pilot","client"].includes(c.stage);
      const regresses = result.stage === "replied" && !["new","contacted","replied"].includes(c.stage);
      if (!advanced && !regresses) s.run("UPDATE contacts SET stage=?,updated_at=? WHERE id=?",result.stage,now(),c.id);
    }
    if (!result.reply.trim()) {
      s.run("UPDATE jobs SET status='completed',text='',error='No response needed.',updated_at=? WHERE id=?",now(),job.id);
      s.activity("autonomous_no_reply","Latest message assessed; no customer response needed.",c.id);return;
    }
    s.run("UPDATE jobs SET text=?,status='ready',updated_at=? WHERE id=?",result.reply,now(),job.id);
    await this.dispatch({...job,text:result.reply,status:"ready"});
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
      Date.parse(event.timestamp) < Math.floor(Date.parse(c.activated_at) / 1000) * 1000 ||
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
      "UPDATE jobs SET status='cancelled',error='A new incoming message requires fresh context.',updated_at=? WHERE contact_id=? AND status IN ('draft','ready','queued','generating')",
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
    if (c.auto_reply) {
      if (this.autonomous) this.schedule(s.contact(c.id), "reply", {id:messageId});
      else s.enqueue(c.id, "reply", "", event.sender, messageId);
    }
    return true;
  }
  valid(job) {
    const s = this.store,
      c = s.one("SELECT * FROM contacts WHERE id=?",job.contact_id);
    if (!c || s.one("SELECT status FROM jobs WHERE id=?",job.id)?.status === "cancelled") return false;
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
    const s = this.store;
    if (this.autonomous) this.plan();
    const job = s.one(
      "SELECT * FROM jobs WHERE status IN ('queued','ready') AND (due_at='' OR due_at<=?) ORDER BY CASE WHEN kind='reply' THEN 0 ELSE 1 END,created_at,rowid LIMIT 1",
      new Date(this.clock()).toISOString(),
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
      if (job.automatic && !this.canDispatch(true)) return;
      if (job.status === "ready") {
        await this.dispatch(job);
        return;
      }
      if (job.automatic) { await this.runAutomatic(job); return; }
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
      const current = s.one("SELECT status FROM jobs WHERE id=?",job.id);
      if (current?.status === "cancelled") return;
      if (job.automatic && !["cancelled","sending","uncertain"].includes(current?.status)) {
        const attempts = job.attempts + 1;
        const retryAt = new Date(this.clock() + Math.min(300, 5 * 2 ** Math.min(attempts,6)) * 1000).toISOString();
        s.run("UPDATE jobs SET status='queued',text='',error=?,attempts=?,due_at=?,updated_at=? WHERE id=?",error.message,attempts,retryAt,now(),job.id);
        s.activity("autonomous_retry","Generation could not complete; an automatic retry is scheduled.",job.contact_id);
        return;
      }
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
    if (!this.canDispatch(Boolean(job.automatic))) return;
    if (job.automatic && !s.contact(job.contact_id).auto_reply) return;
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
      if (job.automatic) s.set("next_autonomous_send_at", this.delayAt());
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
