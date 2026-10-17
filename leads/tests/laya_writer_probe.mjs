// Explicit subscription inference, synthetic conversation only; no transport is created.
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.mjs';
import { Model } from '../server/model.mjs';
if(!process.argv.includes('--run'))throw new Error('Explicit --run required.');
const dir=mkdtempSync(join(tmpdir(),'oracle-laya-writer-'));const store=new Store(join(dir,'test.sqlite'));const model=new Model(store);let decision;
const write=model.write.bind(model);model.write=context=>{decision=context.local_decision;return write(context);};const start=performance.now();
try{
 const result=await model.complete({mode:'autonomous_reply',contact:{name:'Synthetic prospect',stage:'contacted'},messages:[{id:'prior',direction:'out',text:'Hi, Atlas helps brokerages manage leads and follow-ups. Would you like to learn more?'}],new_message:{id:'new-message',text:'Not interested right now, please reach out in February.'},incoming_message_events:[{id:'new-message',text:'Not interested right now, please reach out in February.'}],memories:[],meetings:[],instruction:'Assess this new message. Use nurture for genuine later timing. Respond courteously without pressure or invented commitments.'});
 const report={decision,result,elapsed_ms:Math.round(performance.now()-start),transport_created:false};writeFileSync('/tmp/oracle-leads-laya-writer-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));assert.equal(result.stage,'nurture');assert.equal(result.optOut,false);assert(result.reply.trim());
}finally{model.cancel();store.close();rmSync(dir,{recursive:true,force:true});}
