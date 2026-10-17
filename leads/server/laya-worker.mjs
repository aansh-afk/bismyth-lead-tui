import { parentPort } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Laya } from "@receptron/laya";
import { Tokenizer } from "@huggingface/tokenizers";
import { LAYA_DIR, LAYA_QUESTIONS } from "./laya-config.mjs";
const model = await Laya.load({ modelDir: LAYA_DIR, executionProviders: ["cpu"], sessionOptions: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
const tok = new Tokenizer(JSON.parse(await readFile(join(LAYA_DIR, "tokenizer/tokenizer.json"), "utf8")), JSON.parse(await readFile(join(LAYA_DIR, "tokenizer/tokenizer_config.json"), "utf8")));
parentPort.on("message", async ({ id, state }) => {
  try {
    const count = tok.encode(state, { add_special_tokens: false }).ids.length;
    // The reference runtime silently truncates state; fall back rather than lose the latest message.
    if (count > model.config.max_len - model.config.head_max_len - 16) {
      parentPort.postMessage({ id, result: { fallback: "context_too_long" } }); return;
    }
    const start = performance.now();
    const result = await model.systemOne(state, LAYA_QUESTIONS);
    parentPort.postMessage({ id, result: { ...result, elapsed_ms: Math.round(performance.now() - start), state_tokens: count } });
  } catch { parentPort.postMessage({ id, error: true }); }
});
