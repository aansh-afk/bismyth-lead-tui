import { homedir } from "node:os";
import { join } from "node:path";
export const LAYA_REPO = "receptron/laya-onnx";
export const LAYA_REVISION = "d42786bdff8a7550316339c5fbf8f46caa83ea1b";
export const LAYA_CACHE = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "oracle-leads", "laya");
export const LAYA_DIR = join(LAYA_CACHE, LAYA_REPO.replace("/", "--"), LAYA_REVISION);
export const LAYA_QUESTIONS = {
  intent: { type: "choice", instructions: "Classify the customer's latest message in the sales conversation. Choose other if unclear. Earlier messages are context only.", criteria: {
    opt_out: "Explicitly requests no further messages or removal from contact list",
    declined: "Not interested in the product or declines the offer",
    later: "Wants to revisit at a later time",
    meeting: "Wants a demo, call, meeting or scheduling link",
    interested: "Expresses positive interest in the product",
    question: "Asks a product, pricing or other substantive question",
    acknowledgement: "Only acknowledges or thanks, without a new request",
    other: "Unclear, ambiguous or unrelated message",
  } },
};
