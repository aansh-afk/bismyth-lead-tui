import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../server/store.mjs';
import {Agent} from '../server/agent.mjs';
import {modelResult} from '../server/model.mjs';
import {createApp} from '../server/index.mjs';
const sender='+12025550199';
const answer={reply:'A helpful Atlas response',summary:'Source-backed relationship context.',stage:'interested',optOut:false};
function fixture(t,options={}){
 const dir=mkdtempSync(join(tmpdir(),'oracle-autonomy-'));let store=new Store(join(dir,'test.sqlite'));let clock=Date.now();const calls=[],sent=[];let handler=async()=>({...answer});
 const model={complete:async context=>{calls.push(context);return handler(context);}};
 const transport={state:{status:'connected',phone:sender},status(){return this.state;},async send(phone,text,id){sent.push({phone,text,id});if(options.failSend)throw new Error('Synthetic ambiguous transport');return id;}};
 store.bindSender(sender);store.saveSettings({quiet_start:0,quiet_end:0,reply_delay_min:0,reply_delay_max:0});
 let agent=new Agent(store,model,transport,{clock:()=>clock,random:()=>.5});
 const add=(stage='new',patch={})=>{const phone='+1202555'+String(100+store.state().contacts.length).padStart(4,'0');store.importContacts([{phone,name:'Synthetic '+stage,stage,company:'Fixture Brokerage',notes:'Known fact'}]);const c=store.one('SELECT * FROM contacts WHERE phone=?',phone);store.patchContact(c.id,{active:true,consent:true,...patch},sender);return store.contact(c.id);};
 const incoming=(c,text='Tell me about Atlas')=>agent.receive({contactId:c.id,sender,externalId:'synthetic-'+Math.random(),text,timestamp:new Date(clock+1000).toISOString()});
 const restart=()=>{store.close();store=new Store(join(dir,'test.sqlite'));agent=new Agent(store,model,transport,{clock:()=>clock,random:()=>.5});};
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 return {get store(){return store;},get agent(){return agent;},calls,sent,transport,add,incoming,restart,advance:ms=>clock+=ms,setHandler:fn=>handler=fn,get clock(){return clock;}};
}
test('Start independently introduces only allowed genuinely new relationships once',async t=>{
 const f=fixture(t);const fresh=f.add();f.add('contacted');f.add('interested');f.add('not_interested');f.add('nurture');f.add('low_intent');f.add('client');f.add('meeting_booked');f.add('new',{auto_reply:false});f.add('new',{active:false});f.add('new',{active:false,opted_out:true});
 const historical=f.add();f.store.addMessage(historical.id,'out','Already spoke','sent','old-intro');
 f.store.importContacts([{phone:'+12025550999',name:'Unapproved'}]);assert.equal(f.sent.length,0);assert.equal(f.agent.start().planned,1);await f.agent.tick();await f.agent.tick();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].phone,fresh.phone);assert.equal(f.calls[0].mode,'autonomous_introduction');assert.equal(f.calls[0].contact.company,'Fixture Brokerage');assert.equal(f.store.contact(fresh.id).stage,'contacted');assert.equal(f.store.one("SELECT count(*) n FROM jobs WHERE status='draft'").n,0);
});
test('Start recovers an unanswered inbound with saved relationship memory and links',async t=>{
 const f=fixture(t);const c=f.add('interested');f.store.memory(c.id,'Requested a team demo');f.store.saveSettings({meeting_link:'https://example.test/book'});f.incoming(c,'Can we see it on a call?');f.agent.start();await f.agent.tick();
 assert.equal(f.sent.length,1);assert.equal(f.calls[0].mode,'autonomous_reply');assert.equal(f.calls[0].contact.stage,'interested');assert.equal(f.calls[0].memories[0].content,'Requested a team demo');assert.equal(f.calls[0].links.meeting,'https://example.test/book');assert.equal(f.calls[0].messages.at(-1).text,'Can we see it on a call?');await f.agent.tick();assert.equal(f.sent.length,1);
});
test('new incoming replies automatically send without a review action',async t=>{
 const f=fixture(t);const c=f.add('contacted');f.agent.start();f.incoming(c);await f.agent.tick();assert.equal(f.sent.length,1);assert.equal(f.store.contact(c.id).stage,'interested');assert.equal(f.store.detail(c.id).memories[0].source_id,f.calls[0].source_message_id);
});
test('a decline closes once, does not repitch, and explicit later contact can reengage',async t=>{
 const f=fixture(t);const c=f.add('contacted');f.setHandler(async()=>({...answer,reply:'Understood, thanks for letting me know.',stage:'not_interested'}));f.agent.start();f.incoming(c,'Not interested');await f.agent.tick();assert.equal(f.sent.length,1);assert.equal(f.store.contact(c.id).stage,'not_interested');await f.agent.tick();f.agent.start();await f.agent.tick();assert.equal(f.sent.length,1);
 f.advance(3000);f.setHandler(async()=>answer);f.incoming(c,'Actually, can we look at a demo?');await f.agent.tick();assert.equal(f.sent.length,2);assert.equal(f.store.contact(c.id).stage,'interested');
});
test('saved terminal and later-timing stages do not revive an old inbound on Start',async t=>{
 const f=fixture(t);for(const stage of ['not_interested','low_intent','nurture']){const c=f.add(stage);f.store.addMessage(c.id,'in','An old message','received','old-'+stage,'2020-01-01T00:00:00.000Z');}
 f.agent.start();await f.agent.tick();assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);
});
test('low-intent classification is stored, and existing client stages do not regress',async t=>{
 const f=fixture(t);const c=f.add('interested');f.agent.start();f.setHandler(async()=>({...answer,stage:'low_intent'}));f.incoming(c,'Maybe, perhaps, no decision yet');await f.agent.tick();assert.equal(f.store.contact(c.id).stage,'low_intent');assert.equal(modelResult({...answer,stage:'nurture'}).stage,'nurture');assert.equal(modelResult({...answer,stage:'low_intent'}).stage,'low_intent');
 const client=f.add('client');f.setHandler(async()=>({...answer,stage:'replied'}));f.incoming(client);await f.agent.tick();assert.equal(f.store.contact(client.id).stage,'client');
});
test('opt-out prevents generation and sending immediately',async t=>{
 const f=fixture(t);const c=f.add('contacted');f.agent.start();f.incoming(c,'Please stop messaging me');await f.agent.tick();assert.equal(f.sent.length,0);assert.equal(f.calls.length,0);assert.equal(f.store.contact(c.id).active,0);
});
test('natural delay persists and a burst replaces the older scheduled response',async t=>{
 const f=fixture(t);const c=f.add('contacted');f.store.saveSettings({reply_delay_min:5,reply_delay_max:15});f.agent.start();f.incoming(c,'First thought');await f.agent.tick();assert.equal(f.calls.length,0);f.advance(9000);f.incoming(c,'Actually, my latest question');f.advance(2000);await f.agent.tick();assert.equal(f.calls.length,0);f.advance(8000);await f.agent.tick();assert.equal(f.sent.length,1);assert.equal(f.calls[0].messages.at(-1).text,'Actually, my latest question');assert.equal(f.store.one("SELECT count(*) n FROM jobs WHERE status='cancelled'").n,1);
});
test('pending natural timing survives restart without becoming a duplicate introduction',async t=>{
 const f=fixture(t);f.add();f.store.saveSettings({reply_delay_min:10,reply_delay_max:10});f.agent.start();const due=f.store.one('SELECT due_at FROM jobs').due_at;f.restart();assert.equal(f.store.settings().automation_paused,true);f.agent.start();assert.equal(f.store.one('SELECT due_at FROM jobs').due_at,due);await f.agent.tick();assert.equal(f.sent.length,0);f.advance(10000);await f.agent.tick();assert.equal(f.sent.length,1);f.restart();f.agent.start();await f.agent.tick();assert.equal(f.sent.length,1);
});
test('due inbound responses take priority over introductions',async t=>{
 const f=fixture(t);f.add();const replied=f.add('interested');f.incoming(replied);f.agent.start();await f.agent.tick();assert.equal(f.calls[0].mode,'autonomous_reply');await f.agent.tick();assert.equal(f.calls[1].mode,'autonomous_introduction');assert.equal(f.sent.length,2);
});
test('quiet hours and daily limits defer automatic actions without inference spend',async t=>{
 const f=fixture(t);f.add();f.add();const hour=new Date(f.clock).getHours();f.store.saveSettings({quiet_start:hour,quiet_end:(hour+1)%24,daily_limit:1});f.agent.start();await f.agent.tick();assert.equal(f.calls.length,0);f.advance(3600000);await f.agent.tick();await f.agent.tick();assert.equal(f.sent.length,1);assert.equal(f.calls.length,1);
});
test('pause during autonomous generation cancels its result and resume assesses again',async t=>{
 const f=fixture(t);f.add();let finish;f.setHandler(()=>new Promise(r=>finish=r));f.agent.start();const running=f.agent.tick();f.agent.pause();finish(answer);await running;assert.equal(f.sent.length,0);f.setHandler(async()=>answer);f.agent.start();await f.agent.tick();assert.equal(f.sent.length,1);
});
test('newer inbound during generation discards the stale response',async t=>{
 const f=fixture(t);const c=f.add('contacted');f.agent.start();f.incoming(c,'Old question');let finish;f.setHandler(()=>new Promise(r=>finish=r));const running=f.agent.tick();f.advance(2000);f.incoming(c,'New question');finish(answer);await running;assert.equal(f.sent.length,0);f.setHandler(async()=>answer);await f.agent.tick();assert.equal(f.sent.length,1);assert.equal(f.calls.at(-1).messages.at(-1).text,'New question');
});
test('permission or provider changes during autonomous inference prevent the send',async t=>{
 for(const change of ['scope','provider','takeover']){const f=fixture(t);const c=f.add();let finish;f.setHandler(()=>new Promise(r=>finish=r));f.agent.start();const running=f.agent.tick();if(change==='provider')f.store.saveSettings({provider:'selfhost'});else f.store.patchContact(c.id,change==='scope'?{active:false}:{auto_reply:false},sender);finish(answer);await running;assert.equal(f.sent.length,0);}
});
test('generation retries use backoff without blocking another relationship',async t=>{
 const f=fixture(t);f.add();f.add();let first=true;f.setHandler(async()=>{if(first){first=false;throw new Error('Synthetic inference unavailable');}return answer;});f.agent.start();await f.agent.tick();assert.equal(f.sent.length,0);await f.agent.tick();assert.equal(f.sent.length,1);f.advance(10000);await f.agent.tick();assert.equal(f.sent.length,2);assert.equal(f.store.one('SELECT max(attempts) n FROM jobs').n,1);
});
test('an ambiguous automatic transport outcome is never retried, including after restart',async t=>{
 const f=fixture(t,{failSend:true});f.add();f.agent.start();await f.agent.tick();assert.equal(f.sent.length,1);assert.equal(f.store.one('SELECT status FROM jobs').status,'uncertain');f.advance(3600000);await f.agent.tick();f.restart();f.agent.start();await f.agent.tick();assert.equal(f.sent.length,1);
});
test('no-response decisions are completed without pretending a message was sent',async t=>{
 const f=fixture(t);const c=f.add('contacted');f.agent.start();f.setHandler(async()=>({...answer,reply:'',stage:null}));f.incoming(c,'Thanks');await f.agent.tick();await f.agent.tick();assert.equal(f.calls.length,1);assert.equal(f.sent.length,0);assert.equal(f.store.one('SELECT status FROM jobs').status,'completed');assert.equal(f.store.state().analytics.sent,0);
});
test('delay validation rejects negative, inverted and unbounded intervals',t=>{
 const f=fixture(t);for(const patch of [{reply_delay_min:-1},{reply_delay_max:301},{reply_delay_min:20,reply_delay_max:10}])assert.throws(()=>f.store.saveSettings(patch));f.store.saveSettings({reply_delay_min:0,reply_delay_max:0});assert.equal(f.store.settings().reply_delay_max,0);
});
test('HTTP Start requires the private session and starts autonomous planning',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'oracle-autonomy-http-'));let app;const sent=[];
 app=await createApp({dataDir:dir,modelFactory:()=>({complete:async()=>answer}),transportFactory:()=>({status:()=>({status:'connected',phone:sender}),disconnect(){},send:async(...args)=>{sent.push(args);return args[2];}})});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});app.store.bindSender(sender);app.store.importContacts([{phone:'+12025550101',name:'Synthetic'}]);app.store.patchContact(app.store.state().contacts[0].id,{active:true,consent:true},sender);app.store.saveSettings({quiet_start:0,quiet_end:0,reply_delay_min:0,reply_delay_max:0});
 const url=`http://127.0.0.1:${app.server.address().port}`;assert.equal((await fetch(url+'/api/agent/start',{method:'POST',body:'{}'})).status,401);const init=await fetch(url+'/api/bootstrap',{headers:{'X-Oracle-Key':app.localToken}});const headers={Cookie:init.headers.get('set-cookie').split(';')[0],'X-Oracle-Request':'1','Content-Type':'application/json'};assert.equal((await fetch(url+'/api/agent/start',{method:'POST',headers,body:'{}'})).status,200);await app.agent.tick();assert.equal(sent.length,1);assert.equal((await fetch(url+'/api/agent/pause',{method:'POST',headers,body:'{}'})).status,200);assert.equal(app.store.settings().automation_paused,true);
});
test('each new message ID is assessed even after a response, including repeated text',async t=>{
 const f=fixture(t);const c=f.add('replied');f.agent.start();f.incoming(c,'Same words');await f.agent.tick();assert.equal(f.sent.length,1);const firstSource=f.calls[0].new_message.id;
 f.advance(2000);f.incoming(c,'Same words');await f.agent.tick();assert.equal(f.sent.length,2);assert.notEqual(f.calls[1].new_message.id,firstSource);assert.equal(f.calls[1].incoming_message_events.length,1);assert.equal(f.calls[1].new_message.text,'Same words');assert.equal(f.calls[1].messages.filter(m=>m.direction==='in').length,2);
});
test('a message burst retains every separate event in the single response context',async t=>{
 const f=fixture(t);const c=f.add('replied');f.agent.start();for(const text of ['Hello','One more question','What about team routing?'])f.incoming(c,text);await f.agent.tick();assert.equal(f.sent.length,1);assert.deepEqual(f.calls[0].incoming_message_events.map(m=>m.text),['Hello','One more question','What about team routing?']);assert.equal(f.store.one("SELECT count(*) n FROM messages WHERE direction='in'").n,3);
});
test('natural spacing between contacts persists and does not burst all introductions',async t=>{
 const f=fixture(t);f.add();f.add();f.store.saveSettings({reply_delay_min:5,reply_delay_max:5});f.agent.start();f.advance(5000);await f.agent.tick();await f.agent.tick();assert.equal(f.sent.length,1);f.advance(5000);await f.agent.tick();assert.equal(f.sent.length,2);
});
test('unknown imported stage cannot silently become an autonomous new introduction',t=>{
 const f=fixture(t);const result=f.store.importContacts([{phone:'+12025550998',name:'Existing person',stage:'already-talking-somewhere'}]);assert.equal(result.added,0);assert.equal(result.errors.length,1);const imported=f.store.importContacts([{phone:'+12025550997',stage:'Not Interested'}]);assert.equal(imported.added,1);assert.equal(f.store.state().contacts[0].stage,'not_interested');assert.equal(f.store.state().contacts[0].active,0);
});
test('switching timing to zero removes an old natural pause immediately',async t=>{
 const f=fixture(t);f.add();f.add();f.store.saveSettings({reply_delay_min:10,reply_delay_max:10});f.agent.start();assert.equal(f.agent.status().phase,'timing');f.advance(10000);await f.agent.tick();assert.equal(f.sent.length,1);assert.equal(f.agent.status().phase,'timing');f.store.saveSettings({reply_delay_min:0,reply_delay_max:0});await f.agent.tick();assert.equal(f.sent.length,2);
});
test('a v2 workspace migrates in place without losing contact, conversation or auth data',t=>{
 const f=fixture(t);const c=f.add('interested');const source=f.store.addMessage(c.id,'in','Saved before the upgrade','received','legacy-source');f.store.memory(c.id,'Saved permanent fact',source);f.store.run('INSERT INTO auth VALUES(?,?)','fixture-auth','private-synthetic-auth');const job=f.store.enqueue(c.id,'reply','',sender,source);f.store.saveSettings({reply_mode:'review'});
 const contacts=JSON.stringify(f.store.all('SELECT * FROM contacts'));const messages=JSON.stringify(f.store.all('SELECT * FROM messages'));
 f.store.db.exec("DROP INDEX jobs_due; ALTER TABLE jobs DROP COLUMN automatic; ALTER TABLE jobs DROP COLUMN due_at; ALTER TABLE jobs DROP COLUMN attempts; PRAGMA user_version=2;");
 f.restart();assert.equal(JSON.stringify(f.store.all('SELECT * FROM contacts')),contacts);assert.equal(JSON.stringify(f.store.all('SELECT * FROM messages')),messages);assert.equal(f.store.one("SELECT value FROM auth WHERE key='fixture-auth'").value,'private-synthetic-auth');assert.equal(f.store.detail(c.id).memories[0].content,'Saved permanent fact');assert.equal(f.store.one('SELECT automatic FROM jobs WHERE id=?',job).automatic,0);assert.equal(f.store.one('PRAGMA user_version').user_version,3);assert.equal(f.store.settings().reply_mode,'auto');assert.equal(f.store.settings().automation_paused,true);
});
test('cancelling a checked ambiguous response cannot silently replay that same message event',async t=>{
 const f=fixture(t,{failSend:true});const c=f.add('contacted');f.agent.start();f.incoming(c);await f.agent.tick();const job=f.store.one('SELECT * FROM jobs');assert.equal(job.status,'uncertain');f.store.run("UPDATE jobs SET status='cancelled' WHERE id=?",job.id);f.store.run("UPDATE messages SET status='cancelled' WHERE external_id=?",job.external_id);f.advance(60000);await f.agent.tick();assert.equal(f.sent.length,1);assert.equal(f.calls.length,1);
});
test('the first activation-second message is fresh despite WhatsApp timestamp precision',async t=>{
 const f=fixture(t);const c=f.add('contacted');const second=Math.floor(f.clock/1000);f.store.run('UPDATE contacts SET activated_at=? WHERE id=?',new Date(second*1000+500).toISOString(),c.id);f.agent.start();assert.equal(f.agent.receive({contactId:c.id,sender,externalId:'first-second',text:'Hello',timestamp:new Date(second*1000).toISOString()}),true);await f.agent.tick();assert.equal(f.sent.length,1);
});
test('a newly received message before Start is assessed even in a declined stage at the same timestamp',async t=>{
 const f=fixture(t);const c=f.add('not_interested');const second=Math.floor(f.clock/1000);const boundary=new Date(second*1000+500).toISOString();f.store.run('UPDATE contacts SET activated_at=?,updated_at=? WHERE id=?',boundary,boundary,c.id);assert.equal(f.agent.receive({contactId:c.id,sender,externalId:'new-after-decline',text:'Actually, can I see a demo?',timestamp:new Date(second*1000).toISOString()}),true);f.agent.start();await f.agent.tick();assert.equal(f.sent.length,1);assert.equal(f.calls[0].new_message.text,'Actually, can I see a demo?');assert.equal(f.store.contact(c.id).stage,'interested');
});
test('stable per-contact facts remain in context after many newer automatic summaries',async t=>{
 const f=fixture(t);const c=f.add('contacted');f.store.memory(c.id,'Prefers a Hindi demo for the operations team');for(let i=0;i<60;i++)f.store.memory(c.id,'Recent summary '+i,null,'model_summary');f.agent.start();f.incoming(c,'Can we schedule the walkthrough?');await f.agent.tick();assert(f.calls[0].memories.some(m=>m.content==='Prefers a Hindi demo for the operations team'));assert(f.calls[0].memories.length<=15);assert(f.calls[0].memories.every(m=>m.contact_id===c.id));assert.equal(f.sent.length,1);
});
