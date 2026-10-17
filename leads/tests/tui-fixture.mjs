// Local-only synthetic transport for the terminal smoke test. Never used by production.
import { createApp } from "../server/index.mjs";
if (process.env.ORACLE_LEADS_FIXTURE !== "1")
  throw new Error("Explicit fixture mode required.");
const pairingFixture=process.env.ORACLE_LEADS_PAIRING_FIXTURE==="1";
let pairingState={status:"disconnected",phone:null,error:null};
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
    status: () => pairingFixture ? pairingState : ({
      status: "connected",
      phone: "+12025550199",
      qr: null,
      error: null,
    }),
    async refreshContacts(){return {ok:true};},
    disconnect() {pairingState={status:"disconnected",phone:null,error:null};},
    async connect() {pairingState={status:"qr_ready",phone:null,error:null,qr_matrix:{size:1,data:[1]}};return pairingState;},
    async pairPhone(phone) {if(!phone.includes("12025550199"))throw new Error("Synthetic number only.");pairingState={status:"pairing_code_ready",phone:null,pairing_mode:"phone",pairing_phone:"+12025550199",pairing_code:"ABCD1234"};return pairingState;},
    async send(number, text, messageId) {
      app.store.activity(
        "fixture_transport",
        "Synthetic transport accepted one reviewed message.",
      );
      return messageId;
    },
  }),
});
if(!pairingFixture) app.store.bindSender("+12025550199");
app.store.saveSettings({ quiet_start: 0, quiet_end: 0, reply_delay_min:0, reply_delay_max:0 });
// This route exists only in the explicit synthetic fixture, never in the production service.
const originalRequest=app.server.listeners('request')[0];app.server.removeAllListeners('request');
app.server.on('request',async(req,res)=>{
 if(req.url!=='/api/fixture/incoming')return originalRequest(req,res);
 if(req.method!=='POST'||req.headers.cookie!==`oracle_leads=${app.localToken}`){res.writeHead(401);res.end('{}');return;}
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
 app.agent.receive({contactId:body.contact_id,sender:'+12025550199',externalId:'fixture-new-inbound-'+Date.now(),text:body.text,timestamp:new Date().toISOString()});res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');
});
if(process.env.ORACLE_LEADS_DIRECTORY_FIXTURE==="1"){
  app.store.importContacts(Array.from({length:40},(_,i)=>({name:`Fixture ${String(i+1).padStart(2,'0')}`,phone:`+1202555${String(i+1).padStart(4,'0')}`,company:"Synthetic Brokerage",role:i===38?"Owner":"",source:"Saved fixture"})));
  app.store.syncContactDirectory([{phone:"+12025550038",name:"Fixture 38"},{phone:"+12025550039",name:"Fixture 39"},{phone:"+12025550200",name:"WhatsApp Person"}]);
  const selected=app.store.one("SELECT * FROM contacts WHERE phone=?","+12025550039");
  app.store.patchContact(selected.id,{next_action:"Call Thursday",notes:"Prefers email",stage:"interested"},"+12025550199");
  app.store.memory(selected.id,"Met at the expo");app.store.addMessage(selected.id,"in","Please send the Atlas walkthrough","received","fixture-directory-message");
  const first=app.store.one("SELECT * FROM contacts WHERE phone=?","+12025550001");app.store.patchContact(first.id,{active:true,consent:true},"+12025550199");
}
app.server.listen(0, "127.0.0.1", () =>
  console.log(JSON.stringify({ port: app.server.address().port })),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
