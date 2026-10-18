import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../dist/index.js';
const request={versionId:'dcc',methodId:'dcc.3d6-in-order'};
const golden=[1,1,1,6,6,6,2,2,2,5,5,5,3,3,3,4,4,4];

test('V4-04 four DCC sessions exactly equal four consecutive normal lifecycles on one RNG stream',()=>{
 const dice=[...golden,...Array(18).fill(2),...Array(18).fill(3),...Array(18).fill(6)];
 const batch=core.generateBatch(request,4,core.sequenceRng(dice));
 const rng=core.sequenceRng(dice);
 const singles=Array.from({length:4},()=>{
  let s=core.createSession(request);s=core.applyAction(s,{type:'roll'},rng);return core.applyAction(s,{type:'finalize'},rng);
 });
 assert.deepEqual(batch.map(e=>e.session),singles);
 assert.deepEqual(batch.map(e=>e.index),[1,2,3,4]);
 for(const entry of batch) {
  const loaded=core.deserializeSession(core.serializeSession(entry.session));
  assert.deepEqual(loaded,entry.session);assert.deepEqual(core.getSessionView(loaded),entry.view);
  assert.deepEqual(core.validateSession(loaded),{valid:true,complete:true,issues:[]});
 }
 assert.notEqual(batch[0].session,batch[1].session);
 assert.notEqual(batch[0].session.events,batch[1].session.events);
 const before=batch.map(e=>core.serializeSession(e.session));
 assert.throws(()=>{batch[0].session.events[0].dice[0]=6;},TypeError);
 assert.throws(()=>core.applyAction(batch[0].session,{type:'roll'}),e=>e.code==='COMPLETED');
 assert.deepEqual(batch.map(e=>core.serializeSession(e.session)),before);
});
for(const count of [1,2,4,8])test(`V4-04 count ${count} makes separate complete sessions`,()=>{
 const results=core.generateBatch(request,count,core.sequenceRng(Array(count*18).fill(4)));
 assert.equal(results.length,count);assert.equal(results.every(e=>e.view.phase==='complete'),true);
});
test('V4-04 invalid counts and unavailable methods consume no dice',()=>{
 let calls=0;const rng=()=>{calls++;return 4;};
 for(const n of [0,-1,9,100,1.5,NaN,Infinity,'4',null])assert.throws(()=>core.generateBatch(request,n,rng),e=>e.code==='BATCH_COUNT');
 for(const id of ['dnd5e2024.roll','adnd2e.phb-II','adnd1e.dmg-IV','adnd2e.phb-VI','pf1.purchase','pf1.dice-pool','dnd5e2014.array','bx1981.3d6-in-order']) {
  assert.throws(()=>core.generateBatch({versionId:id.split('.')[0],methodId:id},4,rng),e=>e.code==='BATCH_UNSUPPORTED');
 }
 assert.equal(calls,0);
});
test('V4-04 a depleted stream reports the failed group and never returns a partial batch',()=>{
 const rng=core.sequenceRng([...golden,1]);let returned;
 assert.throws(()=>{returned=core.generateBatch(request,4,rng);},e=>e instanceof core.BatchGenerationError&&e.group===2&&e.causeCode==='BAD_RNG'&&/第 2 组/.test(e.messages.zh)&&/Group 2/.test(e.messages.en));
 assert.equal(returned,undefined);
 assert.throws(()=>core.generateBatch(request,1,rng),e=>e.group===1&&e.causeCode==='BAD_RNG');
});
test('V4-04 batch eligibility is distinct from random generation; ordered methods preserve their own rules',()=>{
 for(const v of core.listVersions())for(const m of core.listMethods(v.id)) {
  if(['assign','pairs','sets','allocate','buy','pool','array','pending'].includes(m.mode))assert.equal(core.isBatchMethod(m),false,m.id);
 }
 assert.equal(core.isBatchMethod(core.getMethod('pf1.classic'),{inOrder:true}),true);
 assert.equal(core.isBatchMethod(core.getMethod('adnd1e.dmg-III')),true);
 const request={versionId:'odnd1974',methodId:'odnd1974.3d6-in-order'};
 const result=core.generateBatch(request,1,core.sequenceRng(golden))[0];
 assert.deepEqual(result.view.attempt.scores,{STR:3,INT:18,WIS:6,CON:15,DEX:9,CHA:12});
 assert.equal(core.getSessionView(core.deserializeSession(core.serializeSession(result.session))).phase,'complete');
 const exceptional=core.generateBatch({versionId:'adnd2e',methodId:'adnd2e.phb-I'},1,core.sequenceRng([...Array(18).fill(6),47]))[0];
 assert.deepEqual(exceptional.session.events.map(e=>e.action.type),['roll','rollExceptional','finalize']);
 assert.equal(core.exportResult(exceptional.session).exceptionalStrength,47);
 const pf=core.generateBatch({versionId:'pf1',methodId:'pf1.classic',options:{inOrder:true}},1,core.sequenceRng(golden))[0];
 assert.equal(pf.view.attempt.scores.INT,15);
});
