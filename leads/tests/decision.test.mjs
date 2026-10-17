import test from 'node:test';
import assert from 'node:assert/strict';
import { Decisions,decisionState,interpretDecision } from '../server/decision.mjs';
import { LAYA_QUESTIONS } from '../server/laya-config.mjs';
import { Model } from '../server/model.mjs';
const result=(choice='meeting',p=.96)=>({answers:{intent:{choice,probabilities:Object.fromEntries(Object.keys(LAYA_QUESTIONS.intent.criteria).map(k=>[k,k===choice?p:(1-p)/7]))}}});
const context={new_message:{id:'new',text:'Can we have a demo?'},incoming_message_events:[{text:'Hello'},{text:'Can we have a demo?'}],messages:[{direction:'out',text:'Would you like an Atlas demo?'}]};
test('local decisions see each new event and previous salesperson context',()=>{
 const state=decisionState(context);assert(state.includes('Hello\nCan we have a demo?'));assert(state.includes('Would you like an Atlas demo?'));assert.equal(decisionState({new_message:{text:'मुझे जानकारी चाहिए'}}),null);assert.equal(decisionState({}),null);
});
test('uncertain, malformed, contradictory and unknown local results fall back automatically',()=>{
 assert.equal(interpretDecision(result()).source,'laya');for(const raw of [null,{},result('meeting',.6),result('other'),{answers:{intent:{choice:'meeting',probabilities:{meeting:1}}}},{fallback:'context_too_long'}])assert.equal(interpretDecision(raw).source,'writer');
 const invalid=result();invalid.answers.intent.probabilities.question=NaN;assert.equal(interpretDecision(invalid).source,'writer');
});
test('local inference failure never blocks the writer and cancellation remains final',async()=>{
 const decisions=new Decisions({infer:async()=>{throw new Error('private diagnostic');}});const failed=await decisions.assess(context);assert.equal(failed.source,'writer');assert.equal(failed.reason,'local_unavailable');decisions.cancel();assert.equal((await decisions.assess(context)).reason,'cancelled');
});
test('writer receives a local intent hint but retains full context and can reject it',async()=>{
 const activities=[];const d=new Decisions({infer:async()=>result('declined')});const m=new Model({settings:()=>({decision_provider:'laya'}),activity:(...args)=>activities.push(args)},{decisions:d});let seen;
 m.write=async c=>{seen=c;return {reply:'Here is the demo link.',summary:'Asked for demo.',stage:'meeting_requested',optOut:false};};const actual=await m.complete({...context,contact_id:'synthetic'});assert.equal(seen.local_decision.intent,'declined');assert.equal(seen.new_message.id,'new');assert.equal(actual.stage,'meeting_requested');assert.equal(actual.optOut,false);assert.equal(activities[0][2],'synthetic');m.cancel();
});
test('disabled local decisions and introductions do not invoke Laya',async()=>{
 let calls=0;const d=new Decisions({infer:async()=>{calls++;return result();}});const m=new Model({settings:()=>({decision_provider:'writer'})},{decisions:d});m.write=async()=>({reply:'Hello'});await m.complete(context);assert.equal(calls,0);m.cancel();
});
test('closing during local inference cannot start a new writer operation',async()=>{
 let finish;const d=new Decisions({infer:()=>new Promise(resolve=>finish=resolve)});const m=new Model({settings:()=>({decision_provider:'laya'})},{decisions:d});let writes=0;m.write=async()=>{writes++;return {};};const pending=m.complete(context);m.cancel();finish(result());await assert.rejects(pending,/cancelled/);assert.equal(writes,0);
});
test('a superseded message or withdrawn permission during local inference never starts the writer',async()=>{
 let finish,current=true;const d=new Decisions({infer:()=>new Promise(resolve=>finish=resolve)});const m=new Model({settings:()=>({decision_provider:'laya'})},{decisions:d});let writes=0;m.write=async()=>{writes++;return {};};const pending=m.complete(context,{isCurrent:()=>current});current=false;finish(result());await assert.rejects(pending,/access or context changed/);assert.equal(writes,0);m.cancel();
});
