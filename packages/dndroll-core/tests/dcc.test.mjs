import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../dist/index.js';
const request={versionId:'dcc',methodId:'dcc.3d6-in-order'};
export const dice=[1,1,1,6,6,6,2,2,2,5,5,5,3,3,3,4,4,4];
const rolled=()=>core.applyAction(core.createSession(request),{type:'roll'},core.sequenceRng(dice));

test('V4-01 DCC uses the approved slot order and exactly 18 recorded d6',()=>{
 const s=rolled(),v=core.getSessionView(s);
 assert.deepEqual(v.version.order,['STR','DEX','CON','WIS','INT','CHA']);
 assert.deepEqual(v.attempt.scores,{STR:3,DEX:18,CON:6,WIS:15,INT:9,CHA:12});
 assert.deepEqual(s.events,[{action:{type:'roll'},dice}]);
 assert.equal(v.attempt.candidates.every(c=>c.dice.length===3&&c.dice.every(d=>d.kept)),true);
 assert.equal(v.canFinalize,true);
 assert.deepEqual(v.classOptions,[]);assert.equal(v.exceptionalStrength,null);
 assert.equal(v.notices.some(n=>/Class selection|传奇力量|种族/.test(n.en+n.zh)),false);
 assert.throws(()=>core.applyAction(s,{type:'assign',assignments:{}}),e=>e.code==='WRONG_ACTION');
 const done=core.applyAction(s,{type:'finalize'});
 assert.deepEqual(core.deserializeSession(core.serializeSession(done)),done);
 assert.deepEqual(core.validateSession(done),{valid:true,complete:true,issues:[]});
});

test('V4-01 DCC STR 18 never rolls d100; repeated roll is rejected',()=>{
 const s=core.applyAction(core.createSession(request),{type:'roll'},core.sequenceRng(Array(18).fill(6)));
 assert.equal(core.getSessionView(s).exceptionalStrength,null);
 assert.equal(s.events.length,1);assert.equal(s.events[0].dice.length,18);
 assert.throws(()=>core.applyAction(s,{type:'roll'}),e=>e.code==='ALREADY_ROLLED');
 assert.throws(()=>core.applyAction(s,{type:'rollExceptional'}),e=>e.code==='EXCEPTIONAL_NOT_ALLOWED');
 assert.equal(core.exportResult(core.applyAction(s,{type:'finalize'})).exceptionalStrength,null);
});

test('V4-02 native names and JSON mapping are unambiguous; text never labels Luck as CHA',()=>{
 const s=core.applyAction(rolled(),{type:'finalize'}),json=core.serializeSession(s);
 const mapping=core.getAbilityMapping('dcc');
 assert.deepEqual(mapping.map(a=>a.id),['STR','AGI','STA','PER','INT','LCK']);
 assert.deepEqual(mapping.map(a=>a.slot),['STR','DEX','CON','WIS','INT','CHA']);
 assert.deepEqual(mapping.map(a=>a.name.zh),['力量','敏捷','耐力','人格','智力','幸运']);
 assert.deepEqual(mapping.map(a=>a.name.en),['Strength','Agility','Stamina','Personality','Intelligence','Luck']);
 const result=core.exportResult(s);
 assert.deepEqual(result.nativeScores,{STR:3,AGI:18,STA:6,PER:15,INT:9,LCK:12});
 assert.deepEqual(result.nativeBaseScores,result.nativeScores);assert.deepEqual(result.abilityMapping,mapping);
 for(const locale of ['zh','en']) {
  const text=core.formatResult(s,locale);
  assert.match(text,/STR 3 \/ AGI 18 \/ STA 6 \/ PER 15 \/ INT 9 \/ LCK 12/);
  assert.doesNotMatch(text,/\b(?:DEX|CON|WIS|CHA)\b/);
 }
 assert.equal(core.serializeSession(s),json);
 for(const v of core.listVersions().filter(v=>v.id!=='dcc')) {
  assert.equal(core.getAbilityDisplay(v.id,'WIS').id,'WIS');
  assert.equal(core.getAbilityDisplay(v.id,'WIS').name.zh,v.id==='adnd2e'?'灵知':'感知');
 }
 assert.equal(core.getAbilityDisplay('dcc','WIS').name.zh,'人格');
 assert.throws(()=>{mapping[0].name.zh='错误';},TypeError);
});

for(const [score,modifier] of [[3,-3],[4,-2],[5,-2],[6,-1],[7,-1],[8,-1],[9,0],[10,0],[11,0],[12,0],[13,1],[14,1],[15,1],[16,2],[17,2],[18,3]])test(`V4-03 DCC modifier ${score} -> ${modifier}`,()=>{
 assert.equal(core.dccAbilityModifier(score),modifier);
});
test('V4-03 modifiers survive native result export and text formatting without altering stored scores',()=>{
 const s=core.applyAction(rolled(),{type:'finalize'}),r=core.exportResult(s);
 assert.deepEqual(r.nativeModifiers,{STR:-3,AGI:3,STA:-1,PER:1,INT:0,LCK:0});
 assert.match(core.formatResult(s,'en'),/STR 3 \(-3\) \/ AGI 18 \(\+3\) \/ STA 6 \(-1\) \/ PER 15 \(\+1\) \/ INT 9 \(0\) \/ LCK 12 \(0\)/);
 for(const n of [2,19,7.5,NaN,Infinity])assert.throws(()=>core.dccAbilityModifier(n),RangeError);
 let old=core.applyAction(core.createSession({versionId:'odnd1974',methodId:'odnd1974.3d6-in-order'}),{type:'roll'},core.sequenceRng(Array(18).fill(4)));
 old=core.applyAction(old,{type:'finalize'});assert.equal(core.exportResult(old).nativeModifiers,null);
 assert.doesNotMatch(core.formatResult(old,'en'),/\(\+?0\)/);
});
