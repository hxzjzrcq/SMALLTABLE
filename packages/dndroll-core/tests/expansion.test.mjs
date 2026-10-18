import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,applyAction,getSessionView,serializeSession,deserializeSession,sequenceRng,exportResult,formatResult,RULES_VERSION} from '../dist/index.js';
const make=id=>createSession({versionId:id.split('.')[0],methodId:id});
const act=(s,a,dice=[])=>applyAction(s,a,sequenceRng(dice));
const stats=n=>({STR:n,DEX:n,CON:n,INT:n,WIS:n,CHA:n});
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);

test('VII exact 75, 3–18 bounds; manual d100 once, retained across STR edits; export and replay',()=>{
 let s=make('adnd2e.sp-VII');
 rejects(()=>act(s,{type:'setScore',ability:'STR',score:19}),'SCORE_RANGE');
 rejects(()=>act(s,{type:'finalize',acceptUnspent:true}),'INCOMPLETE');
 for(const [ab,n] of Object.entries({STR:18,DEX:15,CON:12,INT:10,WIS:10,CHA:10}))s=act(s,{type:'setScore',ability:ab,score:n});
 assert.equal(getSessionView(s).pointBuy.spent,75);assert.equal(getSessionView(s).exceptionalStrength.value,null);
 rejects(()=>act(s,{type:'finalize'}),'INCOMPLETE');
 s=act(s,{type:'rollExceptional'},[100]);
 rejects(()=>act(s,{type:'rollExceptional'},[1]),'EXCEPTIONAL_NOT_ALLOWED');
 s=act(s,{type:'setScore',ability:'STR',score:17});s=act(s,{type:'setScore',ability:'STR',score:18});
 assert.equal(getSessionView(s).exceptionalStrength.value,100);
 s=act(s,{type:'finalize'});assert.equal(exportResult(s).exceptionalStrength,100);assert.match(formatResult(s),/STR 18\/00/);
 assert.deepEqual(deserializeSession(serializeSession(s)),s);
});

test('VIII fixed 24 pool, cap 6 differs from PF1; automatic percentile follows final STR',()=>{
 let s=make('adnd2e.sp-VIII');rejects(()=>act(s,{type:'setPool',counts:{...stats(3),STR:9}}),'BAD_POOL');
 s=act(s,{type:'setPool',counts:stats(4)});s=act(s,{type:'roll'},[...Array(24).fill(6),77]);
 assert.equal(s.events[1].dice.length,24);assert.deepEqual(s.events[2],{action:{type:'rollExceptional'},dice:[77]});
 assert.equal(getSessionView(s).exceptionalStrength.value,77);assert.deepEqual(deserializeSession(serializeSession(s)),s);
});

const rows=[[2,68,18],[3,70,18],[4,72,17],[5,72,18],[6,74,17],[7,74,18],[8,76,17],[9,76,16],[10,78,16],[11,78,15],[12,80,15]];
for(const [total,budget,maximum]of rows)test(`IX 2d6=${total}: budget ${budget}, cap ${maximum}`,()=>{
 let s=make('adnd2e.sp-IX');assert.equal(getSessionView(s).attempt.generated,false);assert.equal(getSessionView(s).pointBuy,null);
 rejects(()=>act(s,{type:'setScore',ability:'STR',score:12}),'SCORE_RANGE');
 const first=Math.min(6,total-1);s=act(s,{type:'roll'},[first,total-first]);
 const v=getSessionView(s);assert.equal(v.pointBuy.budget,budget);assert.equal(v.attempt.pointGeneration.maximum,maximum);
 if(maximum<18)rejects(()=>act(s,{type:'setScore',ability:'STR',score:maximum+1}),'SCORE_RANGE');
 assert.deepEqual(deserializeSession(serializeSession(s)),s);
});

test('X buys exceptional Strength from same budget, no d100; lowering STR refunds and clears purchase',()=>{
 let s=make('adnd2e.sp-X');s=act(s,{type:'setScore',ability:'STR',score:18});
 s=act(s,{type:'buyExceptional',percent:30});assert.equal(getSessionView(s).pointBuy.spent,21+15);
 s=act(s,{type:'buyExceptional',percent:100});assert.equal(getSessionView(s).pointBuy.spent,28+15);
 rejects(()=>act(s,{type:'buyExceptional',percent:35}),'BAD_PERCENT');rejects(()=>act(s,{type:'rollExceptional'},[55]),'EXCEPTIONAL_NOT_ALLOWED');
 s=act(s,{type:'setScore',ability:'STR',score:17});assert.equal(getSessionView(s).pointBuy.spent,17+15);assert.equal(getSessionView(s).attempt.exceptionalStrength,null);
 s=act(s,{type:'setScore',ability:'STR',score:18});s=act(s,{type:'buyExceptional',percent:100});
 for(const [ab,n]of Object.entries({DEX:12,CON:10,INT:10,WIS:10,CHA:5}))s=act(s,{type:'setScore',ability:ab,score:n});
 assert.equal(getSessionView(s).pointBuy.spent,75);s=act(s,{type:'finalize'});assert.equal(exportResult(deserializeSession(serializeSession(s))).exceptionalStrength,100);
});

test('1E/2E allocation rolls once at STR 18, retains percentile when unassigned/reassigned, logs d100 separately',()=>{
 for(const id of ['adnd1e.dmg-I','adnd2e.phb-III']){
  let s=make(id);s=act(s,{type:'roll'},Array(id.startsWith('adnd1e')?24:18).fill(6));assert.equal(getSessionView(s).exceptionalStrength,null);
  s=act(s,{type:'assign',assignments:{STR:'a1.r1'}},[42]);assert.equal(getSessionView(s).exceptionalStrength.value,42);
  s=act(s,{type:'assign',assignments:{DEX:'a1.r1'}});s=act(s,{type:'assign',assignments:{STR:'a1.r2',DEX:'a1.r1'}});
  assert.equal(getSessionView(s).exceptionalStrength.value,42);assert.equal(s.events.filter(e=>e.action.type==='rollExceptional').length,1);
  assert.deepEqual(deserializeSession(serializeSession(s)),s);
 }
});

test('2E pairs, sets and die allocation trigger auto d100; normal editions never do',()=>{
 let s=act(make('adnd2e.phb-II'),{type:'roll'},Array(36).fill(6));s=act(s,{type:'choosePair',ability:'STR',candidateId:'a1.r1'},[12]);assert.equal(getSessionView(s).exceptionalStrength.value,12);
 s=act(make('adnd1e.dmg-IV'),{type:'roll'},Array(216).fill(6));s=act(s,{type:'chooseSet',setId:'a1.set1'},[23]);s=act(s,{type:'chooseSet',setId:'a1.set2'});assert.equal(getSessionView(s).exceptionalStrength.value,23);
 s=act(make('adnd2e.phb-VI'),{type:'roll'},[6,4,1,1,1,1,1]);s=act(s,{type:'allocateDie',dieId:'a1.d1',ability:'STR'});s=act(s,{type:'allocateDie',dieId:'a1.d2',ability:'STR'},[34]);assert.equal(getSessionView(s).exceptionalStrength.value,34);
 s=act(make('pf1.classic'),{type:'roll'},Array(18).fill(6));s=act(s,{type:'assign',assignments:{STR:'a1.r1'}});assert.equal(getSessionView(s).exceptionalStrength,null);
});

test('Legacy 0.1 save reads without inventing dice, first edit upgrades rules and records actual percentile',()=>{
 const old={schemaVersion:1,rulesVersion:'0.1.0-2026-10-17',request:{versionId:'adnd2e',methodId:'adnd2e.phb-I',options:{}},events:[{action:{type:'roll'},dice:Array(18).fill(6)}]};
 let s=deserializeSession(JSON.stringify(old));assert.equal(s.rulesVersion,old.rulesVersion);assert.equal(getSessionView(s).attempt.exceptionalStrength,null);assert.deepEqual(JSON.parse(serializeSession(s)),old);
 s=act(s,{type:'finalize'},[61]);assert.equal(s.rulesVersion,RULES_VERSION);assert.equal(exportResult(s).exceptionalStrength,61);assert.deepEqual(deserializeSession(serializeSession(s)),s);
 const locked={...old,events:[...old.events,{action:{type:'finalize'},dice:[]}]};assert.equal(getSessionView(deserializeSession(JSON.stringify(locked))).phase,'complete');
});

test('Dice side validation rejects forged d100 and d6 logs; failed auto roll leaves input unchanged',()=>{
 let s=make('adnd2e.phb-I');const before=serializeSession(s);rejects(()=>act(s,{type:'roll'},Array(18).fill(6)),'BAD_RNG');assert.equal(serializeSession(s),before);
 s=act(s,{type:'roll'},[...Array(18).fill(6),99]);const bad=JSON.parse(serializeSession(s));bad.events[0].dice[0]=99;rejects(()=>deserializeSession(JSON.stringify(bad)),'BAD_DICE_LOG');bad.events[0].dice[0]=6;bad.events[1].dice[0]=101;rejects(()=>deserializeSession(JSON.stringify(bad)),'BAD_DICE_LOG');
});
