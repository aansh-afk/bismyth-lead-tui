// Local-only synthetic transport for the terminal smoke test. Never used by production.
import { createApp } from "../server/index.mjs";
if (process.env.ORACLE_LEADS_FIXTURE !== "1")
  throw new Error("Explicit fixture mode required.");
let app;
app = await createApp({
  dataDir: process.env.ORACLE_LEADS_DATA,
  modelFactory: () => ({
    status: async () => ({
      provider: "codex",
      ready: true,
      detail: "Synthetic provider fixture.",
    }),
    complete: async () => ({
      reply: `Fixture summary: ${app.store.state().analytics.contacts} contacts and ${app.store.state().analytics.meetings} booked meetings.`,
      summary: "Synthetic fixture summary.",
      stage: null,
      optOut: false,
    }),
  }),
  transportFactory: () => ({
    status: () => ({
      status: "connected",
      phone: "+12025550199",
      qr: null,
      error: null,
    }),
    disconnect() {},
    async send(number, text, messageId) {
      app.store.activity(
        "fixture_transport",
        "Synthetic transport accepted one reviewed message.",
      );
      return messageId;
    },
  }),
});
app.store.bindSender("+12025550199");
app.store.saveSettings({ quiet_start: 0, quiet_end: 0 });
app.server.listen(0, "127.0.0.1", () =>
  console.log(JSON.stringify({ port: app.server.address().port })),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
