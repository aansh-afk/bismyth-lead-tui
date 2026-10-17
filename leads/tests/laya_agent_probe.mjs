// Real local Laya, isolated CRM, synthetic writer and transport. No WhatsApp connection.
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/index.mjs';
import { Model } from '../server/model.mjs';
if(!process.argv.includes('--run'))throw new Error('Explicit --run required.');
const dir=mkdtempSync(join(tmpdir(),'oracle-real-laya-'));const calls=[],sent=[];let maxLag=0,last=performance.now();const lag=setInterval(()=>{const at=performance.now();maxLag=Math.max(maxLag,at-last-25);last=at;},25);
const started=performance.now();let app;
try{
 app=await createApp({dataDir:dir,loadSavedContacts:false,modelFactory:s=>{const m=new Model(s);m.write=async context=>{calls.push(context);return {reply:'Synthetic answer for the isolated test.',summary:'Synthetic reply test.',stage:'replied',optOut:false};};return m;},transportFactory:()=>({status:()=>({status:'connected',phone:'+12025550199'}),disconnect(){},send:async(number,text,id)=>{sent.push(id);return id;}})});
 app.store.bindSender('+12025550199');app.store.saveSettings({quiet_start:0,quiet_end:0,reply_delay_min:0,reply_delay_max:0});app.store.importContacts([{name:'Synthetic only',phone:'+12025550101',stage:'contacted'}]);const c=app.store.state().contacts[0];app.store.patchContact(c.id,{active:true,consent:true},'+12025550199');app.store.addMessage(c.id,'out','Would you like to know more about Atlas?','sent','synthetic-prior');app.agent.start();
 for(const id of ['new-event-1','new-event-2']){
  app.agent.receive({contactId:c.id,sender:'+12025550199',externalId:id,text:'What is the pricing?',timestamp:new Date().toISOString()});await app.agent.tick();
 }
 assert.equal(sent.length,2);assert.equal(calls.length,2);assert(calls.every(c=>c.local_decision));assert.notEqual(calls[0].source_message_id,calls[1].source_message_id);assert.equal(app.store.one("SELECT COUNT(*) AS n FROM jobs WHERE status='draft'").n,0);
 const long=await app.agent.model.decisions.assess({new_message:{text:'word '.repeat(2000)}});assert.equal(long.reason,'context_too_long');
 const report={local_model:true,synthetic_writer:true,synthetic_transport:true,sends:sent.length,distinct_sources:true,no_review_drafts:true,oversized_context_fallback:long.reason,decision_sources:calls.map(c=>c.local_decision.source),elapsed_ms:Math.round(performance.now()-started),max_event_loop_lag_ms:Math.round(maxLag)};writeFileSync('/tmp/oracle-leads-laya-agent-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{clearInterval(lag);await app?.close();rmSync(dir,{recursive:true,force:true});}
