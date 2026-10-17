import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LAYA_DIR, LAYA_QUESTIONS, LAYA_REVISION } from "./laya-config.mjs";

export function decisionState(context) {
  if (!context.new_message?.text) return null;
  const events = context.incoming_message_events?.length ? context.incoming_message_events : [context.new_message];
  const latest = events.map(m => m.text).join("\n");
  // English checkpoint: non-Latin scripts fall back; Latin-script language is checked by the writer.
  if (/[^\u0000-\u007f\u2000-\u206f\u20a0-\u20cf]/u.test(latest)) return null;
  const previous = (context.messages || []).filter(m => m.direction === "out").at(-1)?.text || "";
  return `Earlier salesperson message (context): ${previous}\nCustomer's latest message(s): ${latest}`;
}
export function interpretDecision(raw) {
  if (raw?.fallback) return { source: "writer", reason: raw.fallback };
  const answer = raw?.answers?.intent;
  const keys = Object.keys(LAYA_QUESTIONS.intent.criteria);
  const probs = answer?.probabilities;
  if (!probs || !keys.includes(answer.choice) || keys.some(k => !Number.isFinite(probs[k]) || probs[k] < 0 || probs[k] > 1) || Math.abs(keys.reduce((n,k)=>n+probs[k],0)-1) > .01)
    return { source: "writer", reason: "invalid_local_result" };
  const ranked = keys.sort((a,b)=>probs[b]-probs[a]);
  const confidence = probs[answer.choice];
  if (ranked[0] !== answer.choice || confidence < .9 || confidence - probs[ranked[1]] < .25 || answer.choice === "other")
    return { source: "writer", reason: "uncertain", candidate: answer.choice, confidence };
  return { source: "laya", intent: answer.choice, confidence, elapsed_ms: raw.elapsed_ms, revision: LAYA_REVISION };
}
export class Decisions {
  constructor({ infer, timeoutMs = 45000 } = {}) {
    this.infer = infer; this.timeoutMs = timeoutMs; this.worker = null; this.pending = new Map(); this.serial = 0; this.phase = "idle"; this.closed = false; this.retryAt = 0;
  }
  status() {
    const installed = existsSync(join(LAYA_DIR, "oracle-ready.json"));
    return { provider: "laya", authority: "advisory", installed, phase: installed ? this.phase : "not_installed", detail: !installed ? "Laya is not installed. Run bismyth-leads --setup-laya; the writer handles decisions meanwhile." : this.phase === "fallback" ? "Local decisions unavailable. The writer handles decisions automatically." : "Local Laya intent assessment. The writer verifies context; uncertain decisions fall back automatically." };
  }
  stopWorker() {
    const worker = this.worker; this.worker = null; if (worker) void worker.terminate();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("Local decision unavailable.")); }
    this.pending.clear();
  }
  cancel() { this.closed = true; this.stopWorker(); }
  async predict(state) {
    if (this.infer) return this.infer(state);
    if (this.closed || Date.now() < this.retryAt || !this.status().installed) throw new Error("Local decision unavailable.");
    if (!this.worker) {
      this.phase = "loading";
      const worker = new Worker(new URL("./laya-worker.mjs", import.meta.url));
      this.worker = worker;
      worker.on("message", ({ id, result, error }) => {
        if (this.worker !== worker) return;
        const p = this.pending.get(id); if (!p) return;
        clearTimeout(p.timer); this.pending.delete(id);
        error ? p.reject(new Error("Local decision unavailable.")) : p.resolve(result);
      });
      const failed = () => { if (this.worker === worker) { this.retryAt = Date.now() + 60000; this.stopWorker(); this.phase = "fallback"; } };
      worker.on("error", failed); worker.on("exit", failed);
    }
    return new Promise((resolve,reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => { this.retryAt = Date.now()+60000; this.stopWorker(); this.phase = "fallback"; }, this.timeoutMs);
      this.pending.set(id,{resolve,reject,timer}); this.worker.postMessage({id,state});
    });
  }
  async assess(context) {
    if (this.closed) return { source: "writer", reason: "cancelled" };
    const state = decisionState(context);
    if (!state) return { source: "writer", reason: "no_supported_new_message" };
    try { const result = interpretDecision(await this.predict(state)); this.phase = "ready"; return result; }
    catch { this.phase = "fallback"; return { source: "writer", reason: "local_unavailable" }; }
  }
}
