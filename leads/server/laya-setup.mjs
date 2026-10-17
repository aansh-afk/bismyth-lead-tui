import { ensureBundle, Laya, BUNDLE_FILES } from "@receptron/laya";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LAYA_CACHE, LAYA_DIR, LAYA_REPO, LAYA_REVISION, LAYA_QUESTIONS } from "./laya-config.mjs";
let last = 0;
const cached = BUNDLE_FILES.every(file => existsSync(join(LAYA_DIR,file)));
console.log(cached ? "Verifying the cached Laya model locally. No contacts are accessed." : "Downloading the pinned Laya English ONNX checkpoint (about 1.7 GB). No contacts are accessed.");
if (!cached) await ensureBundle({ repo: LAYA_REPO, revision: LAYA_REVISION, cacheDir: LAYA_CACHE, token: "", onProgress({ file, received }) {
  if (Date.now() - last > 5000) { last = Date.now(); console.log(`${file}: ${Math.round(received / 1048576)} MiB`); }
} });
const model = await Laya.load({ modelDir: LAYA_DIR, executionProviders: ["cpu"], sessionOptions: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
try { await model.systemOne("Customer's latest message: What does Atlas cost?",LAYA_QUESTIONS); }
finally { await model.close(); }
await writeFile(join(LAYA_DIR, "oracle-ready.json"), JSON.stringify({ repo: LAYA_REPO, revision: LAYA_REVISION, installed_at: new Date().toISOString() }), { mode: 0o600 });
console.log("Laya is installed locally. Runtime inference uses CPU and never downloads models.");
