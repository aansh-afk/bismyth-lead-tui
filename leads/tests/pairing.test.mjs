import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
import { WhatsApp, pairingPhone } from "../server/transport.mjs";
import { createApp } from "../server/index.mjs";
function fixture(t, options={}) {
 const dir=mkdtempSync(join(tmpdir(),"oracle-pairing-"));
 const store=new Store(join(dir,"test.sqlite"));
 const calls=[], sockets=[],syncCalls=[];
 let creds;
 const makeSocket=config=>{
  creds=config.auth.creds;if(options.config)options.config(config);
  const socket={ev:new EventEmitter(),user:{id:"12025550199:1@s.whatsapp.net"},end(){this.ended=true;},async logout(){},async resyncAppState(names,initial){syncCalls.push({names,initial});return options.sync?options.sync():undefined;},async requestPairingCode(number){calls.push(number);return options.request?options.request(number):"ABCD1234";}};
  sockets.push(socket);return socket;
 };
 const transport=new WhatsApp(store,options.onMessage||(async()=>{}), {pairingTimeoutMs:options.timeout||200,reconnectDelayMs:options.reconnectDelay||5000,loadModules:async()=>[
  {default:makeSocket,ALL_WA_PATCH_NAMES:["regular","regular_low"],BufferJSON:{},initAuthCreds:()=>({registered:false}),proto:{},DisconnectReason:{loggedOut:401,connectionReplaced:440,restartRequired:515},jidDecode:id=>({user:id?.split(":")[0]}),Browsers:{ubuntu:()=>["Ubuntu","Chrome","1"]}},
  {default:()=>({})},{default:{create:()=>({modules:{size:1,data:[1]}})}}
 ]});
 t.after(()=>{transport.disconnect();store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,transport,calls,sockets,syncCalls,get creds(){return creds;}};
}
const tick=()=>new Promise(r=>setTimeout(r,5));
async function ready(f,update={connection:"connecting"}){while(!f.sockets.length)await tick();f.sockets.at(-1).ev.emit("connection.update",update);}
test("pairing numbers normalize international formatting and reject malformed/local input",()=>{
 assert.equal(pairingPhone(" +1 (202) 555-0199 "),"12025550199");
 for(const value of [null,123,"0123456789","abc12025550199","+1","+12025550199;echo hi","++12025550199","1".repeat(16)])assert.throws(()=>pairingPhone(value));
});
test("phone pairing waits for socket readiness and never binds an entered sender",async t=>{
 const f=fixture(t);const request=f.transport.pairPhone("+12025550199");
 while(!f.sockets.length)await tick();assert.deepEqual(f.calls,[]);
 await ready(f);const result=await request;
 assert.equal(result.status,"pairing_code_ready");assert.equal(result.pairing_code,"ABCD1234");assert.equal(result.phone,null);assert.equal(result.qr_matrix,undefined);assert.deepEqual(f.calls,["12025550199"]);
 assert.equal(f.store.one("SELECT count(*) AS n FROM activity WHERE detail LIKE '%ABCD1234%'").n,0);
 f.creds.pairingCode="ABCD1234";
 f.sockets[0].ev.emit("creds.update",{registered:true});f.sockets[0].ev.emit("connection.update",{connection:"open"});
 assert.equal(f.transport.status().phone,"+12025550199");assert.equal(f.transport.status().pairing_code,undefined);
 assert.equal(JSON.parse(f.store.one("SELECT value FROM auth WHERE key='creds'").value).pairingCode,undefined);
});
test("QR readiness is sufficient; repeated QR updates do not overwrite the pairing code",async t=>{
 const f=fixture(t);const request=f.transport.pairPhone("12025550199");await ready(f,{qr:"fixture-qr"});await request;
 f.sockets[0].ev.emit("connection.update",{qr:"later-qr"});assert.equal(f.transport.status().status,"pairing_code_ready");assert.equal(f.calls.length,1);
});
test("concurrent requests are rejected and disconnect discards delayed pairing completion",async t=>{
 let resolve;const f=fixture(t,{request:()=>new Promise(r=>resolve=r)});const request=f.transport.pairPhone("12025550199");await ready(f);
 while(!f.calls.length)await tick();await assert.rejects(f.transport.pairPhone("12025550198"),/already in progress/);
 f.transport.disconnect();resolve("ABCD1234");await request;assert.equal(f.transport.status().status,"disconnected");assert.equal(f.transport.status().pairing_code,undefined);
});
test("timeouts and request failures clear the code and permit an explicit retry",async t=>{
 const f=fixture(t,{timeout:40,request:async()=>{throw new Error("private diagnostic");}});
 const request=f.transport.pairPhone("12025550199");await ready(f);await request;
 assert.equal(f.transport.status().status,"pairing_error");assert.equal(f.transport.status().pairing_code,null);assert.equal(f.sockets[0].ended,true);assert(!f.transport.status().error.includes("private diagnostic"));
 const retry=f.transport.pairPhone("12025550199");await retry;assert.equal(f.transport.status().status,"pairing_error");assert.equal(f.calls.length,1);
});
test("a linked account cannot be replaced by entering another phone number",async t=>{
 const f=fixture(t);f.store.run("INSERT INTO auth VALUES(?,?)","creds",JSON.stringify({registered:true}));await assert.rejects(f.transport.pairPhone("12025550199"),/already linked/);assert.equal(f.sockets.length,0);
});
test("a QR-linked identity resumes even when Baileys registered is false",async t=>{
 const f=fixture(t);
 await f.transport.resumeSession();assert.equal(f.sockets.length,0);
 f.store.run("INSERT INTO auth VALUES(?,?)","creds",JSON.stringify({registered:false,me:{id:"12025550199:1@s.whatsapp.net"}}));
 await f.transport.resumeSession();assert.equal(f.sockets.length,1);assert.equal(f.creds.me.id,"12025550199:1@s.whatsapp.net");assert.equal(f.calls.length,0);
 await assert.rejects(f.transport.pairPhone("12025550198"),/already linked/);
 assert.equal(f.store.state().analytics.active,0);
});
test("switching to QR preserves an existing QR-linked identity and auth keys",async t=>{
 const f=fixture(t);f.store.run("INSERT INTO auth VALUES(?,?)","creds",JSON.stringify({registered:false,me:{id:"12025550199:1@s.whatsapp.net"}}));
 f.store.run("INSERT INTO auth VALUES(?,?)","fixture-key",JSON.stringify({keep:true}));
 f.transport.state.pairing_mode="phone";await f.transport.connect({qr:true});
 assert.equal(f.creds.me.id,"12025550199:1@s.whatsapp.net");assert(f.store.one("SELECT value FROM auth WHERE key='fixture-key'"));assert.equal(f.calls.length,0);
});
test("service restart resumes a linked account and keeps outreach paused",async t=>{
 const f=fixture(t);const dir=mkdtempSync(join(tmpdir(),"oracle-resume-http-"));
 const first=await createApp({dataDir:dir,modelFactory:()=>({}),transportFactory:()=>({disconnect(){}})});
 first.store.run("INSERT INTO auth VALUES(?,?)","creds",JSON.stringify({registered:false,me:{id:"12025550199:1@s.whatsapp.net"}}));first.store.saveSettings({automation_paused:false});await first.close();
 const app=await createApp({dataDir:dir,modelFactory:()=>({}),transportFactory:(store,receive)=>new WhatsApp(store,receive,{loadModules:f.transport.loadModules})});
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 await ready(f,{connection:"open"});await tick();
 assert.equal(app.transport.status().status,"connected");assert.equal(app.store.settings().automation_paused,true);assert.equal(app.store.state().contacts.length,0);assert.equal(f.calls.length,0);
});
test("switching back to QR cancels phone-code state without activating contacts",async t=>{
 const f=fixture(t);const request=f.transport.pairPhone("12025550199");await ready(f);await request;await f.transport.connect({qr:true});assert.equal(f.sockets.length,2);assert.equal(f.sockets[0].ended,true);assert.equal(f.transport.status().pairing_code,undefined);
 f.sockets[1].ev.emit("connection.update",{qr:"fresh-qr"});assert.equal(f.transport.status().status,"qr_ready");
});
test("phone pairing HTTP endpoint requires the private session and passes the requested number",async t=>{
 const dir=mkdtempSync(join(tmpdir(),"oracle-pair-http-"));const numbers=[];
 const app=await createApp({dataDir:dir,modelFactory:()=>({}),transportFactory:()=>({status:()=>({status:"disconnected"}),disconnect(){},async pairPhone(phone){numbers.push(phone);return {status:"pairing_code_ready",pairing_code:"ABCD1234"};}})});
 await new Promise(r=>app.server.listen(0,"127.0.0.1",r));t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 assert.equal((await fetch(base+"/api/whatsapp/pair-phone",{method:"POST",body:"{}"})).status,401);
 const bootstrap=await fetch(base+"/api/bootstrap",{headers:{"X-Oracle-Key":app.localToken}});const cookie=bootstrap.headers.get("set-cookie").split(";")[0];
 const result=await fetch(base+"/api/whatsapp/pair-phone",{method:"POST",headers:{Cookie:cookie,"X-Oracle-Request":"1","Content-Type":"application/json"},body:JSON.stringify({phone:"+12025550199"})});assert.equal(result.status,200);assert.equal((await result.json()).pairing_code,"ABCD1234");assert.deepEqual(numbers,["+12025550199"]);
});
test("a timed-out code request closes its socket and ignores a late response",async t=>{
 let resolve;const f=fixture(t,{timeout:40,request:()=>new Promise(r=>resolve=r)});
 const request=f.transport.pairPhone("12025550199");await ready(f);await request;
 assert.equal(f.transport.status().status,"pairing_error");assert.equal(f.sockets[0].ended,true);resolve("LATE1234");await tick();assert.equal(f.transport.status().pairing_code,null);
});
test("disconnect during socket initialization prevents a stale socket from being created",async t=>{
 const f=fixture(t);const load=f.transport.loadModules;let release;
 f.transport.loadModules=()=>new Promise(r=>release=r);
 const request=f.transport.pairPhone("12025550199");await tick();f.transport.disconnect();release(await load());await request;assert.equal(f.sockets.length,0);assert.equal(f.transport.status().status,"disconnected");
});
test("WhatsApp metadata lists exact phone contacts without monitoring unapproved messages",async t=>{
 const f=fixture(t);await f.transport.connect();const socket=f.sockets[0];
 socket.ev.emit('contacts.upsert',[{id:'12025550101@s.whatsapp.net',name:'Before connect'},{id:'12345@g.us',name:'Group'}]);socket.ev.emit('connection.update',{connection:'open'});await tick();
 socket.ev.emit('contacts.update',[{id:'opaque@lid',phoneNumber:'12025550102@s.whatsapp.net',name:'Linked phone'},{id:'unknown@lid',name:'Unknown'},{id:null}]);await tick();
 const rows=f.store.state().contacts;assert.equal(rows.length,2);assert(rows.every(c=>c.active===0 && c.consent===0));assert.equal(f.store.state().analytics.replies,0);
 f.transport.disconnect();socket.ev.emit('contacts.upsert',[{id:'12025550103@s.whatsapp.net',name:'Stale'}]);await tick();assert.equal(f.store.state().contacts.length,2);
});
test("contact refresh requests app-state updates without enabling history sync or unscoped messages",async t=>{
 let config;const f=fixture(t,{config:value=>config=value});await assert.rejects(f.transport.refreshContacts(),/Connect WhatsApp/);await f.transport.connect();f.sockets[0].ev.emit('connection.update',{connection:'open'});
 assert.equal(config.shouldSyncHistoryMessage({}),false);assert.equal(Boolean(config.shouldIgnoreJid('12025550103@s.whatsapp.net')),true);
 await f.transport.refreshContacts();assert.deepEqual(f.syncCalls,[{names:['regular','regular_low'],initial:false}]);assert.equal(f.transport.status().directory_status,'ready');assert.equal(f.store.state().contacts.length,0);
});
test("contact sync starts when linked-device app-state keys become available",async t=>{
 const f=fixture(t);await f.transport.connect();f.sockets[0].ev.emit('connection.update',{connection:'open'});assert.equal(f.syncCalls.length,0);f.sockets[0].ev.emit('creds.update',{myAppStateKeyId:'fixture-key'});await tick();assert.equal(f.syncCalls.length,1);
});
test("contact refresh prevents overlap and discards a disconnected result",async t=>{
 let finish;const f=fixture(t,{sync:()=>new Promise(r=>finish=r)});await f.transport.connect();f.sockets[0].ev.emit('connection.update',{connection:'open'});const request=f.transport.refreshContacts();await assert.rejects(f.transport.refreshContacts(),/already being checked/);f.transport.disconnect();finish();await request;assert.equal(f.transport.status().status,'disconnected');assert.equal(f.transport.status().directory_status,undefined);
});
test("a contact whose LID mapping arrives later is listed only after a valid phone mapping",async t=>{
 const f=fixture(t);await f.transport.connect();const socket=f.sockets[0];socket.ev.emit('connection.update',{connection:'open'});
 socket.ev.emit('contacts.upsert',[{id:'later@lid',name:'Later contact'}]);await tick();assert.equal(f.store.state().contacts.length,0);
 socket.ev.emit('lid-mapping.update',{lid:'later@lid',pn:'not-a-phone'});await tick();assert.equal(f.store.state().contacts.length,0);
 socket.ev.emit('lid-mapping.update',{lid:'later@lid',pn:'12025550104@s.whatsapp.net'});await tick();const c=f.store.state().contacts[0];assert.equal(c.name,'Later contact');assert.equal(c.phone,'+12025550104');assert.equal(c.active,0);assert.equal(c.consent,0);
});
test('temporary connection loss reconnects the saved sender without requiring another Start',async t=>{
 const f=fixture(t,{reconnectDelay:5});await f.transport.connect();f.creds.me={id:'12025550199:1@s.whatsapp.net'};f.sockets[0].ev.emit('connection.update',{connection:'open'});f.store.importContacts([{phone:'+12025550101',name:'Scoped fixture'}]);const c=f.store.state().contacts[0];f.store.patchContact(c.id,{active:true,consent:true},'+12025550199');f.store.saveSettings({automation_paused:false});f.sockets[0].ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:408}}}});assert.equal(f.store.settings().automation_paused,false);
 const deadline=Date.now()+500;while(f.sockets.length<2 && Date.now()<deadline)await tick();assert.equal(f.sockets.length,2);f.sockets[1].ev.emit('connection.update',{connection:'open'});assert.equal(f.transport.status().status,'connected');assert.equal(f.store.settings().automation_paused,false);assert.equal(f.store.contact(c.id).active,1);
});
test('logout and account replacement still pause autonomous sending',async t=>{
 for(const code of [401,440]){const f=fixture(t,{reconnectDelay:5});await f.transport.connect();f.creds.me={id:'12025550199:1@s.whatsapp.net'};f.sockets[0].ev.emit('connection.update',{connection:'open'});f.store.saveSettings({automation_paused:false});f.sockets[0].ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:code}}}});assert.equal(f.store.settings().automation_paused,true);await tick();assert.equal(f.sockets.length,1);}
});
test('fresh live and reconnect-backlog events respect scope and WhatsApp second precision',async t=>{
 const received=[];const f=fixture(t,{onMessage:e=>received.push(e)});await f.transport.connect();f.sockets[0].ev.emit('connection.update',{connection:'open'});f.store.importContacts([{phone:'+12025550101',name:'Scoped'}]);const c=f.store.state().contacts[0];f.store.patchContact(c.id,{active:true,consent:true},'+12025550199');const second=Math.floor(Date.now()/1000);f.store.run('UPDATE contacts SET activated_at=? WHERE id=?',new Date(second*1000+500).toISOString(),c.id);
 for(const [type,id,phone,at]of [['notify','fresh','12025550101',second],['append','backlog','12025550101',second],['append','old','12025550101',second-1],['notify','unapproved','12025550102',second]]){f.sockets[0].ev.emit('messages.upsert',{type,messages:[{key:{id,remoteJid:phone+'@s.whatsapp.net'},message:{conversation:'A new message'},messageTimestamp:at}]});await tick();}
 assert.deepEqual(received.map(e=>e.externalId),['fresh','backlog']);assert(received.every(e=>e.historical===false));
});
test('expired authentication prompts same-number relogin without deleting CRM or permissions',async t=>{
 const f=fixture(t);await f.transport.connect();const old=f.sockets[0];f.creds.me={id:'12025550199:1@s.whatsapp.net'};old.ev.emit('connection.update',{connection:'open'});
 f.store.importContacts([{phone:'+12025550101',name:'Saved relationship'}]);const c=f.store.state().contacts[0];f.store.patchContact(c.id,{active:true,consent:true},'+12025550199');f.store.memory(c.id,'Keep this fact');f.store.saveSettings({automation_paused:false,quiet_start:21,quiet_end:9});
 old.ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:401}}}});
 const status=f.transport.status();assert.equal(status.relogin_required,true);assert.equal(status.relogin_phone,'+12025550199');assert(status.relogin_id);assert.equal(f.store.settings().automation_paused,true);assert.equal(f.store.settings().quiet_start,21);assert.equal(f.store.contact(c.id).active,1);assert.equal(f.store.detail(c.id).memories.length,1);assert.equal(f.store.one('SELECT COUNT(*) AS n FROM auth').n,0);
 await assert.rejects(f.transport.pairPhone('+12025550198'),/previously verified/);assert.equal(f.sockets.length,1);
 const request=f.transport.relogin('phone');while(f.sockets.length<2)await tick();f.sockets[1].ev.emit('connection.update',{connection:'connecting'});await request;assert.deepEqual(f.calls,['12025550199']);assert.equal(f.transport.status().relogin_required,true);
 f.sockets[1].ev.emit('connection.update',{connection:'open'});assert.equal(f.transport.status().relogin_required,false);assert.equal(f.transport.status().phone,'+12025550199');assert.equal(f.store.contact(c.id).active,1);assert.equal(f.store.settings().automation_paused,true);
 old.ev.emit('creds.update',{registered:true});assert.equal(f.transport.status().phone,'+12025550199');
});
test('expired-session recovery persists across restart and never silently accepts a different QR account',async t=>{
 const f=fixture(t);await f.transport.connect();f.creds.me={id:'12025550199:1@s.whatsapp.net'};f.sockets[0].ev.emit('connection.update',{connection:'open'});f.sockets[0].ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:500}}}});
 const recovered=new WhatsApp(f.store,async()=>{},{loadModules:f.transport.loadModules});t.after(()=>recovered.disconnect());await recovered.resumeSession();assert.equal(recovered.status().relogin_phone,'+12025550199');assert.equal(recovered.status().status,'logged_out');assert.equal(f.sockets.length,1);
 await recovered.relogin('qr');const wrong=f.sockets[1];wrong.user.id='12025550198:1@s.whatsapp.net';wrong.ev.emit('connection.update',{connection:'open'});assert.equal(recovered.status().status,'logged_out');assert.equal(recovered.status().relogin_required,true);assert.equal(f.store.get('sender'),'+12025550199');assert.equal(f.store.one('SELECT COUNT(*) AS n FROM auth').n,0);assert(wrong.ended);
 await recovered.unlink();assert.equal(recovered.status().relogin_required,false);
});
test('relogin rejects invalid or unnecessary requests; a network outage does not clear authentication',async t=>{
 const f=fixture(t,{reconnectDelay:1000});await assert.rejects(f.transport.relogin('other'),/phone code or QR/);await assert.rejects(f.transport.relogin(),/No expired/);
 await f.transport.connect();f.creds.me={id:'12025550199:1@s.whatsapp.net'};f.sockets[0].ev.emit('creds.update',{registered:true});f.sockets[0].ev.emit('connection.update',{connection:'open'});f.sockets[0].ev.emit('connection.update',{connection:'close',lastDisconnect:{error:{output:{statusCode:408}}}});assert(f.store.one("SELECT value FROM auth WHERE key='creds'"));assert.equal(f.transport.status().relogin_required,false);
});
test('relogin HTTP endpoint is authenticated and forwards the selected recovery method',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'oracle-relogin-http-'));const methods=[];const app=await createApp({dataDir:dir,modelFactory:()=>({}),transportFactory:()=>({status:()=>({status:'logged_out',relogin_required:true,relogin_phone:'+12025550199'}),disconnect(){},async relogin(method){methods.push(method);return {status:'pairing_code_ready'};}})});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});const base=`http://127.0.0.1:${app.server.address().port}`;
 assert.equal((await fetch(base+'/api/whatsapp/relogin',{method:'POST',body:'{}'})).status,401);const b=await fetch(base+'/api/bootstrap',{headers:{'X-Oracle-Key':app.localToken}});const cookie=b.headers.get('set-cookie').split(';')[0];const r=await fetch(base+'/api/whatsapp/relogin',{method:'POST',headers:{Cookie:cookie,'X-Oracle-Request':'1','Content-Type':'application/json'},body:JSON.stringify({method:'qr'})});assert.equal(r.status,200);assert.deepEqual(methods,['qr']);assert.equal(app.store.state().analytics.contacts,0);
});
