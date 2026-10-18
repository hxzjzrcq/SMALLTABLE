import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as core from '../dist/index.js';
const {createSession,applyAction,getSessionView,exportResult,sequenceRng,serializeSession,deserializeSession,validateSession,formatResult,ABILITIES}=core;
const make=(methodId,options)=>createSession({versionId:methodId.split('.')[0],methodId,...(options?{options}:{})});
const roll=(s,dice)=>applyAction(s,{type:'roll'},sequenceRng([...dice,50]));
const mapping=(ids)=>Object.fromEntries(ABILITIES.map((a,i)=>[a,ids[i]]));
const error=(fn,code)=>assert.throws(fn,e=>e instanceof core.RuleError&&e.code===code);
const done=s=>applyAction(s,{type:'finalize',acceptUnspent:true});
const stats=n=>Object.fromEntries(ABILITIES.map(a=>[a,n]));

test('Catalog: ten separate game entries, bilingual text, sources, 32 ready + 1 blocked',()=>{
  assert.equal(core.listVersions().length,10);
  const ms=core.listVersions().flatMap(v=>core.listMethods(v.id));
  assert.equal(ms.filter(m=>m.status==='ready').length,32);assert.equal(ms.filter(m=>m.status==='pending').length,1);
  for(const m of ms){assert.ok(m.name.zh&&m.name.en&&m.description.zh&&m.description.en&&m.source.url);}
  error(()=>make('adnd1e.ua-V'),'METHOD_PENDING');
  error(()=>createSession({versionId:'pf1',methodId:'dnd35.phb-roll'}),'VERSION_MISMATCH');
  error(()=>make('pf1.purchase',{budget:27}),'BAD_BUDGET');
  error(()=>make('adnd2e.phb-I',{inOrder:true}),'BAD_OPTION');
});

test('Golden totals: all 4d6 methods remove exactly one tied lowest die',()=>{
  for(const id of ['adnd1e.dmg-I','adnd2e.phb-V','dnd35.phb-roll','pf1.standard','dnd5e2014.roll','dnd5e2024.roll']){
    const s=roll(make(id),Array(6).fill([1,1,5,6]).flat()),v=getSessionView(s);
    assert.deepEqual(v.attempt.candidates.map(c=>c.total),[12,12,12,12,12,12]);
    assert.equal(v.attempt.candidates[0].dice.filter(d=>!d.kept).length,1);
  }
});

test('Golden fixed order: OD&D CON/DEX differs from B/X, OSE and modern 2E',()=>{
  const dice=[1,1,1,1,1,2,1,1,3,1,1,4,1,1,5,1,1,6];
  const fixtures={
    'odnd1974.3d6-in-order':{STR:3,INT:4,WIS:5,CON:6,DEX:7,CHA:8},
    'bx1981.3d6-in-order':{STR:3,INT:4,WIS:5,DEX:6,CON:7,CHA:8},
    'ose-classic.3d6-in-order':{STR:3,INT:4,WIS:5,DEX:6,CON:7,CHA:8},
    'adnd2e.phb-I':{STR:3,DEX:4,CON:5,INT:6,WIS:7,CHA:8},
  };
  for(const [id,expected]of Object.entries(fixtures)){
    const s=roll(make(id),dice);assert.deepEqual(exportResult(done(s)).baseScores,expected);
    error(()=>applyAction(s,{type:'assign',assignments:{}}),'WRONG_ACTION');
  }
});

test('2E II permits low selection but only within that ability pair',()=>{
  let s=roll(make('adnd2e.phb-II'),Array(6).fill([1,1,6,4,4,6]).flat());
  for(const a of ABILITIES){const c=getSessionView(s).attempt.candidates.find(c=>c.ability===a);s=applyAction(s,{type:'choosePair',ability:a,candidateId:c.id});}
  assert.deepEqual(exportResult(done(s)).baseScores,stats(8));
  error(()=>applyAction(s,{type:'choosePair',ability:'STR',candidateId:'a1.r3'}),'BAD_CANDIDATE');
});

test('1E II forces highest six; 2E IV permits lower six',()=>{
  const dice=[...Array(18).fill(1),...Array(18).fill(6)];
  let a=roll(make('adnd1e.dmg-II'),dice),b=roll(make('adnd2e.phb-IV'),dice);
  const low=mapping(['a1.r1','a1.r2','a1.r3','a1.r4','a1.r5','a1.r6']);
  error(()=>applyAction(a,{type:'assign',assignments:low}),'BAD_CANDIDATE');
  b=applyAction(b,{type:'assign',assignments:low});assert.deepEqual(exportResult(done(b)).baseScores,stats(3));
  a=applyAction(a,{type:'assign',assignments:mapping(['a1.r7','a1.r8','a1.r9','a1.r10','a1.r11','a1.r12'])});assert.deepEqual(exportResult(done(a)).baseScores,stats(18));
});

test('1E II tied cutoff may choose any tied ID but cannot omit a higher result',()=>{
  const s=roll(make('adnd1e.dmg-II'),[6,6,6,...Array(33).fill(3)]);
  const bad=applyAction(s,{type:'assign',assignments:mapping(['a1.r2','a1.r3','a1.r4','a1.r5','a1.r6','a1.r7'])});
  assert.equal(getSessionView(bad).canFinalize,false);error(()=>done(bad),'INCOMPLETE');
  const good=applyAction(s,{type:'assign',assignments:mapping(['a1.r1','a1.r3','a1.r5','a1.r8','a1.r10','a1.r12'])});assert.equal(exportResult(done(good)).baseScores.STR,18);
});

test('1E III uses six independent rolls per fixed ability, 108 dice',()=>{
  const dice=[];for(let i=1;i<=6;i++)dice.push(...Array(15).fill(1),i,i,i);
  const s=roll(make('adnd1e.dmg-III'),dice);
  assert.deepEqual(exportResult(done(s)).baseScores,{STR:3,INT:6,WIS:9,DEX:12,CON:15,CHA:18});
  assert.equal(s.events[0].dice.length,108);
});

test('1E IV chooses an intact set and consumes 216 dice',()=>{
  let s=roll(make('adnd1e.dmg-IV'),[...Array(198).fill(1),...Array(18).fill(6)]);
  assert.equal(s.events[0].dice.length,216);error(()=>done(s),'INCOMPLETE');
  s=applyAction(s,{type:'chooseSet',setId:'a1.set12'});assert.deepEqual(exportResult(done(s)).baseScores,stats(18));
  error(()=>applyAction(s,{type:'assign',assignments:{STR:'a1.r1'}}),'WRONG_ACTION');
});

test('2E VI: whole dice, movable assignments, cap, completion and conservation',()=>{
  let s=roll(make('adnd2e.phb-VI'),[6,5,4,3,2,1,6]);
  s=applyAction(s,{type:'allocateDie',dieId:'a1.d1',ability:'STR'});
  const snapshot=serializeSession(s);
  error(()=>applyAction(s,{type:'allocateDie',dieId:'a1.d2',ability:'STR'}),'SCORE_CAP');assert.equal(serializeSession(s),snapshot);
  s=applyAction(s,{type:'allocateDie',dieId:'a1.d3',ability:'STR'});
  error(()=>done(s),'INCOMPLETE');
  for(const [id,stat]of [['a1.d2','DEX'],['a1.d4','CON'],['a1.d5','INT'],['a1.d6','WIS'],['a1.d7','CHA']])s=applyAction(s,{type:'allocateDie',dieId:id,ability:stat});
  assert.deepEqual(exportResult(done(s)).baseScores,{STR:18,DEX:13,CON:11,INT:10,WIS:9,CHA:14});
  s=applyAction(s,{type:'allocateDie',dieId:'a1.d1',ability:null});assert.equal(getSessionView(s).attempt.scores.STR,12);
  s=applyAction(s,{type:'allocateDie',dieId:'a1.d1',ability:'CON'});assert.equal(getSessionView(s).attempt.scores.CON,17);
  assert.equal(Object.values(exportResult(done(s)).baseScores).reduce((a,b)=>a+b),75);
});

test('Free assignment identities survive duplicates; values cannot be fabricated',()=>{
  let s=roll(make('adnd2e.phb-III'),Array(18).fill(4));
  error(()=>applyAction(s,{type:'assign',assignments:{STR:'a1.r1',DEX:'a1.r1'}}),'DUPLICATE_RESULT');
  error(()=>applyAction(s,{type:'assign',assignments:{STR:'invented'}}),'BAD_CANDIDATE');
  error(()=>applyAction(s,{type:'setScore',ability:'STR',score:18}),'WRONG_ACTION');
  s=applyAction(s,{type:'assign',assignments:mapping(['a1.r6','a1.r5','a1.r4','a1.r3','a1.r2','a1.r1'])});assert.deepEqual(exportResult(done(s)).baseScores,stats(12));
});

test('PF1 Classic uses preselected order; Heroic adds six',()=>{
  const s=roll(make('pf1.classic',{inOrder:true}),Array(18).fill(1));assert.deepEqual(exportResult(done(s)).baseScores,stats(3));
  error(()=>applyAction(s,{type:'assign',assignments:{}}),'WRONG_ACTION');
  let h=roll(make('pf1.heroic'),[1,2,2,3,3,4,4,5,5,6,6,6]);assert.deepEqual(getSessionView(h).attempt.candidates.map(c=>c.total),[9,11,13,15,17,18]);
  h=applyAction(h,{type:'assign',assignments:mapping(['a1.r1','a1.r2','a1.r3','a1.r4','a1.r5','a1.r6'])});assert.ok(formatResult(done(h),'en').includes('1+2+6 = 9'));
});

test('PF1 dice pool: allocation before rolling; 24/28 totals; highest three',()=>{
  let s=make('pf1.dice-pool');let called=0;
  error(()=>applyAction(s,{type:'roll'},()=>{called++;return 6;}),'BAD_POOL_TOTAL');assert.equal(called,0);
  error(()=>applyAction(s,{type:'setPool',counts:{STR:2,DEX:4,CON:4,INT:4,WIS:4,CHA:6}}),'BAD_POOL');
  s=applyAction(s,{type:'setPool',counts:stats(4)});s=roll(s,Array(6).fill([1,2,5,6]).flat());assert.deepEqual(exportResult(done(s)).baseScores,stats(13));
  error(()=>applyAction(s,{type:'setPool',counts:stats(4)}),'WRONG_PHASE');
  let t=make('pf1.dice-pool',{poolTotal:28});t=applyAction(t,{type:'setPool',counts:{...stats(4),STR:8}});t=roll(t,Array(28).fill(6));assert.deepEqual(exportResult(done(t)).baseScores,stats(18));
});

test('Three point tables use independent costs, bases, bounds and budget completion',()=>{
  for(const [id,cost]of [['dnd35.dmg-point-buy',6],['pf1.purchase',5],['dnd5e2014.point-buy',7],['dnd5e2024.point-buy',7]]){
    let s=make(id);s=applyAction(s,{type:'setScore',ability:'STR',score:14});assert.equal(getSessionView(s).pointBuy.spent,cost);
    error(()=>applyAction(s,{type:'finalize'}),'UNSPENT_CONFIRMATION');assert.ok(exportResult(done(s)));
  }
  let pf=make('pf1.purchase',{budget:25});pf=applyAction(pf,{type:'setScore',ability:'STR',score:7});assert.equal(getSessionView(pf).pointBuy.remaining,29);
  for(const id of ['dnd5e2014.point-buy','dnd5e2024.point-buy']){
    let s=make(id);for(const a of ['STR','DEX','CON'])s=applyAction(s,{type:'setScore',ability:a,score:15});assert.equal(getSessionView(s).pointBuy.remaining,0);assert.ok(exportResult(applyAction(s,{type:'finalize'})));
    s=applyAction(s,{type:'setScore',ability:'INT',score:9});error(()=>done(s),'INCOMPLETE');
    error(()=>applyAction(s,{type:'setScore',ability:'INT',score:16}),'SCORE_RANGE');
    error(()=>applyAction(s,{type:'setScore',ability:'INT',score:7}),'SCORE_RANGE');
  }
});

function diceForScore(n){for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(a+b+c===n)return [1,a,b,c];throw Error('bad fixture');}
test('3.5 reroll uses OR and inclusive boundaries, without forcing reroll',()=>{
  for(const [values,allowed]of [ [[13,13,13,13,13,13],true],[[14,10,10,10,8,8],true],[[14,12,10,10,8,8],false] ]){
    const s=roll(make('dnd35.phb-roll'),values.flatMap(diceForScore));assert.equal(getSessionView(s).canRuleReroll,allowed);
    if(allowed){const next=applyAction(s,{type:'reroll',reason:'rule'},sequenceRng(Array(24).fill(6)));assert.equal(getSessionView(next).previousAttempts.length,1);assert.equal(getSessionView(next).attempt.number,2);}
    else error(()=>applyAction(s,{type:'reroll',reason:'rule'}),'REROLL_NOT_ALLOWED');
    const selected=applyAction(s,{type:'assign',assignments:mapping(['a1.r1','a1.r2','a1.r3','a1.r4','a1.r5','a1.r6'])});assert.ok(exportResult(done(selected)));
  }
  for(const id of ['pf1.standard','dnd5e2014.roll','dnd5e2024.roll']){
    const s=roll(make(id),Array(24).fill(1));assert.equal(getSessionView(s).canRuleReroll,false);error(()=>applyAction(s,{type:'reroll',reason:'rule'}),'REROLL_NOT_ALLOWED');
  }
});

test('B/X and OSE trade restrictions, donor minimum, cap and resetting',()=>{
  for(const id of ['bx1981.3d6-in-order','ose-classic.3d6-in-order']){
    let s=roll(make(id),Array(18).fill(4));s=applyAction(s,{type:'selectClass',classId:'thief'});
    error(()=>applyAction(s,{type:'trade',from:'STR',to:'DEX'}),'BAD_TRADE');
    s=applyAction(s,{type:'trade',from:'INT',to:'DEX'});assert.equal(getSessionView(s).attempt.scores.INT,10);assert.equal(getSessionView(s).attempt.scores.DEX,13);
    error(()=>applyAction(s,{type:'trade',from:'INT',to:'DEX'}),'BAD_TRADE_RANGE');
    assert.equal(exportResult(done(s)).baseScores.INT,12);
    s=applyAction(s,{type:'resetAdjustments'});assert.equal(getSessionView(s).attempt.scores.INT,12);
    s=applyAction(s,{type:'selectClass',classId:'elf'});error(()=>applyAction(s,{type:'trade',from:'STR',to:'INT'}),'BAD_TRADE');
  }
  let s=roll(make('ose-classic.3d6-in-order'),Array(18).fill(6));s=applyAction(s,{type:'selectClass',classId:'fighter'});error(()=>applyAction(s,{type:'trade',from:'INT',to:'STR'}),'BAD_TRADE_RANGE');
  const low=roll(make('bx1981.3d6-in-order'),Array(18).fill(1));error(()=>applyAction(low,{type:'selectClass',classId:'dwarf'}),'CLASS_MINIMUM');error(()=>applyAction(low,{type:'selectClass',classId:'elf'}),'CLASS_MINIMUM');error(()=>applyAction(low,{type:'selectClass',classId:'halfling'}),'CLASS_MINIMUM');
});

test('Referee replacement requires an explicit note and preserves prior rolls',()=>{
  let s=roll(make('ose-classic.3d6-in-order'),Array(18).fill(1));
  error(()=>applyAction(s,{type:'reroll',reason:'referee'}),'REFEREE_NOTE_REQUIRED');
  s=applyAction(s,{type:'reroll',reason:'referee',note:'主持人同意弃用低属性角色'},sequenceRng(Array(18).fill(6)));
  const out=exportResult(done(s));assert.equal(out.attempts.length,2);assert.equal(out.attempts[0].scores.STR,3);assert.equal(out.attempts[1].scores.STR,18);
  assert.ok(formatResult(done(s),'zh').includes('主持人同意'));
});

test('Save/load replays actions, detects malformed or illegal records, and freezes outputs',()=>{
  const s=roll(make('adnd2e.phb-I'),Array(18).fill(4));assert.deepEqual(deserializeSession(serializeSession(s)),s);
  const corrupt=JSON.parse(serializeSession(s));corrupt.events[0].dice[0]=7;error(()=>deserializeSession(JSON.stringify(corrupt)),'BAD_DICE_LOG');
  corrupt.events[0].dice[0]=4;corrupt.events[0].dice.push(4);error(()=>deserializeSession(JSON.stringify(corrupt)),'EXTRA_DICE');
  error(()=>deserializeSession('{'),'BAD_JSON');
  error(()=>applyAction(s,{type:'setScore',ability:'STR',score:NaN}),'BAD_ACTION');
  error(()=>applyAction(s,{type:'hack'}),'BAD_ACTION');
  error(()=>applyAction(s,{type:'roll',surprise:true}),'UNKNOWN_FIELD');
  assert.throws(()=>{s.events.push({});});assert.throws(()=>{getSessionView(s).attempt.scores.STR=99;});
  const finished=done(s);error(()=>applyAction(finished,{type:'roll'}),'COMPLETED');
  assert.equal(validateSession(finished).complete,true);assert.equal(validateSession(corrupt).valid,false);
  const before=serializeSession(finished);assert.match(formatResult(finished,'zh'),/第二版/);assert.match(formatResult(finished,'en'),/AD&D 2E/);assert.equal(serializeSession(finished),before);
});

test('Fixed RNG failures are explicit; no hidden random fallback',()=>{
  error(()=>roll(make('adnd2e.phb-I'),[6]),'BAD_RNG');
  error(()=>applyAction(make('adnd2e.phb-I'),{type:'roll'},()=>0),'BAD_RNG');
  error(()=>applyAction(make('adnd2e.phb-I'),{type:'roll'},()=>2.5),'BAD_RNG');
});

// Full lifecycle coverage for every advertised ready method, using deterministic dice.
for(const v of core.listVersions())for(const m of core.listMethods(v.id).filter(m=>m.status==='ready'))test(`Lifecycle: ${m.id}`,()=>{
  let s=make(m.id),view=getSessionView(s),rng=sequenceRng(Array(216).fill(4));
  if(m.mode==='pool')s=applyAction(s,{type:'setPool',counts:stats(4)});
  if(!getSessionView(s).attempt.generated)s=applyAction(s,{type:'roll'},rng);
  view=getSessionView(s);
  if(['assign','best-six','array'].includes(m.mode))s=applyAction(s,{type:'assign',assignments:mapping(view.attempt.candidates.filter(c=>c.eligible).slice(0,6).map(c=>c.id))});
  if(m.mode==='pairs')for(const a of ABILITIES)s=applyAction(s,{type:'choosePair',ability:a,candidateId:view.attempt.candidates.find(c=>c.ability===a).id});
  if(m.mode==='sets')s=applyAction(s,{type:'chooseSet',setId:'a1.set1'});
  if(m.mode==='allocate')for(const [i,d]of view.attempt.looseDice.entries())s=applyAction(s,{type:'allocateDie',dieId:d.id,ability:ABILITIES[i%6]});
  if(m.versionId==='adnd2e'&&m.mode==='buy') {
    let remaining=getSessionView(s).pointBuy.budget-18;
    const cap=getSessionView(s).attempt.pointGeneration?.maximum??18;
    for(const ab of ABILITIES){const add=Math.min(cap-3,remaining);s=applyAction(s,{type:'setScore',ability:ab,score:3+add});remaining-=add;}
    if(getSessionView(s).exceptionalStrength?.canRoll)s=applyAction(s,{type:'rollExceptional'},sequenceRng([50]));
  }
  const final=done(s),exported=exportResult(final);assert.equal(Object.keys(exported.baseScores).length,6);
  assert.deepEqual(exportResult(deserializeSession(serializeSession(final))),exported);
});

test('Standalone browser bundle runs without Node APIs, network or imports',()=>{
  const context=vm.createContext({structuredClone,crypto:webcrypto});vm.runInContext(fs.readFileSync(new URL('../dist/dndroll.browser.js',import.meta.url),'utf8'),context);
  const api=context.DndRoll;assert.equal(api.listVersions().length,10);
  let s=api.createSession({versionId:'dnd5e2024',methodId:'dnd5e2024.array'});
  s=api.applyAction(s,{type:'assign',assignments:mapping(['a1.r1','a1.r2','a1.r3','a1.r4','a1.r5','a1.r6'])});s=api.applyAction(s,{type:'finalize'});
  assert.equal(api.exportResult(s).baseScores.STR,15);assert.equal(api.getSessionView(s).phase,'complete');
  const batch=api.generateBatch({versionId:'dcc',methodId:'dcc.3d6-in-order'},2,()=>4);
  assert.equal(batch.length,2);assert.equal(api.exportResult(batch[0].session).nativeScores.LCK,12);
  assert.equal(api.getAbilityDisplay('dcc','WIS').id,'PER');
});
