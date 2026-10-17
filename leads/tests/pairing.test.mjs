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
 const calls=[], sockets=[];
 let creds;
 const makeSocket=config=>{
  creds=config.auth.creds;
  const socket={ev:new EventEmitter(),user:{id:"12025550199:1@s.whatsapp.net"},end(){this.ended=true;},async logout(){},async requestPairingCode(number){calls.push(number);return options.request?options.request(number):"ABCD1234";}};
  sockets.push(socket);return socket;
 };
 const transport=new WhatsApp(store,async()=>{}, {pairingTimeoutMs:options.timeout||200,loadModules:async()=>[
  {default:makeSocket,BufferJSON:{},initAuthCreds:()=>({registered:false}),proto:{},DisconnectReason:{loggedOut:401,connectionReplaced:440,restartRequired:515},jidDecode:id=>({user:id?.split(":")[0]}),Browsers:{ubuntu:()=>["Ubuntu","Chrome","1"]}},
  {default:()=>({})},{default:{create:()=>({modules:{size:1,data:[1]}})}}
 ]});
 t.after(()=>{transport.disconnect();store.db.close();rmSync(dir,{recursive:true,force:true});});
 return {store,transport,calls,sockets,get creds(){return creds;}};
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
