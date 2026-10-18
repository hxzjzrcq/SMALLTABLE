import type { Ability, ClassOption, Method, Mode, Source, Text, Version, VersionId } from './types.js';
export const RULES_VERSION = '0.4.0-2026-10-18';
export const ABILITIES: Ability[] = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
export const OLD_ORDER: Ability[] = ['STR', 'INT', 'WIS', 'DEX', 'CON', 'CHA'];
export const text = (zh: string, en: string): Text => ({ zh, en });
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
export const versions: Version[] = freeze([
  { id: 'odnd1974', name: text('OD&D（1974）', 'OD&D (1974)'), order: ['STR','INT','WIS','CON','DEX','CHA'] },
  { id: 'bx1981', name: text('B/X D&D（1981）', 'B/X D&D (1981)'), order: [...OLD_ORDER] },
  { id: 'ose-classic', name: text('OSE — 经典奇幻', 'OSE — Classic Fantasy'), order: [...OLD_ORDER] },
  { id: 'adnd1e', name: text('AD&D 第一版', 'AD&D 1E'), order: [...OLD_ORDER] },
  { id: 'adnd2e', name: text('AD&D 第二版', 'AD&D 2E'), order: [...ABILITIES] },
  { id: 'dnd35', name: text('D&D 3.5', 'D&D 3.5'), order: [...ABILITIES] },
  { id: 'pf1', name: text('Pathfinder 第一版', 'Pathfinder 1E'), order: [...ABILITIES] },
  { id: 'dnd5e2014', name: text('D&D 5E（2014）', 'D&D 5E (2014)'), order: [...ABILITIES] },
  { id: 'dcc', name: text('Dungeon Crawl Classics（DCC）', 'Dungeon Crawl Classics (DCC)'), order: ['STR','DEX','CON','WIS','INT','CHA'] },
  { id: 'dnd5e2024', name: text('D&D 5E（2024）', 'D&D 5E (2024)'), order: [...ABILITIES] },
]);
const source = (title: string, location: string, url: string, evidence: Source['evidence'] = 'transcription'): Source => ({title,location,url,evidence});
const sources: Record<VersionId, Source> = {
  dcc: source('Dungeon Crawl Classics RPG Quick Start Guide (June 2011)', 'p.2, Ability Scores / Table 1-1', 'https://www.goodman-games.com/downloads/DCCRPGQuickStartGuide060811.pdf', 'official-web'),
  odnd1974: source('Men & Magic (1974)','pp.10–11','https://anyflip.com/oahjl/yacw/basic'),
  bx1981: source('Moldvay Basic (1981)','pp.B5–B6, B13','https://www.americanroads.us/DandD/DnD_Basic_Rules_Moldvay.pdf','indexed-original'),
  'ose-classic': source('OSE Classic / Basic Rules','Creating a Character; Thief','https://osesrd.opengamingnetwork.com/player-characters/'),
  adnd1e: source('AD&D 1E Dungeon Masters Guide','p.11; reproduced in Dragon, Let the Good Dice Roll','https://1eonline.info/d/dice.odds.htm'),
  adnd2e: source('AD&D 2E Player’s Handbook','Chapter 1: Rolling Ability Scores','https://adnd2e.fandom.com/wiki/Rolling_Ability_Scores_(PHB)'),
  dnd35: source('D&D 3.5 Player’s Handbook','pp.7–8, Ability Scores / Rerolling','https://studylib.net/doc/18263338/3.5-player-s-handbook'),
  pf1: source('Pathfinder Core Rulebook','Generating Ability Scores','https://legacy.aonprd.com/corerulebook/gettingStarted.html','official-web'),
  dnd5e2014: source('D&D Basic Rules (2014)','Determine Ability Scores','https://www.dndbeyond.com/sources/dnd/basic-rules-2014/step-by-step-characters','official-web'),
  dnd5e2024: source('D&D Free Rules (2024)','Step 3: Determine Ability Scores','https://www.dndbeyond.com/sources/dnd/br-2024/creating-a-character','official-web'),
};
const dmg35 = source('D&D 3.5 Dungeon Master’s Guide','pp.169–170','https://anyflip.com/smqdp/kmty/basic/151-200','indexed-original');
const costs35 = {'8':0,'9':1,'10':2,'11':3,'12':4,'13':5,'14':6,'15':8,'16':10,'17':13,'18':16};
const costsPF = {'7':-4,'8':-2,'9':-1,'10':0,'11':1,'12':2,'13':3,'14':5,'15':7,'16':10,'17':13,'18':17};
const costs5 = {'8':0,'9':1,'10':2,'11':3,'12':4,'13':5,'14':7,'15':9};
const result: Method[] = [];
function add(versionId: VersionId, suffix: string, name: Text, description: Text, mode: Mode, extra: Partial<Method> = {}) {
  result.push({id:`${versionId}.${suffix}`,versionId,name,description,mode,source:sources[versionId],
    status:'ready',category:'official-option',notes:[],diceCount:3,keep:3,bonus:0,
    budgets:[],defaultBudget:null,costs:{},base:8,canChooseOrder:false,poolTotals:[],...extra});
}
add('dcc','3d6-in-order',text('3d6 顺序生成','3d6 in order'),text('按 STR（力量）、AGI（敏捷）、STA（耐力）、PER（人格）、INT（智力）、LCK（幸运）依次各掷 3d6，保留全部骰子，不交换结果。仅生成六属性及调整值，不是完整零级人物卡。','Roll 3d6 in order for STR (Strength), AGI (Agility), STA (Stamina), PER (Personality), INT (Intelligence), LCK (Luck). Keep all dice; no swapping. Generates abilities and modifiers only, not a complete level-0 character.'),'fixed',{category:'standard',notes:[text('不生成职业、出身、生命值、钱币、装备或幸运征兆。','Does not generate class, occupation, hit points, money, equipment or birth augur.')]});
add('odnd1974','3d6-in-order',text('三骰依序','3d6 in order'),text('依次为 STR、INT、WIS、CON、DEX、CHA 各掷 3d6，结果固定。原始流程由主持人掷骰。','Roll 3d6 for STR, INT, WIS, CON, DEX, CHA, in that order. The original procedure has the referee roll.'),'fixed',{category:'standard',notes:[text('仅生成六项基础属性；主属性经验换算尚未应用。','Generates the six base scores only; prime-requisite XP conversion is not applied.')]});
for (const v of ['bx1981','ose-classic'] as const) add(v,'3d6-in-order',text('三骰依序','3d6 in order'),text('按 STR、INT、WIS、DEX、CON、CHA 各掷 3d6。之后可选职业并按其限制调整主属性。','Roll 3d6 for STR, INT, WIS, DEX, CON, CHA in order. You may then choose a class and make its permitted prime-requisite exchanges.'),'fixed',{category:'standard',notes:[text('每次从允许的属性减 2 换主属性加 1；供出属性不低于 9，目标不超过 18。盗贼不能降低 STR。','Trade 2 eligible donor points for 1 prime-requisite point; donor minimum 9, target maximum 18. Thieves cannot lower STR.'),text('低属性重建须由主持人许可；程序不会自动重掷。','Replacing a poor character needs referee permission; no automatic rerolls.')]});
add('adnd1e','dmg-I',text('方法 I：四骰去最低','Method I: 4d6, drop lowest'),text('六次 4d6，各去掉一颗最低骰；总和自由分配。','Generate six 4d6 totals, dropping one lowest die each time; assign freely.'),'assign',{diceCount:4});
add('adnd1e','dmg-II',text('方法 II：十二取最高六个','Method II: best six of twelve'),text('掷十二次 3d6，保留最高六个总和，再自由分配。','Keep the highest six of twelve 3d6 totals; assign freely.'),'best-six');
add('adnd1e','dmg-III',text('方法 III：每项六次取最高','Method III: best of six per ability'),text('每项属性掷六次 3d6，取该项最高总和；属性固定。','For each fixed ability, keep the highest of six 3d6 totals.'),'best-per-ability');
add('adnd1e','dmg-IV',text('方法 IV：十二套选一','Method IV: one of twelve characters'),text('生成十二套依序的六项 3d6 属性，选择完整的一套，不能跨套拼接。','Generate twelve in-order 3d6 characters; choose one intact set.'),'sets');
add('adnd1e','ua-V',text('UA 方法 V：职业骰池（待核准）','UA Method V: class pools (pending)'),text('限人类，按职业表掷骰并取最高三颗，再处理职业上下限和容貌。完整限制核准前不可使用。','Human-only class dice pools, keeping the highest three; class limits and Comeliness apply. Unavailable until full constraints are verified.'),'pending',{status:'pending',source:source('AD&D Unearthed Arcana','pp.6, 14–18, 74','https://donperkins.net/dnd/books/Unearthed_Arcana.pdf','indexed-original'),notes:[text('骰数表已取得；完整职业限制与特殊步骤仍待核准。','Dice counts located; full class constraints and special steps remain under review.')]});
const two: [string,Text,Text,Mode,number][] = [
 ['I',text('方法 I：三骰依序','Method I: 3d6 in order'),text('按 STR、DEX、CON、INT、WIS、CHA 各掷 3d6。','Roll 3d6 in order: STR, DEX, CON, INT, WIS, CHA.'),'fixed',3],
 ['II',text('方法 II：每项两次择一','Method II: choose from two per ability'),text('每项掷两次 3d6，任选一个结果；属性位置固定。','For each fixed ability, choose either of two 3d6 totals.'),'pairs',3],
 ['III',text('方法 III：三骰自由分配','Method III: assign six 3d6 totals'),text('掷六次 3d6，自由分配给六项属性。','Roll six 3d6 totals and assign freely.'),'assign',3],
 ['IV',text('方法 IV：十二次任选六个','Method IV: choose six of twelve'),text('掷十二次 3d6，任选六个结果并自由分配；可以选择低值。','Choose any six of twelve 3d6 totals and assign freely, including lower results.'),'assign',3],
 ['V',text('方法 V：四骰去最低','Method V: 4d6, drop lowest'),text('六次 4d6，各去一颗最低骰；总和自由分配。','Generate six 4d6 totals, dropping one lowest die each time; assign freely.'),'assign',4],
 ['VI',text('方法 VI：八点基础加七颗骰','Method VI: base eight plus seven dice'),text('六项从 8 开始，将七颗 d6 的结果逐颗分配。单颗不能拆分，属性不能超过 18。','Start all scores at 8; allocate seven rolled d6 whole. No score may exceed 18.'),'allocate',1],
];
for (const [id,n,d,mode,diceCount] of two) add('adnd2e',`phb-${id}`,n,d,mode,{diceCount,category:id==='I'?'standard':'official-option'});
const spSource = source('AD&D 2E Player’s Option: Skills & Powers','pp.8–9; Character Generation (Methods VII–X)','https://regalgoblins.com/2erules/SP/DD02864.htm');
const spCosts = Object.fromEntries(Array.from({length:16},(_,i)=>[String(i+3),i+3]));
add('adnd2e','sp-VII',text('方法 VII：75 点分配','Method VII: 75-point allocation'),text('将 75 点直接分配给六项属性，每项 3–18，总和必须为 75。STR 18 时点击投传奇力量。','Distribute exactly 75 points among six scores, each 3–18. Click to roll exceptional Strength at STR 18.'),'buy',{source:spSource,costs:spCosts,base:3,budgets:[75],defaultBudget:75});
add('adnd2e','sp-VIII',text('方法 VIII：24d6 骰池','Method VIII: 24d6 dice pool'),text('掷骰前分配 24 颗 d6，每项 3–6 颗，取各项最高三颗相加。','Allocate 24d6 before rolling, 3–6 dice per ability, and sum the highest three for each.'),'pool',{source:spSource,poolTotals:[24],poolMax:6});
add('adnd2e','sp-IX',text('方法 IX：随机预算分配','Method IX: random point allocation'),text('先投 2d6 查表取得 68–80 点预算及 15–18 的单项上限，再直接分配全部点数，每项至少 3。STR 18 时点击投传奇力量。','Roll 2d6 for a 68–80 point budget and a 15–18 score cap, then distribute all points, minimum 3 per score. Click to roll exceptional Strength at STR 18.'),'buy',{source:spSource,costs:spCosts,base:3,randomBudget:true});
add('adnd2e','sp-X',text('方法 X：75 点含传奇力量购买','Method X: 75 points including exceptional Strength'),text('将 75 点直接分配，每项 3–18；STR 18 后每额外 1 点购买 10% 传奇力量。18/30 共花 21 点，18/00 共花 28 点。','Distribute exactly 75 points, each score 3–18. At STR 18, each extra point buys 10 exceptional Strength percentage points: 18/30 costs 21 and 18/00 costs 28.'),'buy',{source:spSource,costs:spCosts,base:3,budgets:[75],defaultBudget:75});
add('dnd35','phb-roll',text('标准随机生成','Standard random generation'),text('六次 4d6 去最低，自由分配。种族调整前，调整值总和≤0 或最高属性≤13 时，可重掷整组。','Assign six 4d6-drop-lowest totals. Before racial changes, a modifier sum ≤0 or highest score ≤13 permits a whole-set reroll.'),'assign',{diceCount:4,category:'standard'});
add('dnd35','dmg-point-buy',text('购点','Point buy'),text('六项从 8 开始，按 3.5 表购买到最高 18；标准 25 点，另有 15/22/28/32 点。','Start at 8; buy up to 18 using 3.5 costs. Standard budget 25; alternatives 15/22/28/32.'),'buy',{source:dmg35,costs:costs35,budgets:[15,22,25,28,32],defaultBudget:25});
add('dnd35','dmg-elite-array',text('精英数组','Elite array'),text('将 15、14、13、12、10、8 分配给六项属性，不掷骰。','Assign 15, 14, 13, 12, 10, 8 to the six abilities without rolling.'),'array',{source:dmg35});
add('pf1','standard',text('标准','Standard'),text('六次 4d6，各去一颗最低骰，总和自由分配。','Assign six 4d6 totals with one lowest die removed from each.'),'assign',{diceCount:4,category:'standard'});
add('pf1','classic',text('经典','Classic'),text('六次 3d6，自由分配；也可在开始前选择依序填写。','Generate six 3d6 totals; assign freely or choose in-order generation before starting.'),'assign',{canChooseOrder:true});
add('pf1','heroic',text('英雄','Heroic'),text('掷六组 2d6+6，总和自由分配。','Generate six 2d6+6 totals and assign freely.'),'assign',{diceCount:2,keep:2,bonus:6});
add('pf1','dice-pool',text('骰池','Dice Pool'),text('掷骰前分配 24 颗 d6，每项至少三颗；各项取最高三颗。高强度选项为 28 颗。','Allocate 24 d6 before rolling, at least three per ability; retain each ability’s highest three. Higher-powered option: 28 dice.'),'pool',{poolTotals:[24,28]});
add('pf1','purchase',text('购点','Purchase'),text('从 10 开始，按 PF1 成本增减至 7–18；预算 10/15/20/25 点，标准 15 点。','Start at 10; purchase or lower scores within 7–18 using PF1 costs. Budgets 10/15/20/25; standard 15.'),'buy',{base:10,costs:costsPF,budgets:[10,15,20,25],defaultBudget:15});
for (const v of ['dnd5e2014','dnd5e2024'] as const) {
  add(v,'roll',text('随机生成','Random generation'),text('六次 4d6，各取最高三颗相加；总和自由分配。没有默认低值重掷条件。','Assign six totals from the highest three of four d6. No default low-score reroll rule.'),'assign',{diceCount:4,category:'standard'});
  add(v,'array',text('标准数组','Standard array'),text('将 15、14、13、12、10、8 分配给六项属性。','Assign 15, 14, 13, 12, 10, 8 to the six abilities.'),'array',{category:'standard'});
  add(v,'point-buy',text('27 点购点','27-point buy'),text('按 5E 成本表购买六项基础属性，范围 8–15，共 27 点。','Spend 27 points using 5E costs; each base score must be 8–15.'),'buy',{costs:costs5,budgets:[27],defaultBudget:27,category:v==='dnd5e2014'?'official-option':'standard'});
}
export const methods: Method[] = freeze(result);
export const classes: ClassOption[] = freeze([
  {id:'fighter',name:text('战士','Fighter'),donors:['INT','WIS'],targets:['STR'],minimums:{}},
  {id:'dwarf',name:text('矮人','Dwarf'),donors:['INT','WIS'],targets:['STR'],minimums:{CON:9}},
  {id:'elf',name:text('精灵','Elf'),donors:['WIS'],targets:['STR','INT'],minimums:{INT:9}},
  {id:'halfling',name:text('半身人','Halfling'),donors:['INT','WIS'],targets:['STR','DEX'],minimums:{DEX:9,CON:9}},
  {id:'magic-user',name:text('魔法师','Magic-User'),donors:['STR','WIS'],targets:['INT'],minimums:{}},
  {id:'cleric',name:text('牧师','Cleric'),donors:['STR','INT'],targets:['WIS'],minimums:{}},
  {id:'thief',name:text('盗贼','Thief'),donors:['INT','WIS'],targets:['DEX'],minimums:{}},
]);
freeze(ABILITIES); freeze(OLD_ORDER);
